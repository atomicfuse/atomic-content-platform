/**
 * Migration orchestrator — wires all modules together for one site.
 *
 * Fetches WP articles, converts HTML → Markdown, cleans up via Claude,
 * generates hero images via Gemini, uploads to R2, assembles .md files,
 * and batch-commits everything to the network repo.
 */

import type { Octokit } from "@octokit/rest";
import type {
  CsvSiteRow,
  MigrationProgress,
  MigrationArticleResult,
  MigrationReport,
} from "./types.js";
import { fetchWpArticles, fetchWpCategories, extractBaseUrl } from "./wp-fetcher.js";
import { wpHtmlToMarkdown } from "./html-to-md.js";
import { cleanupArticle, mapCategoriesToTags } from "./article-cleanup.js";
import { buildArticleMd, stripHtmlTags } from "./frontmatter-builder.js";
import type { ArticleMdInput } from "./frontmatter-builder.js";
import { domainToSiteId } from "./site-scaffolder.js";
import { uploadToR2, buildR2Key } from "../../lib/r2-upload.js";
import { generateImageWithGemini } from "../../lib/gemini.js";
import { optimizeImage } from "../../lib/image-optimizer.js";
import { commitBatch } from "../../lib/github.js";
import type { BatchFileEntry } from "../../lib/github.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface MigrationConfig {
  anthropicApiKey: string;
  geminiApiKey: string;
  octokit: Octokit;
  networkRepo: string;   // e.g. "atomicfuse/atomic-labs-network"
  branch: string;        // e.g. "staging/travelbeautytips"
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full migration pipeline for a single site.
 *
 * 1. Fetch all WP articles
 * 2. Fetch WP categories
 * 3. For each article: convert, cleanup, generate image, build .md
 * 4. Batch commit all files to the network repo
 */
export async function runMigration(
  site: CsvSiteRow,
  config: MigrationConfig,
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationReport> {
  const startedAt = Date.now();
  const siteId = domainToSiteId(site.name);

  // R2 config is read from env vars inside uploadToR2 — it logs a warning if not configured

  const progress: MigrationProgress = {
    site: site.name,
    phase: "fetching",
    totalArticles: 0,
    processedArticles: 0,
    startedAt,
  };

  const emitProgress = (): void => {
    onProgress?.({ ...progress });
  };

  // ── Step 1: Fetch WP articles ──────────────────────────────────────────

  emitProgress();
  console.log(`[migration] Fetching articles from ${site.postsApiUrl}`);
  const articles = await fetchWpArticles(site.postsApiUrl);
  progress.totalArticles = articles.length;
  console.log(`[migration] Fetched ${articles.length} articles for ${site.name}`);

  // ── Step 2: Fetch WP categories ────────────────────────────────────────

  const allCategoryIds = [...new Set(articles.flatMap((a) => a.categories))];
  const baseUrl = extractBaseUrl(site.postsApiUrl);
  const wpCategoriesMap = await fetchWpCategories(baseUrl, allCategoryIds);
  const wpCategoriesArray = [...wpCategoriesMap.values()];
  console.log(`[migration] Fetched ${wpCategoriesMap.size} categories`);

  // ── Step 3: Process each article ───────────────────────────────────────

  progress.phase = "converting";
  emitProgress();

  const results: MigrationArticleResult[] = [];
  const files: BatchFileEntry[] = [];

  for (const article of articles) {
    const slug = article.slug;
    const rawTitle = stripHtmlTags(article.title.rendered);

    progress.currentArticleSlug = slug;
    emitProgress();

    try {
      // 3a. HTML → Markdown
      const rawMarkdown = wpHtmlToMarkdown(article.content.rendered);

      // 3b. Claude cleanup
      const rawExcerpt = stripHtmlTags(article.excerpt.rendered);
      const cleaned = await cleanupArticle(
        config.anthropicApiKey,
        rawTitle,
        rawMarkdown,
        rawExcerpt,
      );

      // 3c. Map WP categories → menu tags
      const tags = mapCategoriesToTags(
        article.categories,
        wpCategoriesArray,
        site.menuItems,
      );

      // 3d. Generate hero image via Gemini
      progress.phase = "generating-images";
      emitProgress();

      let imageGenerated = false;
      let featuredImageUrl: string | undefined;

      const imagePrompt = buildImagePrompt(rawTitle, cleaned.description, site.websiteCategory);
      const imageResult = await generateImageWithGemini(config.geminiApiKey, imagePrompt);

      if (imageResult.ok) {
        // 3e. Optimize and upload to R2
        progress.phase = "uploading-r2";
        emitProgress();

        const optimized = await optimizeImage(imageResult.data);
        const r2Key = buildR2Key(siteId, slug, "webp");
        const uploaded = await uploadToR2(r2Key, optimized, "image/webp");
        if (uploaded) {
          featuredImageUrl = `/assets/images/${slug}.webp`;
          imageGenerated = true;
        }
      } else if (!imageResult.ok) {
        console.warn(`[migration] Image generation failed for ${slug}: ${imageResult.reason}`);
      }

      // 3f. Build SEO data from Yoast metadata
      const yoast = article.yoast_head_json;
      const authorName = yoast?.author ?? yoast?.twitter_misc?.["Written by"] ?? "Editorial Team";
      const publishDate = yoast?.article_published_time ?? article.date;
      const ogImage = yoast?.og_image?.[0]?.url;

      const mdInput: ArticleMdInput = {
        title: rawTitle,
        description: cleaned.description,
        slug,
        publishDate,
        author: authorName,
        tags,
        markdownBody: cleaned.markdown,
        featuredImage: featuredImageUrl,
        wpOriginalId: article.id,
        sourceUrl: article.link ?? `${baseUrl}/${slug}`,
        seo: {
          canonical: yoast?.canonical,
          og_title: yoast?.og_title,
          og_description: yoast?.og_description,
          og_image: ogImage,
          twitter_card: yoast?.twitter_card,
        },
      };

      // 3g. Assemble final .md
      const mdContent = buildArticleMd(mdInput);
      const filePath = `sites/${siteId}/articles/${slug}.md`;
      files.push({ path: filePath, content: mdContent });

      results.push({ slug, title: rawTitle, status: "success", imageGenerated });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[migration] Error processing article ${slug}:`, errorMessage);
      results.push({ slug, title: rawTitle, status: "error", error: errorMessage, imageGenerated: false });
    }

    // 3h. Update progress
    progress.processedArticles++;
    progress.phase = "converting";
    emitProgress();
  }

  // ── Step 4: Batch commit ───────────────────────────────────────────────

  if (files.length > 0) {
    progress.phase = "committing";
    emitProgress();

    console.log(`[migration] Committing ${files.length} articles to ${config.branch}`);
    await commitBatch(
      config.octokit,
      config.networkRepo,
      files,
      [],  // no binary files — images go to R2
      `feat(migration): import ${files.length} articles for ${site.name}`,
      config.branch,
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────

  const durationMs = Date.now() - startedAt;
  const successful = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;

  progress.phase = "complete";
  progress.completedAt = Date.now();
  emitProgress();

  console.log(
    `[migration] Completed ${site.name}: ${successful} ok, ${failed} failed in ${(durationMs / 1000).toFixed(1)}s`,
  );

  return {
    site: site.name,
    totalArticles: articles.length,
    successful,
    failed,
    results,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an image generation prompt from article metadata.
 */
function buildImagePrompt(title: string, description: string, vertical: string): string {
  return [
    `Create a professional hero image for a ${vertical} article.`,
    `Title: "${title}"`,
    `Description: "${description}"`,
    "Style: Modern editorial photography, clean composition, vibrant colors.",
    "The image should be visually engaging and suitable as a blog header.",
    "Do NOT include any text, watermarks, or logos in the image.",
  ].join("\n");
}
