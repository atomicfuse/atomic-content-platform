"use server";

import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import {
  updateSiteInIndex,
  removeSiteFromIndex,
  restoreSiteInIndex,
  permanentlyRemoveFromTrash,
  deleteSiteFilesFromRepo,
  deleteFileFromBranch,
  deleteFilesFromBranch,
  triggerWorkflowViaPush,
  branchExists,
  deleteBranch,
} from "@/lib/github";

import {
  deletePagesProject,
  deleteKVEntry,
  deleteKVByPrefix,
  deleteR2ObjectsByPrefix,
  deleteR2Objects,
  deregisterWorkerCustomDomain,
  getKVEntry,
  putKVEntry,
  bulkDeleteKV,
} from "@/lib/cloudflare";
import {
  R2_BUCKET_PROD,
  getKvNamespaces,
} from "@/lib/constants";
import type { DashboardSiteEntry } from "@/types/dashboard";
import { revalidatePath } from "next/cache";
import { deleteArticleMeta, deleteArticlesMeta, deleteArticlesForSite, upsertArticleMeta, upsertArticlesMeta } from "@/lib/db/articles";
import { deleteSiteConfig } from "@/lib/db/site-configs";
import { updateDashboardIndexEntry, addToDeleteHistory } from "@/lib/db/dashboard-index";

/** Update dashboard metadata for a site. */
export async function updateSiteEntry(
  domain: string,
  updates: Partial<DashboardSiteEntry>
): Promise<void> {
  await updateSiteInIndex(domain, updates);

  // Dual-write: mirror index updates to MongoDB (soft-fail)
  await updateDashboardIndexEntry(domain, updates as Record<string, unknown>);

  revalidatePath("/");
  revalidatePath(`/sites/${domain}`);
}

/**
 * Delete a site — lightweight soft delete. Preserves staging branch, R2
 * assets, and staging KV so the site can be restored from trash.
 * 1. Disconnect custom domain if connected (deregister CF, delete prod KV
 *    hostname, revert config.domain, clear custom_domain on index entry)
 * 2. Delete prod KV hostname entry for siteId (stops domain resolution)
 * 3. Delete site files from Git main (published data only)
 * 4. Delete CF Pages project if it exists (legacy cleanup)
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

  // 1. Disconnect custom domain if connected (domain goes offline)
  if (site.custom_domain) {
    const removedDomain = site.custom_domain;

    // 1a. Deregister from CF worker (best-effort)
    try {
      await deregisterWorkerCustomDomain(removedDomain, domain);
      steps.push({ label: `Deregistered custom domain: ${removedDomain}`, success: true });
    } catch (err) {
      steps.push({
        label: `Deregister custom domain: ${removedDomain}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // 1b. Delete prod KV hostname entry for custom domain
    try {
      const kv = getKvNamespaces(domain);
      await deleteKVEntry(kv.prod, `site:${removedDomain.toLowerCase()}`, domain);
      steps.push({ label: `Deleted KV hostname: site:${removedDomain.toLowerCase()}`, success: true });
    } catch (err) {
      steps.push({
        label: `Delete KV hostname: site:${removedDomain.toLowerCase()}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // 1c. Revert config.domain back to siteId in KV (best-effort)
    // Without this, canonical URLs and og:url in staging preview would reference
    // the disconnected domain. patchSiteConfigDomain is private in wizard.ts,
    // so we inline the KV patch here. site.yaml update is unnecessary since
    // staging branch is preserved and will be correct on restore.
    try {
      const kv = getKvNamespaces(domain);
      const configKey = `site-config:${domain}`;
      for (const ns of [kv.prod, kv.staging]) {
        try {
          const raw = await getKVEntry(ns, configKey, domain);
          if (!raw) continue;
          const config = JSON.parse(raw) as Record<string, unknown>;
          config.domain = domain;
          await putKVEntry(ns, configKey, JSON.stringify(config), domain);
        } catch {
          // best-effort per namespace
        }
      }
      steps.push({ label: "Reverted config.domain to siteId", success: true });
    } catch (err) {
      steps.push({
        label: "Revert config.domain",
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // 1d. Clear custom_domain on site entry before trashing
    // so the trash entry doesn't show a stale domain, and restore
    // doesn't come back with a custom_domain that no longer works.
    site.custom_domain = null;
    site.status = "Ready";
    site.worker_pending_dns = true;
  }

  // 2. Delete prod KV hostname entry for siteId (stops domain resolution)
  {
    const kv = getKvNamespaces(domain);
    try {
      await deleteKVEntry(kv.prod, `site:${domain.toLowerCase()}`, domain);
      steps.push({ label: `Deleted KV hostname: site:${domain.toLowerCase()}`, success: true });
    } catch (err) {
      steps.push({
        label: `Delete KV hostname: site:${domain.toLowerCase()}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // 3. Delete site files from Git main (published data only)
  try {
    await deleteSiteFilesFromRepo(domain);
    steps.push({ label: "Deleted site files from Git main", success: true });
  } catch (err) {
    steps.push({
      label: "Delete site files from Git main",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 4. Delete CF Pages project if it exists (legacy)
  if (site.pages_project) {
    try {
      await deletePagesProject(site.pages_project, domain);
      steps.push({ label: `Deleted CF Pages project: ${site.pages_project}`, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
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

  // 5. Move to trash in dashboard index (staging branch + R2 preserved)
  // Note: site.custom_domain was already cleared in step 1d if it was set,
  // so removeSiteFromIndex will store the entry with custom_domain=null.
  try {
    await removeSiteFromIndex(domain);
    steps.push({ label: "Moved to trash (staging branch + images preserved)", success: true });
  } catch (err) {
    steps.push({
      label: "Move to trash in dashboard index",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // Dual-write: mark as deleted in MongoDB (soft-fail)
  await updateDashboardIndexEntry(domain, { status: "deleted" });

  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");

  return { steps };
}

/** Restore a domain from trash back to the active dashboard. */
export async function restoreSiteEntry(domain: string): Promise<void> {
  await restoreSiteInIndex(domain);

  // Dual-write: mark as restored (Staging) in MongoDB (soft-fail)
  await updateDashboardIndexEntry(domain, { status: "Staging" });

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

/** Delete a single article from the staging branch.
 *  R2 images and production cleanup happen later in publishStagingToProduction
 *  so the live site never shows broken images. */
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

  // 1. Delete from staging branch in Git
  const filePath = `sites/${domain}/articles/${slug}.md`;
  await deleteFileFromBranch(filePath, site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);

  // 2. Immediately delete the staging KV entry so the preview site reflects the deletion
  try {
    const kv = getKvNamespaces(domain);
    await deleteKVEntry(kv.staging, `article:${domain}:${slug}`, domain);
  } catch (err) {
    console.warn(`[sites] Failed to delete staging KV entry for ${domain}:${slug} (non-fatal):`, err);
  }

  // Mark as "deleted" in MongoDB so the dashboard shows the pending deletion
  await upsertArticleMeta(domain, slug, site.staging_branch, { status: "deleted" });

  revalidatePath(`/sites/${domain}`);
}

/** Delete multiple articles from the staging branch.
 *  R2 images and production cleanup happen later in publishStagingToProduction
 *  so the live site never shows broken images. */
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

  // 1. Delete from staging branch in Git
  const filePaths = slugs.map(
    (slug) => `sites/${domain}/articles/${slug}.md`
  );
  await deleteFilesFromBranch(filePaths, site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);

  // 2. Immediately delete the staging KV entries so the preview site reflects the deletions
  try {
    const kv = getKvNamespaces(domain);
    const keys = slugs.map((slug) => `article:${domain}:${slug}`);
    await bulkDeleteKV(kv.staging, keys, domain);
  } catch (err) {
    console.warn(`[sites] Failed to bulk delete staging KV entries for ${domain} (non-fatal):`, err);
  }

  // Mark as "deleted" in MongoDB so the dashboard shows the pending deletions
  await upsertArticlesMeta(
    slugs.map((slug) => ({
      domain,
      slug,
      branch: site.staging_branch!,
      frontmatter: { status: "deleted" },
    })),
  );

  revalidatePath(`/sites/${domain}`);
}

/** Permanently delete a site from trash — destroys staging branch, all KV,
 *  all R2 assets, and records a history entry. Returns cleanup log for UI. */
export async function permanentlyDeleteSite(domain: string): Promise<{
  steps: Array<{ label: string; success: boolean; error?: string }>;
}> {
  const steps: Array<{ label: string; success: boolean; error?: string }> = [];

  // 1. Delete staging branch if it exists
  {
    const branchName = `staging/${domain}`;
    try {
      const exists = await branchExists(branchName);
      if (exists) {
        await deleteBranch(branchName);
        steps.push({ label: `Deleted staging branch: ${branchName}`, success: true });
      } else {
        steps.push({ label: "Staging branch already gone", success: true });
      }
    } catch (err) {
      steps.push({
        label: `Delete staging branch: ${branchName}`,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // 2. Delete site files from Git main (safety retry — may already be gone from soft delete)
  try {
    await deleteSiteFilesFromRepo(domain);
    steps.push({ label: "Deleted site files from Git main", success: true });
  } catch {
    steps.push({ label: "Site files already removed from Git", success: true });
  }

  // 3. Delete ALL KV entries (staging + prod)
  {
    const kv = getKvNamespaces(domain);
    const namespaces = [
      { id: kv.staging, label: "staging" },
      { id: kv.prod, label: "prod" },
    ];
    let kvDeleted = 0;
    const kvErrors: string[] = [];

    for (const ns of namespaces) {
      // Known keys
      for (const key of [
        `site:${domain}`,
        `site-config:${domain}`,
        `article-index:${domain}`,
        `sync-status:${domain}`,
        `site-config-prev:${domain}`,
        `cond-overrides:${domain}`,
      ]) {
        try {
          await deleteKVEntry(ns.id, key, domain);
          kvDeleted++;
        } catch {
          // Key may not exist — that's fine
        }
      }
      // Prefix-scanned keys
      for (const prefix of [`article:${domain}:`, `shared-page:${domain}:`]) {
        try {
          const count = await deleteKVByPrefix(ns.id, prefix, domain);
          kvDeleted += count;
        } catch (err) {
          kvErrors.push(`${ns.label}/${prefix}: ${err instanceof Error ? err.message : "Unknown"}`);
        }
      }
    }

    if (kvErrors.length === 0) {
      steps.push({ label: `Cleaned ${kvDeleted} KV entries (staging + prod)`, success: true });
    } else {
      steps.push({
        label: `KV cleanup: ${kvDeleted} deleted, ${kvErrors.length} errors`,
        success: false,
        error: kvErrors.join("; "),
      });
    }
  }

  // 4. Delete ALL R2 assets
  try {
    const count = await deleteR2ObjectsByPrefix(R2_BUCKET_PROD, `${domain}/`, domain);
    if (count > 0) {
      steps.push({ label: `Deleted ${count} R2 assets`, success: true });
    } else {
      steps.push({ label: "No R2 assets to clean up", success: true });
    }
  } catch (err) {
    steps.push({
      label: "R2 cleanup",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 5. Delete CF Pages project if referenced in trash entry
  // (Read from dashboard-index deleted array before we remove it)
  {
    const index = await readDashboardIndex();
    const trashed = (index.deleted ?? []).find((s) => s.domain === domain);
    if (trashed?.pages_project) {
      try {
        await deletePagesProject(trashed.pages_project, domain);
        steps.push({ label: `Deleted CF Pages project: ${trashed.pages_project}`, success: true });
      } catch {
        steps.push({ label: "CF Pages project already gone", success: true });
      }
    }
  }

  // 6. Remove from trash + write history entry
  try {
    await permanentlyRemoveFromTrash(domain);
    steps.push({ label: "Removed from trash, added to history", success: true });
  } catch (err) {
    steps.push({
      label: "Remove from trash",
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }

  // 7. Delete all articles from MongoDB (soft-fail)
  await deleteArticlesForSite(domain);

  // 7b. Delete site config + mark permanently deleted in MongoDB (soft-fail)
  await deleteSiteConfig(domain);
  await addToDeleteHistory(domain, { deletedAt: new Date().toISOString(), deletedBy: "dashboard" });

  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");

  return { steps };
}

export async function refreshSiteCache(domain: string, _branch?: string): Promise<void> {
  // With MongoDB reads, no in-memory caches to flush. Just revalidate the
  // Next.js page cache so the next render fetches fresh data from the DB.
  revalidatePath(`/sites/${domain}`);
}
