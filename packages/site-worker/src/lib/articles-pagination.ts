export function sliceForPage<T>(all: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.floor(page));
  const initialCount = pageSize * 2;
  if (safePage === 1) return all.slice(0, initialCount);
  const start = initialCount + (safePage - 2) * pageSize;
  return all.slice(start, start + pageSize);
}
