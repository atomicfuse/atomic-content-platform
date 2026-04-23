export interface ReferenceItem {
  id: string;
  name: string;
}

const CACHE_KEY_AUDIENCES = "atl:audiences";
const CACHE_KEY_VERTICALS = "atl:verticals:v2";

function getCached(key: string): ReferenceItem[] | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReferenceItem[];
  } catch {
    return null;
  }
}

function setCache(key: string, data: ReferenceItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(data));
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
  vertical_id: string;
}

export interface TagItem {
  id: string;
  name: string;
  vertical_id?: string;
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

/** Fetch categories for a vertical. No localStorage cache — depends on verticalId param. */
export async function getCategories(verticalId: string): Promise<CategoryItem[]> {
  if (!verticalId) return [];
  const res = await fetch(`/api/categories?vertical_id=${verticalId}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string; iab_code?: string; vertical_id?: string };
      if (obj.id && obj.name) {
        return { id: obj.id, name: obj.name, iab_code: obj.iab_code ?? "", vertical_id: obj.vertical_id ?? "" };
      }
      return null;
    })
    .filter((x): x is CategoryItem => x !== null);
}

/** Fetch tags for a vertical. Includes usage_count. */
export async function getTags(verticalId: string): Promise<TagItem[]> {
  if (!verticalId) return [];
  const res = await fetch(`/api/tags?vertical_id=${verticalId}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string; vertical_id?: string; usage_count?: number };
      if (obj.id && obj.name) {
        return { id: obj.id, name: obj.name, vertical_id: obj.vertical_id, usage_count: obj.usage_count };
      }
      return null;
    })
    .filter((x): x is TagItem => x !== null);
}
