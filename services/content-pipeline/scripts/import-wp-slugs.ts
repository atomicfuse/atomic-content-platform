/**
 * One-off importer for specific WP slugs.
 *
 * Fetches a small set of articles by slug from a WordPress REST API, runs them
 * through the same migration pipeline used by `/wp-migrate` (Claude cleanup,
 * quality scoring, n8n/Gemini image, frontmatter build), and commits a single
 * batch to the network repo's staging/<site> branch.
 *
 * Usage:
 *   pnpm tsx scripts/import-wp-slugs.ts \
 *     --site=journeypeaks \
 *     --wp-url=https://journeypeaks.com/wp-json/wp/v2/posts \
 *     --slugs=slug-a,slug-b,slug-c
 *
 * Optional:
 *   --dry-run    Skip the git commit and n8n triggers (still calls Claude).
 *   --skip-ai    Skip Claude cleanup + quality scoring (raw markdown only).
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";

import { fetchWpCategories, extractBaseUrl } from "../src/agents/migration/wp-fetcher.js";
import {
  wpHtmlToMarkdown,
  extractVideosFromHtml,
  stripVideoEmbeds,
} from "../src/agents/migration/html-to-md.js";
import {
  cleanupArticle,
  mapCategoriesToTags,
  ensureTopicTag,
} from "../src/agents/migration/article-cleanup.js";
import {
  buildArticleMd,
  stripHtmlTags,
} from "../src/agents/migration/frontmatter-builder.js";
import type { ArticleMdInput } from "../src/agents/migration/frontmatter-builder.js";
import { commitBatch } from "../src/lib/github.js";
import type { BatchFileEntry } from "../src/lib/github.js";
import { triggerN8nImage } from "../src/agents/content-generation/n8n-image.js";
import { scoreArticle, resolveStatus } from "../src/agents/content-quality/scorer.js";
import { readSiteBrief } from "../src/lib/site-brief.js";
import type { WpArticle } from "../src/agents/migration/types.js";
import type { SiteBrief, QualityScoreBreakdown } from "../src/types.js";

const INTER_REQUEST_DELAY_MS = 1200;
const WP_TIMEOUT_MS = 30_000;
const USER_AGENT = "Mozilla/5.0 (compatible; AtomicBot/1.0)";

interface CliArgs {
  site: string;
  wpUrl: string;
  slugs: string[];
  dryRun: boolean;
  skipAi: boolean;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      site: { type: "string" },
      "wp-url": { type: "string" },
      slugs: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "skip-ai": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const site = values.site;
  const wpUrl = values["wp-url"];
  const slugsRaw = values.slugs;

  if (!site || !wpUrl || !slugsRaw) {
    console.error(
      "Usage: tsx scripts/import-wp-slugs.ts --site=<siteId> --wp-url=<wpApiUrl> --slugs=a,b,c [--dry-run] [--skip-ai]",
    );
    process.exit(1);
  }

  const slugs = slugsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) {
    console.error("No slugs provided");
    process.exit(1);
  }

  return {
    site,
    wpUrl,
    slugs,
    dryRun: values["dry-run"] ?? false,
    skipAi: values["skip-ai"] ?? false,
  };
}

async function fetchWpArticlesBySlugs(
  wpUrl: string,
  slugs: string[],
): Promise<WpArticle[]> {
  // WP REST supports comma-separated slugs in a single request.
  const url = new URL(wpUrl);
  url.searchParams.set("slug", slugs.join(","));
  url.searchParams.set("per_page", String(Math.max(slugs.length, 10)));

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(WP_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`WP API error: ${res.status} ${res.statusText} for ${url.toString()}`);
  }
  return (await res.json()) as WpArticle[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const args = parseCli();

  const githubToken = process.env.GITHUB_TOKEN;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";
  const n8nUrl = process.env.N8N_IMAGE_WEBHOOK_URL;
  const callbackUrl =
    process.env.IMAGE_CALLBACK_URL ??
    "https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback";

  if (!githubToken) {
    console.error("Missing GITHUB_TOKEN env var");
    process.exit(1);
  }
  if (!args.skipAi && !anthropicApiKey) {
    console.error("Missing ANTHROPIC_API_KEY (or pass --skip-ai)");
    process.exit(1);
  }

  const branch = `staging/${args.site}`;
  const useN8n = !!n8nUrl;
  const defaultImagePath = `/assets/images/${args.site}-general-article.webp`;

  console.log(`[import] Site:       ${args.site}`);
  console.log(`[import] Branch:     ${branch}`);
  console.log(`[import] WP URL:     ${args.wpUrl}`);
  console.log(`[import] Slugs:      ${args.slugs.length}`);
  console.log(`[import] AI cleanup: ${args.skipAi ? "SKIPPED" : "on"}`);
  console.log(`[import] Image:      ${useN8n ? "n8n (async)" : "default only"}`);
  console.log(`[import] Dry run:    ${args.dryRun ? "YES" : "no"}`);
  console.log("");

  console.log(`[import] Fetching ${args.slugs.length} article(s) from WP...`);
  const articles = await fetchWpArticlesBySlugs(args.wpUrl, args.slugs);
  console.log(`[import] WP returned ${articles.length} article(s)`);

  const foundSlugs = new Set(articles.map((a) => a.slug));
  const missingFromWp = args.slugs.filter((s) => !foundSlugs.has(s));
  if (missingFromWp.length > 0) {
    console.warn(`[import] NOT FOUND on WP: ${missingFromWp.join(", ")}`);
  }
  if (articles.length === 0) {
    console.error("[import] No articles to import. Aborting.");
    process.exit(1);
  }

  const baseUrl = extractBaseUrl(args.wpUrl);
  const categoryIds = [...new Set(articles.flatMap((a) => a.categories))];
  const wpCategories = [...(await fetchWpCategories(baseUrl, categoryIds)).values()];

  const octokit = new Octokit({ auth: githubToken });

  let siteBrief: SiteBrief | null = null;
  let siteName = args.site;
  let topics: string[] = [];
  let websiteCategory = "general";
  try {
    const briefData = await readSiteBrief(octokit, networkRepo, args.site, branch);
    siteBrief = briefData.brief;
    siteName = briefData.siteName || args.site;
    topics = siteBrief.topics ?? [];
    websiteCategory = siteBrief.vertical || "general";
    console.log(`[import] Loaded site brief for "${siteName}" (${topics.length} topics)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[import] Could not read site brief — quality scoring skipped: ${msg}`);
  }

  const anthropicClient = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null;

  const files: BatchFileEntry[] = [];
  interface PendingImage { slug: string; title: string; description: string }
  const pendingImages: PendingImage[] = [];
  const results: Array<{ slug: string; status: "ok" | "error"; error?: string }> = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]!;
    const slug = article.slug;
    const title = stripHtmlTags(article.title.rendered);
    console.log(`[import] [${i + 1}/${articles.length}] ${slug}`);

    try {
      const videos = extractVideosFromHtml(article.content.rendered);
      const contentWithoutVideos = stripVideoEmbeds(article.content.rendered);
      const rawMarkdown = wpHtmlToMarkdown(contentWithoutVideos);
      const excerpt = stripHtmlTags(article.excerpt.rendered);

      let descriptionFinal: string;
      let markdownFinal: string;

      if (args.skipAi || !anthropicClient) {
        markdownFinal = rawMarkdown;
        descriptionFinal = excerpt || title;
      } else {
        if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
        const cleaned = await cleanupArticle(
          anthropicApiKey,
          title,
          rawMarkdown,
          excerpt,
          anthropicClient,
        );
        markdownFinal = cleaned.markdown;
        descriptionFinal = cleaned.description || excerpt || title;
      }

      const rawTags = mapCategoriesToTags(article.categories, wpCategories, topics);
      const tags = ensureTopicTag(rawTags, topics, title);

      let quality_score: number | undefined;
      let score_breakdown: QualityScoreBreakdown | undefined;
      let quality_note: string | undefined;
      let articleStatus: "approved" | "review" = "approved";

      if (!args.skipAi && siteBrief && anthropicApiKey) {
        try {
          await sleep(INTER_REQUEST_DELAY_MS);
          const q = await scoreArticle(
            { title, description: descriptionFinal, body: markdownFinal, tags, type: "standard" },
            siteName,
            siteBrief,
            siteBrief.quality_weights,
          );
          quality_score = q.overallScore;
          score_breakdown = q.breakdown;
          quality_note = q.note;
          articleStatus = resolveStatus(q.overallScore, siteBrief.quality_threshold);
          console.log(`  quality ${quality_score}/100 → ${articleStatus}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  quality scoring failed: ${msg}`);
        }
      }

      const yoast = article.yoast_head_json;
      const author =
        yoast?.author ?? yoast?.twitter_misc?.["Written by"] ?? "Editorial Team";
      const publishDate = yoast?.article_published_time ?? article.date;

      if (useN8n) {
        pendingImages.push({ slug, title, description: descriptionFinal });
      }

      const mdInput: ArticleMdInput = {
        title,
        description: descriptionFinal,
        slug,
        publishDate,
        author,
        tags,
        markdownBody: markdownFinal,
        featuredImage: defaultImagePath,
        wpOriginalId: article.id,
        sourceUrl: article.link ?? `${baseUrl}/${slug}`,
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

      files.push({
        path: `sites/${args.site}/articles/${slug}.md`,
        content: buildArticleMd(mdInput),
      });
      results.push({ slug, status: "ok" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  error: ${msg}`);
      results.push({ slug, status: "error", error: msg });
    }
  }

  if (files.length === 0) {
    console.error("[import] No files built. Nothing to commit.");
    process.exit(1);
  }

  if (args.dryRun) {
    console.log(`\n[import] DRY RUN — would commit ${files.length} file(s) to ${branch}:`);
    for (const f of files) console.log(`  ${f.path}  (${f.content.length} bytes)`);
    return;
  }

  const commitMsg = `feat(migration): import ${files.length} missing article(s) for ${args.site}`;
  console.log(`\n[import] Committing ${files.length} file(s) to ${branch}...`);
  await commitBatch(octokit, networkRepo, files, [], commitMsg, branch);
  console.log(`[import] Commit done.`);

  if (useN8n && pendingImages.length > 0 && n8nUrl) {
    console.log(`[import] Triggering ${pendingImages.length} n8n image request(s)...`);
    for (const req of pendingImages) {
      void triggerN8nImage(n8nUrl, {
        request_id: `mig_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        callback_url: callbackUrl,
        job_id: "",
        site_domain: args.site,
        slug: req.slug,
        branch,
        article: {
          title: req.title,
          description: req.description,
          summary: req.description,
          vertical: websiteCategory,
          source_thumbnail_url: null,
          image_guidelines: null,
        },
      });
    }
    await sleep(500);
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const errs = results.filter((r) => r.status === "error").length;
  console.log("\n[import] Summary:");
  console.log(`  committed:  ${ok}`);
  console.log(`  errors:     ${errs}`);
  if (missingFromWp.length > 0) {
    console.log(`  not-on-wp:  ${missingFromWp.length} (${missingFromWp.join(", ")})`);
  }
}

main().catch((err) => {
  console.error("[import] FATAL:", err);
  process.exit(1);
});
