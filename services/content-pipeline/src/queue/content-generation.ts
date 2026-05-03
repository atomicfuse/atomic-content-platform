import { Queue, Worker, QueueEvents, UnrecoverableError } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import { GENERATE_QUEUE } from "./types.js";
import type { GenerateJobData } from "./types.js";
import { createGitHubClient } from "../lib/github.js";
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
  const octokit = createGitHubClient(config.github);
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
    { siteDomain, branch, count },
    config,
  );

  // Surface total failure to BullMQ for retry
  const created = result.results.filter((r) => r.status === "created").length;
  if (created === 0 && result.results.length > 0) {
    throw new Error(
      `All ${result.results.length} articles failed for ${siteDomain}`,
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
