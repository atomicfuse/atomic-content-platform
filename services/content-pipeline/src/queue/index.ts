import type { Redis } from "ioredis";
import { Queue, type Worker, type QueueEvents, type FlowProducer } from "bullmq";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import type { GenerateJobData, SchedulerRunData } from "./types.js";
import { SCHEDULER_RUN_QUEUE } from "./types.js";
import { createRedisConnection } from "./connection.js";
import {
  createGenerateQueue,
  createGenerateQueueEvents,
  createGenerateWorker,
} from "./content-generation.js";
import type { AgentConfig } from "../lib/config.js";

export type { GenerateJobData } from "./types.js";
export { GENERATE_QUEUE, SCHEDULER_RUN_QUEUE, DEFAULT_JOB_OPTIONS } from "./types.js";
export type { SchedulerRunData } from "./types.js";

export interface QueueInstances {
  connection: Redis;
  generateQueue: Queue<GenerateJobData, BatchContentGenerationResult>;
  generateQueueEvents: QueueEvents;
  generateWorker: Worker<GenerateJobData, BatchContentGenerationResult>;
}

const WORKER_CONCURRENCY = 3;

/**
 * Start all queue workers. Called once at server boot.
 * Returns queue instances for the HTTP server to use (enqueue, job lookup).
 */
export function startWorkers(redisUrl: string, config: AgentConfig): QueueInstances {
  const connection = createRedisConnection(redisUrl);

  const generateQueue = createGenerateQueue(connection);
  const generateQueueEvents = createGenerateQueueEvents(connection);
  const generateWorker = createGenerateWorker(connection, WORKER_CONCURRENCY, config);

  generateWorker.on("failed", (job, err) => {
    console.error(
      `[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );
  });

  generateWorker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed for ${job.data.siteDomain}`);
  });

  console.log(`[worker] Content-generation worker started (concurrency: ${WORKER_CONCURRENCY})`);

  return { connection, generateQueue, generateQueueEvents, generateWorker };
}
