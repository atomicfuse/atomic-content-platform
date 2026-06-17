import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";
import type { DashboardIndex, DashboardSiteEntry, DeletedSiteEntry } from "@/types/dashboard";

function useMongoReads(): boolean {
  return process.env.USE_MONGO_READS === "true";
}

// ---------------------------------------------------------------------------
// Reads (feature-flagged: USE_MONGO_READS → MongoDB, else Git fallback)
// ---------------------------------------------------------------------------

/**
 * Read the full dashboard index. Returns the same DashboardIndex shape
 * regardless of whether data comes from MongoDB or Git.
 *
 * When USE_MONGO is true, reconstructs the DashboardIndex from MongoDB docs.
 * When false, delegates to the Git-based readDashboardIndex.
 *
 * The `opts.fresh` parameter is passed through to the Git fallback. When
 * reading from MongoDB, data is always fresh (no caching layer).
 */
export async function getDashboardIndex(
  opts?: { fresh?: boolean },
): Promise<DashboardIndex> {
  if (!useMongoReads()) {
    const { readDashboardIndex } = await import("../github.js");
    return readDashboardIndex(opts);
  }
  const db = await getMongoDb();
  const allDocs = await db
    .collection(COLLECTIONS.dashboardIndex)
    .find({})
    .sort({ domain: 1 })
    .toArray();

  const sites: DashboardSiteEntry[] = [];
  const deleted: DeletedSiteEntry[] = [];

  for (const doc of allDocs) {
    // Strip MongoDB _id and updatedAt before casting
    const { _id, updatedAt, ...rest } = doc as Record<string, unknown>;
    if (rest.status === "deleted" || (rest as Record<string, unknown>).deleted_at) {
      deleted.push(rest as unknown as DeletedSiteEntry);
    } else if (rest.status !== "permanently_deleted") {
      sites.push(rest as unknown as DashboardSiteEntry);
    }
  }

  return { sites, deleted };
}

export async function getDashboardEntry(domain: string): Promise<Record<string, unknown> | null> {
  if (!useMongoReads()) {
    const { readDashboardIndex } = await import("../github.js");
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (site) return site as unknown as Record<string, unknown>;
    const del = index.deleted?.find((s) => s.domain === domain);
    if (del) return del as unknown as Record<string, unknown>;
    return null;
  }
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.dashboardIndex).findOne({ domain });
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
// These ALWAYS write to MongoDB regardless of the feature flag.
// ---------------------------------------------------------------------------

export async function upsertDashboardIndexEntry(domain: string, entry: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.dashboardIndex).updateOne(
      { domain },
      { $set: { ...entry, domain, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertDashboardIndexEntry failed (${domain}): ${msg}`);
  }
}

export async function updateDashboardIndexEntry(domain: string, update: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.dashboardIndex).updateOne(
      { domain },
      { $set: { ...update, updatedAt: new Date() } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] updateDashboardIndexEntry failed (${domain}): ${msg}`);
  }
}

export async function addToDeleteHistory(domain: string, historyEntry: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.dashboardIndex).updateOne(
      { domain },
      {
        $set: { status: "permanently_deleted", updatedAt: new Date() },
        $push: { history: historyEntry } as any,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] addToDeleteHistory failed (${domain}): ${msg}`);
  }
}
