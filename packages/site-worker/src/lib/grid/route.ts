const PASSTHROUGH_EXACT = new Set(['/ads.txt', '/robots.txt', '/sitemap.xml', '/sitemap-index.xml']);
const HAS_FILE_EXTENSION = /\/[^/]+\.[a-z0-9]+$/i;

/**
 * Maps a public Grid-site path to its internal `/grid/*` route, or null when the request
 * must be served by the existing shared routes (server islands, static files, ads.txt, v1 API).
 */
export function toGridPath(pathname: string): string | null {
  if (pathname.startsWith('/_') || pathname.startsWith('/api/v1/')) return null;
  if (PASSTHROUGH_EXACT.has(pathname) || HAS_FILE_EXTENSION.test(pathname)) return null;
  // Note: already-internal paths are served directly by src/pages/grid/* — never double-prefix.
  if (pathname === '/grid' || pathname.startsWith('/grid/')) return null;
  return pathname === '/' ? '/grid' : `/grid${pathname}`;
}

/** Inverse of toGridPath — the path the visitor actually sees (for active pills, links). */
export function publicPath(pathname: string): string {
  if (pathname === '/grid' || pathname === '/grid/') return '/';
  return pathname.startsWith('/grid/') ? pathname.slice('/grid'.length) : pathname;
}
