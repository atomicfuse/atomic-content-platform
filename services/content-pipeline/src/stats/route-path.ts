/** Parse a /site-stats request path → { kind: "all" } | { kind: "one", domain } | null (not a site-stats path). */
export function parseSiteStatsPath(pathname: string): { kind: "all" } | { kind: "one"; domain: string } | null {
  if (pathname === "/site-stats") return { kind: "all" };
  if (pathname.startsWith("/site-stats/")) {
    const domain = decodeURIComponent(pathname.slice("/site-stats/".length));
    return domain ? { kind: "one", domain } : { kind: "all" };
  }
  return null;
}
