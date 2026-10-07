/**
 * Article redirects (renamed slugs, e.g. brand-safety renames): an article lists its old slugs in
 * `redirect_from:`; seed-kv writes `redirect:<siteId>:<old>` → { to: <slug> } and the article
 * routes 301 an old URL to the new one.
 */
import { redirectKey } from '../../src/lib/kv-schema';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Old slugs from an article's frontmatter (`redirect_from`: string or list). */
export function parseRedirectFrom(front: Record<string, unknown>): string[] {
  const raw = front.redirect_from;
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return list.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter((v) => SLUG_RE.test(v));
}

/** KV entries for every old slug. A slug that is itself a live article is never redirected. */
export function redirectEntries(
  siteId: string, articles: ReadonlyArray<{ slug: string; from: readonly string[] }>, liveSlugs: ReadonlySet<string>,
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const a of articles) {
    for (const old of a.from) {
      if (old === a.slug || liveSlugs.has(old)) continue;
      out.push({ key: redirectKey(siteId, old), value: JSON.stringify({ to: a.slug }) });
    }
  }
  return out;
}
