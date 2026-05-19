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
import { setupSchedulerFlow } from "./scheduler-flow.js";
import type { AgentConfig } from "../lib/config.js";
import { notifyError } from "../lib/notifications.js";

export type { GenerateJobData } from "./types.js";
export { GENERATE_QUEUE, SCHEDULER_RUN_QUEUE, DEFAULT_JOB_OPTIONS } from "./types.js";
export type { SchedulerRunData } from "./types.js";

export interface QueueInstances {
  connection: Redis;
  generateQueue: Queue<GenerateJobData, BatchContentGenerationResult>;
  generateQueueEvents: QueueEvents;
  generateWorker: Worker<GenerateJobData, BatchContentGenerationResult>;
  flowProducer: FlowProducer;
  schedulerRunWorker: Worker<SchedulerRunData>;
  schedulerRunQueue: Queue<SchedulerRunData>;
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

  // CRITICAL: Workers emit 'error' for Redis connection issues.
  // Without this handler, an unhandled 'error' event crashes the process.
  generateWorker.on("error", (err) => {
    console.error(`[worker] Connection error: ${err.message}`);
  });

  generateWorker.on("failed", (job, err) => {
    console.error(
      `[worker] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`,
    );
    void notifyError(config.notifications, {
      agent: "content-generation",
      error: `Job ${job?.id} failed after ${job?.attemptsMade} attempt(s): ${err.message}`,
      site: job?.data?.siteDomain,
    });
  });

  generateWorker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed for ${job.data.siteDomain}`);
  });

  console.log(`[worker] Content-generation worker started (concurrency: ${WORKER_CONCURRENCY})`);

  const { flowProducer, schedulerRunWorker } = setupSchedulerFlow(connection, config);

  const schedulerRunQueue = new Queue<SchedulerRunData>(
    SCHEDULER_RUN_QUEUE,
    { connection },
  );

  console.log("[worker] Scheduler-run worker started");

  return {
    connection,
    generateQueue,
    generateQueueEvents,
    generateWorker,
    flowProducer,
    schedulerRunWorker,
    schedulerRunQueue,
  };
}
