export interface ReferenceItem {
  id: string;
  name: string;
}

const CACHE_KEY_AUDIENCES = "atl:audiences";
const CACHE_KEY_VERTICALS = "atl:verticals";

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

export async function getVerticals(): Promise<ReferenceItem[]> {
  const cached = getCached(CACHE_KEY_VERTICALS);
  if (cached) return cached;
  const res = await fetch("/api/verticals");
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const list = extractItems(data);
  if (list.length > 0) setCache(CACHE_KEY_VERTICALS, list);
  return list;
}
