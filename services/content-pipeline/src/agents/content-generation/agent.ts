/**
 * Content Generation Agent v2 — orchestrates the dual-model pipeline.
 *
 * Steps:
 * 1. Read site brief (local YAML or GitHub API)
 * 2. Fetch enriched items from Content Aggregator v2 API (paginated)
 * 3. Fetch settings for factual classification
 * 4. Deduplicate against already-processed source URLs + titles (paginate for more if needed)
 * 5. For each candidate (up to targetCount successes):
 *    a. Route: factual → Claude, general → OpenAI
 *    b. Generate article (cross-model fallback on failure)
 *    c. Image pipeline: generate image from article content (Gemini Flash)
 *    d. SEO metadata
 *    e. Quality scoring
 *    f. Build frontmatter + serialize to markdown
 * 6. Batch-write all articles in a single commit
 *
 * Paginates through aggregator results to find fresh (non-duplicate) items.
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";

// v2 pipeline modules
import { getContent, getSettings, resolveTopicTagIds } from "./api-client.js";
import { classifyContent } from "./router.js";
import { ClaudeGenerator } from "./generators/claude-generator.js";
import { OpenAIGenerator } from "./generators/openai-generator.js";
import { randomUUID } from "node:crypto";
import { generateSEOMetadata } from "./seo/metadata-generator.js";
import { generateSlug } from "./seo/slug-generator.js";
import type { ContentItem, AggregatorSettings, GeneratedArticle as V2GeneratedArticle } from "./types.js";
import type { Generator, GeneratorConfig } from "./generators/base-generator.js";

// Existing infrastructure
import { createOctokit } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import type { PendingArticle } from "../../lib/writer.js";
import { scoreArticle, resolveStatus as resolveQualityStatus } from "../content-quality/scorer.js";
import { processWithConcurrency } from "../../lib/concurrency.js";
import type { AgentConfig } from "../../lib/config.js";
import type { ArticleFrontmatter, ArticleType, QualityScoreBreakdown, SiteBrief, SiteConfig } from "../../types.js";

// ---------------------------------------------------------------------------
// Body validation — rejects empty/garbage content before quality scoring
// ---------------------------------------------------------------------------

const BODY_PLACEHOLDER_PATTERNS = [
  /no article content was available/i,
  /system prompt artifact/i,
  /please provide the original article/i,
  /content for cleanup/i,
  /unable to generate.*article/i,
];

const MIN_BODY_WORDS = 50;

export function validateArticleBody(
  body: string,
): { valid: true } | { valid: false; reason: string } {
  const trimmed = body.trim();
  if (!trimmed) return { valid: false, reason: "empty body" };

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_BODY_WORDS) {
    return { valid: false, reason: `too short (${wordCount} words, minimum ${MIN_BODY_WORDS})` };
  }

  for (const pattern of BODY_PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, reason: "detected placeholder/failure content" };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Public interfaces (preserved for backward compat with index.ts)
// ---------------------------------------------------------------------------

export interface ContentGenerationParams {
  siteDomain: string;
  branch?: string;
  /** Override article count — for on-demand generation from dashboard. */
  count?: number;
  /** BullMQ job ID — passed to n8n for image callback tracking. */
  jobId?: string;
  /** Pre-loaded brief data — avoids redundant GitHub read when passed from scheduler. */
  preloadedBrief?: {
    siteName: string;
    author?: string;
    group: string;
    brief: SiteBrief;
  };
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
  /** @internal n8n image request data — used to fire background image generation. */
  _imageRequest?: {
    requestId: string;
    siteDomain: string;
    slug: string;
    articleTitle: string;
    articleDescription: string;
    articleSummary: string;
    vertical: string;
    sourceThumbnailUrl?: string;
    imageGuidelines: string | string[] | null;
  };
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
  /** How many n8n image requests were triggered (0 if n8n not configured) */
  n8nImagesTriggered: number;
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

/** Normalize a URL for dedup comparison. @internal Exported for testing. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${pathname}`;
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

/** Normalize a title for fuzzy dedup. @internal Exported for testing. */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExistingArticles {
  urls: Set<string>;
  titles: Set<string>;
}

// ---------------------------------------------------------------------------
// Dedup index — persisted alongside articles to avoid N GitHub API reads
// ---------------------------------------------------------------------------

const DEDUP_INDEX_FILENAME = "dedup-index.json";

interface DedupIndexData {
  version: 1;
  urls: string[];
  titles: string[];
}

/** @internal Exported for testing. */
export function dedupIndexPath(siteDomain: string): string {
  return `sites/${siteDomain}/${DEDUP_INDEX_FILENAME}`;
}

/** @internal Exported for testing. */
export function serializeDedupIndex(existing: ExistingArticles): string {
  const data: DedupIndexData = {
    version: 1,
    urls: Array.from(existing.urls),
    titles: Array.from(existing.titles),
  };
  return JSON.stringify(data);
}

/** @internal Exported for testing. */
export function parseDedupIndex(raw: string): ExistingArticles | null {
  try {
    const data = JSON.parse(raw) as Partial<DedupIndexData>;
    if (data.version === 1 && Array.isArray(data.urls) && Array.isArray(data.titles)) {
      return { urls: new Set(data.urls), titles: new Set(data.titles) };
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

/**
 * Load existing articles' source URLs and titles for deduplication.
 *
 * Fast path: read `sites/<domain>/dedup-index.json` (1 API call).
 * Slow path: fall back to reading every article file individually (N calls).
 * The index is written/updated atomically with article batch commits.
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
    // Local mode — try dedup index first
    const indexPath = path.join(config.localNetworkPath, dedupIndexPath(siteDomain));
    try {
      const raw = await fs.readFile(indexPath, "utf-8");
      const parsed = parseDedupIndex(raw);
      if (parsed) {
        console.log(`[agent] Loaded dedup index (local): ${parsed.urls.size} URLs, ${parsed.titles.size} titles`);
        return parsed;
      }
    } catch {
      // No index — fall through to full scan
    }

    // Full scan (local)
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

    console.log(`[agent] Built dedup index from full scan (local): ${urls.size} URLs, ${titles.size} titles`);
    return { urls, titles };
  }

  // GitHub mode — try dedup index first
  const { listFiles, readFile } = await import("../../lib/github.js");
  const octokit = createOctokit(config.github);

  try {
    const raw = await readFile(octokit, config.networkRepo, dedupIndexPath(siteDomain), branch);
    const parsed = parseDedupIndex(raw);
    if (parsed) {
      console.log(`[agent] Loaded dedup index: ${parsed.urls.size} URLs, ${parsed.titles.size} titles`);
      return parsed;
    }
  } catch {
    // No index — fall through to full scan
  }

  // Full scan (GitHub) — reads every article file individually
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

  console.log(`[agent] Built dedup index from full scan: ${urls.size} URLs, ${titles.size} titles (${files.length} files read)`);
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
  const octokit = createOctokit(config.github);
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

  // Promote legacy singular bundle_id into bundle_ids.
  // Sources, in order: brief.bundle_id, top-level config.bundle_id.
  // NOTE: identical shim exists in services/content-pipeline/src/lib/site-brief.ts — keep in sync.
  const topLevelBundleId = (siteConfig as Record<string, unknown>).bundle_id;
  if (!siteConfig.brief.bundle_ids || siteConfig.brief.bundle_ids.length === 0) {
    const legacy: string[] = [];
    if (siteConfig.brief.bundle_id) legacy.push(siteConfig.brief.bundle_id);
    if (typeof topLevelBundleId === "string" && topLevelBundleId && !legacy.includes(topLevelBundleId)) {
      legacy.push(topLevelBundleId);
    }
    if (legacy.length > 0) {
      siteConfig.brief.bundle_ids = legacy;
    }
  }

  return {
    domain: siteConfig.domain,
    siteName: siteConfig.site_name,
    author: siteConfig.author,
    group: siteConfig.group,
    brief: siteConfig.brief,
  };
}

async function getSiteBrief(
  config: AgentConfig,
  siteDomain: string,
  branch?: string,
  preloaded?: ContentGenerationParams["preloadedBrief"],
) {
  if (preloaded) {
    if (!preloaded.brief.vertical) {
      try {
        const vertical = await resolveVerticalFromIndex(config, siteDomain);
        if (vertical) {
          preloaded.brief.vertical = vertical;
          console.log(`[agent] Resolved vertical from dashboard index: ${vertical}`);
        }
      } catch {
        // Non-critical
      }
    }
    return preloaded;
  }

  let result;
  if (config.localNetworkPath && !branch) {
    const local = await readLocalSiteBrief(config.localNetworkPath, siteDomain);
    if (local) result = local;
  }

  if (!result) {
    const octokit = createOctokit(config.github);
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
    const octokit = createOctokit(config.github);
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
  author?: string,
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
      try {
        generated = await fallback.generate(item, genConfig);
        actualGenerator = fallback.name as "claude" | "openai";
      } catch (fallbackErr) {
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new Error(
          `Both generators failed for "${item.title}": ` +
          `${primary.name}: ${msg} | ${fallback.name}: ${fallbackMsg}`,
        );
      }
    }

    // Step 2b: Validate generated body
    const bodyCheck = validateArticleBody(generated.body);
    if (!bodyCheck.valid) {
      console.warn(`[agent] Article body validation failed for "${item.title}": ${bodyCheck.reason}`);
      return { status: "error", message: `Body validation failed: ${bodyCheck.reason}` };
    }

    // Step 3: Generate slug (from SEO module, then deduplicate)
    const baseSlug = generated.slug || generateSlug(generated.title);
    const slug = await resolveUniqueSlug(config, siteDomain, baseSlug, branch);

    // Step 4: Default image — real image generated async by n8n after commit
    const defaultImagePath = `/assets/images/${siteDomain}-general-article.webp`;
    const featuredImageUrl = defaultImagePath;

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
        ` (threshold: ${brief.quality_threshold ?? 40})`,
      );
    } catch (scoreErr) {
      const errMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
      console.warn(`[agent] Quality scoring failed, defaulting to review: ${errMsg}`);
      qualityNote = `Quality scoring failed: ${errMsg}`;
      qualityScore = 0;
      articleStatus = "review";
    }

    // Step 9: Build frontmatter
    const publishDate = new Date().toISOString().slice(0, 10);

    const frontmatter: ArticleFrontmatterWithExtras = {
      title: generated.title,
      description: seo.metaDescription,
      type: articleType,
      status: articleStatus,
      publishDate,
      author: author || "Editorial Team",
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

    // If the source item is a video, embed it after paragraph 1
    if (item.content_type === "video" && item.url) {
      frontmatter.videos = [
        {
          id: randomUUID(),
          url: item.url,
          position: "after-paragraph-1",
        },
      ];
      console.log(`[agent] Video content detected — embedding ${item.url} after paragraph 1`);
    }

    // Strip leading H1 from body — the title is in frontmatter and rendered
    // by the layout. Models sometimes include it despite prompt instructions.
    const cleanBody = generated.body.replace(/^\s*#\s+[^\n]+\n*/, "");

    const markdown = matter.stringify(cleanBody, frontmatter);
    const filePath = `sites/${siteDomain}/articles/${slug}.md`;

    return {
      status: "created",
      slug,
      path: filePath,
      qualityScore,
      articleStatus,
      generatedBy: actualGenerator,
      _pendingArticle: { siteDomain, slug, content: markdown },
      _imageRequest: {
        requestId: `img_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        siteDomain,
        slug,
        articleTitle: generated.title,
        articleDescription: generated.description,
        articleSummary: item.summary,
        vertical: item.vertical?.name ?? "General",
        sourceThumbnailUrl: item.thumbnail?.url,
        imageGuidelines: brief.image_guidelines ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Failed to process item "${item.title}" (${siteDomain}):`, message);
    if (err instanceof Error && err.stack) {
      console.error(`[agent] Stack trace:`, err.stack);
    }
    return { status: "error", message };
  }
}

// ---------------------------------------------------------------------------
// Concurrency-limited processing — imported from ../../lib/concurrency.js
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bundle fan-out helpers (module-level, exported for testing)
// ---------------------------------------------------------------------------

/** Dependencies injected into the bundle fan-out helpers. */
export interface FetchUnionDeps {
  targetCount: number;
  existing: { urls: Set<string>; titles: Set<string> };
  bundleIds: (string | undefined)[];
  mergedCategoryIds: string[];
  language: string;
  /** Optional rotation seed for the bundle iteration order. Production omits
   *  this and the fan-out rotates by hour-of-day. Tests pass a fixed integer
   *  (e.g. 0) for deterministic ordering. */
  bundleOrderSeed?: number;
  /** `ids` is intentionally absent: pre-published items are indexed by url+title only.
   *  The union-level dedupe additionally tracks `item.id` to catch the same article
   *  appearing in multiple bundle queries. */
}

/** Pagination tunables for the fan-out fetch. Production uses defaults; tests
 *  may override `maxPages: 1` to avoid pagination loops. */
export interface FetchPagination {
  pageSize?: number;
  maxPages?: number;
}

/** Rotate an array left by `n` positions (mod len). Pure, no allocation past one slice. */
function rotateArray<T>(arr: readonly T[], n: number): T[] {
  if (arr.length === 0) return [];
  const offset = ((n % arr.length) + arr.length) % arr.length;
  return [...arr.slice(offset), ...arr.slice(0, offset)];
}

/**
 * Fetch new (non-duplicate) items for a single bundle from the aggregator,
 * paginating until `deps.targetCount` unique items are found or pages run out.
 *
 * @internal Exported for unit testing.
 */
export async function fetchNewItemsForBundle(
  bundleId: string | undefined,
  useTagIds: string[] | undefined,
  label: string,
  deps: FetchUnionDeps,
  pagination: FetchPagination = {},
): Promise<{ newItems: ContentItem[]; totalFetched: number; duplicateCount: number }> {
  const PAGE_SIZE = pagination.pageSize ?? 20;
  const MAX_PAGES = pagination.maxPages ?? 5;
  const newItems: ContentItem[] = [];
  let totalFetched = 0;
  let duplicateCount = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(
      `[agent] [${label}] bundle=${bundleId ?? "(none)"} ` +
      `Fetching page ${page} (${PAGE_SIZE}) — target ${deps.targetCount}`,
    );

    // When a bundle is set, suppress site-level category/tag filters.
    // The aggregator AND's all dimensions; sending bundle + site categories
    // intersects them and wipes results when the bundle's rules don't overlap
    // the site's primary vertical (e.g. site=Travel, bundle=Food/Wine).
    // The bundle's own rules (set when the bundle was created) are the
    // intended filter — the site-level fields are only a fallback for the
    // no-bundle path.
    const response = await getContent({
      limit: PAGE_SIZE,
      page,
      language: deps.language,
      bundle_id: bundleId,
      category_ids: bundleId
        ? undefined
        : (deps.mergedCategoryIds.length > 0 ? deps.mergedCategoryIds : undefined),
      tag_ids: bundleId ? undefined : useTagIds,
    });

    const pageItems = response.items;
    totalFetched += pageItems.length;
    if (pageItems.length === 0) break;

    for (const item of pageItems) {
      if (deps.existing.urls.has(normalizeUrl(item.url))) { duplicateCount++; continue; }
      if (deps.existing.titles.has(normalizeTitleKey(item.title))) { duplicateCount++; continue; }
      newItems.push(item);
    }

    const totalPages = response.total_pages ?? 1;
    if (newItems.length >= deps.targetCount || page >= totalPages) break;

    console.log(
      `[agent] [${label}] bundle=${bundleId ?? "(none)"} Page ${page}: ` +
      `found ${newItems.length} new so far (${duplicateCount} dupes), ` +
      `need ${deps.targetCount - newItems.length} more — fetching next page`,
    );
  }

  return { newItems, totalFetched, duplicateCount };
}

/**
 * Fan out over all bundles in `deps.bundleIds`, merge results, and dedupe
 * across the union by item id, normalized URL, and normalized title.
 *
 * Important: ALL bundles are queried regardless of `deps.targetCount`. The
 * previous early-stop ("break when targetCount reached") meant that when a
 * site had `articles_per_day=1` and N subscribed bundles, only bundle 1 was
 * ever queried — content rotation across bundles was impossible.
 *
 * After collecting items from every bundle, we **round-robin merge** them
 * (item 0 from each bundle, then item 1 from each, …) so coverage is balanced
 * across bundles even when targetCount is smaller than the bundle count.
 *
 * To rotate WHICH bundle wins the first slot across runs (e.g. with
 * targetCount=1 and 3 bundles, you want a different bundle on the front each
 * run), the bundle order is shuffled by a stable hour-of-day rotation. Over
 * a day the rotation visits every bundle position; over many runs each
 * bundle gets fair representation in the first slot.
 *
 * @internal Exported for unit testing.
 */
export async function fetchNewItemsUnion(
  useTagIds: string[] | undefined,
  label: string,
  deps: FetchUnionDeps,
  pagination: FetchPagination = {},
): Promise<{ newItems: ContentItem[]; totalFetched: number; duplicateCount: number }> {
  // Rotate bundle order by hour-of-day so the "first slot" wins fairly over
  // time when targetCount < bundleCount. Deterministic per hour for the same
  // run, which makes tests stable when overridden via deps.bundleOrderSeed.
  const rotation = deps.bundleOrderSeed ?? new Date().getUTCHours();
  const orderedBundles = rotateArray(deps.bundleIds, rotation);

  // Query EVERY bundle. No early-stop on the outer loop.
  const perBundleResults: ContentItem[][] = [];
  let totalFetched = 0;
  let duplicateCount = 0;
  for (const bid of orderedBundles) {
    const result = await fetchNewItemsForBundle(bid, useTagIds, label, deps, pagination);
    totalFetched += result.totalFetched;
    duplicateCount += result.duplicateCount;
    perBundleResults.push(result.newItems);
  }

  // Round-robin merge: item 0 from bundle 0, item 0 from bundle 1, …, item 1
  // from bundle 0, item 1 from bundle 1, … Stops once targetCount is reached.
  const merged: ContentItem[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const maxLen = perBundleResults.reduce((m, b) => Math.max(m, b.length), 0);
  outer: for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < perBundleResults.length; b++) {
      const item = perBundleResults[b]?.[i];
      if (!item) continue;
      const urlKey = normalizeUrl(item.url);
      const titleKey = normalizeTitleKey(item.title);
      if (seenIds.has(item.id) || seenUrls.has(urlKey) || seenTitles.has(titleKey)) {
        duplicateCount++;
        continue;
      }
      seenIds.add(item.id);
      seenUrls.add(urlKey);
      seenTitles.add(titleKey);
      merged.push(item);
      if (merged.length >= deps.targetCount) break outer;
    }
  }

  return { newItems: merged, totalFetched, duplicateCount };
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
  const { siteDomain, branch, count, jobId } = params;
  const targetCount = count ?? 3;

  try {
    // Step 1: Read site brief (skip GitHub read if preloaded from scheduler)
    const { siteName, author: siteAuthor, brief } = await getSiteBrief(
      config, siteDomain, branch, params.preloadedBrief,
    );

    // Step 2: Load existing articles for deduplication
    const existing = await getAllExistingArticles(config, siteDomain, branch);

    // Step 3: Resolve tag IDs from topics if the brief doesn't have them
    let tagIds = brief.tag_ids?.filter((id) => !!id && id.length > 0);
    if ((!tagIds || tagIds.length === 0) && brief.topics.length > 0) {
      console.log(`[agent] No tag_ids in brief — resolving from topics: ${brief.topics.join(", ")}`);
      tagIds = await resolveTopicTagIds(brief.topics);
      tagIds = tagIds.filter((id) => !!id && id.length > 0);
      if (tagIds.length > 0) {
        console.log(`[agent] Resolved ${tagIds.length} tag ID(s): ${tagIds.join(", ")}`);
      }
    }

    // Step 4: Fetch enriched items with pagination — skip past duplicates
    const settings = await getSettings();

    // Post-2026-04-29: vertical_id is now a tier-1 category ID — merge it
    // into category_ids for the aggregator query.
    const categoryIds = brief.category_ids ?? [];
    const mergedCategoryIds = brief.vertical_id
      ? [brief.vertical_id, ...categoryIds.filter((id) => id !== brief.vertical_id)]
      : categoryIds;

    // bundle_ids is the new multi-bundle model. We fan out per bundle and
    // dedupe across the union. An empty/missing bundle_ids array falls back
    // to a single category-only query (the no-bundle path).
    const bundleIds: (string | undefined)[] =
      brief.bundle_ids && brief.bundle_ids.length > 0
        ? brief.bundle_ids
        : [undefined];

    const fetchDeps: FetchUnionDeps = {
      targetCount,
      existing,
      bundleIds,
      mergedCategoryIds,
      language: brief.language ?? "EN",
    };

    // Narrow search: each bundle with tags applied.
    let { newItems, totalFetched, duplicateCount } = await fetchNewItemsUnion(tagIds, "narrow", fetchDeps);

    // Broader fallback: drop tags if narrow returned nothing usable.
    if (newItems.length === 0 && tagIds && tagIds.length > 0) {
      const reason = totalFetched === 0
        ? "returned 0 items"
        : `returned ${totalFetched} items but all ${duplicateCount} were duplicates`;
      console.log(
        `[agent] Narrow search ${reason} — falling back to broad (no tag filter)`,
      );
      const broad = await fetchNewItemsUnion(undefined, "broad", fetchDeps);
      newItems = broad.newItems;
      totalFetched += broad.totalFetched;
      duplicateCount += broad.duplicateCount;
    }

    if (totalFetched === 0) {
      return {
        siteDomain,
        requested: targetCount,
        totalSourced: 0,
        duplicateCount: 0,
        availableNew: 0,
        n8nImagesTriggered: 0,
        results: [{ status: "skipped", reason: "no items found from aggregator" }],
      };
    }

    if (newItems.length === 0) {
      return {
        siteDomain,
        requested: targetCount,
        totalSourced: totalFetched,
        duplicateCount,
        availableNew: 0,
        n8nImagesTriggered: 0,
        results: [{ status: "skipped", reason: "all items already processed" }],
      };
    }

    console.log(
      `[agent] Processing up to ${targetCount} articles for ${siteDomain}` +
      ` from pool of ${newItems.length}` +
      ` (fetched: ${totalFetched}, duplicates: ${duplicateCount})`,
    );

    // Step 5: Process items with concurrency limit, stop at targetCount successes
    const results = await processWithConcurrency(
      newItems,
      MAX_CONCURRENCY,
      targetCount,
      (item) => processItem(item, settings, config, siteDomain, siteName, brief, branch, siteAuthor),
      (result) => result.status === "created",
    );

    // Warn if buffer wasn't enough
    const createdCount = results.filter((r) => r.status === "created").length;
    if (createdCount < targetCount) {
      console.warn(
        `[agent] Only ${createdCount}/${targetCount} articles created from ${totalFetched} fetched items. ` +
        `Returning what we have.`,
      );
    }

    return {
      siteDomain,
      requested: targetCount,
      totalSourced: totalFetched,
      duplicateCount,
      availableNew: newItems.length,
      n8nImagesTriggered: 0,
      results,
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
      n8nImagesTriggered: 0,
      results: [{ status: "error", message }],
    };
  }
}
