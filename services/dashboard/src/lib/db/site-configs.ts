import { getMongoDb } from "../mongo";
import { COLLECTIONS } from "./collections";

function useMongoReads(): boolean {
  return process.env.USE_MONGO_READS === "true";
}

// ---------------------------------------------------------------------------
// domain vs siteId
//
// `site_configs` is keyed on the siteId — the site folder name. For sites
// scaffolded from CSV import that is the domain with its TLD stripped
// ("buzzsoaps"), while the config's own `domain` field holds the real hostname
// ("buzzsoaps.com"). Writing the key over `config.domain` silently reverted
// every corrected domain, because the dashboard reads the config back from
// Mongo and serialises it into site.yaml. The real hostname is therefore kept
// in a separate `site_domain` field and restored on read.
// ---------------------------------------------------------------------------

/** True when `value` carries a TLD, i.e. is a hostname rather than a siteId. */
function isRealDomain(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const lastDot = value.lastIndexOf(".");
  return lastDot > 0 && lastDot < value.length - 1;
}

/** Shape the `$set` payload so the Mongo key never overwrites the real domain. */
export function buildSiteConfigDoc(
  siteId: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const doc: Record<string, unknown> = { ...config, domain: siteId, updatedAt: new Date() };
  if (isRealDomain(config.domain)) doc.site_domain = config.domain;
  return doc;
}

/** Inverse of `buildSiteConfigDoc`: strip Mongo internals, restore the domain. */
function restoreSiteConfigDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, updatedAt, site_domain, ...rest } = doc;
  void _id;
  void updatedAt;
  if (isRealDomain(site_domain)) rest.domain = site_domain;
  return rest;
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
    const { readSiteConfig } = await import("../github");
    return readSiteConfig(domain, branch);
  }
  const db = await getMongoDb();
  const doc = await db.collection(COLLECTIONS.siteConfigs).findOne({ domain });
  if (!doc) return null;
  return restoreSiteConfigDoc(doc as Record<string, unknown>);
}

export async function listSiteConfigs(): Promise<Array<Record<string, unknown>>> {
  if (!useMongoReads()) {
    // No direct Git equivalent for listing all configs — return empty.
    // This function is only used by reconciliation/admin tooling.
    return [];
  }
  const db = await getMongoDb();
  const docs = await db.collection(COLLECTIONS.siteConfigs).find({}).sort({ domain: 1 }).toArray();
  return docs.map((doc) => restoreSiteConfigDoc(doc as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Writes (soft-fail: log warning, never throw)
// These ALWAYS write to MongoDB regardless of the feature flag.
// ---------------------------------------------------------------------------

/**
 * Upsert a site's config.
 *
 * `siteId` is the site folder name (the collection's key), NOT the hostname —
 * `config.domain` is the hostname and is preserved verbatim.
 */
export async function upsertSiteConfig(siteId: string, config: Record<string, unknown>): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection(COLLECTIONS.siteConfigs).updateOne(
      { domain: siteId },
      { $set: buildSiteConfigDoc(siteId, config) },
      { upsert: true },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[db] upsertSiteConfig failed (${siteId}): ${msg}`);
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
