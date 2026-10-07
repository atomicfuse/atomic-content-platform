import type { ExternalBundleIndex, GridPoolResponse, NetworkDirectory, ResolvedGridConfig } from '@atomic-platform/shared-types';
import { articleIndexKey, externalIndexKey, networkDirectoryKey, type ArticleIndexEntry } from '../kv-schema';
import { buildPool, type BuiltPool, type ExternalSourceEntries, type SourceArticles } from './feed';
import { resolveBundleSources, resolveSources, type ResolvedSources } from './sources';

/** Minimal KV surface (lets unit tests use a Map-backed fake). */
export interface KvReader {
  get<T>(key: string, type: 'json'): Promise<T | null>;
}

/** Minimal JSON cache surface over the Workers Cache API. */
export interface JsonCache {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/** Cache that never hits — used on staging so Asaf sees changes immediately. */
export const NO_CACHE: JsonCache = { get: async () => null, put: async () => undefined };

/** Workers Cache API adapter; falls back to NO_CACHE outside workerd. */
export function edgeCache(): JsonCache {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return NO_CACHE;
  const req = (key: string): Request => new Request(`https://grid-cache.internal/${encodeURIComponent(key)}`);
  return {
    async get(key) {
      const res = await cache.match(req(key));
      return res ? res.json() : null;
    },
    async put(key, value, ttlSeconds) {
      await cache.put(req(key), new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
      }));
    },
  };
}

/** FNV-1a — stable short hash for cache keys. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Directory + resolution + pool for one Grid site. */
export interface GridPoolData {
  directory: NetworkDirectory | null;
  resolved: ResolvedSources;
  pool: BuiltPool;
  missingIndexes: string[];
}

const EMPTY: Omit<GridPoolData, 'directory'> = {
  resolved: { sources: [], statuses: [], pillsBySite: new Map() },
  pool: { items: [], inactivePins: [] },
  missingIndexes: [],
};

async function safeGet<T>(kv: KvReader, key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key, 'json');
  } catch (error) {
    console.error(`[grid] KV read failed for ${key}`, error);
    return null;
  }
}

/** Loads everything a Grid page needs. Never throws on missing data (empty state instead). */
export async function loadGridPool(kv: KvReader, cache: JsonCache, siteId: string, grid: ResolvedGridConfig, now: Date): Promise<GridPoolData> {
  const directory = await safeGet<NetworkDirectory>(kv, networkDirectoryKey());
  if (!directory) {
    console.error(`[grid] ${networkDirectoryKey()} missing — rendering empty state for ${siteId}`);
    return { directory: null, ...EMPTY };
  }
  const resolved = resolveSources(directory, grid, siteId);
  // Bundle indexes are read before the cache lookup: their updatedAt is part of the cache key, so a
  // fresh sync shows up without waiting for the cache to expire. One KV read per bundle.
  const bundleIndexes = await Promise.all(resolveBundleSources(grid).map(async (b) => ({
    ...b, index: await safeGet<ExternalBundleIndex>(kv, externalIndexKey(b.bundleId)),
  })));
  const external: ExternalSourceEntries[] = bundleIndexes
    .filter((b): b is typeof b & { index: ExternalBundleIndex } => Array.isArray(b.index?.items))
    .map((b) => ({ bundleId: b.bundleId, pills: b.pills, entries: b.index.items }));
  // Bundle-less sites keep exactly the pre-bundle cache key.
  const bundleVersion = bundleIndexes.length ? `${bundleIndexes.map((b) => b.index?.updatedAt ?? '-').join(',')}:` : '';
  const cacheKey = `pool:${siteId}:${directory.generatedAt}:${bundleVersion}${hashString(JSON.stringify(grid))}`;
  const cached = (await cache.get(cacheKey)) as { pool: BuiltPool; missingIndexes: string[] } | null;
  if (cached) return { directory, resolved, ...cached };

  const indexes = await Promise.all(resolved.sources.map(async (s) => ({
    siteId: s.siteId, index: await safeGet<ArticleIndexEntry[]>(kv, articleIndexKey(s.siteId)),
  })));
  const missingIndexes = indexes.filter((r) => !r.index).map((r) => r.siteId);
  for (const missingSiteId of missingIndexes) {
    console.error(`[grid] ${articleIndexKey(missingSiteId)} missing — source skipped for ${siteId}`);
  }
  const sourceArticles: SourceArticles[] = indexes
    .filter((r): r is { siteId: string; index: ArticleIndexEntry[] } => Array.isArray(r.index))
    .map((r) => ({ siteId: r.siteId, pills: resolved.pillsBySite.get(r.siteId) ?? [], articles: r.index }));
  const pool = buildPool(sourceArticles, grid, now, external);
  await cache.put(cacheKey, { pool, missingIndexes }, 300);
  return { directory, resolved, pool, missingIndexes };
}

/** Shapes GridPoolData into the public /api/pool contract. */
export function toPoolResponse(data: GridPoolData, siteId: string, grid: ResolvedGridConfig, now: Date): GridPoolResponse {
  const missing = new Set(data.missingIndexes);
  return {
    siteId,
    generatedAt: now.toISOString(),
    storyMode: grid.story_mode,
    perSiteLimit: grid.per_site_limit,
    directoryGeneratedAt: data.directory?.generatedAt ?? null,
    sources: data.resolved.statuses.map((s) => (missing.has(s.siteId) ? { ...s, included: false, reason: 'missing_index' as const } : s)),
    items: data.pool.items,
    inactivePins: data.pool.inactivePins,
  };
}

/** Adapts the Workers KV binding to KvReader. */
export function kvReader(ns: { get(key: string, type: 'json'): Promise<unknown> }): KvReader {
  return { get: async <T,>(key: string): Promise<T | null> => (await ns.get(key, 'json')) as T | null };
}
