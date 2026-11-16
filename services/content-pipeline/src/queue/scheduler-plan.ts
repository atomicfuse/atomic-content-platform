import { Queue, Worker } from "bullmq";
import type { FlowProducer } from "bullmq";
import type { Redis } from "ioredis";
import type { AgentConfig } from "../lib/config.js";
import { notifyError } from "../lib/notifications.js";
import { planSchedulerRun } from "../agents/scheduled-publisher/index.js";
import type { SchedulerPlanOutcome } from "../agents/scheduled-publisher/index.js";
import { SCHEDULER_PLAN_QUEUE } from "./types.js";
import type { SchedulerPlanData } from "./types.js";

export interface SchedulerPlanInstances {
  schedulerPlanQueue: Queue<SchedulerPlanData>;
  schedulerPlanWorker: Worker<SchedulerPlanData, SchedulerPlanOutcome>;
}

/**
 * Queue + worker for the background planning step of a scheduler run.
 * Concurrency 1: there is at most one run per hour.
 */
export function setupSchedulerPlan(
  connection: Redis,
  config: AgentConfig,
  flowProducer: FlowProducer,
): SchedulerPlanInstances {
  const schedulerPlanQueue = new Queue<SchedulerPlanData>(SCHEDULER_PLAN_QUEUE, { connection });
  schedulerPlanQueue.on("error", (err) => {
    console.error(`[scheduler-plan-queue] Connection error: ${err.message}`);
  });

  const schedulerPlanWorker = new Worker<SchedulerPlanData, SchedulerPlanOutcome>(
    SCHEDULER_PLAN_QUEUE,
    async (job) => planSchedulerRun(config, job.data, flowProducer),
    { connection, concurrency: 1 },
  );

  schedulerPlanWorker.on("error", (err) => {
    console.error(`[scheduler-plan] Worker connection error: ${err.message}`);
  });

  schedulerPlanWorker.on("failed", (job, err) => {
    const attempts = job?.opts.attempts ?? 1;
    const final = (job?.attemptsMade ?? 0) >= attempts;
    console.error(
      `[scheduler-plan] Run ${job?.data.runId} planning failed (attempt ${job?.attemptsMade}/${attempts}): ${err.message}`,
    );
    // Only alert once retries are exhausted — that run produces no articles.
    if (final) {
      void notifyError(config.notifications, {
        agent: "scheduled-publisher",
        error: `Run ${job?.data.runId} could not be planned after ${attempts} attempt(s): ${err.message}`,
      });
    }
  });

  schedulerPlanWorker.on("completed", (job, outcome) => {
    console.log(
      `[scheduler-plan] Run ${job.data.runId} planned: ${outcome.enqueued} site(s) enqueued, ${outcome.skipped.length} skipped`,
    );
  });

  console.log("[worker] Scheduler-plan worker started");
  return { schedulerPlanQueue, schedulerPlanWorker };
}
