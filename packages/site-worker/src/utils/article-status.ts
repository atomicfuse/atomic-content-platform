/**
 * Article status filtering.
 *
 * Staging builds include both "published" and "review" articles so reviewers
 * can preview them. Production builds only include "published" articles.
 *
 * IS_STAGING is set at build time in astro.config.mjs via process.env.IS_STAGING.
 * The deploy:staging script sets IS_STAGING=true; deploy:production does not.
 */

const isStaging: boolean = import.meta.env.IS_STAGING === true || import.meta.env.IS_STAGING === 'true';

const VISIBLE_STATUSES: Set<string> = isStaging
  ? new Set(['published', 'review'])
  : new Set(['published']);

export function isVisibleArticle(status: string): boolean {
  return VISIBLE_STATUSES.has(status);
}
