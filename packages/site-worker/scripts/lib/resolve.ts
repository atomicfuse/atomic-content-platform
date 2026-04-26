/**
 * Pure helpers used by `scripts/seed-kv.ts` (and by the unit tests).
 * Anything in this file must be:
 *   - synchronous OR pure-promise (no fs / network / wrangler calls);
 *   - deterministic given identical inputs;
 *   - importable by both the script and `vitest` without extra setup.
 *
 * Side-effecting helpers (file copy, KV writes, etc.) live in seed-kv.ts.
 */
import { parse as parseYaml } from 'yaml';

// ---------- Deep merge ----------

/**
 * Deep-merge two objects. Arrays in `b` REPLACE arrays in `a` (matching
 * the legacy site-builder semantics for `ad_placements`).
 *
 * `null` and `undefined` in `b` do NOT override values in `a` — they're
 * treated as "no value", which lets us splat optional layer overrides
 * over a defaulted base without erasing keys.
 *
 * `ads_txt` should ideally be additive across layers but this MVP keeps
 * replacement semantics — tracked in `docs/backlog/general.md` as a
 * Phase-7 follow-up.
 */
export function deepMerge(a: unknown, b: unknown): unknown {
  if (b === undefined || b === null) return a;
  if (
    typeof a !== 'object'
    || typeof b !== 'object'
    || Array.isArray(a)
    || Array.isArray(b)
    || a === null
  ) {
    return b;
  }
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    out[k] = deepMerge((a as Record<string, unknown>)[k], v);
  }
  return out;
}

// ---------- Frontmatter ----------

export interface FrontmatterSplit {
  front: Record<string, unknown>;
  body: string;
}

/**
 * Splits a markdown file with optional YAML frontmatter into its parts.
 * Returns `{ front: {}, body: raw }` if there's no frontmatter or the
 * delimiters don't match. Tolerates CRLF.
 */
export function splitFrontmatter(raw: string): FrontmatterSplit {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { front: {}, body: raw };
  const front = (parseYaml(match[1] ?? '') as Record<string, unknown> | null) ?? {};
  return { front, body: match[2] ?? '' };
}

// ---------- Asset URL rewriting ----------

/**
 * Rewrites `/assets/...` references in HTML to `/<siteId>/assets/...` so
 * they resolve against the per-site bundle dir under `public/<siteId>/assets/`.
 *
 * Touches `src=`, `href=`, and markdown-style `(/assets/...)`. Leaves
 * absolute URLs (`https://…/assets/…`) and other paths untouched.
 *
 * Idempotent — calling twice with the same siteId is a no-op (the
 * already-prefixed path doesn't match `/assets/` at the start).
 */
export function rewriteAssetUrls(html: string, siteId: string): string {
  const prefix = `/${siteId}/assets/`;
  return html
    .replace(/(\bsrc\s*=\s*["'])\/assets\//g, `$1${prefix}`)
    .replace(/(\bhref\s*=\s*["'])\/assets\//g, `$1${prefix}`)
    .replace(/(\()\/assets\//g, `$1${prefix}`);
}

/**
 * Rewrites a single URL field (e.g. `frontmatter.featuredImage`) the same
 * way `rewriteAssetUrls` does for HTML. Returns `undefined` for
 * `undefined`/missing input so callers don't have to guard.
 */
export function rewriteFrontmatterUrl(url: string | undefined, siteId: string): string | undefined {
  if (!url) return url;
  if (url.startsWith('/assets/')) return `/${siteId}/assets${url.slice('/assets'.length)}`;
  return url;
}
