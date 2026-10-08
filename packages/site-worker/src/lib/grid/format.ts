/** HTML-escapes text for attribute or element content. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** dazzr-style relative age: 1m, 5h, 5d, 3w, 4mo, 2y. Future dates clamp to 1m; invalid → ''. */
export function formatAge(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const minutes = Math.max(1, Math.floor((now.getTime() - t) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** "Read full story" target on the source site's production host. */
export function buildOutboundUrl(hostname: string, slug: string, gridHost: string, utm: boolean): string {
  const url = new URL(`https://${hostname}/${encodeURIComponent(slug)}`);
  if (utm) {
    url.searchParams.set('utm_source', gridHost);
    url.searchParams.set('utm_medium', 'grid');
  }
  return url.toString();
}

/**
 * "Read full story" on the publisher's site for an aggregator story. Publishers aren't network sites, so
 * the link never carries UTM tags — ours are never added and any `utm_*` already in the feed URL is removed.
 * Null for anything that isn't an absolute http(s) URL — the page then omits the button.
 */
export function buildExternalOutboundUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  for (const key of [...u.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) u.searchParams.delete(key);
  }
  return u.toString();
}
