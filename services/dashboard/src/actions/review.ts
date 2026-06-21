"use server";

import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { readArticlesFromDb } from "@/lib/db/articles";
import {
  readFileContent,
  commitSiteFiles,
  deleteFilesFromBranch,
  triggerWorkflowViaPush,
  copySiteTreeToMain,
  invalidateTreeCache,
} from "@/lib/github";
import { WORKER_STAGING_URL, R2_BUCKET_PROD, getKvNamespaces } from "@/lib/constants";
import { bulkDeleteKV, deleteR2Objects } from "@/lib/cloudflare";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { revalidatePath } from "next/cache";
import type { ArticleEntry } from "@/types/dashboard";
import { upsertArticlesMeta, deleteArticlesMeta } from "@/lib/db/articles";

/**
 * Fetch all articles flagged for review across all sites.
 */
export interface ReviewArticle extends ArticleEntry {
  domain: string;
  /** Worker preview base URL — origin only (e.g.,
   *  "https://atomic-site-worker-staging.accounts-4a8.workers.dev"). Caller
   *  appends `/<slug>?_atl_site=<domain>` to build the article preview
   *  link. Replaces the pre-Phase-7 `*.pages.dev` URL pattern; the
   *  staging Pages projects no longer exist. */
  stagingBaseUrl: string | null;
  /** Git branch where the article lives */
  branch: string | null;
}

export async function getReviewQueue(): Promise<ReviewArticle[]> {
  const index = await readDashboardIndex();

  const reviewArticles: ReviewArticle[] = [];

  for (const site of index.sites) {
    const branch = site.staging_branch ?? undefined;
    // Worker preview origin. Articles in review live on `staging/<domain>`
    // — sync-kv.yml writes those to staging KV (CONFIG_KV_STAGING) on
    // push, and the staging Worker reads from there. The site-id override
    // is appended by the consumer (per-article path).
    const stagingBaseUrl = site.staging_branch ? WORKER_STAGING_URL : null;

    const articles = await readArticlesFromDb(site.domain, branch);
    for (const article of articles) {
      if (article.status !== "review") continue;
      reviewArticles.push({
        ...article,
        domain: site.domain,
        stagingBaseUrl,
        branch: site.staging_branch ?? null,
      });
    }
  }

  return reviewArticles;
}

/**
 * Apply all review decisions in one batch.
 *
 * Per domain:
 * 1. ONE commitSiteFiles() for all approved articles (Git Data API — no webhook)
 * 2. ONE deleteFilesFromBranch() for all rejected articles (Git Data API — no webhook)
 * 3. ONE triggerWorkflowViaPush() to fire Cloudflare build
 * 4. If site is Live/Ready → merge staging to main
 */
export async function applyReviewDecisions(decisions: {
  approved: Array<{ domain: string; slug: string }>;
  rejected: Array<{ domain: string; slug: string }>;
}): Promise<{ summary: string }> {
  const index = await readDashboardIndex();

  // Group all decisions by domain
  const byDomain = new Map<string, { approved: string[]; rejected: string[] }>();

  for (const { domain, slug } of decisions.approved) {
    const entry = byDomain.get(domain) ?? { approved: [], rejected: [] };
    entry.approved.push(slug);
    byDomain.set(domain, entry);
  }
  for (const { domain, slug } of decisions.rejected) {
    const entry = byDomain.get(domain) ?? { approved: [], rejected: [] };
    entry.rejected.push(slug);
    byDomain.set(domain, entry);
  }

  const summaryParts: string[] = [];

  for (const [domain, { approved, rejected }] of byDomain) {
    const site = index.sites.find((s) => s.domain === domain);
    const branch = site?.staging_branch ?? "main";

    // Force fresh tree read — the tree cache (Infinity TTL) may be stale if
    // content-pipeline committed new articles since the last dashboard tree
    // fetch. Without this, readFileContent() returns null for articles that
    // exist on Git but aren't in the cached tree, silently skipping them.
    invalidateTreeCache(branch);

    // 1. Update approved articles' frontmatter → status: published
    let actualApproved = 0;
    if (approved.length > 0) {
      const fileUpdates: Array<{ path: string; content: string }> = [];

      for (const slug of approved) {
        const path = `sites/${domain}/articles/${slug}.md`;
        const content = await readFileContent(path, branch);
        if (!content) {
          console.warn(`[review] Article not found on ${branch}: ${path}`);
          continue;
        }

        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!fmMatch) {
          console.warn(`[review] Could not parse frontmatter: ${path}`);
          continue;
        }

        const frontmatter = parseYaml(fmMatch[1]!) as Record<string, unknown>;
        const body = fmMatch[2] ?? "";

        frontmatter.status = "published";
        frontmatter.reviewer_notes = "Approved via review queue.";

        const newFm = stringifyYaml(frontmatter, { lineWidth: 0 });
        fileUpdates.push({ path, content: `---\n${newFm}---\n${body}` });
      }

      actualApproved = fileUpdates.length;
      if (fileUpdates.length > 0) {
        await commitSiteFiles(
          domain,
          fileUpdates,
          `review: approve ${fileUpdates.length} article${fileUpdates.length > 1 ? "s" : ""}`,
          branch,
        );

        // Dual-write approved articles to MongoDB (soft-fail)
        await upsertArticlesMeta(
          approved
            .filter((slug) => fileUpdates.some((f) => f.path.endsWith(`/${slug}.md`)))
            .map((slug) => ({
              domain,
              slug,
              branch,
              frontmatter: { status: "published" },
            })),
        );
      }
    }

    // 2. Delete rejected articles
    if (rejected.length > 0) {
      const filePaths = rejected.map((slug) => `sites/${domain}/articles/${slug}.md`);
      await deleteFilesFromBranch(filePaths, branch);

      // Dual-write: delete rejected articles from MongoDB (soft-fail)
      await deleteArticlesMeta(domain, rejected, branch);
    }

    // Only trigger build + merge if something actually changed
    const hasChanges = actualApproved > 0 || rejected.length > 0;

    // 3. ONE build trigger per domain
    if (hasChanges && site?.staging_branch) {
      await triggerWorkflowViaPush(site.staging_branch, domain);
    }

    // 4. If site is Live or Ready → merge staging to main + clean up deleted articles
    if (hasChanges && site?.staging_branch && (site.status === "Live" || site.status === "Ready")) {
      const mergeMsg = `review: merge ${domain} staging → main (${actualApproved} approved, ${rejected.length} rejected)`;
      const deletedSlugs = await mergeOrCopySiteToMain(domain, site.staging_branch, mergeMsg);
      await cleanupDeletedArticles(domain, deletedSlugs, site.staging_branch);
    }

    const parts: string[] = [];
    if (actualApproved > 0) parts.push(`${actualApproved} approved`);
    const skipped = approved.length - actualApproved;
    if (skipped > 0) parts.push(`${skipped} not found on branch`);
    if (rejected.length > 0) parts.push(`${rejected.length} rejected`);
    summaryParts.push(`${domain}: ${parts.join(", ")}`);

    revalidatePath(`/sites/${domain}`);
  }


  revalidatePath("/review");

  return {
    summary: summaryParts.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Publish helpers — scoped tree copy (never merges entire branch)
// ---------------------------------------------------------------------------

/** Returns the slugs of articles that were deleted on staging (and now removed from main). */
async function mergeOrCopySiteToMain(
  domain: string,
  stagingBranch: string,
  commitMessage: string,
): Promise<string[]> {
  // Uses the Git Tree API: one recursive tree fetch to get all blob SHAs,
  // then creates a new commit on main referencing those SHAs directly.
  // This is O(1) reads instead of O(N) per-file reads, avoiding gateway
  // timeouts on sites with 100+ articles.
  return copySiteTreeToMain(domain, stagingBranch, commitMessage);
}

/** Best-effort cleanup of deleted articles after publishing to production.
 *  Order: prod KV → MongoDB → R2 images (R2 last so the live site never
 *  shows broken images if an earlier step fails). */
async function cleanupDeletedArticles(
  domain: string,
  deletedSlugs: string[],
  stagingBranch?: string,
): Promise<void> {
  if (deletedSlugs.length === 0) return;

  console.log(
    `[review] Cleaning up ${deletedSlugs.length} deleted articles for ${domain}`,
  );

  // Delete from production KV (article stops being served)
  let prodKvOk = true;
  try {
    const kv = getKvNamespaces(domain);
    const kvKeys = deletedSlugs.map((slug) => `article:${domain}:${slug}`);
    await bulkDeleteKV(kv.prod, kvKeys, domain);
  } catch (err) {
    prodKvOk = false;
    console.warn(
      `[review] Failed to delete prod KV entries for ${domain}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // If prod KV deletion failed the articles are still being served —
  // skip MongoDB + R2 to avoid broken images on the live site.
  if (!prodKvOk) return;

  // Delete from MongoDB — both main and staging branch records (soft-fail)
  await deleteArticlesMeta(domain, deletedSlugs, "main");
  if (stagingBranch) {
    await deleteArticlesMeta(domain, deletedSlugs, stagingBranch);
  }

  // Delete R2 images last
  try {
    const keys = deletedSlugs.map((s) => `${domain}/assets/images/${s}.webp`);
    await deleteR2Objects(R2_BUCKET_PROD, keys, domain);
  } catch (err) {
    console.warn(
      `[review] Failed to delete R2 images for ${domain}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
