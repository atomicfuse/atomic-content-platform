import { FlowProducer, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { createGitHubClient, readFile, commitFile } from "../lib/github.js";
import type { AgentConfig } from "../lib/config.js";
import type { SiteRunResult } from "../agents/scheduled-publisher/history.js";
import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import {
  GENERATE_QUEUE,
  SCHEDULER_RUN_QUEUE,
  DEFAULT_JOB_OPTIONS,
} from "./types.js";
import type { GenerateJobData, SchedulerRunData } from "./types.js";

const HISTORY_PATH = "scheduler/history.json";
const MAX_ENTRIES = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic run ID — hourly granularity. */
export function buildRunId(): string {
  return new Date().toISOString().slice(0, 13);
}

// ---------------------------------------------------------------------------
// Flow creation
// ---------------------------------------------------------------------------

export interface SchedulerSite {
  domain: string;
  branch: string;
  count: number;
}

/**
 * Create a BullMQ Flow: one parent `scheduler-run` job with N child `generate` jobs.
 * Uses deterministic `jobId` to prevent double-enqueue from overlapping cron ticks.
 *
 * The first argument is the Redis connection (used to create a FlowProducer
 * internally). Passing a connection rather than a pre-built FlowProducer keeps
 * the constructor call inside this function so tests can intercept it via
 * vi.mock("bullmq").
 */
export async function createSchedulerFlow(
  connection: Redis,
  runId: string,
  timezone: string,
  forced: boolean,
  sites: SchedulerSite[],
  skipped: Array<{ domain: string; reason: string }>,
): Promise<{ runId: string; enqueued: number }> {
  const flowProducer = new FlowProducer({ connection });

  const children = sites.map((site) => ({
    name: "generate",
    queueName: GENERATE_QUEUE,
    data: {
      siteDomain: site.domain,
      count: site.count,
      branch: site.branch,
      runId,
      triggeredBy: (forced ? "scheduled-forced" : "scheduled") as GenerateJobData["triggeredBy"],
    },
    opts: DEFAULT_JOB_OPTIONS,
  }));

  await flowProducer.add({
    name: "scheduler-run",
    queueName: SCHEDULER_RUN_QUEUE,
    data: {
      runId,
      timezone,
      forced,
      enqueuedDomains: sites.map((s) => s.domain),
      skipped,
    } satisfies SchedulerRunData,
    opts: {
      jobId: `scheduler-run-${runId}`,
    },
    children,
  });

  return { runId, enqueued: sites.length };
}

// ---------------------------------------------------------------------------
// Parent processor — runs after all children complete
// ---------------------------------------------------------------------------

/**
 * Process the parent `scheduler-run` job.
 * Reads each child's returnvalue/failedReason, builds a SchedulerRunEntry,
 * and writes it to `scheduler/history.json` on GitHub — one commit total.
 */
export async function processSchedulerRun(
  job: Job<SchedulerRunData>,
  config: AgentConfig,
): Promise<void> {
  const { runId, timezone, forced, skipped } = job.data;

  // Collect child results — getChildrenValues() only returns COMPLETED children.
  // Children return BatchContentGenerationResult, mapped to SiteRunResult.
  const childrenValues = (await job.getChildrenValues()) as Record<
    string,
    BatchContentGenerationResult | null
  >;
  const sites: SiteRunResult[] = [];
  for (const [, genResult] of Object.entries(childrenValues)) {
    if (!genResult) continue;

    const created = genResult.results.filter((r) => r.status === "created").length;
    const genErrors = genResult.results.filter((r) => r.status === "error");
    let siteStatus: SiteRunResult["status"];
    let siteMessage: string | undefined;

    if (genResult.totalSourced === 0) {
      siteStatus = "no_content";
      siteMessage = "Aggregator returned 0 items for this site's topics";
    } else if (created === 0 && genErrors.length > 0) {
      siteStatus = "error";
      siteMessage = genErrors
        .map((e) => (e.message ?? e.reason ?? "unknown"))
        .join("; ");
    } else if (created === 0 && genErrors.length === 0) {
      siteStatus = "no_content";
      siteMessage = `All ${genResult.totalSourced} item(s) checked were duplicates`;
    } else if (created < genResult.requested && genErrors.length > 0) {
      siteStatus = "partial";
      siteMessage = `${genErrors.length} article(s) failed`;
    } else {
      siteStatus = "success";
    }

    sites.push({
      domain: genResult.siteDomain,
      status: siteStatus,
      articlesCreated: created,
      articlesRequested: genResult.requested,
      message: siteMessage,
    });
  }

  // Also record FAILED children — getChildrenValues() only returns completed
  // children. We know which domains were enqueued from enqueuedDomains in the
  // parent's data. Any domain not in the completed set permanently failed.
  const { enqueuedDomains } = job.data;
  const completedDomains = new Set(sites.map((s) => s.domain));
  for (const domain of enqueuedDomains) {
    if (!completedDomains.has(domain)) {
      sites.push({
        domain,
        status: "error",
        articlesCreated: 0,
        articlesRequested: 0,
        message: "Child job failed (all retries exhausted)",
      });
    }
  }

  // Build history entry
  const entry = {
    timestamp: runId,
    timezone,
    forced,
    sites,
    skipped,
  };

  // Write to GitHub
  const octokit = createGitHubClient(config.github);
  let history: unknown[] = [];
  try {
    const raw = await readFile(octokit, config.networkRepo, HISTORY_PATH);
    history = JSON.parse(raw) as unknown[];
  } catch {
    // First run or missing file — start fresh
  }

  history.unshift(entry);
  const trimmed = history.slice(0, MAX_ENTRIES);

  await commitFile(octokit, config.networkRepo, {
    path: HISTORY_PATH,
    content: JSON.stringify(trimmed, null, 2),
    message: `scheduler: update run history (${runId})`,
    branch: "main",
  });

  console.log(
    `[scheduler-run] History written: ${sites.length} site(s), ${skipped.length} skipped`,
  );
}

// ---------------------------------------------------------------------------
// Worker + Flow setup
// ---------------------------------------------------------------------------

export interface SchedulerFlowInstances {
  flowProducer: FlowProducer;
  schedulerRunWorker: Worker<SchedulerRunData>;
}

export function setupSchedulerFlow(
  connection: Redis,
  config: AgentConfig,
): SchedulerFlowInstances {
  const flowProducer = new FlowProducer({ connection });

  const schedulerRunWorker = new Worker<SchedulerRunData>(
    SCHEDULER_RUN_QUEUE,
    async (job) => processSchedulerRun(job, config),
    { connection },
  );

  schedulerRunWorker.on("failed", (job, err) => {
    console.error(
      `[scheduler-run] Parent job ${job?.id} failed: ${err.message}`,
    );
  });

  schedulerRunWorker.on("completed", (job) => {
    console.log(`[scheduler-run] Run ${job.data.runId} completed`);
  });

  return { flowProducer, schedulerRunWorker };
}
