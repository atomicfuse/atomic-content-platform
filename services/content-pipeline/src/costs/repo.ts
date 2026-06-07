import { getMongoDb } from "../lib/mongo.js";
import { COST_COLLECTIONS, type SiteCosts, type ModelRollup } from "./types.js";
import { priceForModel } from "./pricing.js";

export interface ModelCostEntry {
  model: string;
  tokensUse: { input: number; output: number };
  images: number;
  costForToken: { input?: number; output?: number; perImage?: number } | null;
  costUsd: number;
  estimated: boolean;
}

export interface SiteCostsResponse {
  siteDomain: string;
  totalCostUsd: number;
  byModel: ModelCostEntry[];
  windows: { thisWeekUsd: number; last30dUsd: number };
}

/**
 * Returns the start of the ISO week (Monday 00:00:00.000 UTC) containing `now`.
 * Matches the definition in stats/repo.ts — kept as a local copy to avoid coupling.
 *
 * Example: now = 2026-06-10 (Wednesday) → 2026-06-08T00:00:00.000Z (Monday)
 * Example: now = 2026-06-07 (Sunday)    → 2026-06-01T00:00:00.000Z (Monday 6 days earlier)
 */
function startOfWeek(now: Date): Date {
  const d = new Date(now);
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Convert a byModel map from the rollup doc → ModelCostEntry array. */
function rollupToEntries(byModel: Record<string, ModelRollup>): ModelCostEntry[] {
  return Object.entries(byModel).map(([model, rollup]) => ({
    model,
    tokensUse: { input: rollup.inputTokens, output: rollup.outputTokens },
    images: rollup.images,
    costForToken: priceForModel(model),
    costUsd: rollup.costUsd,
    estimated: rollup.estimated,
  }));
}

/**
 * Sum `costUsd` from `cost_events` for a given domain where `at >= since`.
 */
async function sumCostWindow(domain: string, since: Date): Promise<number> {
  const db = await getMongoDb();
  const result = await db
    .collection(COST_COLLECTIONS.costEvents)
    .aggregate<{ total: number }>([
      { $match: { siteDomain: domain, at: { $gte: since } } },
      { $group: { _id: null, total: { $sum: "$costUsd" } } },
    ])
    .toArray();
  return result[0]?.total ?? 0;
}

/**
 * Read the `site_costs` rollup for `domain` and aggregate `cost_events` for the
 * time windows:
 *
 *   windows.thisWeekUsd  — sum of costUsd since startOfWeek(now) (Monday UTC)
 *   windows.last30dUsd   — sum of costUsd in the last 30 days
 *
 * If no site_costs doc exists, returns totalCostUsd 0 and byModel [].
 */
export async function getSiteCosts(
  domain: string,
  now: Date,
): Promise<SiteCostsResponse> {
  const db = await getMongoDb();

  const rollup = await db
    .collection(COST_COLLECTIONS.siteCosts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .findOne<SiteCosts>({ _id: domain as any });

  const weekStart = startOfWeek(now);
  const cutoff30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [thisWeekUsd, last30dUsd] = await Promise.all([
    sumCostWindow(domain, weekStart),
    sumCostWindow(domain, cutoff30d),
  ]);

  return {
    siteDomain: domain,
    totalCostUsd: rollup?.totalCostUsd ?? 0,
    byModel: rollup ? rollupToEntries(rollup.byModel) : [],
    windows: { thisWeekUsd, last30dUsd },
  };
}

/**
 * Returns one SiteCostsResponse per document in the `site_costs` collection.
 */
export async function getAllSiteCosts(now: Date): Promise<SiteCostsResponse[]> {
  const db = await getMongoDb();
  const docs = await db
    .collection(COST_COLLECTIONS.siteCosts)
    .find<{ _id: string }>({}, { projection: { _id: 1 } })
    .toArray();
  return Promise.all(docs.map((doc) => getSiteCosts(doc._id, now)));
}
