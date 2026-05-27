/**
 * One-off: import a WP article that has emoji/non-filesystem chars in its slug,
 * saving it locally under a clean ASCII slug.
 *
 *   pnpm tsx scripts/import-wp-emoji-slug.ts \
 *     --site=medicalnewscorner \
 *     --wp-url=https://medicalnewscorner.com/wp-json/wp/v2/posts \
 *     --wp-id=24594 \
 *     --save-as=career-battle-neurologist-vs-psychiatrist
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";

import { fetchWpCategories, extractBaseUrl } from "../src/agents/migration/wp-fetcher.js";
import { wpHtmlToMarkdown, extractVideosFromHtml, stripVideoEmbeds } from "../src/agents/migration/html-to-md.js";
import { cleanupArticle, mapCategoriesToTags, ensureTopicTag } from "../src/agents/migration/article-cleanup.js";
import { buildArticleMd, stripHtmlTags } from "../src/agents/migration/frontmatter-builder.js";
import type { ArticleMdInput } from "../src/agents/migration/frontmatter-builder.js";
import { commitBatch } from "../src/lib/github.js";
import { triggerN8nImage } from "../src/agents/content-generation/n8n-image.js";
import { scoreArticle, resolveStatus } from "../src/agents/content-quality/scorer.js";
import { readSiteBrief } from "../src/lib/site-brief.js";
import type { WpArticle } from "../src/agents/migration/types.js";

const USER_AGENT = "Mozilla/5.0 (compatible; AtomicBot/1.0)";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      site: { type: "string" },
      "wp-url": { type: "string" },
      "wp-id": { type: "string" },
      "save-as": { type: "string" },
    },
  });
  const { site, "wp-url": wpUrl, "wp-id": wpIdStr, "save-as": saveAs } = values;
  if (!site || !wpUrl || !wpIdStr || !saveAs) {
    console.error("Usage: --site=<id> --wp-url=<url> --wp-id=<n> --save-as=<slug>");
    process.exit(1);
  }
  const wpId = Number(wpIdStr);
  const branch = `staging/${site}`;
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";
  const githubToken = process.env.GITHUB_TOKEN!;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY!;
  const n8nUrl = process.env.N8N_IMAGE_WEBHOOK_URL;
  const callbackUrl = process.env.IMAGE_CALLBACK_URL
    ?? "https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback";

  // 1. Fetch the WP article by ID
  const fetchUrl = `${wpUrl.replace(/\/$/, "")}/${wpId}`;
  const res = await fetch(fetchUrl, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`WP fetch ${res.status} ${res.statusText}`);
  const article = (await res.json()) as WpArticle;
  const originalTitle = stripHtmlTags(article.title.rendered);
  console.log(`Fetched WP article ${wpId}: ${originalTitle}`);

  // Strip the emoji from the title for display (keep meaning)
  const cleanTitle = originalTitle.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  if (cleanTitle !== originalTitle) console.log(`Cleaned title: ${cleanTitle}`);

  // 2. Setup
  const octokit = new Octokit({ auth: githubToken });
  const briefData = await readSiteBrief(octokit, networkRepo, site, branch);
  const brief = briefData.brief;
  const siteName = briefData.siteName || site;
  const topics = brief.topics ?? [];

  const baseUrl = extractBaseUrl(wpUrl);
  const wpCategories = [...(await fetchWpCategories(baseUrl, article.categories)).values()];
  const anthropicClient = new Anthropic({ apiKey: anthropicApiKey });

  // 3. Cleanup
  const videos = extractVideosFromHtml(article.content.rendered);
  const contentWithoutVideos = stripVideoEmbeds(article.content.rendered);
  const rawMarkdown = wpHtmlToMarkdown(contentWithoutVideos);
  const excerpt = stripHtmlTags(article.excerpt.rendered);
  const cleaned = await cleanupArticle(anthropicApiKey, cleanTitle, rawMarkdown, excerpt, anthropicClient);

  const rawTags = mapCategoriesToTags(article.categories, wpCategories, topics);
  const tags = ensureTopicTag(rawTags, topics, cleanTitle);

  // 4. Quality score
  await new Promise((r) => setTimeout(r, 1200));
  const q = await scoreArticle(
    { title: cleanTitle, description: cleaned.description, body: cleaned.markdown, tags, type: "standard" },
    siteName, brief, brief.quality_weights,
  );
  const articleStatus = resolveStatus(q.overallScore, brief.quality_threshold);
  console.log(`quality ${q.overallScore}/100 → ${articleStatus}`);

  // 5. Build + commit
  const yoast = article.yoast_head_json;
  const author = yoast?.author ?? "Editorial Team";
  const publishDate = yoast?.article_published_time ?? article.date;
  const defaultImagePath = `/assets/images/${site}-general-article.webp`;

  const mdInput: ArticleMdInput = {
    title: cleanTitle,
    description: cleaned.description,
    slug: saveAs,
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
    quality_score: q.overallScore,
    score_breakdown: q.breakdown,
    quality_note: q.note,
    articleStatus,
  };

  const file = { path: `sites/${site}/articles/${saveAs}.md`, content: buildArticleMd(mdInput) };
  const sha = await commitBatch(
    octokit, networkRepo, [file], [],
    `feat(${site}): import wp:${wpId} (${originalTitle}) under emoji-free slug`,
    branch,
  );
  console.log(`committed ${sha.slice(0, 7)}`);

  // 6. n8n image
  if (n8nUrl) {
    await triggerN8nImage(n8nUrl, {
      request_id: `mig_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      callback_url: callbackUrl,
      job_id: "",
      site_domain: site,
      slug: saveAs,
      branch,
      article: {
        title: cleanTitle,
        description: cleaned.description,
        summary: cleaned.description,
        vertical: brief.vertical ?? "general",
        source_thumbnail_url: null,
        image_guidelines: null,
      },
    });
    console.log("n8n image triggered");
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
