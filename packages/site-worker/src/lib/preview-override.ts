/**
 * Preview-site override for staging environments.
 *
 * Lets a developer view ANY seeded siteId via the workers.dev URL by
 * appending `?_atl_site=<siteId>` once. The middleware sets a cookie
 * (`atl_preview_site`) so subsequent navigation within the tab keeps
 * the override. `?_atl_site=clear` removes the cookie.
 *
 * Gated to workers.dev hostnames so production custom domains can't
 * accidentally render a different tenant — the hostname → site mapping
 * in KV remains the only source of truth in production.
 *
 * Pure functions; testable without a runtime.
 */

const QUERY_PARAM = '_atl_site';
const COOKIE_NAME = 'atl_preview_site';
const COOKIE_MAX_AGE_SECS = 60 * 60; // 1 hour

export interface PreviewDecision {
  /** The siteId to render, if a preview override is in effect.
   *  `null` means: no override, fall through to normal hostname lookup. */
  siteIdOverride: string | null;
  /** A `Set-Cookie` header value to attach to the response, if the
   *  middleware should persist or clear the cookie. `null` means leave
   *  cookies alone. */
  setCookie: string | null;
}

export interface PreviewInputs {
  hostname: string;
  searchParams: URLSearchParams;
  cookieHeader: string | null;
}

/**
 * Hostnames where the preview override is honoured. We allow:
 *   - `*.workers.dev`   — Cloudflare-managed dev URLs (the staging Worker)
 *   - `localhost`       — local `wrangler dev`
 * Everything else (real custom domains in production) ignores the param,
 * keeping the hostname-to-site mapping authoritative.
 */
export function isPreviewableHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname.endsWith('.workers.dev')) return true;
  return false;
}

/** Reads a single cookie value out of a `Cookie:` header string. */
export function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const raw of header.split(/;\s*/)) {
    const eq = raw.indexOf('=');
    if (eq < 0) continue;
    if (raw.slice(0, eq).trim() === name) {
      return decodeURIComponent(raw.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Resolves the preview decision. Pure function — middleware passes the
 * raw inputs in, gets the override siteId + Set-Cookie value out.
 *
 *   - `?_atl_site=clear` on a previewable host → clears the cookie.
 *   - `?_atl_site=<id>` on a previewable host → uses <id>; sets cookie.
 *   - cookie present + previewable host + no query → uses cookie value.
 *   - non-previewable host → ignored (returns null + null).
 *   - empty / missing inputs → no override.
 */
export function resolvePreview(inputs: PreviewInputs): PreviewDecision {
  if (!isPreviewableHost(inputs.hostname)) {
    return { siteIdOverride: null, setCookie: null };
  }

  const queryValue = inputs.searchParams.get(QUERY_PARAM);

  if (queryValue === 'clear') {
    return {
      siteIdOverride: null,
      setCookie: `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    };
  }

  if (queryValue && /^[a-z0-9][a-z0-9._-]*$/i.test(queryValue)) {
    return {
      siteIdOverride: queryValue,
      setCookie: `${COOKIE_NAME}=${encodeURIComponent(queryValue)}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECS}; HttpOnly; SameSite=Lax`,
    };
  }

  // No query — fall back to cookie if present.
  const cookieValue = parseCookie(inputs.cookieHeader, COOKIE_NAME);
  if (cookieValue && /^[a-z0-9][a-z0-9._-]*$/i.test(cookieValue)) {
    return { siteIdOverride: cookieValue, setCookie: null };
  }

  return { siteIdOverride: null, setCookie: null };
}
