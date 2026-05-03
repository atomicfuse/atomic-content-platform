import type { JobsOptions } from "bullmq";

export interface GenerateJobData {
  siteDomain: string;
  count: number;
  branch: string;
  runId?: string;
  triggeredBy: "manual" | "scheduled" | "scheduled-forced";
}

export interface SchedulerRunData {
  runId: string;
  timezone: string;
  forced: boolean;
  /** Domains that were enqueued as child generate jobs. */
  enqueuedDomains: string[];
  skipped: Array<{ domain: string; reason: string }>;
}

export const GENERATE_QUEUE = "content-generation";
export const SCHEDULER_RUN_QUEUE = "scheduler-run";

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};
