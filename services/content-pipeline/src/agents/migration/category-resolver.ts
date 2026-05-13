export interface AggregatorCategory {
  _id: string;
  name: string;
  iab_code?: string;
  parent_id: string | null;
}

interface ResolvedCategories {
  verticalId: string;
  verticalName: string;
  categoryIds: string[];
  bundleId: string | null;
}

function getAggregatorApiBase(): string {
  const raw =
    process.env.CONTENT_API_BASE_URL ??
    process.env.CONTENT_AGGREGATOR_URL ??
    "https://content-aggregator-v2-34cd.atomic.cloudgrid.io";
  return raw.replace(/\/api\/?$/, "");
}

export async function fetchVerticals(): Promise<AggregatorCategory[]> {
  const base = getAggregatorApiBase();
  const res = await fetch(
    `${base}/api/categories?parent_id=null&active=true&page_size=200`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch verticals: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { results: AggregatorCategory[] };
  return data.results;
}

export async function fetchSubcategories(
  parentId: string,
): Promise<AggregatorCategory[]> {
  const base = getAggregatorApiBase();
  const res = await fetch(
    `${base}/api/categories?parent_id=${encodeURIComponent(parentId)}&active=true&page_size=200`,
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch subcategories for ${parentId}: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as { results: AggregatorCategory[] };
  return data.results;
}

export function matchVertical(
  name: string,
  verticals: AggregatorCategory[],
): AggregatorCategory | null {
  const exact = verticals.find((v) => v.name === name);
  if (exact) return exact;

  const lower = name.toLowerCase();
  const fuzzy = verticals.find((v) => v.name.toLowerCase().includes(lower));
  return fuzzy ?? null;
}

export function matchSubcategories(
  names: string[],
  available: AggregatorCategory[],
): AggregatorCategory[] {
  const matched: AggregatorCategory[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const found = available.find(
      (c) =>
        c.name === name || c.name.toLowerCase().includes(lower),
    );
    if (found && !matched.some((m) => m._id === found._id)) {
      matched.push(found);
    }
  }
  return matched;
}

export async function createBundle(
  name: string,
  verticalId: string,
  categoryIds: string[],
): Promise<string | null> {
  const base = getAggregatorApiBase();
  const payload = {
    name,
    description: `Content bundle for ${name}`,
    active: true,
    rules: {
      category_ids: [verticalId, ...categoryIds.filter((id) => id !== verticalId)],
      tag_ids: [],
    },
  };

  const res = await fetch(`${base}/api/bundles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.status === 409) {
    const retryPayload = { ...payload, name: `${name} (2)` };
    const retry = await fetch(`${base}/api/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(retryPayload),
    });
    if (!retry.ok) return null;
    const retryData = (await retry.json()) as { _id: string };
    return retryData._id;
  }

  if (!res.ok) return null;
  const data = (await res.json()) as { _id: string };
  return data._id;
}

export async function resolveCategories(
  websiteCategory: string,
  subCategoryNames: string[],
  siteName: string,
): Promise<ResolvedCategories | null> {
  const verticals = await fetchVerticals();
  const vertical = matchVertical(websiteCategory, verticals);
  if (!vertical) return null;

  const subcategories = await fetchSubcategories(vertical._id);
  let matched = matchSubcategories(subCategoryNames, subcategories);

  // If no subcategories matched, use ALL available
  if (matched.length === 0) {
    matched = subcategories;
  }

  const categoryIds = matched.map((c) => c._id);
  const bundleId = await createBundle(siteName, vertical._id, categoryIds);

  return {
    verticalId: vertical._id,
    verticalName: vertical.name,
    categoryIds,
    bundleId,
  };
}
