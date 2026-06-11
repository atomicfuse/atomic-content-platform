"use server";

import {
  readDashboardIndex,
  updateSiteInIndex,
  removeSiteFromIndex,
  restoreSiteInIndex,
  permanentlyRemoveFromTrash,
  deleteSiteFilesFromRepo,
  deleteFileFromBranch,
  deleteFilesFromBranch,
  triggerWorkflowViaPush,
  invalidateSiteCaches,
  flushAllCaches,
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
  invalidateSiteCaches(domain);
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

  // 6. Invalidate caches (landmine #45) — must come before revalidatePath
  invalidateSiteCaches(domain, `staging/${domain}`);

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

  invalidateSiteCaches(domain, site.staging_branch);
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

  invalidateSiteCaches(domain, site.staging_branch);
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

export async function refreshSiteCache(domain: string, branch?: string): Promise<void> {
  // Flush ALL in-memory caches (tree, dashboard-index, articles, site-config).
  // Then actively fetch fresh dashboard index via the Contents API (bypasses
  // the tree cache entirely) so the cache is pre-populated with verified-fresh
  // data before router.refresh() triggers the page re-render.
  flushAllCaches();
  await readDashboardIndex({ fresh: true });
  revalidatePath(`/sites/${domain}`);
}
