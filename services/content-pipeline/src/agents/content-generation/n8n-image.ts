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
  createOctokit,
  readFile,
  commitFile,
  commitBatch,
  clearTreeCache,
} from "../../lib/github.js";
import type { GitHubConfig } from "../../lib/github.js";
import { notifyImageDefaultFallback } from "../../lib/notifications.js";
import type { NotificationConfig } from "../../lib/notifications.js";
import { isGeneralImage } from "../../lib/general-image.js";
import { recordImageGenEvent } from "../../stats/recorder.js";
import { recordImageUsage } from "../../costs/recorder.js";
import { incrementR2Tally } from "../../stats/r2-tally.js";
import { upsertArticleMeta, upsertArticlesBatch } from "../../lib/db/articles.js";

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
/**
 * Reads an article's current `featuredImage` from the authoritative store.
 * Resolves to the value, `undefined` when the article has no image, or `null`
 * when it could not be read at all.
 */
export type ImageVerifier = (
  siteDomain: string,
  slug: string,
) => Promise<string | undefined | null>;

/**
 * Decide whether a timed-out image request warrants an alert.
 *
 * The in-process flag is only trustworthy when it says "succeeded". This service
 * runs 5 replicas and n8n's callback is load-balanced, so it usually lands on a
 * different replica than the one holding the timer — "no success seen here"
 * means nothing on its own. That is what fired 4 false alerts on 2026-08-27 for
 * articles whose images had been delivered in ~22s.
 *
 * `featuredImage` read from Git is the authoritative answer. An unverifiable
 * read alerts rather than staying quiet: every failure in this subsystem so far
 * has been a silence, and a false positive is cheaper than a lost image.
 */
export function shouldAlertOnImageTimeout(
  succeededInThisProcess: boolean,
  featuredImage: string | undefined | null,
  domain: string,
): boolean {
  if (succeededInThisProcess) return false;
  if (featuredImage === null) return true;
  return isGeneralImage(featuredImage, domain);
}

/**
 * Build an {@link ImageVerifier} that reads the article's frontmatter from Git.
 *
 * Git rather than KV: KV is only re-seeded minutes later by CI, so at the 300s
 * mark it is not yet authoritative. Tries the staging branch (where the image
 * callback commits) before main (where auto-publish copies it); after a publish
 * the two are identical, so either answers correctly.
 */
export function createGitImageVerifier(
  github: GitHubConfig,
  networkRepo: string,
): ImageVerifier {
  return async (siteDomain, slug) => {
    const octokit = createOctokit(github);
    const path = `sites/${siteDomain}/articles/${slug}.md`;

    for (const branch of [`staging/${siteDomain}`, "main"]) {
      try {
        clearTreeCache(branch);
        const raw = await readFile(octokit, networkRepo, path, branch);
        const featured = matter(raw).data.featuredImage ?? matter(raw).data.featured_image;
        return typeof featured === "string" ? featured : undefined;
      } catch {
        // Not on this branch (or unreadable) — try the next one.
      }
    }
    return null;
  };
}

/**
 * Track a triggered image request. If no callback arrives within the timeout,
 * verify the article against Git and alert only if it really has no image.
 */
export function trackPendingImage(
  requestId: string,
  siteDomain: string,
  slug: string,
  articleTitle: string,
  notifications: NotificationConfig,
  verifier?: ImageVerifier,
): void {
  const timer = setTimeout(() => {
    // Async work is fired-and-contained: this callback must never throw into
    // the timer queue.
    void (async () => {
      pendingImages.delete(requestId);

      const imageKey = `${siteDomain}/${slug}`;
      const succeeded = successfulImages.has(imageKey);

      // `succeeded` is per-replica and therefore only meaningful when true.
      // Otherwise ask Git what the article actually looks like.
      let featuredImage: string | undefined | null = null;
      let verified = false;
      if (!succeeded && verifier) {
        try {
          featuredImage = await verifier(siteDomain, slug);
          verified = featuredImage !== null;
        } catch (err) {
          console.error(`[n8n-image] image verification failed for ${imageKey}:`, err);
          featuredImage = null;
        }
      }

      if (!shouldAlertOnImageTimeout(succeeded, featuredImage, siteDomain)) {
        console.log(
          `[n8n-image] TIMEOUT for ${imageKey} but the article has a real image — ` +
          `no alert (callback was handled by another replica)`,
        );
        return;
      }

      const seconds = IMAGE_CALLBACK_TIMEOUT_MS / 1000;
      const reason = verified
        ? `n8n image callback not received within ${seconds}s and the article still uses the default image`
        : `n8n image callback not received within ${seconds}s — could not verify the article's current image`;

      console.error(
        `[n8n-image] TIMEOUT — no callback for ${imageKey} ` +
        `(request_id=${requestId}) after ${seconds}s`,
      );
      void notifyImageDefaultFallback(notifications, {
        site: siteDomain,
        articleTitle,
        slug,
        reason,
      });
    })();
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
// Bulk image run buffer — batches all callbacks into a single commit when
// triggered via the /bulk-generate-images endpoint.
// ---------------------------------------------------------------------------

interface BufferedFile {
  path: string;
  content: string;
  slug: string;
}

interface BulkRunBuffer {
  expectedSlugs: Set<string>;
  receivedCount: number;
  buffered: Map<string, BufferedFile[]>;
  github: GitHubConfig;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

let activeBulkRun: BulkRunBuffer | null = null;

const BULK_FLUSH_TIMEOUT_MS = 5 * 60 * 1000;

export function registerBulkRun(
  articles: Array<{ domain: string; slug: string }>,
  github: GitHubConfig,
): void {
  if (activeBulkRun) {
    console.warn(`[n8n-image] Previous bulk run still active — flushing before starting new one`);
    void flushBulkBuffer();
  }

  const expectedSlugs = new Set(articles.map(a => `${a.domain}/${a.slug}`));
  activeBulkRun = {
    expectedSlugs,
    receivedCount: 0,
    buffered: new Map(),
    github,
    flushTimer: null,
  };
  console.log(`[n8n-image] Bulk run registered: ${expectedSlugs.size} articles expected`);
}

function isPartOfBulkRun(siteDomain: string, slug: string): boolean {
  return activeBulkRun?.expectedSlugs.has(`${siteDomain}/${slug}`) ?? false;
}

function bufferBulkResult(branch: string, file: BufferedFile): void {
  if (!activeBulkRun) return;
  const files = activeBulkRun.buffered.get(branch) ?? [];
  files.push(file);
  activeBulkRun.buffered.set(branch, files);
}

function markBulkCallbackReceived(siteDomain: string, slug: string): void {
  if (!activeBulkRun) return;
  const key = `${siteDomain}/${slug}`;
  if (!activeBulkRun.expectedSlugs.has(key)) return;

  activeBulkRun.receivedCount++;
  const total = activeBulkRun.expectedSlugs.size;
  const bufferedCount = Array.from(activeBulkRun.buffered.values())
    .reduce((sum, f) => sum + f.length, 0);
  console.log(
    `[n8n-image] Bulk progress: ${activeBulkRun.receivedCount}/${total} callbacks, ` +
    `${bufferedCount} images buffered (${key})`,
  );

  if (activeBulkRun.receivedCount >= total) {
    console.log(`[n8n-image] All bulk callbacks received — flushing buffer`);
    void flushBulkBuffer();
  }
}

export function removeBulkExpected(siteDomain: string, slug: string): void {
  if (!activeBulkRun) return;
  const key = `${siteDomain}/${slug}`;
  if (!activeBulkRun.expectedSlugs.delete(key)) return;

  console.log(
    `[n8n-image] Removed ${key} from bulk run (trigger failed), ` +
    `${activeBulkRun.expectedSlugs.size} remaining`,
  );

  if (activeBulkRun.receivedCount >= activeBulkRun.expectedSlugs.size) {
    console.log(`[n8n-image] All remaining bulk callbacks received — flushing buffer`);
    void flushBulkBuffer();
  }
}

export function scheduleBulkFlush(): void {
  if (!activeBulkRun) return;
  if (activeBulkRun.flushTimer) return;

  console.log(
    `[n8n-image] Scheduling bulk flush timeout (${BULK_FLUSH_TIMEOUT_MS / 1000}s) — ` +
    `${activeBulkRun.receivedCount}/${activeBulkRun.expectedSlugs.size} callbacks so far`,
  );

  activeBulkRun.flushTimer = setTimeout(() => {
    if (!activeBulkRun) return;
    console.warn(
      `[n8n-image] Bulk flush timeout — received ${activeBulkRun.receivedCount}/` +
      `${activeBulkRun.expectedSlugs.size}, flushing what we have`,
    );
    void flushBulkBuffer();
  }, BULK_FLUSH_TIMEOUT_MS);

  if (activeBulkRun.flushTimer.unref) activeBulkRun.flushTimer.unref();
}

async function flushBulkBuffer(): Promise<void> {
  const run = activeBulkRun;
  if (!run) return;

  if (run.flushTimer) clearTimeout(run.flushTimer);
  activeBulkRun = null;

  const totalBuffered = Array.from(run.buffered.values())
    .reduce((sum, f) => sum + f.length, 0);

  if (totalBuffered === 0) {
    console.log(`[n8n-image] Bulk flush — no successful images to commit`);
    return;
  }

  console.log(
    `[n8n-image] Flushing bulk buffer: ${totalBuffered} images across ` +
    `${run.buffered.size} branch(es)`,
  );

  const octokit = createOctokit(run.github);

  for (const [branch, files] of run.buffered) {
    const message = files.length === 1
      ? `feat(image): add hero image for ${files[0]!.slug}`
      : `feat(image): add hero images for ${files.length} articles`;

    try {
      await commitBatch(
        octokit,
        run.github.repo,
        files.map(f => ({ path: f.path, content: f.content })),
        [],
        message,
        branch,
      );
      console.log(
        `[n8n-image] Bulk commit OK → ${files.length} files on branch ${branch}`,
      );

      // Dual-write to MongoDB (supplementary — never fails the pipeline)
      const mongoDocs = files.map((f) => {
        const parsed = matter(f.content);
        // Extract siteDomain from path: sites/<domain>/articles/<slug>.md
        const parts = f.path.split("/");
        const domain = parts[1] ?? "";
        return {
          domain,
          slug: f.slug,
          branch,
          frontmatter: { featuredImage: parsed.data["featuredImage"], image_alt: parsed.data["image_alt"] } as Record<string, unknown>,
        };
      });
      await upsertArticlesBatch(mongoDocs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[n8n-image] Bulk commit FAILED for branch ${branch}: ${msg} — falling back to individual commits`,
      );
      for (const file of files) {
        try {
          await enqueueForBranch(branch, () =>
            commitFile(octokit, run.github.repo, {
              path: file.path,
              content: file.content,
              message: `feat(image): add hero image for ${file.slug}`,
              branch,
            }),
          );
          console.log(`[n8n-image] Fallback commit OK → ${file.path}`);
        } catch (fbErr) {
          console.error(
            `[n8n-image] Fallback commit FAILED → ${file.path}: ` +
            `${fbErr instanceof Error ? fbErr.message : String(fbErr)}`,
          );
        }
      }
    }
  }
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

  // Fire-and-forget recorder helper — site_domain and slug are guaranteed present here.
  const recordOutcome = (ok: boolean, error: string | null): void => {
    void recordImageGenEvent({
      siteDomain: site_domain,
      slug,
      ok,
      provider: payload.meta?.provider ?? null,
      error,
      at: new Date(),
    });
  };

  // Check for error status from n8n
  if (status && status !== "ok") {
    const reason = payload.error ?? `n8n status: ${status}`;
    console.error(`${tag} FAIL — n8n error: ${reason} (provider=${provider}, duration=${durationMs ?? "?"}ms)`);
    alertFailure(`n8n image generation failed: ${reason}`);
    recordOutcome(false, reason);
    markBulkCallbackReceived(site_domain, slug);
    return { ok: false, message: reason };
  }

  if (!payload.data_base64) {
    console.error(`${tag} FAIL — no image data in payload`);
    alertFailure("n8n returned no image data");
    recordOutcome(false, "No image data in callback");
    markBulkCallbackReceived(site_domain, slug);
    return { ok: false, message: "No image data in callback" };
  }

  const imageData = Buffer.from(payload.data_base64, "base64");
  const rawSizeKB = (imageData.length / 1024).toFixed(0);

  // Mark success immediately — n8n delivered a valid callback with image data.
  // This prevents the 300s "callback not received" timer from firing a false
  // alert if processN8nImageResult partially fails (e.g., R2 upload succeeds
  // but Git commit fails due to SHA conflict). The image is valid regardless.
  const imageKey = `${site_domain}/${slug}`;
  markImageSuccess(imageKey);

  try {
    await processN8nImageResult({
      siteDomain: site_domain,
      slug,
      imageData,
      altText: payload.alt_text ?? "",
      branch,
      github,
    });
    console.log(
      `${tag} SUCCESS — image delivered (provider=${provider}, ` +
      `n8n_duration=${durationMs ?? "?"}ms, raw_size=${rawSizeKB}KB)`,
    );
    recordOutcome(true, null);
    // source approximation: most images originate from the scheduler; dashboard-triggered
    // images share the same callback path but are not distinguishable here.
    void recordImageUsage({ siteDomain: site_domain, source: "scheduler", model: "gemini-2.5-flash-image", images: 1 });
    markBulkCallbackReceived(site_domain, slug);
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
    markBulkCallbackReceived(site_domain, slug);
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

  // Increment R2 usage tally (fire-and-forget, non-blocking)
  incrementR2Tally(optimized.length, 1).catch((err) =>
    console.warn("[r2-tally] increment failed:", err),
  );

  // 3. Read article, update frontmatter, commit (or buffer for bulk mode).
  const octokit = createOctokit(github);
  const articlePath = `sites/${siteDomain}/articles/${slug}.md`;
  const imageUrl = `/assets/images/${slug}.webp`;

  // Force a fresh tree fetch — the cache may be stale from auto-publish or a
  // prior operation that ran between the article commit and this callback
  // (the tree cache has no TTL and is only cleared by explicit calls).
  clearTreeCache(branch);

  if (isPartOfBulkRun(siteDomain, slug)) {
    // Bulk mode: buffer for single batch commit when all callbacks arrive
    let rawContent: string;
    try {
      rawContent = await readArticleWithFallback(octokit, github.repo, articlePath, branch, tag);
    } catch (readErr) {
      const readMsg = readErr instanceof Error ? readErr.message : String(readErr);
      const isNotFound = readMsg.includes("got nothing") || readMsg.includes("Not Found") || readMsg.includes("404");
      if (isNotFound) {
        // Article lost (auto-publish race reset the staging branch before this
        // callback arrived). Image is already in R2 — persist to MongoDB so the
        // article can pick it up if regenerated, and move on.
        console.warn(`${tag} Article not found on any branch — image saved to R2 only (${r2Key})`);
        await upsertArticleMeta(siteDomain, slug, branch, { featuredImage: imageUrl, image_alt: altText });
        return;
      }
      throw readErr;
    }
    const parsed = matter(rawContent);
    parsed.data["featuredImage"] = imageUrl;
    parsed.data["image_alt"] = altText;
    const updatedContent = matter.stringify(parsed.content, parsed.data);

    bufferBulkResult(branch, { path: articlePath, content: updatedContent, slug });
    console.log(`${tag} Buffered for bulk commit → ${articlePath} (branch: ${branch})`);
    return;
  }

  // Individual mode: commit immediately, serialized per branch to avoid SHA conflicts
  await enqueueForBranch(branch, async () => {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Clear again inside the queue — another operation may have re-populated
        // the cache while this callback waited in the per-branch queue.
        clearTreeCache(branch);
        const rawContent = await readArticleWithFallback(octokit, github.repo, articlePath, branch, tag);

        const parsed = matter(rawContent);
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

        // Dual-write to MongoDB (supplementary — never fails the pipeline)
        await upsertArticleMeta(siteDomain, slug, branch, {
          featuredImage: imageUrl,
          image_alt: altText,
        });

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

        // Article gone (auto-publish race). Image is already in R2 — persist
        // to MongoDB and succeed instead of triggering a noisy alert.
        const isNotFound = msg.includes("got nothing") || msg.includes("Not Found") || msg.includes("404");
        if (isNotFound) {
          console.warn(`${tag} Article not found on any branch — image saved to R2 only (${r2Key})`);
          await upsertArticleMeta(siteDomain, slug, branch, { featuredImage: imageUrl, image_alt: altText });
          return;
        }
        throw err;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// readArticleWithFallback — try staging branch first, fall back to main
// ---------------------------------------------------------------------------

/**
 * Read an article file from the given branch, falling back to `main` if the
 * file isn't found on the staging branch. Auto-publish may have merged the
 * article to main and reset the staging branch between the article commit
 * and this image callback arriving.
 */
async function readArticleWithFallback(
  octokit: ReturnType<typeof createOctokit>,
  repo: string,
  articlePath: string,
  branch: string,
  tag: string,
): Promise<string> {
  try {
    return await readFile(octokit, repo, articlePath, branch);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Only fall back for "file not found" — not for auth errors, network issues, etc.
    if (!msg.includes("got nothing") && !msg.includes("Not Found") && !msg.includes("404")) {
      throw err;
    }
    if (branch === "main") throw err; // already on main, no fallback

    console.warn(
      `${tag} Article not found on ${branch}, trying main ` +
      `(auto-publish may have reset staging)`,
    );
    clearTreeCache("main");
    return await readFile(octokit, repo, articlePath, "main");
  }
}
