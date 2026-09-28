import type { GridPoolItem, GridSummaryRecord, GridSummaryStatus } from '@atomic-platform/shared-types';
import { gridSummaryKey } from '../kv-schema';

/**
 * Max items per /api/pool?summaries=1 request that get a summary lookup. A Workers invocation may
 * make at most 1000 KV operations: 1 directory + ~50 article indexes + 300 summaries stays well
 * under that. Items beyond the cap get no `summary` field (the dashboard renders "—").
 */
export const SUMMARY_LOOKUP_LIMIT = 300;

/** Reads one `grid-summary:*` record (null when absent). */
export type SummaryGetter = (key: string) => Promise<GridSummaryRecord | null>;

export function summaryStatusOf(rec: GridSummaryRecord | null): GridSummaryStatus {
  if (!rec) return 'none';
  if (rec.edited && rec.sourceChanged) return 'stale';
  return rec.edited ? 'edited' : 'generated';
}

/**
 * Attaches `summary` status to the first `limit` items. A failed lookup is logged and leaves that
 * item without `summary` — summaries never fail the request.
 */
export async function lookupSummaryStatuses(items: GridPoolItem[], get: SummaryGetter, limit: number = SUMMARY_LOOKUP_LIMIT): Promise<GridPoolItem[]> {
  return Promise.all(items.map(async (item, i): Promise<GridPoolItem> => {
    if (i >= limit) return item;
    try {
      const rec = await get(gridSummaryKey(item.site, item.slug));
      return { ...item, summary: rec ? { status: summaryStatusOf(rec), generatedAt: rec.generatedAt } : { status: 'none' } };
    } catch (err) {
      console.error(`[grid] summary lookup failed for ${item.site}/${item.slug}:`, err instanceof Error ? err.message : err);
      return item;
    }
  }));
}
