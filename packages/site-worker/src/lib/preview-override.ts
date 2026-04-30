/**
 * Preview-site override for staging environments.
 *
 * Lets a developer view ANY seeded siteId via the workers.dev URL by
 * appending `?_atl_site=<siteId>`. The middleware injects a small
 * inline script that propagates `_atl_site` on every internal link
 * click, keeping the override scoped per browser tab.
 *
 * The previous cookie-based approach (`atl_preview_site`) caused
 * cross-tab leakage: opening site B in a second tab overwrote the
 * cookie, so returning to the first tab (site A) resolved the wrong
 * content. Cookies are global per domain and cannot be scoped per tab.
 *
 * `?_atl_site=clear` emits a deletion cookie to clean up stale
 * cookies left by the old mechanism.
 *
 * Gated to workers.dev hostnames so production custom domains can't
 * accidentally render a different tenant — the hostname → site mapping
 * in KV remains the only source of truth in production.
 *
 * Pure functions; testable without a runtime.
 */

const QUERY_PARAM = '_atl_site';
const COOKIE_NAME = 'atl_preview_site';

export interface PreviewDecision {
  /** The siteId to render, if a preview override is in effect.
   *  `null` means: no override, fall through to normal hostname lookup. */
  siteIdOverride: string | null;
  /** A `Set-Cookie` header value to attach to the response, if the
   *  middleware should clear the legacy cookie. `null` means leave
   *  cookies alone. */
  setCookie: string | null;
}

export interface PreviewInputs {
  hostname: string;
  searchParams: URLSearchParams;
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
 *   - `?_atl_site=clear` on a previewable host → clears the legacy cookie.
 *   - `?_atl_site=<id>` on a previewable host → uses <id>; clears legacy cookie.
 *   - no query param → no override (cookie fallback removed).
 *   - non-previewable host → ignored (returns null + null).
 *   - empty / missing inputs → no override.
 */
export function resolvePreview(inputs: PreviewInputs): PreviewDecision {
  if (!isPreviewableHost(inputs.hostname)) {
    return { siteIdOverride: null, setCookie: null };
  }

  const queryValue = inputs.searchParams.get(QUERY_PARAM);
  const deletionCookie = `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

  if (queryValue === 'clear') {
    return { siteIdOverride: null, setCookie: deletionCookie };
  }

  if (queryValue && /^[a-z0-9][a-z0-9._-]*$/i.test(queryValue)) {
    // Override active — also clear any legacy cookie so old tabs don't
    // pick up a stale value if the user still has the cookie from before
    // this fix was deployed.
    return { siteIdOverride: queryValue, setCookie: deletionCookie };
  }

  return { siteIdOverride: null, setCookie: null };
}

/**
 * Generates a small inline `<script>` that rewrites all internal `<a>`
 * hrefs to carry `?_atl_site=<siteId>`. This keeps the preview context
 * scoped to the browser tab (each tab's URLs carry their own siteId)
 * instead of relying on a domain-wide cookie.
 *
 * Handles:
 *   - Static links rendered by Astro (articles, nav, footer, pagination)
 *   - Dynamically-updated hrefs (e.g. LoadMoreButton.astro JS)
 *   - Skips external links and links that already carry `_atl_site`
 */
export function generatePreviewScript(siteId: string): string {
  // Escape for safe embedding in a single-quoted JS string.
  const escaped = siteId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `<script data-atl-preview>(function(){var s='${escaped}';document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;try{var u=new URL(a.href);if(u.origin!==location.origin)return;if(u.searchParams.has('_atl_site'))return;u.searchParams.set('_atl_site',s);a.href=u.pathname+u.search+u.hash}catch(x){}},true)})()</script>`;
}
