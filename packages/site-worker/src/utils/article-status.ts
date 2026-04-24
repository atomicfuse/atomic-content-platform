/**
 * Article status filtering.
 *
 * Staging builds include both "published" and "review" articles so reviewers
 * can preview them. Production builds only include "published" articles.
 *
 * Staging is detected via CF_PAGES_BRANCH (set by Cloudflare Pages) or the
 * explicit STAGING env var — both resolved at build time in astro.config.mjs.
 */

const isStaging: boolean = import.meta.env.IS_STAGING === true || import.meta.env.IS_STAGING === 'true';

const VISIBLE_STATUSES: Set<string> = isStaging
  ? new Set(['published', 'review'])
  : new Set(['published']);

export function isVisibleArticle(status: string): boolean {
  return VISIBLE_STATUSES.has(status);
}
