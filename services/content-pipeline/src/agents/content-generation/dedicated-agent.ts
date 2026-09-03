/**
 * Dedicated Article Generation Agent
 *
 * Generates an original article from a user-provided prompt, bypassing
 * the Content Aggregator entirely. Uses Claude via generateContent().
 *
 * Steps:
 * 1. Read site brief from Git
 * 2. Generate article using dedicated prompts (no source material)
 * 3. Parse + validate the generated body
 * 4. Deduplicate slug against existing articles
 * 5. Ensure topic tag
 * 6. Score quality
 * 7. Build frontmatter + serialize to markdown
 * 8. Commit to Git via writeArticleBatch
 * 9. Trigger n8n image generation (fire-and-forget)
 */

import matter from "gray-matter";
import { randomUUID } from "node:crypto";

import { createOctokit, readFile } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import { generateContent } from "../../lib/ai.js";
import { writeArticleBatch } from "../../lib/writer.js";
import { upsertArticleMeta } from "../../lib/db/articles.js";
import { parseGeneratedArticle } from "./generators/base-generator.js";
import { validateArticleBody, ensureTopicTag } from "./agent.js";
import { scoreArticle, resolveStatus as resolveQualityStatus } from "../content-quality/scorer.js";
import { triggerN8nImage, trackPendingImage, createGitImageVerifier } from "./n8n-image.js";
import { buildArticlePrompts } from "./prompts/build-prompts.js";
import { recordTextUsage } from "../../costs/recorder.js";
import type { AgentConfig } from "../../lib/config.js";
import type { ArticleFrontmatter, ArticleType, QualityScoreBreakdown } from "../../types.js";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DedicatedGenerationParams {
  siteDomain: string;
  branch: string;
  userPrompt: string;
}

export interface DedicatedGenerationResult {
  status: "created" | "error";
  slug?: string;
  path?: string;
  message?: string;
  qualityScore?: number;
  articleStatus?: "published" | "review";
  n8nImageTriggered: boolean;
}

// ---------------------------------------------------------------------------
// Internal: frontmatter type with extras
// ---------------------------------------------------------------------------

interface ArticleFrontmatterWithExtras extends ArticleFrontmatter {
  generated_by?: string;
  quality_score?: number;
  score_breakdown?: QualityScoreBreakdown;
  quality_note?: string;
  reading_time?: number;
}

// ---------------------------------------------------------------------------
// Valid article types
// ---------------------------------------------------------------------------

const VALID_ARTICLE_TYPES: ArticleType[] = ["listicle", "how-to", "review", "standard"];

// ---------------------------------------------------------------------------
// Slug uniqueness check
// ---------------------------------------------------------------------------

async function slugExists(
  config: AgentConfig,
  siteDomain: string,
  slug: string,
  branch: string,
): Promise<boolean> {
  const octokit = createOctokit(config.github);
  try {
    await readFile(
      octokit,
      config.github.repo,
      `sites/${siteDomain}/articles/${slug}.md`,
      branch,
    );
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueSlug(
  config: AgentConfig,
  siteDomain: string,
  baseSlug: string,
  branch: string,
): Promise<string> {
  let candidate = baseSlug;
  let counter = 2;

  while (await slugExists(config, siteDomain, candidate, branch)) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  return candidate;
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runDedicatedGeneration(
  params: DedicatedGenerationParams,
  config: AgentConfig,
): Promise<DedicatedGenerationResult> {
  const { siteDomain, branch, userPrompt } = params;

  // Step 1: Read site brief
  const octokit = createOctokit(config.github);
  let siteBriefData: Awaited<ReturnType<typeof readSiteBrief>>;
  try {
    siteBriefData = await readSiteBrief(octokit, config.github.repo, siteDomain, branch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dedicated] Failed to read site brief for ${siteDomain}: ${message}`);
    return { status: "error", message: `Could not read site brief: ${message}`, n8nImageTriggered: false };
  }

  const { siteName, brief, author } = siteBriefData;
  console.log(`[dedicated] Generating article for ${siteDomain} (${siteName}) on branch ${branch}`);

  // Step 2: Generate article via Claude
  const { system: systemPrompt, user: userPromptText } = buildArticlePrompts({
    siteName,
    brief,
    mode: "original",
    userRequest: userPrompt,
  });

  let rawResponse: string;
  let usage: { inputTokens: number; outputTokens: number; estimated: boolean };
  try {
    const result = await generateContent({ systemPrompt, userPrompt: userPromptText });
    rawResponse = result.text;
    usage = result.usage;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dedicated] Generation failed for ${siteDomain}: ${message}`);
    return { status: "error", message: `Article generation failed: ${message}`, n8nImageTriggered: false };
  }

  // Record generation cost (fire-and-forget)
  void recordTextUsage({
    siteDomain,
    source: "dashboard",
    model: "claude-sonnet-4-6",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimated: usage.estimated,
  });

  // Step 3: Parse response
  let generated: ReturnType<typeof parseGeneratedArticle>;
  try {
    generated = parseGeneratedArticle(rawResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dedicated] JSON parse failed for ${siteDomain}: ${message}`);
    return { status: "error", message: `Failed to parse generated article: ${message}`, n8nImageTriggered: false };
  }

  // Step 4: Validate body
  const bodyCheck = validateArticleBody(generated.body);
  if (!bodyCheck.valid) {
    console.warn(`[dedicated] Body validation failed for ${siteDomain}: ${bodyCheck.reason}`);
    return { status: "error", message: `Body validation failed: ${bodyCheck.reason}`, n8nImageTriggered: false };
  }

  // Step 5: Resolve unique slug
  const baseSlug = generated.slug || generated.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let slug: string;
  try {
    slug = await resolveUniqueSlug(config, siteDomain, baseSlug, branch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dedicated] Slug resolution failed for ${siteDomain}: ${message}`);
    return { status: "error", message: `Slug resolution failed: ${message}`, n8nImageTriggered: false };
  }

  // Step 6: Ensure topic tag
  const tags = ensureTopicTag(
    generated.tags ?? [],
    brief.topics,
    generated.title,
  );

  // Step 7: Quality scoring
  const articleType: ArticleType = VALID_ARTICLE_TYPES.includes(generated.type as ArticleType)
    ? (generated.type as ArticleType)
    : "standard";

  let qualityScore: number | undefined;
  let scoreBreakdown: QualityScoreBreakdown | undefined;
  let qualityNote: string | undefined;
  let articleStatus: "published" | "review" = "published";

  try {
    console.log(`[dedicated] Scoring article: "${generated.title}"`);
    const qualityResult = await scoreArticle(
      {
        title: generated.title,
        description: generated.description,
        body: generated.body,
        tags,
        type: articleType,
      },
      siteName,
      brief,
      brief.quality_weights,
    );

    qualityScore = qualityResult.overallScore;
    scoreBreakdown = qualityResult.breakdown;
    qualityNote = qualityResult.note;
    articleStatus = resolveQualityStatus(qualityResult.overallScore, brief.quality_threshold);

    // Record quality scoring cost (fire-and-forget)
    if (qualityResult.usage) {
      void recordTextUsage({
        siteDomain,
        source: "dashboard",
        model: "claude-sonnet-4-6",
        inputTokens: qualityResult.usage.inputTokens,
        outputTokens: qualityResult.usage.outputTokens,
        estimated: qualityResult.usage.estimated,
      });
    }

    console.log(
      `[dedicated] Quality score: ${qualityScore}/100 → ${articleStatus}` +
      ` (threshold: ${brief.quality_threshold ?? 40})`,
    );
  } catch (scoreErr) {
    const errMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
    console.warn(`[dedicated] Quality scoring failed, defaulting to review: ${errMsg}`);
    qualityNote = `Quality scoring failed: ${errMsg}`;
    qualityScore = 0;
    articleStatus = "review";
  }

  // Step 8: Build frontmatter
  const publishDate = new Date().toISOString().slice(0, 10);
  const defaultImagePath = `/assets/images/${siteDomain}-general-article.webp`;

  // Estimate reading time (average 200 wpm)
  const wordCount = generated.body.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.round(wordCount / 200));

  const frontmatter: ArticleFrontmatterWithExtras = {
    title: generated.title,
    description: generated.description,
    type: articleType,
    status: articleStatus,
    publishDate,
    author: author || "Editorial Team",
    tags,
    slug,
    reviewer_notes: articleStatus === "review" ? (qualityNote ?? "") : "",
    featuredImage: defaultImagePath,
    generated_by: "claude-dedicated",
    ...(qualityScore !== undefined ? { quality_score: qualityScore } : {}),
    ...(scoreBreakdown ? { score_breakdown: scoreBreakdown } : {}),
    ...(qualityNote ? { quality_note: qualityNote } : {}),
    reading_time: readingTime,
  };

  // Strip leading H1 from body (models sometimes include it despite instructions)
  const cleanBody = generated.body.replace(/^\s*#\s+[^\n]+\n*/, "");
  const markdown = matter.stringify(cleanBody, frontmatter);
  const filePath = `sites/${siteDomain}/articles/${slug}.md`;

  // Step 9: Commit to Git
  const writerConfig = {
    localNetworkPath: config.localNetworkPath,
    github: config.github,
    branch,
  };

  try {
    await writeArticleBatch(
      writerConfig,
      [{ siteDomain, slug, content: markdown }],
      [],
      `feat(content): add dedicated article "${generated.title}" for ${siteDomain}`,
    );
    console.log(`[dedicated] Committed article ${slug} to ${branch}`);

    // Dual-write to MongoDB (supplementary — never fails the pipeline)
    await upsertArticleMeta(siteDomain, slug, branch, {
      title: frontmatter.title,
      description: frontmatter.description,
      type: frontmatter.type,
      status: frontmatter.status,
      publishDate: frontmatter.publishDate,
      author: frontmatter.author,
      tags: frontmatter.tags,
      slug: frontmatter.slug,
      featuredImage: frontmatter.featuredImage,
      generated_by: frontmatter.generated_by,
      quality_score: frontmatter.quality_score,
      score_breakdown: frontmatter.score_breakdown,
      quality_note: frontmatter.quality_note,
      reading_time: frontmatter.reading_time,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dedicated] Git commit failed for ${siteDomain}/${slug}: ${message}`);
    return { status: "error", message: `Failed to commit article: ${message}`, n8nImageTriggered: false };
  }

  // Step 10: Trigger n8n image (fire-and-forget)
  let n8nImageTriggered = false;
  const webhookUrl = config.n8nImageWebhookUrl;
  if (webhookUrl) {
    const callbackUrl = config.imageCallbackUrl ?? "https://sites-platform-e297--atomic.cloudgrid.io/api/agent/image-callback";
    const requestId = `img_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

    n8nImageTriggered = await triggerN8nImage(webhookUrl, {
      request_id: requestId,
      callback_url: callbackUrl,
      job_id: "",
      site_domain: siteDomain,
      slug,
      branch,
      article: {
        title: generated.title,
        description: generated.description,
        summary: generated.body.slice(0, 500),
        vertical: brief.topics[0] ?? "General",
        source_thumbnail_url: null,
        image_guidelines: typeof brief.image_guidelines === "string" ? brief.image_guidelines : null,
      },
    });

    if (n8nImageTriggered) {
      trackPendingImage(
        requestId,
        siteDomain,
        slug,
        generated.title,
        config.notifications,
        createGitImageVerifier(config.github, config.networkRepo),
      );
    }
  }

  return {
    status: "created",
    slug,
    path: filePath,
    qualityScore,
    articleStatus,
    n8nImageTriggered,
  };
}
