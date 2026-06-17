"use server";

import {
  readDashboardIndex,
  readArticles,
  readFileContent,
  commitSiteFiles,
  deleteFilesFromBranch,
  triggerWorkflowViaPush,
  copySiteTreeToMain,
  invalidateSiteCaches,
} from "@/lib/github";
import { readArticlesWithKVFallback } from "@/lib/kv-api";
import { WORKER_STAGING_URL } from "@/lib/constants";
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

    const articles = await readArticlesWithKVFallback(site.domain, branch, readArticles);
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

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";

function getAgentUrl(): string {
  if (process.env.NODE_ENV === "development" && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
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
    invalidateSiteCaches(domain, branch, { keepDashboardIndex: true });

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

    // 4. If site is Live or Ready → merge staging to main
    if (hasChanges && site?.staging_branch && (site.status === "Live" || site.status === "Ready")) {
      const mergeMsg = `review: merge ${domain} staging → main (${actualApproved} approved, ${rejected.length} rejected)`;
      await mergeOrCopySiteToMain(domain, site.staging_branch, mergeMsg);
    }

    const parts: string[] = [];
    if (actualApproved > 0) parts.push(`${actualApproved} approved`);
    const skipped = approved.length - actualApproved;
    if (skipped > 0) parts.push(`${skipped} not found on branch`);
    if (rejected.length > 0) parts.push(`${rejected.length} rejected`);
    summaryParts.push(`${domain}: ${parts.join(", ")}`);

    invalidateSiteCaches(domain, branch);
    revalidatePath(`/sites/${domain}`);
  }


  // Fire-and-forget: decrement review counts in MongoDB
  for (const [domain, { approved, rejected }] of byDomain) {
    const decrementCount = approved.length + rejected.length;
    if (decrementCount > 0) {
      fetch(`${getAgentUrl()}/review-counts/decrement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, count: decrementCount }),
        signal: AbortSignal.timeout(5_000),
      }).catch((err) =>
        console.warn(`[review] Failed to update review count for ${domain}:`, err),
      );
    }
  }
  revalidatePath("/review");

  return {
    summary: summaryParts.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Publish helpers — scoped tree copy (never merges entire branch)
// ---------------------------------------------------------------------------

async function mergeOrCopySiteToMain(
  domain: string,
  stagingBranch: string,
  commitMessage: string,
): Promise<void> {
  // Uses the Git Tree API: one recursive tree fetch to get all blob SHAs,
  // then creates a new commit on main referencing those SHAs directly.
  // This is O(1) reads instead of O(N) per-file reads, avoiding gateway
  // timeouts on sites with 100+ articles.
  await copySiteTreeToMain(domain, stagingBranch, commitMessage);
}
