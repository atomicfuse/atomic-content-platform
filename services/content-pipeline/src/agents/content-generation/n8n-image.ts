/**
 * n8n async image generation — fire-and-forget + callback.
 *
 * Flow:
 *   1. After article commit, agent.ts calls `triggerN8nImage()` for each article.
 *      This POSTs to the n8n webhook with a `callback_url` and returns immediately.
 *   2. n8n generates the image (~46s) and POSTs the result to our callback.
 *   3. `handleImageCallback()` receives the result, optimizes the image,
 *      uploads to R2, and updates the article frontmatter in Git.
 */

import matter from "gray-matter";
import { optimizeImage } from "../../lib/image-optimizer.js";
import { uploadToR2, buildR2Key } from "../../lib/r2-upload.js";
import {
  createGitHubClient,
  readFile,
  commitFile,
} from "../../lib/github.js";
import type { GitHubConfig } from "../../lib/github.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface N8nImageArticle {
  title: string;
  description: string;
  summary: string;
  vertical: string;
  source_thumbnail_url: string | null;
  image_guidelines: string | null;
}

export interface N8nTriggerRequest {
  request_id: string;
  callback_url: string;
  site_domain: string;
  slug: string;
  branch: string;
  article: N8nImageArticle;
}

/** Shape of the payload n8n POSTs to our /image-callback endpoint. */
export interface N8nCallbackPayload {
  request_id: string;
  site_domain: string;
  slug: string;
  branch: string;
  status: string;
  mime_type?: string;
  data_base64?: string;
  alt_text?: string;
  meta?: {
    provider: string;
    prompt?: string;
    duration_ms?: number;
  };
  error?: string;
}

export interface ProcessImageParams {
  siteDomain: string;
  slug: string;
  imageData: Buffer;
  altText: string;
  branch: string;
  github: GitHubConfig;
}

// ---------------------------------------------------------------------------
// Trigger timeout (10s — just firing the webhook, not waiting for image)
// ---------------------------------------------------------------------------

const TRIGGER_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// triggerN8nImage — fire-and-forget POST to n8n
// ---------------------------------------------------------------------------

/**
 * POST to the n8n webhook to trigger image generation.
 * Returns immediately after n8n acknowledges (HTTP 200).
 * n8n will POST the result to `callbackUrl` when the image is ready.
 *
 * @returns true if n8n accepted the request, false on error
 */
export async function triggerN8nImage(
  webhookUrl: string,
  req: N8nTriggerRequest,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);

  try {
    console.log(`[n8n-image] Triggering image for ${req.slug} (${req.site_domain})`);

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        `[n8n-image] Trigger failed for ${req.slug}: ${response.status} ${response.statusText}`,
      );
      return false;
    }

    console.log(`[n8n-image] Trigger accepted for ${req.slug} (request_id: ${req.request_id})`);
    return true;
  } catch (err) {
    const reason = err instanceof Error
      ? (err.name === "AbortError" ? `timeout (${TRIGGER_TIMEOUT_MS}ms)` : err.message)
      : String(err);
    console.error(`[n8n-image] Trigger error for ${req.slug}: ${reason}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// handleImageCallback — process the async result from n8n
// ---------------------------------------------------------------------------

/**
 * Handle the callback POST from n8n containing the generated image.
 * Validates the payload, optimizes the image, uploads to R2,
 * and updates the article's Git frontmatter.
 *
 * @returns A result object for the HTTP response
 */
export async function handleImageCallback(
  payload: N8nCallbackPayload,
  github: GitHubConfig,
): Promise<{ ok: boolean; message: string }> {
  const { request_id, site_domain, slug, branch, status } = payload;

  console.log(
    `[n8n-image] Callback received: request_id=${request_id}, slug=${slug}, ` +
    `status=${status}, has_data=${!!payload.data_base64}`,
  );

  // Check for error status from n8n
  if (status && status !== "ok") {
    const reason = payload.error ?? `n8n status: ${status}`;
    console.error(`[n8n-image] n8n reported failure for ${slug}: ${reason}`);
    return { ok: false, message: reason };
  }

  if (!payload.data_base64) {
    console.error(`[n8n-image] No image data in callback for ${slug}`);
    return { ok: false, message: "No image data in callback" };
  }

  if (!site_domain || !slug || !branch) {
    return { ok: false, message: "Missing required fields: site_domain, slug, branch" };
  }

  const imageData = Buffer.from(payload.data_base64, "base64");

  try {
    await processN8nImageResult({
      siteDomain: site_domain,
      slug,
      imageData,
      altText: payload.alt_text ?? "",
      branch,
      github,
    });
    return { ok: true, message: `Image processed for ${site_domain}/${slug}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[n8n-image] Processing failed for ${slug}: ${message}`);
    return { ok: false, message };
  }
}

// ---------------------------------------------------------------------------
// processN8nImageResult — optimize, R2 upload, Git update
// ---------------------------------------------------------------------------

/**
 * Take image data, optimize it, upload to R2,
 * and update the article's Git frontmatter with the image URL and alt text.
 *
 * Skips the Git update entirely if R2 upload fails.
 */
export async function processN8nImageResult(
  params: ProcessImageParams,
): Promise<void> {
  const { siteDomain, slug, imageData, altText, branch, github } = params;

  // 1. Optimize the raw image to WebP
  const optimized = await optimizeImage(imageData);

  // 2. Build R2 key and upload
  const r2Key = buildR2Key(siteDomain, slug, "webp");
  const uploaded = await uploadToR2(r2Key, optimized, "image/webp");

  if (!uploaded) {
    console.warn(`[n8n-image] R2 upload failed for ${slug} — skipping Git update`);
    return;
  }

  // 3. Read the article markdown from Git
  const octokit = createGitHubClient(github);
  const articlePath = `sites/${siteDomain}/articles/${slug}.md`;
  const rawContent = await readFile(octokit, github.repo, articlePath, branch);

  // 4. Parse frontmatter, inject image fields, stringify
  const parsed = matter(rawContent);
  // Use the convention without siteId prefix — seed-kv's rewriteFrontmatterUrl
  // adds the `/<siteId>/` prefix at sync time when writing to KV.
  const imageUrl = `/assets/images/${slug}.webp`;
  parsed.data["featuredImage"] = imageUrl;
  parsed.data["image_alt"] = altText;

  const updatedContent = matter.stringify(parsed.content, parsed.data);

  // 5. Commit the updated article
  await commitFile(octokit, github.repo, {
    path: articlePath,
    content: updatedContent,
    message: `feat(image): add hero image for ${slug}`,
    branch,
  });

  console.log(`[n8n-image] Updated frontmatter for ${siteDomain}/${slug}`);
}
