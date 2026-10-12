/**
 * Ids that look like site folders in R2/KV but belong to the platform: `authors` (author portraits at
 * /authors/assets/*) and `aggregator` (Grid's external stories). No site may be created or renamed to them.
 */
const RESERVED_SITE_IDS: ReadonlySet<string> = new Set(["authors", "aggregator"]);

export function isReservedSiteId(id: string): boolean {
  return RESERVED_SITE_IDS.has(id.toLowerCase());
}
