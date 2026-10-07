import type { ExternalStoryRecord } from '@atomic-platform/shared-types';
import { AGGREGATOR_SOURCE_ID } from '../kv-schema';
import { isCategoryBlocked } from './feed';

/** "<title-slug>-<24-hex item id>" — anything else is rejected before any KV read. */
const SLUG_RE = /^([a-z0-9-]*?)-?([0-9a-f]{24})$/;

/** Splits an external story URL segment into its title slug and item id; null for anything else. */
export function parseExternalSlug(param: string): { itemId: string; slugPart: string } | null {
  const m = SLUG_RE.exec(param);
  return m ? { itemId: m[2]!, slugPart: m[1]! } : null;
}

/** Canonical story path for an external story. */
export function externalStoryPath(r: Pick<ExternalStoryRecord, 'slug' | 'id'>): string {
  return `/story/${AGGREGATOR_SOURCE_ID}/${r.slug}-${r.id}`;
}

/**
 * What the external story route should do for a URL segment and the record found for its id.
 * Stories in a category the site blocks are 404 (spec D5, as revised: never shown on this site).
 */
export function resolveExternalRequest(
  param: string,
  record: ExternalStoryRecord | null,
  blockedCategories: readonly string[] = [],
  /** Request query string ("?…") — kept on the 301 so ?_atl_site (staging preview) and UTM tags survive. */
  search = '',
): { kind: 'ok'; record: ExternalStoryRecord } | { kind: 'redirect'; location: string } | { kind: 'not_found' } {
  const parsed = parseExternalSlug(param);
  if (!parsed || !record || record.id !== parsed.itemId) return { kind: 'not_found' };
  if (isCategoryBlocked(record.categories, blockedCategories)) return { kind: 'not_found' };
  if (parsed.slugPart !== record.slug) return { kind: 'redirect', location: `${externalStoryPath(record)}${search}` };
  return { kind: 'ok', record };
}
