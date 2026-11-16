/**
 * Response of the content pipeline's /scheduled-publish endpoint (via
 * /api/scheduler/run-now). With the queue enabled the pipeline only queues a
 * background planning job and returns `queued` + `runId`; without a queue
 * (local dev) it runs synchronously and lists the triggered sites.
 */
export interface RunNowResult {
  status?: string;
  configStatus?: string;
  skippedGlobal?: string;
  triggered?: string[];
  skipped?: Array<{ domain: string; reason: string }>;
  errors?: Array<{ domain: string; error: string }>;
  queued?: boolean;
  alreadyQueued?: boolean;
  runId?: string;
  error?: string;
  details?: string;
}

export interface RunNowSummary {
  tone: "success" | "info" | "error";
  message: string;
}

/** One-line toast text for a "Run now" response. */
export function summarizeRunNow(result: RunNowResult): RunNowSummary {
  if (result.error) return { tone: "error", message: result.error };
  const run = result.runId ? `Run ${result.runId}` : "This hour's run";
  if (result.alreadyQueued) {
    return { tone: "info", message: `${run} is already queued` };
  }
  if (result.queued) {
    return { tone: "success", message: `${run} queued — due sites are checked and generated in the background` };
  }
  return { tone: "success", message: `Triggered ${result.triggered?.length ?? 0} site(s)` };
}
