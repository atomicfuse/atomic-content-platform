import { getMongoDb } from "../mongo.js";
import { COLLECTIONS } from "./collections.js";

function useMongoReads(): boolean {
  return process.env.USE_MONGO_READS === "true";
}

// ---------------------------------------------------------------------------
// Reads (feature-flagged: USE_MONGO_READS → MongoDB, else Git fallback)
// ---------------------------------------------------------------------------

/**
 * Read site config (site.yaml) for a domain.
 *
 * The `branch` parameter is respected by the Git fallback (staging vs main).
 * MongoDB stores one config per domain — when USE_MONGO is true, `branch` is
 * ignored (the dual-write layer always writes the latest config).
 */
export async function getSiteConfig(
  domain: string,
  branch?: string,
): Promise<Record<string, unknown> | null> {
  if (!useMongoReads()) {
    const { readSiteConfig } = await import("../github.js");
    return readSiteConfig(domain, branch);
  }
  const db = await getMongoDb();
  const doc = await db.collection(COLLECTIONS.siteConfigs).findOne({ domain });
  if (!doc) return null;
  // Strip MongoDB internals
  const { _id, updatedAt, ...rest } = doc as Record<string, unknown>;
  return rest as Record<string, unknown>;
}

export async function listSiteConfigs(): Promise<Array<Record<string, unknown>>> {
  if (!useMongoReads()) {
    // No direct Git equivalent for listing all configs — return empty.
    // This function is only used by reconciliation/admin tooling.
    return [];
  }
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.siteConfigs).find({}).sort({ domain: 1 }).toArray();
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
// These ALWAYS write to MongoDB regardless of the feature flag.
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
