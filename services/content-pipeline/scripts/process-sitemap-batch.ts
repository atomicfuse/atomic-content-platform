/**
 * Orchestrator: process a sitemap JSON of { hostname: [url, ...] } across many
 * sites. For each site:
 *   1. List existing slugs in the repo (staging/<siteId>)
 *   2. Diff against the sitemap URLs to find missing-in-repo slugs
 *   3. Query the WP API to determine which exist on WP vs. not
 *   4. Import the WP-existing slugs (Claude cleanup + score)
 *   5. Generate articles for the WP-missing slugs (Claude write + score)
 *   6. Single batched commit per site, fire n8n image triggers
 *
 * Usage:
 *   pnpm tsx scripts/process-sitemap-batch.ts --input=/tmp/sitemaps.json
 *   pnpm tsx scripts/process-sitemap-batch.ts --input=/tmp/sitemaps.json --dry-run
 *   pnpm tsx scripts/process-sitemap-batch.ts --input=/tmp/sitemaps.json --only=fashionnewsbee.com,popnsnap.com
 *   pnpm tsx scripts/process-sitemap-batch.ts --input=/tmp/sitemaps.md   (auto-strips JS wrapper)
 *
 * Always skips journeypeaks.com (already processed).
 *
 * Reads existing repo slugs via `git ls-tree` against $LOCAL_NETWORK_PATH for speed.
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";
import matter from "gray-matter";

import { fetchWpCategories, extractBaseUrl } from "../src/agents/migration/wp-fetcher.js";
import {
  wpHtmlToMarkdown,
  extractVideosFromHtml,
  stripVideoEmbeds,
} from "../src/agents/migration/html-to-md.js";
import {
  cleanupArticle,
  mapCategoriesToTags,
  ensureTopicTag as ensureTopicTagMigration,
} from "../src/agents/migration/article-cleanup.js";
import {
  buildArticleMd,
  stripHtmlTags,
  estimateReadingTime,
} from "../src/agents/migration/frontmatter-builder.js";
import type { ArticleMdInput } from "../src/agents/migration/frontmatter-builder.js";
import { ClaudeGenerator } from "../src/agents/content-generation/generators/claude-generator.js";
import type { ContentItem, GeneratedArticle } from "../src/agents/content-generation/types.js";
import { ensureTopicTag as ensureTopicTagGen } from "../src/agents/content-generation/agent.js";
import { commitBatch } from "../src/lib/github.js";
import type { BatchFileEntry } from "../src/lib/github.js";
import { triggerN8nImage } from "../src/agents/content-generation/n8n-image.js";
import { scoreArticle, resolveStatus } from "../src/agents/content-quality/scorer.js";
import { readSiteBrief } from "../src/lib/site-brief.js";
import type { WpArticle, WpCategory } from "../src/agents/migration/types.js";
import type { SiteBrief, QualityScoreBreakdown } from "../src/types.js";

const INTER_REQUEST_DELAY_MS = 1200;
const WP_TIMEOUT_MS = 30_000;
const USER_AGENT = "Mozilla/5.0 (compatible; AtomicBot/1.0)";
const SKIP_SITES = new Set(["journeypeaks.com"]);
const STATE_FILE = "/tmp/sitemap-batch-state.json";

interface CliArgs {
  input: string;
  dryRun: boolean;
  only: Set<string> | null;
  skipExisting: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      only: { type: "string" },
      "skip-existing": { type: "boolean", default: true },
    },
    allowPositionals: false,
  });
  if (!values.input) {
    console.error("Usage: tsx scripts/process-sitemap-batch.ts --input=<path> [--dry-run] [--only=host1,host2]");
    process.exit(1);
  }
  return {
    input: values.input,
    dryRun: values["dry-run"] ?? false,
    only: values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null,
    skipExisting: values["skip-existing"] ?? true,
  };
}

function loadSitemap(path: string): Record<string, string[]> {
  const raw = readFileSync(path, "utf8");
  // Strip JS wrapper if present: `const sitemaps = { ... };` or `export const ...`
  let body = raw.trim();
  body = body.replace(/^\s*(?:export\s+)?const\s+\w+\s*=\s*/, "");
  body = body.replace(/;\s*$/, "");
  // Convert single quotes to double quotes for JSON parse
  // Strategy: walk and convert quoted strings — but JS object literals with single quotes
  // are not valid JSON. Use a tolerant parser via JSON5-style replacement.
  // Simpler: replace `'` with `"` wholesale; URLs don't contain single quotes typically.
  const jsonish = body.replace(/'/g, '"');
  try {
    return JSON.parse(jsonish) as Record<string, string[]>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${path}: ${msg}`);
  }
}

function hostToSiteId(host: string): string {
  let h = host.toLowerCase().trim();
  if (h.startsWith("www.")) h = h.slice(4);
  h = h.replace(/\.(co\.uk|co\.nz|com\.au)$/, "").replace(/\.[a-z]{2,}$/, "");
  return h.replace(/[^a-z0-9]/g, "");
}

function urlToSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/|\/$/g, "");
    if (!path) return null;
    const decoded = decodeURIComponent(path);
    // Only allow alnum + dash; skip slugs with other chars (emoji, etc.)
    if (!/^[a-z0-9-]+$/i.test(decoded)) return null;
    return decoded.toLowerCase();
  } catch {
    return null;
  }
}

function urlHost(url: string): string {
  return new URL(url).host;
}

function listExistingSlugs(networkPath: string, siteId: string): Set<string> {
  const ref = `origin/staging/${siteId}`;
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["-C", networkPath, "ls-tree", "-r", "--name-only", ref, `sites/${siteId}/articles/`],
      { encoding: "utf8" },
    );
  } catch {
    return new Set();
  }
  const slugs = new Set<string>();
  for (const line of out.split("\n")) {
    const m = line.match(/^sites\/[^/]+\/articles\/(.+)\.md$/);
    if (m) slugs.add(m[1]!.toLowerCase());
  }
  return slugs;
}

/**
 * Fetch WP articles by slugs. Returns:
 *   - `articles`: matched WP articles (could be empty)
 *   - `wpAvailable`: false if the WP REST API is gone/migrated (404 on root)
 *
 * On 429, retries with backoff. On 404 on the root endpoint, marks WP unavailable
 * (the site is no longer WordPress — all missing slugs should be generated).
 * On other errors, logs and returns wpAvailable=false (safer than aborting).
 */
async function fetchWpArticlesBySlugs(wpUrl: string, slugs: string[]):
  Promise<{ articles: WpArticle[]; wpAvailable: boolean }> {
  if (slugs.length === 0) return { articles: [], wpAvailable: true };

  // Probe the endpoint first with a 1-post request — cheap and tells us if WP is alive.
  try {
    const probe = new URL(wpUrl);
    probe.searchParams.set("per_page", "1");
    const probeRes = await fetch(probe.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(WP_TIMEOUT_MS),
    });
    if (probeRes.status === 404) return { articles: [], wpAvailable: false };
    if (!probeRes.ok && probeRes.status !== 429) {
      console.warn(`    WP probe ${probeRes.status} for ${wpUrl} — treating as unavailable`);
      return { articles: [], wpAvailable: false };
    }
  } catch (err) {
    console.warn(`    WP probe failed for ${wpUrl}: ${(err as Error).message} — treating as unavailable`);
    return { articles: [], wpAvailable: false };
  }

  const out: WpArticle[] = [];
  const failedSlugs: string[] = [];
  const chunkSize = 10;
  for (let i = 0; i < slugs.length; i += chunkSize) {
    const chunk = slugs.slice(i, i + chunkSize);

    let attempt = 0;
    const maxAttempts = 4;
    let chunkOk = false;
    while (attempt < maxAttempts) {
      attempt++;
      const url = new URL(wpUrl);
      url.searchParams.set("slug", chunk.join(","));
      url.searchParams.set("per_page", String(Math.max(chunk.length, 10)));
      try {
        const res = await fetch(url.toString(), {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(WP_TIMEOUT_MS),
        });
        if (res.status === 429 && attempt < maxAttempts) {
          await sleep(2000 * attempt);
          continue;
        }
        if (!res.ok) break;
        const page = (await res.json()) as WpArticle[];
        out.push(...page);
        chunkOk = true;
        break;
      } catch {
        if (attempt < maxAttempts) {
          await sleep(2000 * attempt);
          continue;
        }
        break;
      }
    }
    if (!chunkOk) failedSlugs.push(...chunk);
    await sleep(300);
  }

  // Per-slug fallback for chunks that failed (e.g. persistent 429)
  if (failedSlugs.length > 0) {
    console.warn(`    Bulk lookup failed for ${failedSlugs.length} slug(s); retrying one by one...`);
    for (const slug of failedSlugs) {
      let attempt = 0;
      while (attempt < 3) {
        attempt++;
        try {
          const url = new URL(wpUrl);
          url.searchParams.set("slug", slug);
          const res = await fetch(url.toString(), {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(WP_TIMEOUT_MS),
          });
          if (res.status === 429) { await sleep(2000 * attempt); continue; }
          if (!res.ok) break;
          const page = (await res.json()) as WpArticle[];
          out.push(...page);
          break;
        } catch {
          await sleep(2000 * attempt);
        }
      }
      await sleep(800);
    }
  }
  return { articles: out, wpAvailable: true };
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

interface SitePlan {
  host: string;
  siteId: string;
  branch: string;
  wpUrl: string;
  wpAvailable: boolean;        // false if WP REST API is gone (migrated site)
  existingInRepo: number;
  totalRequested: number;
  invalidSlugs: number;
  missingInRepo: string[];
  toImport: string[];          // exist on WP — slug list
  toGenerate: string[];        // not on WP — slug list (or WP unavailable)
  wpArticles: WpArticle[];     // pre-fetched WP article data for imports
}

async function planSite(
  host: string,
  urls: string[],
  networkPath: string,
): Promise<SitePlan> {
  const siteId = hostToSiteId(host);
  const branch = `staging/${siteId}`;

  // Extract slugs
  const slugs: string[] = [];
  let invalid = 0;
  for (const u of urls) {
    const s = urlToSlug(u);
    if (!s) { invalid++; continue; }
    slugs.push(s);
  }
  const uniqueSlugs = [...new Set(slugs)];

  // Existing in repo
  const existingSlugs = listExistingSlugs(networkPath, siteId);
  const missing = uniqueSlugs.filter((s) => !existingSlugs.has(s));

  // WP existence — use the first URL's host (handles `www.`)
  const wpHost = urlHost(urls[0]!);
  const wpUrl = `https://${wpHost}/wp-json/wp/v2/posts`;
  const { articles: wpArticles, wpAvailable } = await fetchWpArticlesBySlugs(wpUrl, missing);
  const wpSlugsFound = new Set(wpArticles.map((a) => a.slug.toLowerCase()));

  const toImport = wpAvailable ? missing.filter((s) => wpSlugsFound.has(s)) : [];
  const toGenerate = wpAvailable
    ? missing.filter((s) => !wpSlugsFound.has(s))
    : [...missing]; // WP gone → generate everything missing

  return {
    host, siteId, branch, wpUrl, wpAvailable,
    existingInRepo: existingSlugs.size,
    totalRequested: uniqueSlugs.length,
    invalidSlugs: invalid,
    missingInRepo: missing,
    toImport,
    toGenerate,
    wpArticles,
  };
}

// ---------------------------------------------------------------------------
// Article processing — produces a file entry + optional pending n8n image
// ---------------------------------------------------------------------------

interface ProcessedArticle {
  file: BatchFileEntry;
  image?: { slug: string; title: string; description: string };
  qualityScore?: number;
  articleStatus: "approved" | "review";
}

async function processImport(
  article: WpArticle,
  siteId: string,
  wpCategories: WpCategory[],
  topics: string[],
  siteName: string,
  brief: SiteBrief | null,
  anthropicApiKey: string,
  anthropicClient: Anthropic,
  defaultImagePath: string,
): Promise<ProcessedArticle> {
  const slug = article.slug.toLowerCase();
  const title = stripHtmlTags(article.title.rendered);

  const videos = extractVideosFromHtml(article.content.rendered);
  const contentWithoutVideos = stripVideoEmbeds(article.content.rendered);
  const rawMarkdown = wpHtmlToMarkdown(contentWithoutVideos);
  const excerpt = stripHtmlTags(article.excerpt.rendered);

  const cleaned = await cleanupArticle(anthropicApiKey, title, rawMarkdown, excerpt, anthropicClient);

  const rawTags = mapCategoriesToTags(article.categories, wpCategories, topics);
  const tags = ensureTopicTagMigration(rawTags, topics, title);

  let quality_score: number | undefined;
  let score_breakdown: QualityScoreBreakdown | undefined;
  let quality_note: string | undefined;
  let articleStatus: "approved" | "review" = "approved";

  if (brief) {
    try {
      await sleep(INTER_REQUEST_DELAY_MS);
      const q = await scoreArticle(
        { title, description: cleaned.description, body: cleaned.markdown, tags, type: "standard" },
        siteName, brief, brief.quality_weights,
      );
      quality_score = q.overallScore;
      score_breakdown = q.breakdown;
      quality_note = q.note;
      articleStatus = resolveStatus(q.overallScore, brief.quality_threshold);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`    quality scoring failed: ${msg}`);
    }
  }

  const yoast = article.yoast_head_json;
  const author = yoast?.author ?? yoast?.twitter_misc?.["Written by"] ?? "Editorial Team";
  const publishDate = yoast?.article_published_time ?? article.date;

  const mdInput: ArticleMdInput = {
    title,
    description: cleaned.description,
    slug,
    publishDate,
    author,
    tags,
    markdownBody: cleaned.markdown,
    featuredImage: defaultImagePath,
    wpOriginalId: article.id,
    sourceUrl: article.link ?? "",
    seo: {
      canonical: yoast?.canonical,
      og_title: yoast?.og_title,
      og_description: yoast?.og_description,
      og_image: yoast?.og_image?.[0]?.url,
      twitter_card: yoast?.twitter_card,
    },
    videos: videos.length > 0 ? videos : undefined,
    quality_score,
    score_breakdown,
    quality_note,
    articleStatus,
  };

  return {
    file: { path: `sites/${siteId}/articles/${slug}.md`, content: buildArticleMd(mdInput) },
    image: { slug, title, description: cleaned.description },
    qualityScore: quality_score,
    articleStatus,
  };
}

function titleizeSlug(slug: string): string {
  return slug.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function buildSyntheticItem(slug: string, brief: SiteBrief): ContentItem {
  const workingTitle = titleizeSlug(slug);
  const topic = brief.topics?.[0] ?? "General";
  const verticalName = brief.vertical ?? "General";
  return {
    id: `synthetic-${slug}`,
    url: "",
    title: workingTitle,
    description: "",
    summary: workingTitle,
    thumbnail: null,
    content_type: "general",
    vertical: { name: verticalName },
    categories: [{ name: topic }],
    tags: [],
    audience_types: brief.audience ? [{ name: brief.audience }] : [],
    source: { name: "Editorial" },
    published_at: new Date().toISOString(),
    language: "en",
  };
}

async function processGenerate(
  slug: string,
  siteId: string,
  brief: SiteBrief,
  siteName: string,
  generator: ClaudeGenerator,
  defaultImagePath: string,
): Promise<ProcessedArticle> {
  const item = buildSyntheticItem(slug, brief);
  const generated: GeneratedArticle = await generator.generate(item, { siteName, brief });
  const tags = ensureTopicTagGen(generated.tags ?? [], brief.topics ?? [], generated.title);

  let quality_score: number | undefined;
  let score_breakdown: QualityScoreBreakdown | undefined;
  let quality_note: string | undefined;
  let articleStatus: "approved" | "review" = "approved";

  try {
    await sleep(INTER_REQUEST_DELAY_MS);
    const q = await scoreArticle(
      { title: generated.title, description: generated.description, body: generated.body, tags, type: "standard" },
      siteName, brief, brief.quality_weights,
    );
    quality_score = q.overallScore;
    score_breakdown = q.breakdown;
    quality_note = q.note;
    articleStatus = resolveStatus(q.overallScore, brief.quality_threshold);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`    quality scoring failed: ${msg}`);
  }

  const publishDate = new Date().toISOString().slice(0, 10);
  const cleanBody = generated.body.replace(/^\s*#\s+[^\n]+\n*/, "");
  const readingTime = estimateReadingTime(cleanBody);

  const frontmatter: Record<string, unknown> = {
    title: generated.title,
    description: generated.description,
    type: "standard",
    status: articleStatus,
    publishDate,
    author: "Editorial Team",
    tags,
    slug,
    reviewer_notes: articleStatus === "review" ? (quality_note ?? "") : "",
    source_url: "",
    source_item_id: `synthetic-${slug}`,
    generated_by: "claude",
    featuredImage: defaultImagePath,
    reading_time: readingTime,
  };
  if (quality_score !== undefined) frontmatter.quality_score = quality_score;
  if (score_breakdown) frontmatter.score_breakdown = score_breakdown;
  if (quality_note) frontmatter.quality_note = quality_note;

  return {
    file: { path: `sites/${siteId}/articles/${slug}.md`, content: matter.stringify(cleanBody, frontmatter) },
    image: { slug, title: generated.title, description: generated.description },
    qualityScore: quality_score,
    articleStatus,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface SiteResult {
  host: string;
  siteId: string;
  imported: number;
  generated: number;
  errors: number;
  errorDetail: Array<{ slug: string; type: "import" | "generate"; error: string }>;
  commitSha?: string;
  durationMs: number;
}

async function main(): Promise<void> {
  const args = parseCli();

  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";
  const networkPath = process.env.LOCAL_NETWORK_PATH;
  const n8nUrl = process.env.N8N_IMAGE_WEBHOOK_URL;
  const callbackUrl = process.env.IMAGE_CALLBACK_URL
    ?? "https://sites-platform-e297--atomic.cloudgrid.io/api/agent/image-callback";

  if (!githubToken) { console.error("Missing GITHUB_TOKEN"); process.exit(1); }
  if (!args.dryRun && !anthropicApiKey) { console.error("Missing ANTHROPIC_API_KEY"); process.exit(1); }
  if (!networkPath) { console.error("Missing LOCAL_NETWORK_PATH (used for fast slug listing)"); process.exit(1); }

  const sitemap = loadSitemap(args.input);
  const allHosts = Object.keys(sitemap);
  const hosts = allHosts.filter((h) => {
    if (SKIP_SITES.has(h)) return false;
    if (args.only && !args.only.has(h)) return false;
    return true;
  });
  console.log(`[batch] Input: ${args.input}`);
  console.log(`[batch] Sites: ${hosts.length} (of ${allHosts.length}, ${allHosts.length - hosts.length} skipped)`);
  console.log(`[batch] Mode:  ${args.dryRun ? "DRY-RUN (no Claude calls, no commits)" : "LIVE"}`);
  console.log("");

  // Ensure fresh fetch of staging branches (one shot, before per-site loop)
  console.log("[batch] git fetch --all --prune...");
  try {
    execFileSync("git", ["-C", networkPath, "fetch", "--all", "--prune"], { stdio: "inherit" });
  } catch (err) {
    console.warn(`[batch] git fetch failed: ${(err as Error).message}`);
  }
  console.log("");

  // ===== PLANNING PHASE (always runs) =====
  console.log("[batch] === Planning phase ===");
  const plans: SitePlan[] = [];
  for (let i = 0; i < hosts.length; i++) {
    const host = hosts[i]!;
    const urls = sitemap[host]!;
    try {
      const plan = await planSite(host, urls, networkPath);
      plans.push(plan);
      console.log(
        `[plan] [${i + 1}/${hosts.length}] ${host.padEnd(28)} ` +
        `requested=${plan.totalRequested}  in-repo=${plan.existingInRepo}  ` +
        `missing=${plan.missingInRepo.length}  → import=${plan.toImport.length}  generate=${plan.toGenerate.length}` +
        (plan.invalidSlugs ? `  invalid=${plan.invalidSlugs}` : "") +
        (!plan.wpAvailable && plan.missingInRepo.length > 0 ? "  (WP unavailable — all → generate)" : ""),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[plan] [${i + 1}/${hosts.length}] ${host} FAILED: ${msg}`);
    }
  }

  const totalImport = plans.reduce((s, p) => s + p.toImport.length, 0);
  const totalGenerate = plans.reduce((s, p) => s + p.toGenerate.length, 0);
  console.log("");
  console.log(`[batch] === Plan summary ===`);
  console.log(`  total-import:   ${totalImport}`);
  console.log(`  total-generate: ${totalGenerate}`);
  console.log(`  total work:     ${totalImport + totalGenerate} articles across ${plans.length} sites`);
  console.log("");

  if (args.dryRun) {
    // Dump plan to disk for inspection / resumability
    writeFileSync("/tmp/sitemap-batch-plan.json", JSON.stringify(plans.map((p) => ({
      host: p.host, siteId: p.siteId, branch: p.branch, wpAvailable: p.wpAvailable,
      totalRequested: p.totalRequested, existingInRepo: p.existingInRepo, invalidSlugs: p.invalidSlugs,
      missingInRepo: p.missingInRepo, toImport: p.toImport, toGenerate: p.toGenerate,
    })), null, 2));
    console.log("[batch] DRY-RUN complete. Plan written to /tmp/sitemap-batch-plan.json");
    return;
  }

  // ===== EXECUTION PHASE =====
  const octokit = new Octokit({ auth: githubToken });
  const anthropicClient = new Anthropic({ apiKey: anthropicApiKey });
  const claudeGenerator = new ClaudeGenerator();

  const results: SiteResult[] = [];
  const batchStart = Date.now();

  for (let pi = 0; pi < plans.length; pi++) {
    const plan = plans[pi]!;
    const siteStart = Date.now();

    if (plan.toImport.length === 0 && plan.toGenerate.length === 0) {
      console.log(`[site ${pi + 1}/${plans.length}] ${plan.host}: nothing to do, skipping`);
      results.push({ host: plan.host, siteId: plan.siteId, imported: 0, generated: 0, errors: 0, errorDetail: [], durationMs: 0 });
      continue;
    }

    console.log("");
    console.log(`[site ${pi + 1}/${plans.length}] ${plan.host} → ${plan.branch}`);
    console.log(`  import=${plan.toImport.length}  generate=${plan.toGenerate.length}`);

    // Read site brief
    let brief: SiteBrief | null = null;
    let siteName = plan.siteId;
    let topics: string[] = [];
    let vertical = "general";
    try {
      const briefData = await readSiteBrief(octokit, networkRepo, plan.siteId, plan.branch);
      brief = briefData.brief;
      siteName = briefData.siteName || plan.siteId;
      topics = brief.topics ?? [];
      vertical = brief.vertical ?? "general";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  WARN: could not read brief: ${msg}`);
    }

    // Fetch WP categories for imports
    let wpCategories: WpCategory[] = [];
    if (plan.wpArticles.length > 0) {
      const baseUrl = extractBaseUrl(plan.wpUrl);
      const catIds = [...new Set(plan.wpArticles.flatMap((a) => a.categories))];
      try {
        wpCategories = [...(await fetchWpCategories(baseUrl, catIds)).values()];
      } catch (err) {
        console.warn(`  WARN: could not fetch WP categories: ${(err as Error).message}`);
      }
    }

    const defaultImagePath = `/assets/images/${plan.siteId}-general-article.webp`;
    const files: BatchFileEntry[] = [];
    const pendingImages: Array<{ slug: string; title: string; description: string }> = [];
    const errorDetail: SiteResult["errorDetail"] = [];

    // Imports
    for (let i = 0; i < plan.wpArticles.length; i++) {
      const a = plan.wpArticles[i]!;
      const slug = a.slug.toLowerCase();
      process.stdout.write(`  [import ${i + 1}/${plan.wpArticles.length}] ${slug.slice(0, 60)}... `);
      try {
        if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
        const r = await processImport(
          a, plan.siteId, wpCategories, topics, siteName, brief,
          anthropicApiKey, anthropicClient, defaultImagePath,
        );
        files.push(r.file);
        if (r.image) pendingImages.push(r.image);
        console.log(`q=${r.qualityScore ?? "n/a"} → ${r.articleStatus}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`ERROR: ${msg}`);
        errorDetail.push({ slug, type: "import", error: msg });
      }
    }

    // Generates
    if (brief) {
      for (let i = 0; i < plan.toGenerate.length; i++) {
        const slug = plan.toGenerate[i]!;
        process.stdout.write(`  [generate ${i + 1}/${plan.toGenerate.length}] ${slug.slice(0, 60)}... `);
        try {
          await sleep(INTER_REQUEST_DELAY_MS);
          const r = await processGenerate(slug, plan.siteId, brief, siteName, claudeGenerator, defaultImagePath);
          files.push(r.file);
          if (r.image) pendingImages.push(r.image);
          console.log(`q=${r.qualityScore ?? "n/a"} → ${r.articleStatus}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`ERROR: ${msg}`);
          errorDetail.push({ slug, type: "generate", error: msg });
        }
      }
    } else if (plan.toGenerate.length > 0) {
      console.warn(`  SKIP ${plan.toGenerate.length} generate(s) — no site brief loaded`);
      for (const slug of plan.toGenerate) {
        errorDetail.push({ slug, type: "generate", error: "no site brief" });
      }
    }

    // Commit
    let commitSha: string | undefined;
    if (files.length > 0) {
      const msg = `feat(batch): import ${plan.wpArticles.length - errorDetail.filter((e) => e.type === "import").length} + generate ${plan.toGenerate.length - errorDetail.filter((e) => e.type === "generate").length} article(s) for ${plan.siteId}`;
      try {
        commitSha = await commitBatch(octokit, networkRepo, files, [], msg, plan.branch);
        console.log(`  committed ${files.length} file(s): ${commitSha.slice(0, 7)}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`  COMMIT FAILED: ${errMsg}`);
        errorDetail.push({ slug: "(commit)", type: "import", error: errMsg });
      }
    }

    // n8n images
    if (n8nUrl && pendingImages.length > 0 && commitSha) {
      console.log(`  triggering ${pendingImages.length} n8n image request(s)...`);
      for (const req of pendingImages) {
        void triggerN8nImage(n8nUrl, {
          request_id: `bat_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
          callback_url: callbackUrl,
          job_id: "",
          site_domain: plan.siteId,
          slug: req.slug,
          branch: plan.branch,
          article: {
            title: req.title,
            description: req.description,
            summary: req.description,
            vertical,
            source_thumbnail_url: null,
            image_guidelines: null,
          },
        });
      }
      await sleep(500);
    }

    const durationMs = Date.now() - siteStart;
    const importedOk = plan.wpArticles.length - errorDetail.filter((e) => e.type === "import").length;
    const generatedOk = plan.toGenerate.length - errorDetail.filter((e) => e.type === "generate").length;
    results.push({
      host: plan.host, siteId: plan.siteId,
      imported: importedOk, generated: generatedOk,
      errors: errorDetail.length, errorDetail,
      ...(commitSha ? { commitSha } : {}),
      durationMs,
    });
    console.log(`  ✓ ${plan.host} done in ${(durationMs / 1000).toFixed(1)}s (imported=${importedOk}, generated=${generatedOk}, errors=${errorDetail.length})`);

    // Persist progress after each site
    writeFileSync(STATE_FILE, JSON.stringify(results, null, 2));
  }

  const totalMs = Date.now() - batchStart;
  console.log("");
  console.log("[batch] === FINAL SUMMARY ===");
  console.log(`  duration:  ${(totalMs / 60_000).toFixed(1)} min`);
  console.log(`  sites:     ${results.length}`);
  console.log(`  imported:  ${results.reduce((s, r) => s + r.imported, 0)}`);
  console.log(`  generated: ${results.reduce((s, r) => s + r.generated, 0)}`);
  console.log(`  errors:    ${results.reduce((s, r) => s + r.errors, 0)}`);
  console.log(`  state file: ${STATE_FILE}`);
  for (const r of results) {
    if (r.errors > 0) {
      console.log(`  errors on ${r.host}:`);
      for (const e of r.errorDetail.slice(0, 5)) {
        console.log(`    [${e.type}] ${e.slug}: ${e.error.slice(0, 100)}`);
      }
      if (r.errorDetail.length > 5) console.log(`    ... and ${r.errorDetail.length - 5} more`);
    }
  }
}

main().catch((err) => {
  console.error("[batch] FATAL:", err);
  process.exit(1);
});
