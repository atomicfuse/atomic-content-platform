/**
 * Pure helpers + shared types for the bulk "Publish changes" flow on the
 * Sites page. The server route (`/api/sites/pending-changes`) feeds GitHub
 * compare output through `summarisePendingFiles`; the client modal consumes
 * the resulting `PendingChangesResponse`.
 */

import type { SiteStatus } from "@/types/dashboard";

/** GitHub's compare API returns at most this many files per response. */
export const GITHUB_COMPARE_FILE_CAP = 300;

/** The subset of a GitHub compare `files[]` entry we rely on. */
export interface CompareFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export interface PendingFile {
  filename: string;
  status: string;
}

export interface PendingSummary {
  files: PendingFile[];
  added: number;
  modified: number;
  removed: number;
  /** Slugs of articles that publishing will delete from the live site. */
  deletedArticles: string[];
  /** True when GitHub hit its file cap, so the list may be incomplete. */
  truncated: boolean;
}

export interface PendingSite extends PendingSummary {
  domain: string;
  status: SiteStatus;
}

export interface PendingScanError {
  domain: string;
  message: string;
}

export interface PendingChangesResponse {
  scannedAt: string;
  /** Number of eligible sites that were compared (with or without changes). */
  scanned: number;
  sites: PendingSite[];
  errors: PendingScanError[];
  /** `?domain=` mode only: whether that site is still Ready/Live with a staging branch. */
  eligible?: boolean;
}

/** Sites the flow considers: published at least once and has a staging branch. */
export function isPublishEligible(site: {
  status: SiteStatus;
  staging_branch: string | null;
}): boolean {
  return (site.status === "Ready" || site.status === "Live") && Boolean(site.staging_branch);
}

function articleSlug(domain: string, path: string): string | null {
  const prefix = `sites/${domain}/articles/`;
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return null;
  const rest = path.slice(prefix.length, -".md".length);
  // Only direct children of articles/ are articles.
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest;
}

/**
 * Summarise one site's pending staging changes from a GitHub compare
 * `files[]` list. Only files under `sites/<domain>/` count, mirroring the
 * `staging-status` route (staging branches can carry other domains' files
 * from batch operations).
 */
export function summarisePendingFiles(domain: string, files: CompareFile[]): PendingSummary {
  const prefix = `sites/${domain}/`;
  const own = files.filter((f) => f.filename.startsWith(prefix));

  let added = 0;
  let modified = 0;
  let removed = 0;
  const deleted: string[] = [];

  for (const f of own) {
    if (f.status === "added" || f.status === "copied") {
      added++;
    } else if (f.status === "removed") {
      removed++;
      const slug = articleSlug(domain, f.filename);
      if (slug) deleted.push(slug);
    } else {
      // modified / changed / renamed / unchanged all read as "changed".
      modified++;
      if (f.status === "renamed" && f.previous_filename) {
        // A renamed article disappears from main under its old slug, so the
        // publish's tree copy deletes it from the live site.
        const oldSlug = articleSlug(domain, f.previous_filename);
        if (oldSlug && oldSlug !== articleSlug(domain, f.filename)) deleted.push(oldSlug);
      }
    }
  }

  return {
    files: own.map((f) => ({ filename: f.filename, status: f.status })),
    added,
    modified,
    removed,
    deletedArticles: deleted,
    truncated: files.length >= GITHUB_COMPARE_FILE_CAP,
  };
}

/**
 * Article deletions in a fresh re-check that the user did not see (and so
 * did not confirm) during review. Publishing must not proceed with these.
 */
export function unconfirmedDeletions(reviewed: string[], fresh: string[]): string[] {
  const seen = new Set(reviewed);
  return fresh.filter((slug) => !seen.has(slug));
}
