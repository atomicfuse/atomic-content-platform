/**
 * Content Generation Agent v2 — orchestrates the dual-model pipeline.
 *
 * Steps:
 * 1. Read site brief (local YAML or GitHub API)
 * 2. Fetch enriched items from Content Aggregator v2 API (targetCount * 2)
 * 3. Fetch settings for factual classification
 * 4. Deduplicate against already-processed source URLs + titles
 * 5. For each candidate (up to targetCount successes):
 *    a. Route: factual → Claude, general → OpenAI
 *    b. Generate article (cross-model fallback on failure)
 *    c. Image pipeline: analyze thumbnail → generate original image (DALL-E 3)
 *    d. SEO metadata
 *    e. Quality scoring
 *    f. Build frontmatter + serialize to markdown
 * 6. Batch-write all articles in a single commit
 *
 * LIGHTWEIGHT: fetches only targetCount * 2 items. No pagination loops.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";

// v2 pipeline modules
import { getContent, getSettings } from "./api-client.js";
import { classifyContent } from "./router.js";
import { ClaudeGenerator } from "./generators/claude-generator.js";
import { OpenAIGenerator } from "./generators/openai-generator.js";
import { analyzeThumbnail } from "./image-pipeline/analyzer.js";
import { generateImage } from "./image-pipeline/generator.js";
import { generateSEOMetadata } from "./seo/metadata-generator.js";
import { generateSlug } from "./seo/slug-generator.js";
import type { ContentItem, AggregatorSettings, GeneratedArticle as V2GeneratedArticle } from "./types.js";
import type { Generator, GeneratorConfig } from "./generators/base-generator.js";

// Existing infrastructure
import { createGitHubClient } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import { writeArticleBatch } from "../../lib/writer.js";
import type { PendingArticle, PendingAsset } from "../../lib/writer.js";
import { scoreArticle, resolveStatus as resolveQualityStatus } from "../content-quality/scorer.js";
import type { AgentConfig } from "../../lib/config.js";
import type { ArticleFrontmatter, ArticleType, QualityScoreBreakdown, SiteBrief, SiteConfig } from "../../types.js";

// ---------------------------------------------------------------------------
// Public interfaces (preserved for backward compat with index.ts)
// ---------------------------------------------------------------------------

export interface ContentGenerationParams {
  siteDomain: string;
  branch?: string;
  /** Override article count — for on-demand generation from dashboard. */
  count?: number;
}

export interface ContentGenerationResult {
  status: "created" | "skipped" | "error";
  slug?: string;
  path?: string;
  reason?: string;
  message?: string;
  /** Quality score 0-100 from the quality agent. */
  qualityScore?: number;
  /** Whether the article was auto-published or flagged for review. */
  articleStatus?: "published" | "review";
  /** Which model generated the article. */
  generatedBy?: "claude" | "openai";
  /** @internal Pending file data — used for batch commit, stripped before API response. */
  _pendingArticle?: PendingArticle;
  /** @internal Pending asset data — used for batch commit, stripped before API response. */
  _pendingAsset?: PendingAsset;
}

export interface BatchContentGenerationResult {
  siteDomain: string;
  /** How many the user requested */
  requested: number;
  /** How many items the aggregator API returned */
  totalSourced: number;
  /** How many were already on the site (duplicates) */
  duplicateCount: number;
  /** How many new items were available after dedup */
  availableNew: number;
  results: ContentGenerationResult[];
}

// Extended frontmatter with source tracking and quality fields
interface ArticleFrontmatterWithExtras extends ArticleFrontmatter {
  source_url?: string;
  source_item_id?: string;
  generated_by?: string;
  quality_score?: number;
  score_breakdown?: QualityScoreBreakdown;
  quality_note?: string;
  reading_time?: number;
}

const VALID_ARTICLE_TYPES: ArticleType[] = ["listicle", "how-to", "review", "standard"];

// Max concurrent article generations
const MAX_CONCURRENCY = 3;

// ---------------------------------------------------------------------------
// Generators (singletons)
// ---------------------------------------------------------------------------

const claudeGenerator = new ClaudeGenerator();
const openaiGenerator = new OpenAIGenerator();

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

/**
 * Ensure at least one tag matches a site topic (for category page filtering).
 * If the generator's tags don't include a topic, find the best match and prepend it.
 */
export function ensureTopicTag(
  generatedTags: string[],
  topics: string[],
  articleTitle: string,
): string[] {
  if (topics.length === 0) return generatedTags;

  const tags = generatedTags.length > 0 ? [...generatedTags] : [];
  const lowerTopics = topics.map((t) => t.toLowerCase());

  const hasTopicTag = tags.some((tag) =>
    lowerTopics.includes(tag.toLowerCase()),
  );
  if (hasTopicTag) return tags;

  const combined = [articleTitle, ...tags].join(" ").toLowerCase();
  const matchedTopic = topics.find((topic) =>
    combined.includes(topic.toLowerCase()),
  );
  if (matchedTopic) return [matchedTopic, ...tags];

  return [topics[0]!, ...tags];
}

// ---------------------------------------------------------------------------
// Deduplication — bulk load all existing source_urls + titles
// ---------------------------------------------------------------------------

/** Normalize a URL for dedup comparison. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${pathname}`;
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

/** Normalize a title for fuzzy dedup. */
function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface ExistingArticles {
  urls: Set<string>;
  titles: Set<string>;
}

async function getAllExistingArticles(
  config: AgentConfig,
  siteDomain: string,
  branch?: string,
): Promise<ExistingArticles> {
  const urls = new Set<string>();
  const titles = new Set<string>();

  function extractFromFrontmatter(data: Record<string, unknown>): void {
    if (data.source_url) urls.add(normalizeUrl(data.source_url as string));
    if (data.title) titles.add(normalizeTitleKey(data.title as string));
  }

  if (config.localNetworkPath && !branch) {
    const articlesDir = path.join(config.localNetworkPath, "sites", siteDomain, "articles");

    let files: string[];
    try {
      files = await fs.readdir(articlesDir);
    } catch {
      return { urls, titles };
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await fs.readFile(path.join(articlesDir, file), "utf-8");
        const { data } = matter(content);
        extractFromFrontmatter(data);
      } catch {
        // Skip unparseable files
      }
    }

    return { urls, titles };
  }

  // GitHub mode
  const { listFiles, readFile } = await import("../../lib/github.js");
  const octokit = createGitHubClient(config.github);
  const articlesPath = `sites/${siteDomain}/articles`;

  let files: string[];
  try {
    files = await listFiles(octokit, config.networkRepo, articlesPath, branch);
  } catch {
    return { urls, titles };
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const content = await readFile(
        octokit,
        config.networkRepo,
        `${articlesPath}/${file}`,
        branch,
      );
      const { data } = matter(content);
      extractFromFrontmatter(data);
    } catch {
      // Skip unparseable files
    }
  }

  return { urls, titles };
}

// ---------------------------------------------------------------------------
// Slug resolution
// ---------------------------------------------------------------------------

async function resolveUniqueSlug(
  config: AgentConfig,
  siteDomain: string,
  baseSlug: string,
  branch?: string,
): Promise<string> {
  let candidate = baseSlug;
  let counter = 2;

  while (await slugExists(config, siteDomain, candidate, branch)) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  return candidate;
}

async function slugExists(
  config: AgentConfig,
  siteDomain: string,
  slug: string,
  branch?: string,
): Promise<boolean> {
  if (config.localNetworkPath && !branch) {
    const filePath = path.join(
      config.localNetworkPath,
      "sites",
      siteDomain,
      "articles",
      `${slug}.md`,
    );
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  const { readFile } = await import("../../lib/github.js");
  const octokit = createGitHubClient(config.github);
  try {
    await readFile(
      octokit,
      config.networkRepo,
      `sites/${siteDomain}/articles/${slug}.md`,
      branch,
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Site brief reading
// ---------------------------------------------------------------------------

async function readLocalSiteBrief(localNetworkPath: string, siteDomain: string) {
  const yamlPath = path.join(localNetworkPath, "sites", siteDomain, "site.yaml");

  let raw: string;
  try {
    raw = await fs.readFile(yamlPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  if (!raw.trim()) return null;

  const siteConfig = parseYaml(raw) as SiteConfig;
  if (!siteConfig?.brief) {
    throw new Error(`Site ${siteDomain} has no content brief defined`);
  }

  return {
    domain: siteConfig.domain,
    siteName: siteConfig.site_name,
    group: siteConfig.group,
    brief: siteConfig.brief,
  };
}

async function getSiteBrief(config: AgentConfig, siteDomain: string, branch?: string) {
  let result;
  if (config.localNetworkPath) {
    const local = await readLocalSiteBrief(config.localNetworkPath, siteDomain);
    if (local) result = local;
  }

  if (!result) {
    const octokit = createGitHubClient(config.github);
    result = await readSiteBrief(octokit, config.networkRepo, siteDomain, branch);
  }

  if (!result.brief.vertical) {
    try {
      const vertical = await resolveVerticalFromIndex(config, siteDomain);
      if (vertical) {
        result.brief.vertical = vertical;
        console.log(`[agent] Resolved vertical from dashboard index: ${vertical}`);
      }
    } catch {
      // Non-critical
    }
  }

  return result;
}

async function resolveVerticalFromIndex(
  config: AgentConfig,
  siteDomain: string,
): Promise<SiteBrief["vertical"] | undefined> {
  const VALID_VERTICALS = new Set([
    "Tech", "Travel", "News", "Sport", "Lifestyle",
    "Entertainment", "Food & Drink", "Animals", "Science",
  ]);

  let raw: string;
  if (config.localNetworkPath) {
    try {
      raw = await fs.readFile(
        path.join(config.localNetworkPath, "dashboard-index.yaml"),
        "utf-8",
      );
    } catch {
      return undefined;
    }
  } else {
    const { readFile } = await import("../../lib/github.js");
    const octokit = createGitHubClient(config.github);
    raw = await readFile(octokit, config.networkRepo, "dashboard-index.yaml");
  }

  const index = parseYaml(raw) as { sites?: Array<{ domain: string; vertical?: string }> };
  const site = index.sites?.find((s) => s.domain === siteDomain);
  const vertical = site?.vertical;

  if (vertical && VALID_VERTICALS.has(vertical)) {
    return vertical as SiteBrief["vertical"];
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Single article processing (v2 pipeline)
// ---------------------------------------------------------------------------

async function processItem(
  item: ContentItem,
  settings: AggregatorSettings,
  config: AgentConfig,
  siteDomain: string,
  siteName: string,
  brief: SiteBrief,
  branch?: string,
): Promise<ContentGenerationResult> {
  // Skip items without summary (unenriched leaked through)
  if (!item.summary || item.summary.length < 20) {
    console.warn(`[agent] Skipping item "${item.title}" — no/short summary`);
    return { status: "skipped", reason: "no summary" };
  }

  // Skip non-English items
  if (item.language && item.language.toUpperCase() !== "EN") {
    console.warn(`[agent] Skipping non-EN item "${item.title}" (${item.language})`);
    return { status: "skipped", reason: `non-English: ${item.language}` };
  }

  try {
    // Step 1: Route — factual (Claude) or general (OpenAI)
    const decision = classifyContent(item, settings);
    console.log(`[agent] Routed "${item.title}" → ${decision.generator} (${decision.reason})`);

    // Step 2: Generate article with cross-model fallback
    const genConfig: GeneratorConfig = { siteName, brief };
    let generated: V2GeneratedArticle;
    let actualGenerator: "claude" | "openai" = decision.generator;

    const primary: Generator = decision.isFactual ? claudeGenerator : openaiGenerator;
    const fallback: Generator = decision.isFactual ? openaiGenerator : claudeGenerator;

    try {
      generated = await primary.generate(item, genConfig);
    } catch (primaryErr) {
      const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      console.warn(`[agent] ${primary.name} failed for "${item.title}", falling back to ${fallback.name}: ${msg}`);
      generated = await fallback.generate(item, genConfig);
      actualGenerator = fallback.name as "claude" | "openai";
    }

    // Step 3: Generate slug (from SEO module, then deduplicate)
    const baseSlug = generated.slug || generateSlug(generated.title);
    const slug = await resolveUniqueSlug(config, siteDomain, baseSlug, branch);

    // Step 4: Image pipeline — analyze thumbnail → generate original
    let pendingImageAsset: PendingAsset | undefined;
    let featuredImageUrl: string | undefined;

    try {
      const analysis = item.thumbnail?.url
        ? await analyzeThumbnail(item.thumbnail.url)
        : null;

      const imageResult = await generateImage({
        analysis,
        articleTitle: generated.title,
        articleSummary: item.summary,
        vertical: item.vertical?.name ?? "General",
      });

      if (imageResult) {
        const assetPath = `assets/images/${slug}.png`;
        pendingImageAsset = { siteDomain, assetPath, data: imageResult.data };
        featuredImageUrl = `/assets/images/${slug}.png`;
      }
    } catch (imgErr) {
      // Image pipeline is non-critical
      const msg = imgErr instanceof Error ? imgErr.message : String(imgErr);
      console.warn(`[agent] Image pipeline failed (non-critical): ${msg}`);
    }

    // Step 5: SEO metadata
    const seo = generateSEOMetadata(generated, item, decision.isFactual, featuredImageUrl);

    // Step 6: Validate article type
    const articleType: ArticleType = VALID_ARTICLE_TYPES.includes(generated.type as ArticleType)
      ? (generated.type as ArticleType)
      : "standard";

    // Step 7: Ensure topic tag
    const tags = ensureTopicTag(
      generated.tags ?? [],
      brief.topics,
      generated.title,
    );

    // Step 8: Quality scoring
    let qualityScore: number | undefined;
    let scoreBreakdown: QualityScoreBreakdown | undefined;
    let qualityNote: string | undefined;
    let articleStatus: "published" | "review" = "published";

    try {
      console.log(`[agent] Scoring article: "${generated.title}"`);
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

      console.log(
        `[agent] Quality score: ${qualityScore}/100 → ${articleStatus}` +
        ` (threshold: ${brief.quality_threshold ?? 75})`,
      );
    } catch (scoreErr) {
      const errMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
      console.warn(`[agent] Quality scoring failed, defaulting to published: ${errMsg}`);
      qualityNote = `Quality scoring failed: ${errMsg}`;
    }

    // Step 9: Build frontmatter
    const publishDate = new Date().toISOString().slice(0, 10);

    const frontmatter: ArticleFrontmatterWithExtras = {
      title: generated.title,
      description: seo.metaDescription,
      type: articleType,
      status: articleStatus,
      publishDate,
      author: "Editorial Team",
      tags,
      slug,
      reviewer_notes: articleStatus === "review" ? (qualityNote ?? "") : "",
      source_url: item.url,
      source_item_id: item.id,
      generated_by: actualGenerator,
      ...(featuredImageUrl ? { featuredImage: featuredImageUrl } : {}),
      ...(qualityScore !== undefined ? { quality_score: qualityScore } : {}),
      ...(scoreBreakdown ? { score_breakdown: scoreBreakdown } : {}),
      ...(qualityNote ? { quality_note: qualityNote } : {}),
      ...(seo.readingTime ? { reading_time: seo.readingTime } : {}),
    };

    const markdown = matter.stringify(generated.body, frontmatter);
    const filePath = `sites/${siteDomain}/articles/${slug}.md`;

    return {
      status: "created",
      slug,
      path: filePath,
      qualityScore,
      articleStatus,
      generatedBy: actualGenerator,
      _pendingArticle: { siteDomain, slug, content: markdown },
      _pendingAsset: pendingImageAsset,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Failed to process item "${item.title}":`, message);
    return { status: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Concurrency-limited processing
// ---------------------------------------------------------------------------

async function processWithConcurrency<T, R>(
  items: T[],
  maxConcurrency: number,
  targetCount: number,
  processor: (item: T) => Promise<R>,
  isSuccess: (result: R) => boolean,
): Promise<R[]> {
  const results: R[] = [];
  let successCount = 0;
  let nextIndex = 0;
  const inFlight = new Set<Promise<void>>();

  function canProcess(): boolean {
    return successCount < targetCount && nextIndex < items.length;
  }

  async function processNext(): Promise<void> {
    if (!canProcess()) return;

    const idx = nextIndex++;
    const item = items[idx]!;

    const result = await processor(item);
    results.push(result);

    if (isSuccess(result)) {
      successCount++;
    }
  }

  while (canProcess() || inFlight.size > 0) {
    // Fill up to maxConcurrency
    while (canProcess() && inFlight.size < maxConcurrency) {
      const p = processNext().then(() => {
        inFlight.delete(p);
      });
      inFlight.add(p);
    }

    // Wait for at least one to complete
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point for the content generation agent (v2).
 *
 * Fetches enriched items from Content Aggregator v2, routes through
 * dual-model generation, and produces article packages.
 */
export async function runContentGeneration(
  params: ContentGenerationParams,
  config: AgentConfig,
): Promise<BatchContentGenerationResult> {
  const { siteDomain, branch, count } = params;
  const targetCount = count ?? 3;

  try {
    // Step 1: Read site brief
    const { siteName, brief } = await getSiteBrief(config, siteDomain, branch);

    // Step 2: Load existing articles for deduplication
    const existing = await getAllExistingArticles(config, siteDomain, branch);

    // Step 3: Fetch enriched items — LIGHTWEIGHT: only targetCount * 2
    const fetchLimit = targetCount * 2;
    console.log(`[agent] Fetching ${fetchLimit} items from aggregator (target: ${targetCount})`);

    const [items, settings] = await Promise.all([
      getContent({
        limit: fetchLimit,
        vertical: brief.vertical,
        language: brief.language ?? "EN",
      }),
      getSettings(),
    ]);

    if (items.length === 0) {
      return {
        siteDomain,
        requested: targetCount,
        totalSourced: 0,
        duplicateCount: 0,
        availableNew: 0,
        results: [{ status: "skipped", reason: "no items found from aggregator" }],
      };
    }

    // Step 4: Deduplicate — by URL AND title
    const newItems = items.filter((item) => {
      if (existing.urls.has(normalizeUrl(item.url))) return false;
      if (existing.titles.has(normalizeTitleKey(item.title))) return false;
      return true;
    });
    const duplicateCount = items.length - newItems.length;

    if (newItems.length === 0) {
      return {
        siteDomain,
        requested: targetCount,
        totalSourced: items.length,
        duplicateCount,
        availableNew: 0,
        results: [{ status: "skipped", reason: "all items already processed" }],
      };
    }

    console.log(
      `[agent] Processing up to ${targetCount} articles for ${siteDomain}` +
      ` from pool of ${newItems.length}` +
      ` (fetched: ${items.length}, duplicates: ${duplicateCount})`,
    );

    // Step 5: Process items with concurrency limit, stop at targetCount successes
    const results = await processWithConcurrency(
      newItems,
      MAX_CONCURRENCY,
      targetCount,
      (item) => processItem(item, settings, config, siteDomain, siteName, brief, branch),
      (result) => result.status === "created",
    );

    // Warn if buffer wasn't enough
    const createdCount = results.filter((r) => r.status === "created").length;
    if (createdCount < targetCount) {
      console.warn(
        `[agent] Only ${createdCount}/${targetCount} articles created from ${fetchLimit} fetched items. ` +
        `Returning what we have — not fetching more.`,
      );
    }

    // Step 6: Batch-write all created articles in a SINGLE commit
    const created = results.filter((r) => r.status === "created");
    if (created.length > 0) {
      const pendingArticles = created
        .map((r) => r._pendingArticle)
        .filter((a): a is PendingArticle => !!a);
      const pendingAssets = created
        .map((r) => r._pendingAsset)
        .filter((a): a is PendingAsset => !!a);

      const slugList = pendingArticles.map((a) => a.slug).join(", ");
      const commitMsg = `feat(content): add ${pendingArticles.length} article(s) for ${siteDomain}\n\n${slugList}`;

      await writeArticleBatch(
        { localNetworkPath: config.localNetworkPath, github: config.github, branch },
        pendingArticles,
        pendingAssets,
        commitMsg,
      );
    }

    // Strip internal fields before returning API response
    const cleanResults = results.map(({ _pendingArticle, _pendingAsset, ...rest }) => rest);

    return {
      siteDomain,
      requested: targetCount,
      totalSourced: items.length,
      duplicateCount,
      availableNew: newItems.length,
      results: cleanResults,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Content generation failed for ${siteDomain}:`, message);
    return {
      siteDomain,
      requested: targetCount,
      totalSourced: 0,
      duplicateCount: 0,
      availableNew: 0,
      results: [{ status: "error", message }],
    };
  }
}
