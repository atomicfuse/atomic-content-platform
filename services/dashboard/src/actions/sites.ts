"use server";

import {
  readDashboardIndex,
  updateSiteInIndex,
  removeSiteFromIndex,
  restoreSiteInIndex,
  permanentlyRemoveFromTrash,
  deleteSiteFilesFromRepo,
  deleteBranch,
  branchExists,
  deleteFileFromBranch,
  deleteFilesFromBranch,
  triggerWorkflowViaPush,
} from "@/lib/github";
import {
  deletePagesProject,
  deleteKVEntry,
  deleteKVByPrefix,
  deleteR2ObjectsByPrefix,
  deleteR2Objects,
} from "@/lib/cloudflare";
import {
  R2_BUCKET_PROD,
  getKvNamespaces,
} from "@/lib/constants";
import type { DashboardSiteEntry } from "@/types/dashboard";
import { revalidatePath } from "next/cache";

/** Update dashboard metadata for a site. */
export async function updateSiteEntry(
  domain: string,
  updates: Partial<DashboardSiteEntry>
): Promise<void> {
  await updateSiteInIndex(domain, updates);
  revalidatePath("/");
  revalidatePath(`/sites/${domain}`);
}

/**
 * Delete a site — full cleanup of all resources.
 * 1. Delete staging branch (if exists)
 * 2. Delete site files from git (main branch)
 * 3. Delete CF Pages project (if exists)
 * 4. Remove site from Worker KV (staging + prod)
 * 5. Move to trash in dashboard index
 *
 * Returns a log of what was cleaned up for the UI.
 */
export async function deleteSiteEntry(domain: string): Promise<{
  steps: Array<{ label: string; success: boolean; error?: string }>;
}> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  const steps: Array<{ label: string; success: boolean; error?: string }> = [];

  // 1. Delete staging branch if it exists
  if (site.staging_branch) {
    try {
      const exists = await branchExists(site.staging_branch);
      if (exists) {
        await deleteBranch(site.staging_branch);
      }
      steps.push({ label: `Deleted staging branch: ${site.staging_branch}`, success: true });
    } catch (err) {
      steps.push({
        label: `Delete staging branch: ${site.staging_branch}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // 2. Delete site files from git (main branch)
  try {
    await deleteSiteFilesFromRepo(domain);
    steps.push({ label: "Deleted site files from Git", success: true });
  } catch (err) {
    steps.push({
      label: "Delete site files from Git",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 3. Delete CF Pages project if it exists
  if (site.pages_project) {
    try {
      await deletePagesProject(site.pages_project, domain);
      steps.push({ label: `Deleted CF Pages project: ${site.pages_project}`, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      // CF may return error if project doesn't exist — that's OK
      if (msg.includes("not found") || msg.includes("404")) {
        steps.push({ label: `CF Pages project already gone: ${site.pages_project}`, success: true });
      } else {
        steps.push({
          label: `Delete CF Pages project: ${site.pages_project}`,
          success: false,
          error: msg,
        });
      }
    }
  }

  // 4. Remove site from Worker KV (staging + prod) — best-effort
  // KV siteId is the domain folder name (e.g. "scienceworld"), NOT the
  // numeric site_id from dashboard-index ("6603398636894").
  {
    const siteId = domain;
    const hostnames = [domain, site.custom_domain].filter(Boolean) as string[];
    const kvKeys = [
      ...hostnames.map((h) => `site:${h.toLowerCase()}`),
      `site-config:${siteId}`,
      `article-index:${siteId}`,
      `sync-status:${siteId}`,
    ];
    const kv = getKvNamespaces(domain);
    const namespaces = [
      { id: kv.staging, label: "staging" },
      { id: kv.prod, label: "prod" },
    ];
    let kvDeleted = 0;
    const kvErrors: string[] = [];
    for (const ns of namespaces) {
      for (const key of kvKeys) {
        try {
          await deleteKVEntry(ns.id, key, domain);
          kvDeleted++;
        } catch (err) {
          kvErrors.push(`${ns.label}/${key}: ${err instanceof Error ? err.message : "Unknown"}`);
        }
      }
    }
    if (kvErrors.length === 0) {
      steps.push({ label: `Cleaned ${kvDeleted} Worker KV entries (staging + prod)`, success: true });
    } else {
      steps.push({
        label: `Worker KV cleanup: ${kvDeleted} deleted, ${kvErrors.length} failed`,
        success: kvErrors.length < kvKeys.length * namespaces.length,
        error: kvErrors.join("; "),
      });
    }
  }

  // 4b. Delete article + shared-page + prev-config KV entries by prefix (staging + prod)
  {
    const siteId = domain;
    const prefixes = [
      { prefix: `article:${siteId}:`, label: "articles" },
      { prefix: `shared-page:${siteId}:`, label: "shared pages" },
    ];
    const extraKeys = [`site-config-prev:${siteId}`];
    let totalDeleted = 0;
    const prefixErrors: string[] = [];

    const kv = getKvNamespaces(domain);
    for (const ns of [
      { id: kv.staging, label: "staging" },
      { id: kv.prod, label: "prod" },
    ]) {
      for (const { prefix, label } of prefixes) {
        try {
          const count = await deleteKVByPrefix(ns.id, prefix, domain);
          totalDeleted += count;
        } catch (err) {
          prefixErrors.push(
            `${ns.label}/${label}: ${err instanceof Error ? err.message : "Unknown"}`,
          );
        }
      }
      for (const key of extraKeys) {
        try {
          await deleteKVEntry(ns.id, key, domain);
          totalDeleted++;
        } catch (err) {
          prefixErrors.push(
            `${ns.label}/${key}: ${err instanceof Error ? err.message : "Unknown"}`,
          );
        }
      }
    }

    if (prefixErrors.length === 0) {
      steps.push({
        label: `Cleaned ${totalDeleted} KV entries (articles, shared pages, prev-config)`,
        success: true,
      });
    } else {
      steps.push({
        label: `KV prefix cleanup: ${totalDeleted} deleted, ${prefixErrors.length} errors`,
        success: prefixErrors.length === 0,
        error: prefixErrors.join("; "),
      });
    }
  }

  // 4c. Delete R2 assets (staging + prod buckets) — best-effort
  {
    const siteId = domain;
    let r2Deleted = 0;
    const r2Errors: string[] = [];

    try {
      const count = await deleteR2ObjectsByPrefix(R2_BUCKET_PROD, `${siteId}/`, domain);
      r2Deleted += count;
    } catch (err) {
      r2Errors.push(err instanceof Error ? err.message : "Unknown");
    }

    if (r2Errors.length === 0 && r2Deleted > 0) {
      steps.push({ label: `Deleted ${r2Deleted} R2 assets`, success: true });
    } else if (r2Errors.length === 0) {
      steps.push({ label: "No R2 assets to clean up", success: true });
    } else {
      steps.push({
        label: `R2 cleanup: ${r2Deleted} deleted, ${r2Errors.length} errors`,
        success: r2Errors.length === 0,
        error: r2Errors.join("; "),
      });
    }
  }

  // 5. Move to trash in dashboard index
  try {
    await removeSiteFromIndex(domain);
    steps.push({ label: "Moved to trash in dashboard index", success: true });
  } catch (err) {
    steps.push({
      label: "Move to trash in dashboard index",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");

  return { steps };
}

/** Restore a domain from trash back to the active dashboard. */
export async function restoreSiteEntry(domain: string): Promise<void> {
  await restoreSiteInIndex(domain);
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");
}

/** Build R2 object key for an article's featured image. */
function articleImageKey(domain: string, slug: string): string {
  return `${domain}/assets/images/${slug}.webp`;
}

/** Best-effort deletion of article images from both R2 buckets. */
async function deleteArticleImages(domain: string, slugs: string[]): Promise<void> {
  const keys = slugs.map((s) => articleImageKey(domain, s));
  try {
    await deleteR2Objects(R2_BUCKET_PROD, keys, domain);
  } catch (err) {
    console.warn(
      `[sites] Failed to delete R2 images for ${domain}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Delete a single article from the staging branch and clean up its R2 image. */
export async function deleteArticleFromStaging(
  domain: string,
  slug: string
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);
  if (!site.staging_branch) {
    throw new Error(`No staging branch found for ${domain}`);
  }

  const filePath = `sites/${domain}/articles/${slug}.md`;
  await deleteFileFromBranch(filePath, site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);
  await deleteArticleImages(domain, [slug]);

  revalidatePath(`/sites/${domain}`);
}

/** Delete multiple articles from the staging branch and clean up their R2 images. */
export async function deleteArticlesFromStaging(
  domain: string,
  slugs: string[]
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);
  if (!site.staging_branch) {
    throw new Error(`No staging branch found for ${domain}`);
  }

  const filePaths = slugs.map(
    (slug) => `sites/${domain}/articles/${slug}.md`
  );
  await deleteFilesFromBranch(filePaths, site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);
  await deleteArticleImages(domain, slugs);

  revalidatePath(`/sites/${domain}`);
}

/** Permanently delete a domain — remove from trash AND retry cleanup for anything
 *  the soft delete may have missed. Best-effort: swallows all cleanup errors. */
export async function permanentlyDeleteSite(domain: string): Promise<void> {
  // Retry site file + override file deletion (may already be gone from soft delete)
  try {
    await deleteSiteFilesFromRepo(domain);
  } catch {
    // Files may already be deleted — that's fine
  }

  // Retry KV cleanup (all key patterns)
  const kv = getKvNamespaces(domain);
  for (const nsId of [kv.staging, kv.prod]) {
    try { await deleteKVByPrefix(nsId, `article:${domain}:`, domain); } catch { /* best-effort */ }
    try { await deleteKVByPrefix(nsId, `shared-page:${domain}:`, domain); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `site-config-prev:${domain}`, domain); } catch { /* best-effort */ }
    // Also retry the known keys in case soft delete missed them
    try { await deleteKVEntry(nsId, `site:${domain}`, domain); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `site-config:${domain}`, domain); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `article-index:${domain}`, domain); } catch { /* best-effort */ }
    try { await deleteKVEntry(nsId, `sync-status:${domain}`, domain); } catch { /* best-effort */ }
  }

  // Retry R2 cleanup
  try { await deleteR2ObjectsByPrefix(R2_BUCKET_PROD, `${domain}/`, domain); } catch { /* best-effort */ }

  await permanentlyRemoveFromTrash(domain);
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");
}
