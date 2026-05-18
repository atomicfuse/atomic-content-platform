/**
 * n8n webhook client for async image generation.
 *
 * Sends image generation requests to the n8n webhook and handles the
 * inline response (~46s). Also provides a processor to optimize the
 * returned image, upload to R2, and update Git frontmatter.
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

export interface N8nImageRequest {
  request_id: string;
  callback_url: string;
  site_domain: string;
  slug: string;
  article: N8nImageArticle;
}

export interface N8nImageAttempt {
  provider: string;
  reason: string | null;
  ok: boolean;
  attempt: number;
}

export interface N8nImageMeta {
  provider: string;
  prompt: string;
  duration_ms: number;
  attempts: N8nImageAttempt[];
}

export interface N8nImageResponse {
  request_id: string;
  status: string;
  delivery: string;
  mime_type: string;
  data_base64: string;
  alt_text: string;
  meta: N8nImageMeta;
}

export type N8nRequestResult =
  | { ok: true; data: Buffer; altText: string; meta: N8nImageResponse["meta"] }
  | { ok: false; reason: string };

export interface ProcessImageParams {
  siteDomain: string;
  slug: string;
  imageData: Buffer;
  altText: string;
  branch: string;
  github: GitHubConfig;
}

// ---------------------------------------------------------------------------
// Timeout constant (90 seconds — n8n inference can take ~46s)
// ---------------------------------------------------------------------------

const WEBHOOK_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// requestImageFromN8n
// ---------------------------------------------------------------------------

/**
 * POST to the n8n webhook and wait for the inline image response.
 *
 * @param req  The image generation request payload
 * @returns    A decoded image Buffer on success, or an error reason on failure
 */
export async function requestImageFromN8n(
  req: N8nImageRequest,
): Promise<N8nRequestResult> {
  const webhookUrl = req.callback_url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `n8n returned ${response.status}: ${response.statusText}`,
      };
    }

    const body = (await response.json()) as N8nImageResponse;

    if (body.status !== "ok") {
      return { ok: false, reason: `n8n status: ${body.status}` };
    }

    if (!body.data_base64) {
      return { ok: false, reason: "n8n returned empty image data" };
    }

    const data = Buffer.from(body.data_base64, "base64");

    return { ok: true, data, altText: body.alt_text, meta: body.meta };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: `n8n webhook timeout (${WEBHOOK_TIMEOUT_MS}ms)` };
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// processN8nImageResult
// ---------------------------------------------------------------------------

/**
 * Take a successful image result from n8n, optimize it, upload to R2,
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
  const imageUrl = `https://assets.atomicfuse.io/${r2Key}`;
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
