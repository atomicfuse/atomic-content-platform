export interface ReferenceItem {
  id: string;
  name: string;
}

const CACHE_KEY_AUDIENCES = "atl:audiences:v3";
const CACHE_KEY_VERTICALS = "atl:verticals:v3";
/** localStorage TTL — 1 hour. Prevents stale IDs from persisting across aggregator migrations. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Stale keys from previous versions — removed on first load. */
const STALE_KEYS = ["atl:audiences", "atl:verticals:v2", "atl:audiences:v2"];

function purgeStaleKeys(): void {
  if (typeof window === "undefined") return;
  for (const key of STALE_KEYS) {
    localStorage.removeItem(key);
  }
}

interface CacheEntry<T> {
  ts: number;
  data: T;
}

function getCached(key: string): ReferenceItem[] | null {
  if (typeof window === "undefined") return null;
  purgeStaleKeys();
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as CacheEntry<ReferenceItem[]>;
    if (!entry.ts || Date.now() - entry.ts > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function setCache(key: string, data: ReferenceItem[]): void {
  if (typeof window === "undefined") return;
  const entry: CacheEntry<ReferenceItem[]> = { ts: Date.now(), data };
  localStorage.setItem(key, JSON.stringify(entry));
}

/** Extract { id, name } pairs from a paginated API response ({ items: [...] }). */
function extractItems(data: unknown): ReferenceItem[] {
  const items = (data as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string };
      if (obj.id && obj.name) return { id: obj.id, name: obj.name };
      return null;
    })
    .filter((x): x is ReferenceItem => x !== null);
}

export async function getAudiences(): Promise<ReferenceItem[]> {
  const cached = getCached(CACHE_KEY_AUDIENCES);
  if (cached) return cached;
  const res = await fetch("/api/audiences");
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const list = extractItems(data);
  if (list.length > 0) setCache(CACHE_KEY_AUDIENCES, list);
  return list;
}

export interface VerticalItem extends ReferenceItem {
  iab_code: string;
}

export interface CategoryItem {
  id: string;
  name: string;
  iab_code: string;
  parent_id: string | null;
}

export interface TagItem {
  id: string;
  name: string;
  usage_count?: number;
}

export async function getVerticals(): Promise<VerticalItem[]> {
  const cached = getCached(CACHE_KEY_VERTICALS);
  if (cached) return cached as VerticalItem[];
  const res = await fetch("/api/verticals");
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const items = (data as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const list = items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string; iab_code?: string };
      if (obj.id && obj.name) {
        return { id: obj.id, name: obj.name, iab_code: obj.iab_code ?? "" };
      }
      return null;
    })
    .filter((x): x is VerticalItem => x !== null);
  if (list.length > 0) setCache(CACHE_KEY_VERTICALS, list);
  return list;
}

/** Fetch child categories for a tier-1 (parent) category. No localStorage cache — depends on parentId param. */
export async function getCategories(parentId: string): Promise<CategoryItem[]> {
  if (!parentId) return [];
  const res = await fetch(`/api/categories?parent_id=${parentId}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map(parseCategoryItem)
    .filter((x): x is CategoryItem => x !== null);
}

/** Walk all pages of a paginated aggregator list endpoint at the documented
 *  max `page_size` of 100. `basePath` is a dashboard proxy path (e.g.
 *  "/api/categories?active=true") with everything EXCEPT page/page_size.
 *  Returns [] if the first page fails. Bounded by a high safety ceiling. */
async function fetchAllPages(basePath: string, maxPages = 50): Promise<unknown[]> {
  const sep = basePath.includes("?") ? "&" : "?";
  const all: unknown[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const res = await fetch(`${basePath}${sep}page=${page}&page_size=100`);
    if (!res.ok) {
      if (page === 1) return [];
      break;
    }
    const data = (await res.json()) as { items?: unknown[]; total_pages?: number };
    if (!Array.isArray(data.items)) break;
    all.push(...data.items);
    totalPages = typeof data.total_pages === "number" ? data.total_pages : page;
    if (data.items.length === 0) break;
  }
  return all;
}

/** Fetch ALL categories (tier-1s + every subcategory across the taxonomy).
 *  Paginated at page_size=100 (documented max) — covers the ~524-row taxonomy
 *  plus growth. Used by bundle/topic UIs that pick across multiple tier-1s. */
export async function getAllCategories(): Promise<CategoryItem[]> {
  const items = await fetchAllPages("/api/categories?active=true");
  return items
    .map(parseCategoryItem)
    .filter((x): x is CategoryItem => x !== null);
}

/** Fetch the most-used tags (usage_count desc), bounded by `limit`. Replaces
 *  the old "fetch everything" path which doesn't scale as the tag taxonomy
 *  grows (9k+ and climbing). Niche tags are reachable via `searchTags`, and a
 *  selected topic's exact ids are resolved by id via `resolveTagNames`. */
export async function getTopTags(limit = 300): Promise<TagItem[]> {
  const PAGE_SIZE = 100;
  const maxPages = Math.max(1, Math.ceil(limit / PAGE_SIZE));
  const all: TagItem[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `/api/tags?sort=usage_count&order=desc&include_usage=true&page_size=${PAGE_SIZE}&page=${page}`,
    );
    if (!res.ok) break;
    const data = (await res.json()) as { items?: unknown[] };
    if (!Array.isArray(data.items) || data.items.length === 0) break;
    for (const t of extractTags(data.items)) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        all.push(t);
      }
    }
    if (all.length >= limit || data.items.length < PAGE_SIZE) break;
  }
  return all.slice(0, limit);
}

/** Resolve specific taxonomy ids → names via the aggregator `?ids=` endpoint.
 *  O(selected), not O(taxonomy) — scales regardless of total taxonomy size.
 *  Robust if the endpoint over-returns: we map by id and keep only the
 *  requested ids. Returns {} for empty input (no request). */
async function resolveNames(
  path: string,
  ids: string[],
  extract: (items: unknown[]) => Array<{ id: string; name: string }>,
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const res = await fetch(`${path}?ids=${unique.join(",")}&include_usage=true`);
  if (!res.ok) return {};
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return {};
  const byId = new Map(extract(data.items).map((x) => [x.id, x.name]));
  const out: Record<string, string> = {};
  for (const id of unique) {
    const name = byId.get(id);
    if (name) out[id] = name;
  }
  return out;
}

/** Resolve tag ids → names via `?ids=`. */
export async function resolveTagNames(ids: string[]): Promise<Record<string, string>> {
  return resolveNames("/api/tags", ids, extractTags);
}

/** Resolve category ids → names via `?ids=`. */
export async function resolveCategoryNames(ids: string[]): Promise<Record<string, string>> {
  return resolveNames("/api/categories", ids, (items) =>
    items.map(parseCategoryItem).filter((x): x is CategoryItem => x !== null),
  );
}

function parseCategoryItem(d: unknown): CategoryItem | null {
  const obj = d as { id?: string; name?: string; iab_code?: string; parent_id?: string | null };
  if (obj.id && obj.name) {
    return { id: obj.id, name: obj.name, iab_code: obj.iab_code ?? "", parent_id: obj.parent_id ?? null };
  }
  return null;
}

/** Tag lookup list for pills/selection. Bounded to the most-used tags so it
 *  scales as the tag taxonomy grows (formerly fetched up to 2000 tags
 *  alphabetically — broke past that ceiling). Niche tags are reached via
 *  `searchTags`; a topic's exact selected ids resolve via `resolveTagNames`.
 *  No vertical scoping (dropped 2026-04-29). */
export async function getTags(): Promise<TagItem[]> {
  return getTopTags(300);
}

/** Search tags by name via API. Debounce in the caller. No vertical scoping (dropped 2026-04-29). */
export async function searchTags(search: string): Promise<TagItem[]> {
  if (!search.trim()) return [];
  const qs = new URLSearchParams({ search: search.trim(), page_size: "20" });
  const res = await fetch(`/api/tags?${qs.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return extractTags(data.items);
}

function extractTags(items: unknown[]): TagItem[] {
  return items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string; usage_count?: number };
      if (obj.id && obj.name) {
        const tag: TagItem = { id: obj.id, name: obj.name };
        if (obj.usage_count !== undefined) tag.usage_count = obj.usage_count;
        return tag;
      }
      return null;
    })
    .filter((x): x is TagItem => x !== null);
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

export interface BundleItem {
  id: string;
  name: string;
  description?: string;
  content_count?: number;
  rules: {
    category_ids: string[];
    tag_ids: string[];
  };
}

export async function getBundles(): Promise<BundleItem[]> {
  const res = await fetch("/api/bundles");
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map((d: unknown) => {
      const obj = d as {
        id?: string;
        name?: string;
        description?: string;
        content_count?: number;
        rules?: { category_ids?: string[]; tag_ids?: string[] };
      };
      if (!obj.id || !obj.name) return null;
      const bundle: BundleItem = {
        id: obj.id,
        name: obj.name,
        description: obj.description,
        content_count: obj.content_count,
        rules: {
          category_ids: obj.rules?.category_ids ?? [],
          tag_ids: obj.rules?.tag_ids ?? [],
        },
      };
      return bundle;
    })
    .filter((x): x is BundleItem => x !== null);
}
