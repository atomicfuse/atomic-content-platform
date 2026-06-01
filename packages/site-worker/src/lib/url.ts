/**
 * Resolves a possibly-relative image URL to an absolute URL suitable for
 * og:image and twitter:image meta tags. Social media scrapers (Facebook,
 * Twitter) cannot resolve relative paths — they need full https:// URLs.
 *
 * Returns undefined for falsy input so callers don't emit empty meta tags.
 */
export function toAbsoluteImageUrl(
  url: string | undefined,
  siteBaseUrl: string,
): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('//')) return url;
  const base = siteBaseUrl.endsWith('/') ? siteBaseUrl.slice(0, -1) : siteBaseUrl;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}
