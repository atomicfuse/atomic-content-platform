import {
  readFileContent,
  commitNetworkFiles,
  listNetworkDirectory,
  deleteNetworkFile,
  triggerWorkflowViaPush,
  listStagingSites,
} from "@/lib/github";
import { NETWORK_REPO_OWNER } from "@/lib/constants";

/**
 * Platform code repo — used as fallback for bundled shared page templates
 * and ads-txt profiles that haven't been committed to the network data repo yet.
 */
const PLATFORM_REPO = { owner: NETWORK_REPO_OWNER, name: "atomic-content-platform" };
const BUNDLED_SHARED_PAGES = "packages/site-builder/shared-pages";

export interface SharedPageInfo {
  name: string;
  fileName: string;
  overrideCount: number;
  overrideSites: string[];
}

export interface AdsTxtProfile {
  name: string;
  content: string;
}

export interface AdsTxtAssignments {
  [domain: string]: string;
}

/**
 * List all shared pages with override info.
 * Merges pages from the network data repo with bundled templates from the platform repo.
 */
export async function listSharedPages(): Promise<SharedPageInfo[]> {
  // Read from network data repo (user-edited pages)
  const networkEntries = await listNetworkDirectory("shared-pages");
  const networkMd = networkEntries.filter((e) => e.name.endsWith(".md"));

  // Read from platform code repo (bundled templates as fallback)
  const bundledEntries = await listNetworkDirectory(BUNDLED_SHARED_PAGES, undefined, PLATFORM_REPO);
  const bundledMd = bundledEntries.filter((e) => e.name.endsWith(".md"));

  // Merge: network pages take precedence, add bundled pages not already in network
  const seen = new Set(networkMd.map((e) => e.name));
  const allFiles = [...networkMd];
  for (const file of bundledMd) {
    if (!seen.has(file.name)) {
      allFiles.push(file);
    }
  }

  const pages: SharedPageInfo[] = [];
  for (const file of allFiles) {
    const name = file.name.replace(".md", "");
    const overrideSites = await getOverrideSites(name);
    pages.push({
      name,
      fileName: file.name,
      overrideCount: overrideSites.length,
      overrideSites,
    });
  }
  return pages;
}

/**
 * Get site domains that have an override for a given page.
 *
 * Overrides live on each site's `staging/{site}` branch (see createOverrides).
 * We enumerate sites from existing `staging/*` branches (the source of truth
 * for which sites currently exist), then probe each site's staging branch for
 * the override file. We can't enumerate `sites/` on main because new sites
 * only land on main after "Publish to Production".
 */
export async function getOverrideSites(pageName: string): Promise<string[]> {
  const sites = await listStagingSites();
  const found: string[] = [];
  for (const site of sites) {
    const file = await readFileContent(
      `overrides/${site}/${pageName}.md`,
      `staging/${site}`,
    );
    if (file !== null) found.push(site);
  }
  return found;
}

/**
 * Read a shared page's content.
 * Tries network data repo first, falls back to bundled template in platform repo.
 */
export async function readSharedPage(name: string): Promise<string> {
  // Try network data repo first (user-edited)
  const content = await readFileContent(`shared-pages/${name}.md`);
  if (content !== null) return content;

  // Fall back to platform code repo (bundled template)
  const bundled = await readFileContent(
    `${BUNDLED_SHARED_PAGES}/${name}.md`,
    undefined,
    PLATFORM_REPO,
  );
  if (bundled !== null) return bundled;

  throw new Error(`Shared page "${name}" not found`);
}

/** Update a shared page's content (commits to network data repo). */
export async function writeSharedPage(name: string, content: string): Promise<void> {
  await commitNetworkFiles(
    [{ path: `shared-pages/${name}.md`, content }],
    `shared-pages: update ${name}`,
  );
}

/** Read a site-specific override (from the site's staging branch). */
export async function readOverride(name: string, siteId: string): Promise<string | null> {
  return readFileContent(`overrides/${siteId}/${name}.md`, `staging/${siteId}`);
}

/**
 * Create overrides for multiple sites.
 *
 * Each override is committed to that site's `staging/{site}` branch so it
 * shows up on the staging URL first (mirroring how site config edits flow
 * via wizard.ts → save/route.ts). After the commit, we push a build-trigger
 * via the Contents API because Git Data API commits don't fire Actions
 * (see triggerWorkflowViaPush in github.ts).
 */
export async function createOverrides(
  name: string,
  sites: string[],
  content: string,
): Promise<void> {
  for (const site of sites) {
    const branch = `staging/${site}`;
    await commitNetworkFiles(
      [{ path: `overrides/${site}/${name}.md`, content }],
      `shared-pages: create ${name} override for ${site}`,
      branch,
    );
    await triggerWorkflowViaPush(branch, site);
  }
}

/** Update a single site's override (commits to that site's staging branch). */
export async function updateOverride(
  name: string,
  siteId: string,
  content: string,
): Promise<void> {
  const branch = `staging/${siteId}`;
  await commitNetworkFiles(
    [{ path: `overrides/${siteId}/${name}.md`, content }],
    `shared-pages: update ${name} override for ${siteId}`,
    branch,
  );
  await triggerWorkflowViaPush(branch, siteId);
}

/** Delete a site-specific override (from the site's staging branch). */
export async function deleteOverride(name: string, siteId: string): Promise<void> {
  const branch = `staging/${siteId}`;
  await deleteNetworkFile(
    `overrides/${siteId}/${name}.md`,
    `shared-pages: delete ${name} override for ${siteId}`,
    branch,
  );
  await triggerWorkflowViaPush(branch, siteId);
}

// --- ads.txt profiles ---

/**
 * List all ads.txt profiles.
 * Merges from network data repo and bundled templates.
 */
export async function listAdsTxtProfiles(): Promise<AdsTxtProfile[]> {
  const networkEntries = await listNetworkDirectory("shared-pages/ads-txt");
  const bundledEntries = await listNetworkDirectory(
    `${BUNDLED_SHARED_PAGES}/ads-txt`,
    undefined,
    PLATFORM_REPO,
  );

  // Merge: network takes precedence
  const seen = new Set<string>();
  const profiles: AdsTxtProfile[] = [];

  for (const entry of networkEntries) {
    if (!entry.name.endsWith(".txt")) continue;
    const content = await readFileContent(entry.path);
    if (content !== null) {
      const name = entry.name.replace(".txt", "");
      seen.add(name);
      profiles.push({ name, content });
    }
  }

  for (const entry of bundledEntries) {
    if (!entry.name.endsWith(".txt")) continue;
    const name = entry.name.replace(".txt", "");
    if (seen.has(name)) continue;
    const content = await readFileContent(entry.path, undefined, PLATFORM_REPO);
    if (content !== null) {
      profiles.push({ name, content });
    }
  }

  return profiles;
}

/** Read a specific ads.txt profile (network first, then bundled). */
export async function readAdsTxtProfile(name: string): Promise<string | null> {
  const content = await readFileContent(`shared-pages/ads-txt/${name}.txt`);
  if (content !== null) return content;
  return readFileContent(`${BUNDLED_SHARED_PAGES}/ads-txt/${name}.txt`, undefined, PLATFORM_REPO);
}

/** Write an ads.txt profile (commits to network data repo). */
export async function writeAdsTxtProfile(name: string, content: string): Promise<void> {
  await commitNetworkFiles(
    [{ path: `shared-pages/ads-txt/${name}.txt`, content }],
    `ads-txt: update profile ${name}`,
  );
}

/** Delete an ads.txt profile. */
export async function deleteAdsTxtProfile(name: string): Promise<void> {
  await deleteNetworkFile(
    `shared-pages/ads-txt/${name}.txt`,
    `ads-txt: delete profile ${name}`,
  );
}

/** Read ads.txt assignments. */
export async function readAdsTxtAssignments(): Promise<AdsTxtAssignments> {
  const content = await readFileContent("ads-txt-assignments.json");
  if (!content) return {};
  try {
    return JSON.parse(content) as AdsTxtAssignments;
  } catch {
    return {};
  }
}

/** Write ads.txt assignments (commits to network data repo). */
export async function writeAdsTxtAssignments(assignments: AdsTxtAssignments): Promise<void> {
  await commitNetworkFiles(
    [{ path: "ads-txt-assignments.json", content: JSON.stringify(assignments, null, 2) }],
    "ads-txt: update assignments",
  );
}
