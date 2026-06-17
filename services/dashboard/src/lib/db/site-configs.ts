import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getSiteConfig(domain: string): Promise<Record<string, unknown> | null> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.siteConfigs).findOne({ domain }) as Promise<Record<string, unknown> | null>;
}

export async function listSiteConfigs(): Promise<Array<Record<string, unknown>>> {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.siteConfigs).find({}).sort({ domain: 1 }).toArray();
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
// ---------------------------------------------------------------------------

export async function upsertSiteConfig(domain: string, config: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.siteConfigs).updateOne(
      { domain },
      { $set: { ...config, domain, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertSiteConfig failed (${domain}): ${msg}`);
  }
}

export async function deleteSiteConfig(domain: string): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.siteConfigs).deleteOne({ domain });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] deleteSiteConfig failed (${domain}): ${msg}`);
  }
}
