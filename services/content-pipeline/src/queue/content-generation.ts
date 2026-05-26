import { Queue, Worker, QueueEvents, UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import { GENERATE_QUEUE } from "./types.js";
import type { GenerateJobData } from "./types.js";
import { createOctokit } from "../lib/github.js";
import { readSiteBriefWithFallback } from "../lib/site-brief.js";
import { runContentGeneration } from "../agents/content-generation/agent.js";
import type { AgentConfig } from "../lib/config.js";

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
 * Wraps `runContentGeneration` with:
 * 1. Pre-flight checks that throw UnrecoverableError (no LLM spend wasted)
 * 2. Result inspection that surfaces total failures to BullMQ for retry
 *
 * `runContentGeneration` itself never throws — it returns error results.
 * This wrapper bridges that contract with BullMQ's throw-to-fail model.
 */
export async function processGenerateJob(
  job: Job<GenerateJobData>,
  config: AgentConfig,
): Promise<BatchContentGenerationResult> {
  const { siteDomain, branch, count } = job.data;

  // Pre-flight: verify site exists and has a schedule
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

  // Run the agent (never throws — returns error results)
  const result = await runContentGeneration(
    { siteDomain, branch, count, jobId: job.id },
    config,
  );

  // Surface total failure to BullMQ for retry — but only actual errors,
  // not skipped items (duplicates, no aggregator results, non-English, etc.)
  const created = result.results.filter((r) => r.status === "created").length;
  const errors = result.results.filter((r) => r.status === "error");
  if (created === 0 && errors.length > 0) {
    const reasons = errors
      .map((r) => r.message ?? "unknown")
      .slice(0, 3)
      .join("; ");
    throw new Error(
      `All ${errors.length} article(s) failed for ${siteDomain}: ${reasons}`,
    );
  }

  return result;
}

export function createGenerateWorker(
  connection: Redis,
  concurrency: number,
  config: AgentConfig,
): Worker<GenerateJobData, BatchContentGenerationResult> {
  return new Worker(
    GENERATE_QUEUE,
    async (job) => processGenerateJob(job, config),
    { connection, concurrency },
  );
}
