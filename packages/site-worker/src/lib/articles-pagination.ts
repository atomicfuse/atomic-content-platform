/**
 * Legacy slice used by non-homepage callers (kept for backward compat).
 * Page 1 returns the first `pageSize * 2` items; later pages return
 * `pageSize` items each, starting after that initial batch.
 */
export function sliceForPage<T>(all: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.floor(page));
  const initialCount = pageSize * 2;
  if (safePage === 1) return all.slice(0, initialCount);
  const start = initialCount + (safePage - 2) * pageSize;
  return all.slice(start, start + pageSize);
}

/**
 * Homepage "More on …" slicer.
 * Page 1 returns the first `initialSize` items.
 * Page N >= 2 returns the next `loadMoreSize` items per click.
 * Page < 1 returns an empty array.
 */
export function sliceMoreOn<T>(
  moreOn: T[],
  page: number,
  initialSize: number,
  loadMoreSize: number,
): T[] {
  if (!Number.isFinite(page) || page < 1) return [];
  const p = Math.floor(page);
  if (p === 1) return moreOn.slice(0, initialSize);
  const start = initialSize + (p - 2) * loadMoreSize;
  return moreOn.slice(start, start + loadMoreSize);
}

/**
 * Whether a "Show More" click on the given page would yield more items.
 * Mirrors `sliceMoreOn`'s page semantics — invalid pages return false,
 * and non-integer pages are floored, exactly like `sliceMoreOn`.
 */
export function hasMoreOnAfter<T>(
  moreOn: T[],
  page: number,
  initialSize: number,
  loadMoreSize: number,
): boolean {
  if (!Number.isFinite(page) || page < 1) return false;
  const p = Math.floor(page);
  if (p === 1) return moreOn.length > initialSize;
  return moreOn.length > initialSize + (p - 1) * loadMoreSize;
}
