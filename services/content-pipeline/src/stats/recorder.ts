import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import type { GenerationEvent, GenerationSource, RunStatus } from "./types.js";

export interface EventContext {
  source: GenerationSource;
  forced: boolean;
  topicName: string | null;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * Pure mapper — derives a GenerationEvent from a BatchContentGenerationResult.
 * No I/O; safe to call in any context.
 *
 * Status derivation is intentionally consistent with the scheduler's
 * per-site status logic (scheduled-publisher/index.ts ~lines 272-286):
 *
 *   created > 0, failed === 0  → "success"   (any created, no errors)
 *   created > 0, failed > 0    → "partial"   (some created, some errored)
 *   created === 0, failed > 0  → "error"     (nothing created, at least one hard error)
 *   created === 0, failed === 0 → "no_content" (all skipped / all duplicates / nothing sourced)
 *
 * The scheduler also reaches "no_content" when totalSourced === 0 (aggregator
 * returned nothing), but in that case the agent emits a single skipped result,
 * so created === 0 && failed === 0 already covers it — no separate totalSourced
 * branch is needed here.
 *
 * The scheduler uses "success" for any created > 0 (regardless of how many were
 * requested). That matches here: we do NOT require created >= requested for
 * "success" — that would diverge from what's written to history.json.
 */
export function buildGenerationEvent(
  result: BatchContentGenerationResult,
  ctx: EventContext,
): GenerationEvent {
  const created = result.results.filter((r) => r.status === "created").length;
  const failed = result.results.filter((r) => r.status === "error").length;

  let status: RunStatus;
  if (created > 0 && failed === 0) {
    status = "success";
  } else if (created > 0 && failed > 0) {
    status = "partial";
  } else if (created === 0 && failed > 0) {
    status = "error";
  } else {
    status = "no_content";
  }

  const firstErr = result.results.find((r) => r.status === "error");

  return {
    siteDomain: result.siteDomain,
    source: ctx.source,
    forced: ctx.forced,
    topicName: ctx.topicName,
    requested: result.requested,
    created,
    failed,
    status,
    message: firstErr?.message ?? null,
    startedAt: ctx.startedAt,
    finishedAt: ctx.finishedAt,
  };
}
