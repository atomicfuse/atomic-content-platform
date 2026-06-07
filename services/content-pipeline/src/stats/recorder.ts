import type { BatchContentGenerationResult } from "../agents/content-generation/agent.js";
import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS, type ScheduleSnapshot } from "./types.js";
import type { GenerationEvent, GenerationSource, ImageGenEvent, RunStatus } from "./types.js";

export interface EventContext {
  source: GenerationSource;
  forced: boolean;
  topicName: string | null;
  startedAt: Date;
  finishedAt: Date;
}

/**
 * Maps a job's `triggeredBy` to a GenerationSource.
 *   "manual"            → "dashboard"
 *   "wp-import"         → "wp-import"
 *   "scheduled" / "scheduled-forced" / anything else → "scheduler"
 */
export function sourceFromTriggeredBy(t: string): GenerationSource {
  if (t === "manual") return "dashboard";
  if (t === "wp-import") return "wp-import";
  return "scheduler"; // scheduled / scheduled-forced
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

/**
 * Persists a generation run to MongoDB:
 *   1. Inserts a GenerationEvent document.
 *   2. Upserts the SiteStats rollup document.
 *
 * Failure-isolated — any Mongo error is caught and logged; the caller
 * (scheduler, dashboard) never sees an exception from this function.
 */
export async function recordGeneration(
  result: BatchContentGenerationResult,
  ctx: EventContext,
  schedule: ScheduleSnapshot | null,
): Promise<void> {
  try {
    const event = buildGenerationEvent(result, ctx);
    const db = await getMongoDb();

    // 1. Insert the raw event record
    await db.collection(COLLECTIONS.generationEvents).insertOne(event as any);

    // 2. Build $set — always includes the timestamp fields; conditionally
    //    includes the per-run outcome fields.
    const set: Record<string, unknown> = {
      lastRunAt: event.finishedAt,
      updatedAt: event.finishedAt,
    };

    if (schedule !== null) {
      set["schedule"] = schedule;
    }
    if (event.created > 0) {
      set["lastAddedAt"] = event.finishedAt;
      set["lastAddedSource"] = event.source;
      set["lastAddedCount"] = event.created;
    }
    if (event.status === "error" && event.created === 0) {
      set["lastFailedAt"] = event.finishedAt;
    }

    // 3. Build $setOnInsert — null-defaults for every rollup field that is
    //    NOT already in $set for this call.  This avoids the Mongo "path
    //    conflict" error that occurs when the same key appears in both
    //    $set and $setOnInsert.
    const nullDefaults: Record<string, null> = {
      lastAddedAt: null,
      lastAddedSource: null,
      lastAddedCount: null,
      lastFailedAt: null,
      schedule: null,
    };
    const setOnInsert: Record<string, null> = {};
    for (const key of Object.keys(nullDefaults)) {
      if (!(key in set)) {
        setOnInsert[key] = null;
      }
    }

    await db.collection(COLLECTIONS.siteStats).updateOne(
      { _id: event.siteDomain as any },
      {
        $set: set,
        $inc: { totalCreated: event.created },
        $setOnInsert: setOnInsert,
      },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] recordGeneration failed (non-fatal): ${msg}`);
  }
}

/**
 * Persists an image generation callback outcome to MongoDB.
 *
 * Failure-isolated — any Mongo error is caught and logged; the caller
 * never sees an exception from this function.
 */
export async function recordImageGenEvent(event: ImageGenEvent): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.imageGenEvents).insertOne(event as any);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stats] recordImageGenEvent failed (non-fatal): ${msg}`);
  }
}
