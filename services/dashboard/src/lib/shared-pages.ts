import {
  readFileContent,
  commitNetworkFiles,
  listNetworkDirectory,
  deleteNetworkFile,
} from "@/lib/github";

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

/** List all shared pages with override info. */
export async function listSharedPages(): Promise<SharedPageInfo[]> {
  const entries = await listNetworkDirectory("shared-pages");
  const mdFiles = entries.filter((e) => e.name.endsWith(".md"));

  const pages: SharedPageInfo[] = [];
  for (const file of mdFiles) {
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

/** Get site domains that have an override for a given page. */
async function getOverrideSites(pageName: string): Promise<string[]> {
  const sites: string[] = [];
  const siteDirs = await listNetworkDirectory("overrides");
  for (const dir of siteDirs) {
    if (dir.type !== "dir") continue;
    const files = await listNetworkDirectory(dir.path);
    if (files.some((f) => f.name === `${pageName}.md`)) {
      sites.push(dir.name);
    }
  }
  return sites;
}

/** Read a shared page's content. */
export async function readSharedPage(name: string): Promise<string> {
  const content = await readFileContent(`shared-pages/${name}.md`);
  if (content === null) throw new Error(`Shared page "${name}" not found`);
  return content;
}

/** Update a shared page's content (commits to network data repo). */
export async function writeSharedPage(name: string, content: string): Promise<void> {
  await commitNetworkFiles(
    [{ path: `shared-pages/${name}.md`, content }],
    `shared-pages: update ${name}`,
  );
}

/** Read a site-specific override. */
export async function readOverride(name: string, siteId: string): Promise<string | null> {
  return readFileContent(`overrides/${siteId}/${name}.md`);
}

/** Create overrides for multiple sites (commits to network data repo). */
export async function createOverrides(
  name: string,
  sites: string[],
  content: string,
): Promise<void> {
  const files = sites.map((site) => ({
    path: `overrides/${site}/${name}.md`,
    content,
  }));
  await commitNetworkFiles(
    files,
    `shared-pages: create ${name} override for ${sites.join(", ")}`,
  );
}

/** Delete a site-specific override. */
export async function deleteOverride(name: string, siteId: string): Promise<void> {
  await deleteNetworkFile(
    `overrides/${siteId}/${name}.md`,
    `shared-pages: delete ${name} override for ${siteId}`,
  );
}

// --- ads.txt profiles ---

/** List all ads.txt profiles. */
export async function listAdsTxtProfiles(): Promise<AdsTxtProfile[]> {
  const entries = await listNetworkDirectory("shared-pages/ads-txt");
  const profiles: AdsTxtProfile[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".txt")) continue;
    const content = await readFileContent(entry.path);
    if (content !== null) {
      profiles.push({ name: entry.name.replace(".txt", ""), content });
    }
  }
  return profiles;
}

/** Read a specific ads.txt profile. */
export async function readAdsTxtProfile(name: string): Promise<string | null> {
  return readFileContent(`shared-pages/ads-txt/${name}.txt`);
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
