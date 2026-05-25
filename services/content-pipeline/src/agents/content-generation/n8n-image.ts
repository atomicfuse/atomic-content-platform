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
import { notifyImageDefaultFallback } from "../../lib/notifications.js";
import type { NotificationConfig } from "../../lib/notifications.js";

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
  job_id: string;
  site_domain: string;
  slug: string;
  branch: string;
  article: N8nImageArticle;
}

/** Shape of the payload n8n POSTs to our /image-callback endpoint. */
export interface N8nCallbackPayload {
  request_id: string;
  job_id?: string;
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
// Pending image tracker — detects when n8n fails to deliver a callback
// ---------------------------------------------------------------------------

/** How long to wait for n8n callback before alerting (5 minutes). */
const IMAGE_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

interface PendingImage {
  requestId: string;
  siteDomain: string;
  slug: string;
  articleTitle: string;
  triggeredAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/** In-memory map of pending image callbacks, keyed by request_id. */
const pendingImages = new Map<string, PendingImage>();

/**
 * Track a triggered image request. If no callback arrives within the timeout,
 * fires a Slack/Telegram alert so the failure is visible.
 */
export function trackPendingImage(
  requestId: string,
  siteDomain: string,
  slug: string,
  articleTitle: string,
  notifications: NotificationConfig,
): void {
  const timer = setTimeout(() => {
    pendingImages.delete(requestId);
    const reason = `n8n image callback not received within ${IMAGE_CALLBACK_TIMEOUT_MS / 1000}s — ` +
      `n8n may have failed to deliver the result (timeout, network error, or crash)`;
    console.error(
      `[n8n-image] TIMEOUT — no callback for ${siteDomain}/${slug} ` +
      `(request_id=${requestId}) after ${IMAGE_CALLBACK_TIMEOUT_MS / 1000}s`,
    );
    void notifyImageDefaultFallback(notifications, {
      site: siteDomain,
      articleTitle,
      slug,
      reason,
    });
  }, IMAGE_CALLBACK_TIMEOUT_MS);

  // Don't let the timer prevent process exit
  if (timer.unref) timer.unref();

  pendingImages.set(requestId, {
    requestId,
    siteDomain,
    slug,
    articleTitle,
    triggeredAt: Date.now(),
    timer,
  });
}

/**
 * Mark a pending image as received (callback arrived). Clears the timeout.
 * Called from handleImageCallback() on any callback — success or error.
 */
export function clearPendingImage(requestId: string): void {
  const pending = pendingImages.get(requestId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingImages.delete(requestId);
  }
}

// ---------------------------------------------------------------------------
// Per-branch commit queue — serializes Git read-modify-commit to avoid SHA
// conflicts when multiple image callbacks target the same branch concurrently.
// Only the Git step is serialized; image optimization and R2 upload still
// run in parallel across callbacks.
// ---------------------------------------------------------------------------

const branchCommitQueues = new Map<string, Promise<unknown>>();

function enqueueForBranch<T>(branch: string, fn: () => Promise<T>): Promise<T> {
  const prev = branchCommitQueues.get(branch) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  // Store settled promise so chain continues regardless of success/failure
  branchCommitQueues.set(branch, result.then(() => {}, () => {}));
  return result;
}

// ---------------------------------------------------------------------------
// Delayed alert system — avoids false Slack alarms when a retry or duplicate
// n8n callback succeeds shortly after an initial SHA-conflict failure.
// ---------------------------------------------------------------------------

/** Wait before sending failure alert, giving retries/duplicates time to succeed. */
const IMAGE_ALERT_DELAY_MS = 30_000;
/** Cleanup delay for the success tracker to prevent unbounded memory growth. */
const SUCCESS_TRACKER_TTL_MS = 10 * 60 * 1000;

/** Articles whose images were successfully delivered. */
const successfulImages = new Set<string>();
/** Pending delayed alerts, keyed by "siteDomain/slug". */
const delayedAlerts = new Map<string, ReturnType<typeof setTimeout>>();

/** Record a successful image delivery and cancel any pending failure alert. */
function markImageSuccess(key: string): void {
  successfulImages.add(key);
  const timer = delayedAlerts.get(key);
  if (timer) {
    clearTimeout(timer);
    delayedAlerts.delete(key);
  }
  // Auto-cleanup to prevent memory leak
  const cleanup = setTimeout(() => successfulImages.delete(key), SUCCESS_TRACKER_TTL_MS);
  if (cleanup.unref) cleanup.unref();
}

/**
 * Schedule a delayed failure alert. If the image succeeds before the delay
 * expires (via retry or duplicate callback), the alert is cancelled.
 */
function scheduleImageAlert(
  key: string,
  notifications: NotificationConfig,
  params: { site: string; articleTitle: string; slug: string; reason: string },
): void {
  // Already succeeded — no alert needed
  if (successfulImages.has(key)) return;
  // Already have a pending alert — don't duplicate
  if (delayedAlerts.has(key)) return;

  const timer = setTimeout(() => {
    delayedAlerts.delete(key);
    // Re-check: a retry may have succeeded during the delay
    if (successfulImages.has(key)) return;
    void notifyImageDefaultFallback(notifications, params);
  }, IMAGE_ALERT_DELAY_MS);

  if (timer.unref) timer.unref();
  delayedAlerts.set(key, timer);
}

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
  notifications?: NotificationConfig,
): Promise<{ ok: boolean; message: string }> {
  const { request_id, site_domain, slug, branch, status } = payload;

  // Clear the pending-image timeout — callback arrived (regardless of success/error)
  if (request_id) {
    clearPendingImage(request_id);
  }

  const meta = payload.meta;
  const provider = meta?.provider ?? "unknown";
  const durationMs = meta?.duration_ms;
  const tag = `[n8n-image] [${site_domain}/${slug}]`;

  console.log(
    `${tag} Callback received: request_id=${request_id}, status=${status}, ` +
    `provider=${provider}, duration=${durationMs ?? "?"}ms, has_data=${!!payload.data_base64}`,
  );

  // Helper to send Slack alert on failure
  const alertFailure = (reason: string): void => {
    if (notifications) {
      void notifyImageDefaultFallback(notifications, {
        site: site_domain ?? "unknown",
        articleTitle: slug ?? "unknown",
        slug: slug ?? "unknown",
        reason,
      });
    }
  };

  // Validate required routing fields first — these are needed for any processing
  if (!site_domain || !slug || !branch) {
    const reason = `Missing required fields (site_domain=${site_domain}, slug=${slug}, branch=${branch})`;
    console.error(`${tag} FAIL — ${reason}`);
    alertFailure(reason);
    return { ok: false, message: "Missing required fields: site_domain, slug, branch" };
  }

  // Check for error status from n8n
  if (status && status !== "ok") {
    const reason = payload.error ?? `n8n status: ${status}`;
    console.error(`${tag} FAIL — n8n error: ${reason} (provider=${provider}, duration=${durationMs ?? "?"}ms)`);
    alertFailure(`n8n image generation failed: ${reason}`);
    return { ok: false, message: reason };
  }

  if (!payload.data_base64) {
    console.error(`${tag} FAIL — no image data in payload`);
    alertFailure("n8n returned no image data");
    return { ok: false, message: "No image data in callback" };
  }

  const imageData = Buffer.from(payload.data_base64, "base64");
  const rawSizeKB = (imageData.length / 1024).toFixed(0);

  try {
    await processN8nImageResult({
      siteDomain: site_domain,
      slug,
      imageData,
      altText: payload.alt_text ?? "",
      branch,
      github,
    });
    const imageKey = `${site_domain}/${slug}`;
    markImageSuccess(imageKey);
    console.log(
      `${tag} SUCCESS — image delivered (provider=${provider}, ` +
      `n8n_duration=${durationMs ?? "?"}ms, raw_size=${rawSizeKB}KB)`,
    );
    return { ok: true, message: `Image processed for ${site_domain}/${slug}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${tag} FAIL — processing error: ${message} (raw_size=${rawSizeKB}KB)`);
    // Delay the alert — a retry or duplicate n8n callback may still succeed.
    // Immediate alertFailure is reserved for non-transient errors above.
    if (notifications) {
      scheduleImageAlert(`${site_domain}/${slug}`, notifications, {
        site: site_domain,
        articleTitle: slug,
        slug,
        reason: `Image processing failed: ${message}`,
      });
    }
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
 * Throws if R2 upload fails — caller should not count this as a completed image.
 */
export async function processN8nImageResult(
  params: ProcessImageParams,
): Promise<void> {
  const { siteDomain, slug, imageData, altText, branch, github } = params;
  const tag = `[n8n-image] [${siteDomain}/${slug}]`;

  // 1. Optimize the raw image to WebP
  const optimized = await optimizeImage(imageData);
  const optimizedKB = (optimized.length / 1024).toFixed(0);
  const rawKB = (imageData.length / 1024).toFixed(0);
  console.log(`${tag} Optimized: ${rawKB}KB → ${optimizedKB}KB (WebP)`);

  // 2. Build R2 key and upload
  const r2Key = buildR2Key(siteDomain, slug, "webp");
  const uploaded = await uploadToR2(r2Key, optimized, "image/webp");

  if (!uploaded) {
    throw new Error(`R2 upload failed for ${r2Key} — image not persisted`);
  }
  console.log(`${tag} R2 upload OK → ${r2Key}`);

  // 3. Read article, update frontmatter, commit — serialized per branch.
  // The branch queue ensures only one callback commits at a time, avoiding
  // the SHA conflicts that occur when the GitHub Contents API's internal
  // ref fast-forward races with concurrent commits to the same branch.
  // Retry logic is kept as a safety net for external concurrent commits.
  const octokit = createGitHubClient(github);
  const articlePath = `sites/${siteDomain}/articles/${slug}.md`;
  const imageUrl = `/assets/images/${slug}.webp`;

  await enqueueForBranch(branch, async () => {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const rawContent = await readFile(octokit, github.repo, articlePath, branch);

        const parsed = matter(rawContent);
        // Use the convention without siteId prefix — seed-kv's rewriteFrontmatterUrl
        // adds the `/<siteId>/` prefix at sync time when writing to KV.
        parsed.data["featuredImage"] = imageUrl;
        parsed.data["image_alt"] = altText;

        const updatedContent = matter.stringify(parsed.content, parsed.data);

        await commitFile(octokit, github.repo, {
          path: articlePath,
          content: updatedContent,
          message: `feat(image): add hero image for ${slug}`,
          branch,
        });

        console.log(`${tag} Git commit OK → ${articlePath} (branch: ${branch})`);
        return; // success
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isShaConflict = msg.includes("but expected") || msg.includes("409") || msg.includes("422");

        if (isShaConflict && attempt < MAX_RETRIES) {
          const delayMs = attempt * 2000; // 2s, 4s
          console.warn(`${tag} Git SHA conflict (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }
  });
}
