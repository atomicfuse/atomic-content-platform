import { Queue, Worker, QueueEvents, UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import matter from "gray-matter";
import type { BatchContentGenerationResult, ContentGenerationResult, ContentGenerationParams } from "../agents/content-generation/agent.js";
import { normalizeUrl, normalizeTitleKey, dedupIndexPath, serializeDedupIndex, getAllExistingArticles } from "../agents/content-generation/agent.js";
import { GENERATE_QUEUE } from "./types.js";
import type { GenerateJobData } from "./types.js";
import { createOctokit } from "../lib/github.js";
import type { BatchFileEntry } from "../lib/github.js";
import { readSiteBriefWithFallback } from "../lib/site-brief.js";
import type { SiteBriefData } from "../lib/site-brief.js";
import { runContentGeneration } from "../agents/content-generation/agent.js";
import { writeArticleBatch } from "../lib/writer.js";
import type { PendingArticle } from "../lib/writer.js";
import { upsertArticlesBatch } from "../lib/db/articles.js";
import { triggerN8nImage, trackPendingImage, createGitImageVerifier } from "../agents/content-generation/n8n-image.js";
import { notifyImageDefaultFallback } from "../lib/notifications.js";
import type { AgentConfig } from "../lib/config.js";
import { recordGeneration, sourceFromTriggeredBy } from "../stats/recorder.js";
import { runAfterRun } from "../alerts/run.js";
import { buildScheduleSnapshot } from "../stats/schedule.js";

export function createGenerateQueue(
  connection: Redis,
): Queue<GenerateJobData, BatchContentGenerationResult> {
  return new Queue(GENERATE_QUEUE, { connection });
}

export function createGenerateQueueEvents(connection: Redis): QueueEvents {
  return new QueueEvents(GENERATE_QUEUE, { connection });
}

/**
 * BullMQ worker processor for content generation jobs.
 *
 * Three-phase pipeline with Redis checkpoint:
 * 1. LLM generation (expensive — cached in Redis so retries skip it)
 * 2. Git push (writeArticleBatch — the likely failure point on retries)
 * 3. n8n image triggers (fire-and-forget)
 *
 * If Phase 2 fails, BullMQ retries the job. On retry, Phase 1 is skipped
 * (cached LLM results loaded from Redis), so only the push is re-attempted.
 */
export async function processGenerateJob(
  job: Job<GenerateJobData>,
  config: AgentConfig,
  redis: Redis,
): Promise<BatchContentGenerationResult> {
  const { siteDomain, branch, count, briefJson, topicName, bypassSchedule, triggeredBy, timezone } = job.data;
  // Manual dashboard triggers always bypass per-topic date eligibility. The
  // job payload's `bypassSchedule` (set by the dashboard) is authoritative;
  // we also default-on for triggeredBy="manual" so older callers work.
  const effectiveBypass = bypassSchedule ?? triggeredBy === "manual";

  // Deserialize preloaded brief from job data (avoids redundant GitHub read)
  let preloadedBrief: ContentGenerationParams["preloadedBrief"] | undefined;
  if (briefJson) {
    try {
      const parsed = JSON.parse(briefJson) as SiteBriefData;
      preloadedBrief = {
        siteName: parsed.siteName,
        author: parsed.author,
        group: parsed.group,
        brief: parsed.brief,
      };
    } catch {
      // Fall through to fresh read
    }
  }

  // Pre-flight: verify site exists and has a schedule (skip if we have preloaded data)
  if (!preloadedBrief) {
    const octokit = createOctokit(config.github);
    let briefData;
    try {
      briefData = await readSiteBriefWithFallback(
        octokit,
        config.networkRepo,
        siteDomain,
        branch,
      );
    } catch {
      throw new UnrecoverableError(
        `Site "${siteDomain}" not found — no brief in staging or main`,
      );
    }

    if (!briefData.data.brief?.schedule) {
      throw new UnrecoverableError(
        `No publishing schedule for ${siteDomain}`,
      );
    }
  }

  // --- Phase 1: LLM generation (skip on retry if cached) ---
  const cacheKey = `job:${job.id}:articles`;
  let result: BatchContentGenerationResult;

  const startedAt = new Date();
  const cached = await redis.get(cacheKey);
  if (cached && job.attemptsMade > 0) {
    result = JSON.parse(cached);
    console.log(
      `[generate] Retry #${job.attemptsMade} for ${siteDomain} — loaded ${result.results.length} cached articles, skipping LLM`,
    );
  } else {
    result = await runContentGeneration(
      {
        siteDomain,
        branch,
        count,
        jobId: job.id,
        preloadedBrief,
        topicName,
        bypassSchedule: effectiveBypass,
        timezone,
        source: sourceFromTriggeredBy(triggeredBy),
      },
      config,
    );
    await redis.set(cacheKey, JSON.stringify(result), "EX", 3600);
  }
  const finishedAt = new Date();

  // Record the generation run to stats (failure-isolated; runs on
  // retried-from-cache attempts too, hence placed after the if/else above).
  // scheduler-flow sets triggeredBy="scheduled-forced" when a run is forced; bypassSchedule is set by manual dashboard enqueues.
  await recordGeneration(
    result,
    {
      source: sourceFromTriggeredBy(triggeredBy),
      forced: triggeredBy === "scheduled-forced" || bypassSchedule === true,
      topicName: topicName ?? null,
      startedAt,
      finishedAt,
    },
    buildScheduleSnapshot(preloadedBrief?.brief?.schedule),
  );

  // Re-evaluate run-sensitive alert conditions for this site (fire-and-forget;
  // runAfterRun is failure-isolated and never alters generation behavior).
  void runAfterRun(siteDomain, new Date());

  // Surface total failure to BullMQ for retry
  const created = result.results.filter((r) => r.status === "created");
  const errors = result.results.filter((r) => r.status === "error");
  if (created.length === 0 && errors.length > 0) {
    const reasons = errors
      .map((r) => r.message ?? "unknown")
      .slice(0, 3)
      .join("; ");
    throw new Error(
      `All ${errors.length} article(s) failed for ${siteDomain}: ${reasons}`,
    );
  }

  // --- Phase 2: Push to Git ---
  if (created.length > 0) {
    const pendingArticles = created
      .map((r) => r._pendingArticle)
      .filter((a): a is PendingArticle => !!a);

    // Load full existing articles set (from dedup index or file scan) and merge
    // in the newly created articles. Previously this only wrote the new batch,
    // causing the next run to lose track of all older articles.
    const existingArticles = await getAllExistingArticles(config, siteDomain, branch);
    for (const r of created) {
      if (r._pendingArticle) {
        const { data } = matter(r._pendingArticle.content);
        if (data.source_url) existingArticles.urls.add(normalizeUrl(data.source_url as string));
        if (data.title) existingArticles.titles.add(normalizeTitleKey(data.title as string));
        // Original aggregator title + item id — the cross-run dedup keys that
        // survive the LLM title rewrite and URL variants.
        if (data.source_title) existingArticles.titles.add(normalizeTitleKey(data.source_title as string));
        if (data.source_item_id) existingArticles.ids.add(String(data.source_item_id));
      }
    }
    const dedupIndexFile: BatchFileEntry = {
      path: dedupIndexPath(siteDomain),
      content: serializeDedupIndex(existingArticles),
    };

    const slugList = pendingArticles.map((a) => a.slug).join(", ");
    const commitMsg = `feat(content): add ${pendingArticles.length} article(s) for ${siteDomain}\n\n${slugList}`;

    await writeArticleBatch(
      { localNetworkPath: config.localNetworkPath, github: config.github, branch },
      pendingArticles,
      [],
      commitMsg,
      [dedupIndexFile],
    );

    // Dual-write to MongoDB (supplementary — never fails the pipeline)
    const mongoArticles = pendingArticles.map((a) => {
      const { data: fm } = matter(a.content);
      return {
        domain: a.siteDomain,
        slug: a.slug,
        branch,
        frontmatter: fm as Record<string, unknown>,
      };
    });
    await upsertArticlesBatch(mongoArticles);
  }

  // --- Phase 3: n8n image triggers ---
  let n8nImagesTriggered = 0;
  const jobId = job.id;
  if (config.n8nImageWebhookUrl && branch) {
    const imageRequests = created
      .filter((r) => r._imageRequest)
      .map((r) => r._imageRequest!);

    if (imageRequests.length > 0) {
      n8nImagesTriggered = imageRequests.length;
      const webhookUrl = config.n8nImageWebhookUrl;
      const callbackUrl = config.imageCallbackUrl ?? "https://sites-platform-e297--atomic.cloudgrid.io/api/agent/image-callback";

      for (const req of imageRequests) {
        void triggerN8nImage(webhookUrl, {
          request_id: req.requestId,
          callback_url: callbackUrl,
          job_id: jobId ?? "",
          site_domain: req.siteDomain,
          slug: req.slug,
          branch,
          article: {
            title: req.articleTitle,
            description: req.articleDescription,
            summary: req.articleSummary,
            vertical: req.vertical,
            source_thumbnail_url: req.sourceThumbnailUrl ?? null,
            image_guidelines: Array.isArray(req.imageGuidelines)
              ? req.imageGuidelines.join("\n")
              : req.imageGuidelines,
          },
        }).then((accepted) => {
          if (accepted) {
            trackPendingImage(
              req.requestId,
              req.siteDomain,
              req.slug,
              req.articleTitle,
              config.notifications,
              createGitImageVerifier(config.github, config.networkRepo),
            );
          } else {
            void notifyImageDefaultFallback(config.notifications, {
              site: req.siteDomain, articleTitle: req.articleTitle,
              slug: req.slug, reason: "n8n webhook trigger failed",
            });
          }
        });
      }
    }
  } else if (branch) {
    const imageRequests = created
      .filter((r) => r._imageRequest)
      .map((r) => r._imageRequest!);
    for (const req of imageRequests) {
      void notifyImageDefaultFallback(config.notifications, {
        site: req.siteDomain, articleTitle: req.articleTitle,
        slug: req.slug, reason: "n8n image webhook not configured (N8N_IMAGE_WEBHOOK_URL unset)",
      });
    }
  }

  // Clean up Redis cache on success
  await redis.del(cacheKey);

  // Strip internal fields before returning
  const cleanResults = result.results.map(({ _pendingArticle, _imageRequest, ...rest }) => rest);

  return {
    ...result,
    n8nImagesTriggered,
    results: cleanResults,
  };
}

export function createGenerateWorker(
  connection: Redis,
  concurrency: number,
  config: AgentConfig,
): Worker<GenerateJobData, BatchContentGenerationResult> {
  return new Worker(
    GENERATE_QUEUE,
    async (job) => processGenerateJob(job, config, connection),
    { connection, concurrency },
  );
}
