import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDashboardIndex(): Promise<Array<Record<string, unknown>>> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.dashboardIndex).find({ status: { $ne: "deleted" } }).sort({ domain: 1 }).toArray();
}

export async function getDashboardEntry(domain: string): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.dashboardIndex).findOne({ domain });
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
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
