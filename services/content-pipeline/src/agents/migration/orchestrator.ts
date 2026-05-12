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

export interface MigrationConfig {
  anthropicApiKey: string;
  geminiApiKey: string;
  octokit: Octokit;
  networkRepo: string;
  branch: string;
}

/**
 * Run the full migration pipeline for a single site:
 * fetch WP articles → convert → cleanup → generate images → commit.
 */
export async function runMigration(
  site: CsvSiteRow,
  config: MigrationConfig,
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationReport> {
  const startedAt = Date.now();
  const siteId = domainToSiteId(site.name);

  const progress: MigrationProgress = {
    site: site.name,
    phase: "fetching",
    totalArticles: 0,
    processedArticles: 0,
    startedAt,
  };

  const emit = (): void => { onProgress?.({ ...progress }); };

  // Step 1: Fetch all WP articles
  emit();
  console.log(`[migration] Fetching articles from ${site.postsApiUrl}`);
  const articles = await fetchWpArticles(site.postsApiUrl);
  progress.totalArticles = articles.length;
  console.log(`[migration] Fetched ${articles.length} articles`);

  // Step 2: Fetch WP categories referenced by articles
  const allCategoryIds = [...new Set(articles.flatMap((a) => a.categories))];
  const baseUrl = extractBaseUrl(site.postsApiUrl);
  const wpCategories = [...(await fetchWpCategories(baseUrl, allCategoryIds)).values()];

  // Step 3: Process each article
  progress.phase = "converting";
  emit();

  const results: MigrationArticleResult[] = [];
  const files: BatchFileEntry[] = [];

  for (const article of articles) {
    const slug = article.slug;
    const title = stripHtmlTags(article.title.rendered);
    progress.currentArticleSlug = slug;
    progress.phase = "converting";
    emit();

    try {
      const rawMarkdown = wpHtmlToMarkdown(article.content.rendered);
      const excerpt = stripHtmlTags(article.excerpt.rendered);
      const cleaned = await cleanupArticle(config.anthropicApiKey, title, rawMarkdown, excerpt);
      const tags = mapCategoriesToTags(article.categories, wpCategories, site.menuItems);

      // Generate hero image
      progress.phase = "generating-image";
      emit();

      let imageGenerated = false;
      let featuredImagePath: string | undefined;

      const imagePrompt = buildImagePrompt(title, cleaned.description, site.websiteCategory);
      const imageResult = await generateImageWithGemini(config.geminiApiKey, imagePrompt);

      if (imageResult.ok) {
        progress.phase = "uploading-image";
        emit();

        const optimized = await optimizeImage(imageResult.data);
        const r2Key = buildR2Key(siteId, slug, "webp");
        const uploaded = await uploadToR2(r2Key, optimized, "image/webp");
        if (uploaded) {
          featuredImagePath = `/assets/images/${slug}.webp`;
          imageGenerated = true;
        }
      } else {
        console.warn(`[migration] Image gen failed for ${slug}: ${imageResult.reason}`);
      }

      // Build frontmatter + body
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
        featuredImage: featuredImagePath,
        wpOriginalId: article.id,
        sourceUrl: article.link ?? `${baseUrl}/${slug}`,
        seo: {
          canonical: yoast?.canonical,
          og_title: yoast?.og_title,
          og_description: yoast?.og_description,
          og_image: yoast?.og_image?.[0]?.url,
          twitter_card: yoast?.twitter_card,
        },
      };

      files.push({
        path: `sites/${siteId}/articles/${slug}.md`,
        content: buildArticleMd(mdInput),
      });

      results.push({ slug, title, status: "success", imageGenerated });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[migration] Error processing ${slug}:`, message);
      results.push({ slug, title, status: "error", error: message, imageGenerated: false });
    }

    progress.processedArticles++;
    emit();
  }

  // Step 4: Batch commit all articles
  if (files.length > 0) {
    progress.phase = "committing";
    emit();

    console.log(`[migration] Committing ${files.length} articles to ${config.branch}`);
    await commitBatch(
      config.octokit,
      config.networkRepo,
      files,
      [],
      `feat(migration): import ${files.length} articles for ${site.name}`,
      config.branch,
    );
  }

  const durationMs = Date.now() - startedAt;
  const successful = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;

  progress.phase = "complete";
  progress.completedAt = Date.now();
  emit();

  console.log(`[migration] Done: ${successful} ok, ${failed} failed in ${(durationMs / 1000).toFixed(1)}s`);

  return { site: site.name, totalArticles: articles.length, successful, failed, results, durationMs };
}

function buildImagePrompt(title: string, description: string, category: string): string {
  return [
    `Create a professional hero image for a ${category} article.`,
    `Title: "${title}"`,
    `Description: "${description}"`,
    "Style: Modern editorial photography, clean composition, vibrant colors.",
    "The image should be visually engaging and suitable as a blog header.",
    "Do NOT include any text, watermarks, or logos in the image.",
  ].join("\n");
}
