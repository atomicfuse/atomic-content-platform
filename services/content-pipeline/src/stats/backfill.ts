/**
 * One-time idempotent backfill of MongoDB stats from scheduler/history.json.
 *
 * Run via: pnpm tsx src/stats/backfill.ts
 */

import { getMongoDb, closeMongo } from "../lib/mongo.js";
import { COLLECTIONS } from "./types.js";
import type { GenerationEvent, GenerationSource, RunStatus, SiteStats } from "./types.js";
import type { SchedulerRunEntry } from "../agents/scheduled-publisher/history.js";

export interface BackfillResult {
  eventsUpserted: number;
  sitesRebuilt: number;
}

/**
 * Upserts GenerationEvents for each (entry, site) pair using a deterministic
 * _id = `${entry.timestamp}:${site.domain}`, then rebuilds site_stats for
 * every affected domain by aggregating from generation_events.
 *
 * Safe to run multiple times — the upsert logic means re-running produces
 * exactly the same DB state.
 */
export async function backfillFromHistory(
  entries: SchedulerRunEntry[],
): Promise<BackfillResult> {
  const db = await getMongoDb();
  const eventsCol = db.collection(COLLECTIONS.generationEvents);
  const statsCol = db.collection(COLLECTIONS.siteStats);

  // Collect all unique domains so we know which rollups to rebuild.
  const affectedDomains = new Set<string>();

  let eventsUpserted = 0;

  for (const entry of entries) {
    const runTime = new Date(entry.timestamp);

    for (const site of entry.sites) {
      const id = `${entry.timestamp}:${site.domain}`;
      affectedDomains.add(site.domain);

      const failed = Math.max(site.articlesRequested - site.articlesCreated, 0);

      const event: GenerationEvent & { _id: string } = {
        _id: id,
        siteDomain: site.domain,
        source: "scheduler" as GenerationSource,
        forced: entry.forced,
        topicName: null,
        requested: site.articlesRequested,
        created: site.articlesCreated,
        failed,
        status: site.status as RunStatus,
        message: site.message ?? null,
        startedAt: runTime,
        finishedAt: runTime,
      };

      const result = await eventsCol.updateOne(
        { _id: id as any },
        { $set: event as any },
        { upsert: true },
      );

      if (result.upsertedCount > 0 || result.modifiedCount > 0) {
        eventsUpserted++;
      }
    }
  }

  // Rebuild site_stats for each affected domain by aggregating all events.
  for (const domain of affectedDomains) {
    const domainEvents = await eventsCol
      .find({ siteDomain: domain })
      .toArray() as unknown as Array<GenerationEvent & { _id: string }>;

    // totalCreated = sum of created
    const totalCreated = domainEvents.reduce((sum, e) => sum + e.created, 0);

    // lastRunAt = max finishedAt
    const lastRunAt = domainEvents.reduce<Date>((max, e) => {
      return e.finishedAt > max ? e.finishedAt : max;
    }, new Date(0));

    // events with created > 0 → pick max finishedAt for lastAddedAt
    const createdEvents = domainEvents.filter((e) => e.created > 0);
    let lastAddedAt: Date | null = null;
    let lastAddedSource: GenerationSource | null = null;
    let lastAddedCount: number | null = null;

    if (createdEvents.length > 0) {
      const best = createdEvents.reduce((prev, cur) =>
        cur.finishedAt > prev.finishedAt ? cur : prev,
      );
      lastAddedAt = best.finishedAt;
      lastAddedSource = best.source;
      lastAddedCount = best.created;
    }

    // events with status === "error" && created === 0 → lastFailedAt
    const failedEvents = domainEvents.filter(
      (e) => e.status === "error" && e.created === 0,
    );
    let lastFailedAt: Date | null = null;
    if (failedEvents.length > 0) {
      lastFailedAt = failedEvents.reduce((max, e) =>
        e.finishedAt > max ? e.finishedAt : max,
      new Date(0));
    }

    // updatedAt = max finishedAt (deterministic)
    const updatedAt = lastRunAt;

    const statsDoc: SiteStats = {
      _id: domain,
      lastRunAt,
      lastAddedAt,
      lastAddedSource,
      lastAddedCount,
      lastFailedAt,
      totalCreated,
      schedule: null,  // history.json has no preferred_days; fills on first real run
      updatedAt,
    };

    await statsCol.updateOne(
      { _id: domain as any },
      { $set: statsDoc as any },
      { upsert: true },
    );
  }

  return {
    eventsUpserted,
    sitesRebuilt: affectedDomains.size,
  };
}

/** ESM "is main module" guard — only executes when run directly. */
async function main(): Promise<void> {
  const { createOctokit, readFile } = await import("../lib/github.js");
  const { loadConfig } = await import("../lib/config.js");

  const config = loadConfig();
  const octokit = createOctokit(config.github);
  const raw = await readFile(octokit, config.networkRepo, "scheduler/history.json", "main");
  const entries: SchedulerRunEntry[] = JSON.parse(raw) as SchedulerRunEntry[];

  console.log(`[backfill] Loaded ${entries.length} history entries`);
  const result = await backfillFromHistory(entries);
  console.log(
    `[backfill] Done — eventsUpserted=${result.eventsUpserted}, sitesRebuilt=${result.sitesRebuilt}`,
  );

  await closeMongo();
}

// Only run when executed directly (not on import)
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("[backfill] Fatal:", err);
    process.exit(1);
  });
}
