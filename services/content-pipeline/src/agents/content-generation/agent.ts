/**
 * Content Generation Agent — orchestrates the full pipeline from
 * Content Aggregator API to published articles.
 *
 * Steps:
 * 1. Read site brief (local YAML or GitHub API)
 * 2. Query Content Aggregator API (with fallback logic)
 * 3. Filter by topic relevance
 * 4. Deduplicate against already-processed source URLs
 * 5. For each candidate article:
 *    a. Scrape source content
 *    b. Build Claude prompts
 *    c. Call Claude → get generated article JSON
 *    d. Resolve unique slug
 *    e. Handle featured image (aggregator → scraped → Gemini)
 *    f. Build frontmatter + serialize to markdown
 *    g. Write article (local or GitHub)
 * 6. Return batch results
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import {
  fetchWithFallback,
  filterByRelevance,
  scrapeSourceContent,
  type AggregatorArticle,
} from "./aggregator.js";
import { buildSystemPrompt, buildUserPrompt, buildMetadataOnlyPrompt, type GeneratedArticle, type SourceArticle } from "./prompts.js";
import { generateContent } from "../../lib/ai.js";
import { createGitHubClient } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import { generateImageWithGemini } from "../../lib/gemini.js";
import { writeArticle, writeAsset, writeArticleBatch } from "../../lib/writer.js";
import type { PendingArticle, PendingAsset } from "../../lib/writer.js";
import { scoreArticle, resolveStatus as resolveQualityStatus } from "../content-quality/scorer.js";
import type { AgentConfig } from "../../lib/config.js";
import type { ArticleFrontmatter, ArticleType, QualityScoreBreakdown, SiteBrief, SiteConfig } from "../../types.js";

export interface ContentGenerationParams {
  siteDomain: string;
  branch?: string;
  /** Override articles_per_week — for on-demand generation from dashboard. */
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
  /** @internal Pending file data — used for batch commit, stripped before API response. */
  _pendingArticle?: PendingArticle;
  /** @internal Pending asset data — used for batch commit, stripped before API response. */
  _pendingAsset?: PendingAsset;
}

export interface BatchContentGenerationResult {
  siteDomain: string;
  /** How many the user requested */
  requested: number;
  /** How many relevant articles the aggregator API returned */
  totalSourced: number;
  /** How many were already on the site (duplicates) */
  duplicateCount: number;
  /** How many new articles were available after dedup */
  availableNew: number;
  results: ContentGenerationResult[];
}

// Extended frontmatter with source tracking and quality fields
interface ArticleFrontmatterWithExtras extends ArticleFrontmatter {
  source_url?: string;
  quality_score?: number;
  score_breakdown?: QualityScoreBreakdown;
  quality_note?: string;
}

const VALID_ARTICLE_TYPES: ArticleType[] = ["listicle", "how-to", "review", "standard"];

/**
 * Ensure at least one tag matches a site topic (for category page filtering).
 * If Claude's tags don't include a topic, find the best match and prepend it.
 */
export function ensureTopicTag(
  generatedTags: string[],
  topics: string[],
  articleTitle: string,
): string[] {
  if (topics.length === 0) return generatedTags;

  const tags = generatedTags.length > 0 ? [...generatedTags] : [];
  const lowerTopics = topics.map((t) => t.toLowerCase());

  // Check if any tag already matches a topic
  const hasTopicTag = tags.some((tag) =>
    lowerTopics.includes(tag.toLowerCase()),
  );
  if (hasTopicTag) return tags;

  // Try to find best matching topic from title or existing tags
  const combined = [articleTitle, ...tags].join(" ").toLowerCase();
  const matchedTopic = topics.find((topic) =>
    combined.includes(topic.toLowerCase()),
  );
  if (matchedTopic) return [matchedTopic, ...tags];

  // Fallback: prepend the first topic
  return [topics[0]!, ...tags];
}

function parseClaudeResponse(raw: string): GeneratedArticle {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const cleaned = fenceMatch ? fenceMatch[1]! : raw;
  return JSON.parse(cleaned.trim()) as GeneratedArticle;
}

// ---------------------------------------------------------------------------
// Deduplication — bulk load all existing source_urls
// ---------------------------------------------------------------------------

/** Normalize a URL for dedup comparison. Strips protocol, www, query, fragment, trailing slash. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip www., lowercase host, keep pathname only (no query/fragment)
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${pathname}`;
  } catch {
    // Fallback for malformed URLs
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * Normalize a title into a comparable key.
 * Strips punctuation, extra spaces, lowercases — so "7 Expert Sleep Tips..."
 * matches "7 Expert Sleep Tips…" or "7 expert sleep tips".
 */
function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // strip punctuation
    .replace(/\s+/g, " ")    // collapse whitespace
    .trim();
}

interface ExistingArticles {
  urls: Set<string>;
  titles: Set<string>;
}

/**
 * Read all existing articles and return the set of source_urls and titles already processed.
 * URLs are normalized for consistent comparison. Titles are normalized for fuzzy matching.
 */
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

  // If brief has no vertical, try to resolve it from dashboard-index.yaml
  if (!result.brief.vertical) {
    try {
      const vertical = await resolveVerticalFromIndex(config, siteDomain);
      if (vertical) {
        result.brief.vertical = vertical;
        console.log(`[agent] Resolved vertical from dashboard index: ${vertical}`);
      }
    } catch {
      // Non-critical — proceed without vertical
    }
  }

  return result;
}

/** Read the vertical for a site from dashboard-index.yaml as a fallback. */
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
// Single article processing
// ---------------------------------------------------------------------------

async function processArticle(
  article: AggregatorArticle,
  config: AgentConfig,
  siteDomain: string,
  siteName: string,
  brief: SiteBrief,
  branch?: string,
): Promise<ContentGenerationResult> {
  try {
    // Scrape source content
    const parsed = await scrapeSourceContent(article.url);

    // Build prompts — fall back to metadata-only generation if scraping failed
    const source: SourceArticle = {
      title: article.title,
      url: article.url,
      imageUrl: article.image_url,
    };

    const systemPrompt = buildSystemPrompt(siteName, brief);
    let userPrompt: string;

    if (parsed.textBody) {
      userPrompt = buildUserPrompt(source, parsed);
    } else {
      console.log(`[agent] Scrape failed for "${article.title}" — generating from metadata only`);
      userPrompt = buildMetadataOnlyPrompt(source);
    }

    // Call Claude via CloudGrid AI Gateway
    const rawResponse = await generateContent({ systemPrompt, userPrompt });
    const generated = parseClaudeResponse(rawResponse);

    // Resolve unique slug
    const slug = await resolveUniqueSlug(config, siteDomain, generated.slug, branch);

    // Handle featured image: aggregator image → scraped image → Gemini
    let featuredImageUrl: string | undefined = article.image_url ?? undefined;

    if (!featuredImageUrl && parsed.featuredImageUrl) {
      featuredImageUrl = parsed.featuredImageUrl;
    }

    let pendingImageAsset: PendingAsset | undefined;
    if (!featuredImageUrl && config.geminiApiKey) {
      const imageBuffer = await generateImageWithGemini(
        config.geminiApiKey,
        `Create a featured image for an article titled: ${generated.title}`,
      );
      if (imageBuffer) {
        const assetPath = `assets/images/${slug}.png`;
        pendingImageAsset = { siteDomain, assetPath, data: imageBuffer };
        featuredImageUrl = `/assets/images/${slug}.png`;
      }
    }

    const articleType: ArticleType = VALID_ARTICLE_TYPES.includes(generated.type as ArticleType)
      ? (generated.type as ArticleType)
      : "standard";

    const tags = ensureTopicTag(
      generated.tags ?? [],
      brief.topics,
      generated.title,
    );

    // Quality scoring — replaces random review_percentage logic
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
      // If quality scoring fails, fall back to published (don't block the pipeline)
      const errMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
      console.warn(`[agent] Quality scoring failed, defaulting to published: ${errMsg}`);
      qualityNote = `Quality scoring failed: ${errMsg}`;
    }

    // Build frontmatter
    const publishDate = new Date().toISOString().slice(0, 10);

    const frontmatter: ArticleFrontmatterWithExtras = {
      title: generated.title,
      description: generated.description,
      type: articleType,
      status: articleStatus,
      publishDate,
      author: "Editorial Team",
      tags,
      slug,
      reviewer_notes: articleStatus === "review" ? (qualityNote ?? "") : "",
      source_url: article.url,
      ...(featuredImageUrl ? { featuredImage: featuredImageUrl } : {}),
      ...(qualityScore !== undefined ? { quality_score: qualityScore } : {}),
      ...(scoreBreakdown ? { score_breakdown: scoreBreakdown } : {}),
      ...(qualityNote ? { quality_note: qualityNote } : {}),
    };

    const markdown = matter.stringify(generated.body, frontmatter);

    const filePath = `sites/${siteDomain}/articles/${slug}.md`;

    // Collect pending data for batch commit (don't write yet)
    return {
      status: "created",
      slug,
      path: filePath,
      qualityScore,
      articleStatus,
      _pendingArticle: { siteDomain, slug, content: markdown },
      _pendingAsset: pendingImageAsset,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Failed to process article "${article.title}":`, message);
    return { status: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point for the content generation agent.
 * Queries the Content Aggregator API, filters, deduplicates, and generates
 * multiple articles in a single run.
 */
export async function runContentGeneration(
  params: ContentGenerationParams,
  config: AgentConfig,
): Promise<BatchContentGenerationResult> {
  const { siteDomain, branch, count } = params;

  const requested = count ?? 3;

  try {
    // Step 1: Read site brief
    const { siteName, brief } = await getSiteBrief(config, siteDomain, branch);

    // Step 2: Load existing articles for deduplication (needed before fetching)
    const existing = await getAllExistingArticles(config, siteDomain, branch);

    // Step 3: Query aggregator API with fallback
    // Request more than needed and pass existingUrls so the fallback keeps
    // broadening filters until enough NEW (non-duplicate) articles are found.
    const apiLimit = Math.max(requested * 5, requested + 30);
    const articles = await fetchWithFallback(config.contentAggregatorUrl, brief, apiLimit, existing.urls);

    if (articles.length === 0) {
      return {
        siteDomain,
        requested,
        totalSourced: 0,
        duplicateCount: 0,
        availableNew: 0,
        results: [{ status: "skipped", reason: "no articles found from aggregator" }],
      };
    }

    // Step 4: Filter by topic relevance
    const relevant = filterByRelevance(articles, brief.topics);

    // Step 5: Deduplicate — by URL AND title (catches syndicated/reposted content)
    const newArticles = relevant.filter((a) => {
      if (existing.urls.has(normalizeUrl(a.url))) return false;
      if (existing.titles.has(normalizeTitleKey(a.title))) return false;
      return true;
    });
    const duplicateCount = relevant.length - newArticles.length;

    if (newArticles.length === 0) {
      return {
        siteDomain,
        requested,
        totalSourced: relevant.length,
        duplicateCount,
        availableNew: 0,
        results: [{ status: "skipped", reason: "all articles already processed" }],
      };
    }

    // Step 6: Process articles from pool until we have enough created or exhaust pool
    console.log(
      `[agent] Processing up to ${requested} articles for ${siteDomain}` +
      ` from pool of ${newArticles.length}` +
      ` (relevant: ${relevant.length}, duplicates: ${duplicateCount})`,
    );

    const results: ContentGenerationResult[] = [];
    const skippedResults: ContentGenerationResult[] = [];
    let createdSoFar = 0;
    let poolIndex = 0;

    while (createdSoFar < requested && poolIndex < newArticles.length) {
      const article = newArticles[poolIndex]!;
      poolIndex++;

      console.log(`[agent] Processing (${createdSoFar + 1}/${requested}, pool ${poolIndex}/${newArticles.length}): "${article.title}"`);
      const result = await processArticle(
        article,
        config,
        siteDomain,
        siteName,
        brief,
        branch,
      );

      if (result.status === "created") {
        results.push(result);
        createdSoFar++;
      } else {
        skippedResults.push(result);
      }
    }

    // Append skipped/error results for reporting
    results.push(...skippedResults);

    // Step 8: Batch-write all created articles in a SINGLE commit
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
      requested,
      totalSourced: relevant.length,
      duplicateCount,
      availableNew: newArticles.length,
      results: cleanResults,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Content generation failed for ${siteDomain}:`, message);
    return {
      siteDomain,
      requested,
      totalSourced: 0,
      duplicateCount: 0,
      availableNew: 0,
      results: [{ status: "error", message }],
    };
  }
}
