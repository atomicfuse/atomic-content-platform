/** Content Aggregator reads for the Grid bundle sync (scripts/seed-grid.ts). */
import type { AggregatorItem } from './grid-bundles';

const DEFAULT_BASE = 'https://content-aggregator-v2-34cd.atomic.cloudgrid.io';

/** CONTENT_API_BASE_URL first — CloudGrid injects a stale CONTENT_AGGREGATOR_URL (CLAUDE.md #20). */
export function aggregatorBase(env: NodeJS.ProcessEnv): string {
  const raw = env.CONTENT_API_BASE_URL || env.CONTENT_AGGREGATOR_URL || DEFAULT_BASE;
  return raw.replace(/\/+$/, '').replace(/\/api$/, '');
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`[seed-grid] ${url} → ${res.status}`);
  return res.json();
}

/** Active items of one bundle, up to maxPages × 100. Throws on any non-2xx so the caller skips the bundle. */
export async function fetchBundleItems(base: string, bundleId: string, fetchFn: typeof fetch = fetch, maxPages = 3): Promise<AggregatorItem[]> {
  const items: AggregatorItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/api/content?bundle_id=${encodeURIComponent(bundleId)}&status=active&enriched=true&page_size=100&page=${page}`;
    const body = (await getJson(url, fetchFn)) as { items?: AggregatorItem[]; total_pages?: number };
    const pageItems = body.items ?? [];
    items.push(...pageItems);
    if (pageItems.length === 0 || page >= (body.total_pages ?? 1)) break;
  }
  return items;
}

/** id → bundle name for the index's `name`; an empty map on failure (names are cosmetic). */
export async function fetchBundleNames(base: string, fetchFn: typeof fetch = fetch): Promise<Map<string, string>> {
  try {
    const body = (await getJson(`${base}/api/bundles?page_size=100`, fetchFn)) as { items?: Array<{ id: string; name: string }> };
    return new Map((body.items ?? []).map((b) => [b.id, b.name]));
  } catch (err) {
    console.warn('[seed-grid] bundle names unavailable:', err instanceof Error ? err.message : err);
    return new Map();
  }
}
