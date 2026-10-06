/**
 * Direct (HTTP) generation requests run through the generate queue.
 *
 * Only the queue worker (processGenerateJob) persists articles — commit to the
 * staging branch, dedup index, Mongo mirror, n8n image triggers. Running the
 * agent inline from POST /content-generate generated articles and then dropped
 * them, so the HTTP path enqueues and waits for the worker instead.
 */

import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import type { GenerateJobData } from "./types.js";

/**
 * How long POST /content-generate holds the request open. The dashboard has no
 * 202-polling UI yet, so the request must outlive a full multi-article run
 * (10 articles ≈ 4–5 min).
 */
export const DIRECT_GENERATE_TIMEOUT_MS = 20 * 60_000;

/** The parts of a BullMQ job this module uses (lets tests pass fakes). */
export interface GenerateJobLike {
  id?: string;
  waitUntilFinished(events: unknown, ttl?: number): Promise<BatchContentGenerationResult>;
  getState(): Promise<string>;
}

/** The parts of the generate queue this module uses. */
export interface GenerateQueueLike {
  add(name: string, data: GenerateJobData): Promise<GenerateJobLike>;
  getJob(id: string): Promise<{ failedReason?: string } | undefined>;
}

export type DirectGenerateOutcome =
  | { kind: "finished"; jobId: string; result: BatchContentGenerationResult }
  | { kind: "failed"; jobId: string; error: string }
  | { kind: "running"; jobId: string };

/**
 * Enqueues a generate job and waits for the worker to finish it.
 * Returns "running" when the wait times out (the job keeps going in the worker).
 */
export async function enqueueAndWait(
  queue: GenerateQueueLike,
  events: unknown,
  data: GenerateJobData,
  timeoutMs: number = DIRECT_GENERATE_TIMEOUT_MS,
): Promise<DirectGenerateOutcome> {
  const job = await queue.add("generate", data);
  const jobId = job.id ?? "";
  try {
    const result = await job.waitUntilFinished(events, timeoutMs);
    return { kind: "finished", jobId, result };
  } catch (err) {
    const state = await job.getState();
    if (state === "failed") {
      // The local job object is a snapshot — re-read for the final failure reason.
      const fresh = jobId ? await queue.getJob(jobId) : undefined;
      const reason = fresh?.failedReason ?? (err instanceof Error ? err.message : String(err));
      return { kind: "failed", jobId, error: reason };
    }
    return { kind: "running", jobId };
  }
}
