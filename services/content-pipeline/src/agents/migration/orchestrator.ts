import type { Octokit } from "@octokit/rest";
import Anthropic from "@anthropic-ai/sdk";
import matter from "gray-matter";
import type {
  CsvSiteRow,
  MigrationProgress,
  MigrationArticleResult,
  MigrationReport,
} from "./types.js";
import { fetchWpArticles, fetchWpCategories, extractBaseUrl } from "./wp-fetcher.js";
import { wpHtmlToMarkdown, extractVideosFromHtml, stripVideoEmbeds } from "./html-to-md.js";
import { cleanupArticle, mapCategoriesToTags, ensureTopicTag } from "./article-cleanup.js";
import { buildArticleMd, stripHtmlTags } from "./frontmatter-builder.js";
import type { ArticleMdInput } from "./frontmatter-builder.js";
import { domainToSiteId } from "./site-scaffolder.js";
import { uploadToR2, buildR2Key } from "../../lib/r2-upload.js";
import { generateImageWithGemini } from "../../lib/gemini.js";
import { optimizeImage } from "../../lib/image-optimizer.js";
import { commitBatch } from "../../lib/github.js";
import type { BatchFileEntry } from "../../lib/github.js";
import { upsertArticlesBatch } from "../../lib/db/articles.js";
import { triggerN8nImage } from "../content-generation/n8n-image.js";
import { scoreArticle, resolveStatus as resolveQualityStatus } from "../content-quality/scorer.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import type { SiteBrief, QualityScoreBreakdown } from "../../types.js";
import { notifyImageDefaultFallback } from "../../lib/notifications.js";
import type { NotificationConfig } from "../../lib/notifications.js";
import { randomUUID } from "node:crypto";

/** Delay between consecutive Claude API calls to avoid rate limiting. */
const INTER_REQUEST_DELAY_MS = 1200;

export interface MigrationConfig {
  anthropicApiKey: string;
  geminiApiKey: string;
  octokit: Octokit;
  networkRepo: string;
  branch: string;
  /** If set, commit the same files to this branch too (e.g. staging + main). */
  alsoCommitTo?: string;
  /** n8n webhook URL for async image generation. If set, n8n is preferred over Gemini. */
  n8nImageWebhookUrl?: string;
  /** Override callback URL for n8n image results. */
  imageCallbackUrl?: string;
  /** Notification config for Slack/Telegram alerts. */
  notifications?: NotificationConfig;
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
    successfulArticles: 0,
    failedArticles: 0,
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

  // Step 2b: Read site brief for quality scoring (non-fatal if missing)
  let siteBrief: SiteBrief | null = null;
  let siteName = site.name;
  try {
    const briefData = await readSiteBrief(config.octokit, config.networkRepo, siteId, config.branch);
    siteBrief = briefData.brief;
    siteName = briefData.siteName || site.name;
    console.log(`[migration] Loaded site brief for quality scoring`);
  } catch {
    console.warn(`[migration] Could not read site brief — skipping quality scoring`);
  }

  // Step 3: Process each article
  progress.phase = "converting";
  emit();

  const useN8n = !!config.n8nImageWebhookUrl;
  const defaultImagePath = `/assets/images/${siteId}-general-article.webp`;

  const results: MigrationArticleResult[] = [];
  const files: BatchFileEntry[] = [];

  // Reuse a single Anthropic client to avoid per-request overhead
  const anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });

  // Collect n8n image request metadata for post-commit firing
  interface PendingImageRequest {
    slug: string;
    title: string;
    description: string;
  }
  const pendingImageRequests: PendingImageRequest[] = [];

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]!;
    const slug = article.slug;
    const title = stripHtmlTags(article.title.rendered);
    progress.currentArticleSlug = slug;
    progress.phase = "converting";
    emit();

    try {
      // Extract YouTube videos before markdown conversion strips iframes
      const videos = extractVideosFromHtml(article.content.rendered);
      const contentWithoutVideos = stripVideoEmbeds(article.content.rendered);
      if (videos.length > 0) {
        console.log(`[migration] Found ${videos.length} video(s) in ${slug}`);
      }

      const rawMarkdown = wpHtmlToMarkdown(contentWithoutVideos);
      const excerpt = stripHtmlTags(article.excerpt.rendered);

      // Delay between API calls to stay under Anthropic rate limits
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, INTER_REQUEST_DELAY_MS));
      }

      const cleaned = await cleanupArticle(config.anthropicApiKey, title, rawMarkdown, excerpt, anthropicClient);
      const rawTags = mapCategoriesToTags(article.categories, wpCategories, site.menuItems);
      const tags = ensureTopicTag(rawTags, site.menuItems, title);

      let imageGenerated = false;
      let imageSource: "n8n" | "gemini" | "default" = "default";
      let featuredImagePath: string;

      if (useN8n) {
        // n8n mode: use default image now, trigger n8n async after commit
        featuredImagePath = defaultImagePath;
        pendingImageRequests.push({ slug, title, description: cleaned.description });
        imageSource = "n8n";
      } else {
        // Gemini fallback: generate inline before commit
        progress.phase = "generating-image";
        emit();

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
            imageSource = "gemini";
          } else {
            featuredImagePath = defaultImagePath;
          }
        } else {
          console.warn(`[migration] Gemini image gen failed for ${slug}: ${imageResult.reason}`);
          featuredImagePath = defaultImagePath;
          if (config.notifications) {
            void notifyImageDefaultFallback(config.notifications, {
              site: siteId,
              articleTitle: title,
              slug,
              reason: `Gemini image generation failed: ${imageResult.reason}`,
            });
          }
        }
      }

      // Quality scoring (if site brief is available)
      let qualityScore: number | undefined;
      let scoreBreakdown: QualityScoreBreakdown | undefined;
      let qualityNote: string | undefined;
      let articleStatus: "published" | "review" = "published";

      if (siteBrief) {
        try {
          // Delay before scoring API call
          await new Promise((resolve) => setTimeout(resolve, INTER_REQUEST_DELAY_MS));

          const qualityResult = await scoreArticle(
            { title, description: cleaned.description, body: cleaned.markdown, tags, type: "standard" },
            siteName,
            siteBrief,
            siteBrief.quality_weights,
          );
          qualityScore = qualityResult.overallScore;
          scoreBreakdown = qualityResult.breakdown;
          qualityNote = qualityResult.note;
          articleStatus = resolveQualityStatus(qualityResult.overallScore, siteBrief.quality_threshold);
          console.log(`[migration] Quality: ${qualityScore}/100 → ${articleStatus} (${slug})`);
        } catch (scoreErr) {
          const errMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
          console.warn(`[migration] Quality scoring failed for ${slug}, defaulting to approved: ${errMsg}`);
        }
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
        videos: videos.length > 0 ? videos : undefined,
        quality_score: qualityScore,
        score_breakdown: scoreBreakdown,
        quality_note: qualityNote,
        articleStatus,
      };

      files.push({
        path: `sites/${siteId}/articles/${slug}.md`,
        content: buildArticleMd(mdInput),
      });

      results.push({ slug, title, status: "success", imageGenerated, imageSource });
      progress.successfulArticles++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[migration] Error processing ${slug}:`, message);
      results.push({ slug, title, status: "error", error: message, imageGenerated: false });
      progress.failedArticles++;
    }

    progress.processedArticles++;
    emit();
  }

  // Step 4: Batch commit all articles
  if (files.length > 0) {
    progress.phase = "committing";
    emit();

    const commitMsg = `feat(migration): import ${files.length} articles for ${site.name}`;

    console.log(`[migration] Committing ${files.length} articles to ${config.branch}`);
    await commitBatch(config.octokit, config.networkRepo, files, [], commitMsg, config.branch);

    if (config.alsoCommitTo) {
      console.log(`[migration] Also committing to ${config.alsoCommitTo}`);
      await commitBatch(config.octokit, config.networkRepo, files, [], commitMsg, config.alsoCommitTo);
    }

    // Dual-write to MongoDB (supplementary — never fails the pipeline)
    const mongoArticles = files.map((f) => {
      const { data: fm } = matter(f.content);
      // Extract slug from path: sites/<domain>/articles/<slug>.md
      const pathSlug = f.path.split("/").pop()?.replace(".md", "") ?? "";
      return {
        domain: siteId,
        slug: pathSlug,
        branch: config.branch,
        frontmatter: fm as Record<string, unknown>,
      };
    });
    await upsertArticlesBatch(mongoArticles);
  }

  // Step 5: Fire n8n image triggers (post-commit, fire-and-forget)
  let n8nImagesTriggered = 0;
  if (useN8n && pendingImageRequests.length > 0) {
    progress.phase = "triggering-images";
    emit();

    const webhookUrl = config.n8nImageWebhookUrl!;
    const callbackUrl = config.imageCallbackUrl
      ?? "https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback";

    console.log(`[migration] Triggering ${pendingImageRequests.length} n8n image request(s) → ${webhookUrl}`);

    for (const req of pendingImageRequests) {
      void triggerN8nImage(webhookUrl, {
        request_id: `mig_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        callback_url: callbackUrl,
        job_id: "",
        site_domain: siteId,
        slug: req.slug,
        branch: config.branch,
        article: {
          title: req.title,
          description: req.description,
          summary: req.description,
          vertical: site.websiteCategory,
          source_thumbnail_url: null,
          image_guidelines: null,
        },
      }).then((accepted) => {
        if (accepted) {
          n8nImagesTriggered++;
        } else if (config.notifications) {
          void notifyImageDefaultFallback(config.notifications, {
            site: siteId,
            articleTitle: req.title,
            slug: req.slug,
            reason: "n8n webhook trigger failed (migration)",
          });
        }
      });
    }
    // Short delay to let fire-and-forget triggers dispatch before we report
    await new Promise((resolve) => setTimeout(resolve, 500));
    n8nImagesTriggered = pendingImageRequests.length;
  }

  // Step 6: Generate default site image and upload to R2.
  // Non-fatal — articles are committed regardless of image generation outcome.
  const siteImagePrompt = `Professional hero image for "${site.name}" website in the ${site.websiteCategory} niche. No text. Clean, modern. 1200x630.`;
  const siteImageResult = await generateImageWithGemini(config.geminiApiKey, siteImagePrompt);
  if (siteImageResult.ok) {
    const sharp = (await import("sharp")).default;
    const optimized = await sharp(siteImageResult.data)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    await uploadToR2(`${siteId}/assets/images/${siteId}-general-article.webp`, optimized, "image/webp");
  } else {
    console.warn(`[migration] Default site image generation failed: ${siteImageResult.reason}`);
  }

  const durationMs = Date.now() - startedAt;
  const successful = results.filter((r) => r.status === "success").length;
  const failed = results.filter((r) => r.status === "error").length;

  progress.phase = "complete";
  progress.completedAt = Date.now();
  emit();

  console.log(
    `[migration] Done: ${successful} ok, ${failed} failed` +
    `${n8nImagesTriggered > 0 ? `, ${n8nImagesTriggered} n8n images triggered` : ""}` +
    ` in ${(durationMs / 1000).toFixed(1)}s`,
  );

  return { site: site.name, totalArticles: articles.length, successful, failed, results, durationMs, n8nImagesTriggered };
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
