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
import {
  createImportSiteQueue,
  createImportSiteWorker,
} from "./import-site.js";
import {
  createImportFinalizeQueue,
  createImportFinalizeWorker,
} from "./import-finalize.js";
import {
  createImportArticlesQueue,
  createImportArticlesWorker,
} from "./import-articles.js";
import type { ImportSiteJobData, ImportSiteResult, ImportFinalizeData, ImportArticlesJobData, ImportArticlesResult } from "./types.js";

export type { GenerateJobData } from "./types.js";
export { GENERATE_QUEUE, SCHEDULER_RUN_QUEUE, DEFAULT_JOB_OPTIONS } from "./types.js";
export type { SchedulerRunData } from "./types.js";
export { IMPORT_SITE_QUEUE, IMPORT_FINALIZE_QUEUE, IMPORT_ARTICLES_QUEUE } from "./types.js";
export type { ImportSiteJobData, ImportSiteResult, ImportFinalizeData, ImportArticlesJobData, ImportArticlesResult } from "./types.js";

export interface QueueInstances {
  connection: Redis;
  generateQueue: Queue<GenerateJobData, BatchContentGenerationResult>;
  generateQueueEvents: QueueEvents;
  generateWorker: Worker<GenerateJobData, BatchContentGenerationResult>;
  flowProducer: FlowProducer;
  schedulerRunWorker: Worker<SchedulerRunData>;
  schedulerRunQueue: Queue<SchedulerRunData>;
  importSiteQueue: Queue<ImportSiteJobData, ImportSiteResult>;
  importSiteWorker: Worker<ImportSiteJobData, ImportSiteResult>;
  importFinalizeQueue: Queue<ImportFinalizeData>;
  importFinalizeWorker: Worker<ImportFinalizeData>;
  importArticlesQueue: Queue<ImportArticlesJobData, ImportArticlesResult>;
  importArticlesWorker: Worker<ImportArticlesJobData, ImportArticlesResult>;
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

  // CRITICAL: BullMQ instances re-emit Redis connection errors as their own
  // 'error' events. Without handlers, an unhandled 'error' event crashes Node.
  generateQueue.on("error", (err) => {
    console.error(`[queue] Connection error: ${err.message}`);
  });
  generateQueueEvents.on("error", (err) => {
    console.error(`[queue-events] Connection error: ${err.message}`);
  });
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
  schedulerRunQueue.on("error", (err) => {
    console.error(`[scheduler-queue] Connection error: ${err.message}`);
  });

  console.log("[worker] Scheduler-run worker started");

  // Import site queue
  const githubToken = process.env.GITHUB_TOKEN ?? "";
  const networkRepo = process.env.NETWORK_REPO ?? "atomicfuse/atomic-labs-network";

  const importSiteQueue = createImportSiteQueue(connection);
  const importSiteWorker = createImportSiteWorker(connection, WORKER_CONCURRENCY, githubToken, networkRepo);

  importSiteQueue.on("error", (err) => {
    console.error(`[import-site-queue] Connection error: ${err.message}`);
  });
  importSiteWorker.on("error", (err) => {
    console.error(`[import-site-worker] Connection error: ${err.message}`);
  });
  importSiteWorker.on("failed", (job, err) => {
    console.error(`[import-site] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });
  importSiteWorker.on("completed", (job) => {
    console.log(`[import-site] Job ${job.id} completed for ${job.data.siteId}`);
  });

  console.log(`[worker] Import-site worker started (concurrency: ${WORKER_CONCURRENCY})`);

  // Import finalize queue
  const importFinalizeQueue = createImportFinalizeQueue(connection);
  const importFinalizeWorker = createImportFinalizeWorker(connection, githubToken, networkRepo);

  importFinalizeQueue.on("error", (err) => {
    console.error(`[import-finalize-queue] Connection error: ${err.message}`);
  });
  importFinalizeWorker.on("error", (err) => {
    console.error(`[import-finalize-worker] Connection error: ${err.message}`);
  });
  importFinalizeWorker.on("completed", (job) => {
    console.log(`[import-finalize] Batch ${job.data.batchId.slice(0, 8)} finalized`);
  });

  console.log("[worker] Import-finalize worker started");

  // Import articles queue (background article migration)
  const importArticlesQueue = createImportArticlesQueue(connection);
  const importArticlesWorker = createImportArticlesWorker(connection, 1);

  importArticlesQueue.on("error", (err) => {
    console.error(`[import-articles-queue] Connection error: ${err.message}`);
  });
  importArticlesWorker.on("error", (err) => {
    console.error(`[import-articles-worker] Connection error: ${err.message}`);
  });
  importArticlesWorker.on("failed", (job, err) => {
    console.error(`[import-articles] Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
  });
  importArticlesWorker.on("completed", (job) => {
    console.log(`[import-articles] Job ${job.id} completed for ${job.data.siteDomain}`);
  });

  console.log("[worker] Import-articles worker started (concurrency: 1)");

  return {
    connection,
    generateQueue,
    generateQueueEvents,
    generateWorker,
    flowProducer,
    schedulerRunWorker,
    schedulerRunQueue,
    importSiteQueue,
    importSiteWorker,
    importFinalizeQueue,
    importFinalizeWorker,
    importArticlesQueue,
    importArticlesWorker,
  };
}
