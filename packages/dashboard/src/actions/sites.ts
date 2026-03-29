"use server";

import {
  updateSiteInIndex,
  removeSiteFromIndex,
  restoreSiteInIndex,
  permanentlyRemoveFromTrash,
  deleteSiteFilesFromRepo,
} from "@/lib/github";
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

/** Move a domain to trash (soft delete — can be restored). */
export async function deleteSiteEntry(domain: string): Promise<void> {
  await removeSiteFromIndex(domain);
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");
}

/** Restore a domain from trash back to the active dashboard. */
export async function restoreSiteEntry(domain: string): Promise<void> {
  await restoreSiteInIndex(domain);
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");
}

/** Permanently delete a domain — remove from trash AND delete site files from Git. */
export async function permanentlyDeleteSite(domain: string): Promise<void> {
  await deleteSiteFilesFromRepo(domain);
  await permanentlyRemoveFromTrash(domain);
  revalidatePath("/");
  revalidatePath("/sites");
  revalidatePath("/trash");
}
