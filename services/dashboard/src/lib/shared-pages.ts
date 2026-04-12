import { readFile, writeFile, readdir, mkdir, rm, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const SITE_BUILDER_ROOT = join(process.cwd(), "..", "..", "packages", "site-builder");
const SHARED_PAGES_DIR = join(SITE_BUILDER_ROOT, "shared-pages");
const OVERRIDES_DIR = join(SITE_BUILDER_ROOT, "overrides");
const ADS_TXT_DIR = join(SHARED_PAGES_DIR, "ads-txt");
const ADS_TXT_ASSIGNMENTS_PATH = join(SITE_BUILDER_ROOT, "ads-txt-assignments.json");

export interface SharedPageInfo {
  name: string;
  fileName: string;
  lastModified: string;
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
  const entries = await readdir(SHARED_PAGES_DIR);
  const mdFiles = entries.filter((f) => extname(f) === ".md");

  const pages: SharedPageInfo[] = [];
  for (const fileName of mdFiles) {
    const filePath = join(SHARED_PAGES_DIR, fileName);
    const stats = await stat(filePath);
    const name = fileName.replace(".md", "");

    // Count overrides
    const overrideSites = await getOverrideSites(name);

    pages.push({
      name,
      fileName,
      lastModified: stats.mtime.toISOString(),
      overrideCount: overrideSites.length,
      overrideSites,
    });
  }

  return pages;
}

/** Get site domains that have an override for a given page. */
async function getOverrideSites(pageName: string): Promise<string[]> {
  const sites: string[] = [];
  try {
    const siteDirs = await readdir(OVERRIDES_DIR);
    for (const siteDir of siteDirs) {
      if (siteDir === ".gitkeep") continue;
      const overridePath = join(OVERRIDES_DIR, siteDir, `${pageName}.md`);
      try {
        await stat(overridePath);
        sites.push(siteDir);
      } catch {
        // No override for this site
      }
    }
  } catch {
    // Overrides directory doesn't exist
  }
  return sites;
}

/** Read a shared page's content. */
export async function readSharedPage(name: string): Promise<string> {
  const filePath = join(SHARED_PAGES_DIR, `${name}.md`);
  return readFile(filePath, "utf-8");
}

/** Update a shared page's content. */
export async function writeSharedPage(name: string, content: string): Promise<void> {
  const filePath = join(SHARED_PAGES_DIR, `${name}.md`);
  await writeFile(filePath, content, "utf-8");
}

/** Read a site-specific override. */
export async function readOverride(name: string, siteId: string): Promise<string | null> {
  const filePath = join(OVERRIDES_DIR, siteId, `${name}.md`);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/** Create overrides for multiple sites. */
export async function createOverrides(
  name: string,
  sites: string[],
  content: string,
): Promise<void> {
  for (const site of sites) {
    const dir = join(OVERRIDES_DIR, site);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.md`), content, "utf-8");
  }
}

/** Delete a site-specific override. */
export async function deleteOverride(name: string, siteId: string): Promise<void> {
  const filePath = join(OVERRIDES_DIR, siteId, `${name}.md`);
  await rm(filePath, { force: true });
}

// --- ads.txt profiles ---

/** List all ads.txt profiles. */
export async function listAdsTxtProfiles(): Promise<AdsTxtProfile[]> {
  try {
    const entries = await readdir(ADS_TXT_DIR);
    const profiles: AdsTxtProfile[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".txt")) continue;
      const content = await readFile(join(ADS_TXT_DIR, entry), "utf-8");
      profiles.push({
        name: entry.replace(".txt", ""),
        content,
      });
    }
    return profiles;
  } catch {
    return [];
  }
}

/** Read a specific ads.txt profile. */
export async function readAdsTxtProfile(name: string): Promise<string | null> {
  try {
    return await readFile(join(ADS_TXT_DIR, `${name}.txt`), "utf-8");
  } catch {
    return null;
  }
}

/** Write an ads.txt profile. */
export async function writeAdsTxtProfile(name: string, content: string): Promise<void> {
  await mkdir(ADS_TXT_DIR, { recursive: true });
  await writeFile(join(ADS_TXT_DIR, `${name}.txt`), content, "utf-8");
}

/** Delete an ads.txt profile. */
export async function deleteAdsTxtProfile(name: string): Promise<void> {
  await rm(join(ADS_TXT_DIR, `${name}.txt`), { force: true });
}

/** Read ads.txt assignments. */
export async function readAdsTxtAssignments(): Promise<AdsTxtAssignments> {
  try {
    const raw = await readFile(ADS_TXT_ASSIGNMENTS_PATH, "utf-8");
    return JSON.parse(raw) as AdsTxtAssignments;
  } catch {
    return {};
  }
}

/** Write ads.txt assignments. */
export async function writeAdsTxtAssignments(assignments: AdsTxtAssignments): Promise<void> {
  await writeFile(ADS_TXT_ASSIGNMENTS_PATH, JSON.stringify(assignments, null, 2), "utf-8");
}
