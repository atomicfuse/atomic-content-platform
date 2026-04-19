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
import { deletePagesProject } from "@/lib/cloudflare";
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
 * 4. Move to trash in dashboard index
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
      await deletePagesProject(site.pages_project);
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

  // 4. Move to trash in dashboard index
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

/** Delete a single article from the staging branch. */
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

  revalidatePath(`/sites/${domain}`);
}

/** Delete multiple articles from the staging branch in a single commit + build. */
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

  revalidatePath(`/sites/${domain}`);
}

/** Permanently delete a domain — remove from trash AND delete any remaining site files from Git. */
export async function permanentlyDeleteSite(domain: string): Promise<void> {
  // Try to delete files (may already be gone from soft delete)
  try {
    await deleteSiteFilesFromRepo(domain);
  } catch {
    // Files may already be deleted — that's fine
  }
  await permanentlyRemoveFromTrash(domain);
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");
}
