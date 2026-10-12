import type { SiteAuthorAssignment } from '@atomic-platform/shared-types';

/*
 * Author id helpers with NO Astro/worker imports — scripts (seed-kv, seed-authors) run under plain Node, where
 * src/utils/article-status.ts's import.meta.env read would crash at load. Re-exported from ./authors.
 */

/** Author ids are kebab-case slugs, equal to the network repo file name `authors/<id>.yaml`. */
export const AUTHOR_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** site.yaml `authors:` → clean assignments (valid ids, first occurrence wins, trimmed topics). */
export function normalizeSiteAuthors(raw: unknown): SiteAuthorAssignment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SiteAuthorAssignment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || !AUTHOR_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const topics = (entry as { topics?: unknown }).topics;
    out.push({
      id,
      topics: Array.isArray(topics) ? topics.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean) : [],
    });
  }
  return out;
}
