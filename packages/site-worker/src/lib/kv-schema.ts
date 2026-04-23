import type { ResolvedConfig } from '@atomic-platform/shared-types';

/**
 * KV key schema v1 for the site-worker.
 *
 * All keys are strings; all values are JSON.
 *
 * Writers: the Phase 5 GitHub → KV sync workflow (and the manual
 * scripts/seed-kv.ts for development).
 *
 * Readers: the Worker — middleware.ts plus page route handlers.
 */

/** Hostname → siteId redirect. Thin on purpose — keeps the lookup cheap
 *  and lets a site have multiple hostnames without duplicating config. */
export interface SiteLookup {
  siteId: string;
}

/** Full resolved config for a site. Produced by the yaml-to-kv mapper. */
export type SiteConfig = ResolvedConfig;

/** Minimal article metadata used by the homepage + category listings.
 *  The full article body lives at `article:<siteId>:<slug>`. */
export interface ArticleIndexEntry {
  slug: string;
  title: string;
  description?: string;
  author: string;
  publishDate: string;
  featuredImage?: string;
  tags: string[];
  type: 'listicle' | 'how-to' | 'review' | 'standard';
  status: 'draft' | 'review' | 'published';
}

/** Article stored body (markdown, already parsed-out frontmatter).
 *  Frontmatter is duplicated here for detail-page rendering without a
 *  second KV hop. */
export interface ArticleRecord {
  frontmatter: ArticleIndexEntry;
  body: string; // raw markdown body
}

/** Sync audit record — lets operators see which git sha is live in KV. */
export interface SyncStatus {
  gitSha: string;
  committedAt: string;
  syncedAt: string;
  ok: boolean;
  error?: string;
}

// ---------- Key builders ----------

export const siteLookupKey = (hostname: string): string => `site:${hostname}`;
export const siteConfigKey = (siteId: string): string => `site-config:${siteId}`;
export const siteConfigPrevKey = (siteId: string): string => `site-config-prev:${siteId}`;
export const articleIndexKey = (siteId: string): string => `article-index:${siteId}`;
export const articleKey = (siteId: string, slug: string): string => `article:${siteId}:${slug}`;
export const syncStatusKey = (siteId: string): string => `sync-status:${siteId}`;
