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

/** Fetch ALL categories (tier-1s + every subcategory across the taxonomy).
 *  Used by bundle-creation UIs that allow picking subcats across multiple tier-1s. */
export async function getAllCategories(): Promise<CategoryItem[]> {
  const res = await fetch("/api/categories");
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map(parseCategoryItem)
    .filter((x): x is CategoryItem => x !== null);
}

function parseCategoryItem(d: unknown): CategoryItem | null {
  const obj = d as { id?: string; name?: string; iab_code?: string; parent_id?: string | null };
  if (obj.id && obj.name) {
    return { id: obj.id, name: obj.name, iab_code: obj.iab_code ?? "", parent_id: obj.parent_id ?? null };
  }
  return null;
}

/** Fetch the entire tag library by paginating until empty.
 *  Used to populate name-by-id lookups for tag pills (so a site's selected
 *  tag_ids display as names, not raw IDs). The aggregator caps `page_size`
 *  (~100 in practice), so a single fetch isn't enough for large taxonomies;
 *  we walk pages until exhaustion or a safety ceiling.
 *  No vertical scoping (dropped 2026-04-29). */
export async function getTags(): Promise<TagItem[]> {
  const PAGE_SIZE = 100;
  const MAX_PAGES = 20; // safety ceiling — 2000 tags is well past today's taxonomy
  const all: TagItem[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`/api/tags?page_size=${PAGE_SIZE}&page=${page}`);
    if (!res.ok) break;
    const data = (await res.json()) as { items?: unknown[] };
    if (!Array.isArray(data.items) || data.items.length === 0) break;
    const batch = extractTags(data.items);
    let addedThisPage = 0;
    for (const t of batch) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        all.push(t);
        addedThisPage++;
      }
    }
    // If the aggregator returned fewer than a full page OR all items were dups
    // we've seen before, we're done.
    if (data.items.length < PAGE_SIZE || addedThisPage === 0) break;
  }
  return all;
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
