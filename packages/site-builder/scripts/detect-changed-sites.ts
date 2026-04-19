/**
 * Changed-site detection for CI/CD pipelines.
 *
 * Determines whether a given site needs to be rebuilt based on which files
 * changed in the most recent commit. This allows the build matrix to skip
 * sites whose configuration has not been touched.
 *
 * With the unified groups + overrides architecture:
 * - `groups/<id>.yaml` changes trigger rebuilds for sites using that group
 * - `overrides/config/<id>.yaml` changes trigger rebuilds for targeted sites
 * - `org.yaml` changes trigger rebuilds for all sites
 */

import { execSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/**
 * Return the list of files changed in the most recent commit by running
 * `git diff --name-only HEAD~1`.
 *
 * If there is no previous commit (e.g. the very first commit in a repo),
 * returns `["*"]` as a sentinel value meaning "everything changed".
 *
 * @returns An array of changed file paths relative to the repo root, or
 *          `["*"]` when the diff cannot be computed.
 */
export function getChangedFiles(): string[] {
  try {
    const output = execSync("git diff --name-only HEAD~1", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return ["*"];
  }
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

const OVERRIDE_CONFIG_REGEX = /^overrides\/config\/([^/]+)\.yaml$/;

/**
 * Decide whether a site needs rebuilding based on which files changed.
 *
 * Rebuild rules:
 *  - Any file inside `sites/{siteDomain}/`          -> YES
 *  - `org.yaml` changed                             -> YES (affects all sites)
 *  - `network.yaml` changed                         -> YES (platform version)
 *  - `groups/{siteGroup}.yaml` changed              -> YES
 *  - `overrides/config/*.yaml` changed              -> YES (if override targets this site)
 *  - The sentinel value `"*"` is in the list        -> YES (first commit)
 *  - Changes only in other sites' directories       -> NO
 *
 * @param siteDomain  - The domain slug for the site (e.g. "coolnews.dev").
 * @param siteGroups  - The group ID(s) the site belongs to. Accepts a single
 *                       string (backward compat) or an array of group IDs.
 * @param changedFiles - List of changed file paths from {@link getChangedFiles}.
 * @param overrideTargets - Optional map of override IDs to their target site/group lists.
 *                          When provided, override changes only trigger rebuilds for
 *                          sites actually targeted by the override.
 * @returns `true` if the site should be rebuilt.
 */
export function shouldBuildSite(
  siteDomain: string,
  siteGroups: string | string[],
  changedFiles: string[],
  overrideTargets?: Map<string, { groups: string[]; sites: string[] }>,
): boolean {
  // First-commit sentinel: rebuild everything.
  if (changedFiles.includes("*")) {
    return true;
  }

  const groups = Array.isArray(siteGroups) ? siteGroups : [siteGroups];
  const sitePrefix = `sites/${siteDomain}/`;
  const groupFiles = groups.map((g) => `groups/${g}.yaml`);

  for (const file of changedFiles) {
    // Direct changes to the site's own directory.
    if (file.startsWith(sitePrefix)) {
      return true;
    }

    // Org-level config affects every site.
    if (file === "org.yaml") {
      return true;
    }

    // Network manifest change (e.g. platform_version bump).
    if (file === "network.yaml") {
      return true;
    }

    // Any group config that this site belongs to.
    if (groupFiles.includes(file)) {
      return true;
    }

    // Override config changes — rebuild if override targets this site
    const overrideMatch = OVERRIDE_CONFIG_REGEX.exec(file);
    if (overrideMatch) {
      if (!overrideTargets) {
        // No target info available — conservative: rebuild
        return true;
      }
      const overrideId = overrideMatch[1];
      const targets = overrideTargets.get(overrideId);
      if (targets) {
        if (targets.sites.includes(siteDomain)) return true;
        for (const g of groups) {
          if (targets.groups.includes(g)) return true;
        }
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Override-aware rebuild detection (replaces monetization detection)
// ---------------------------------------------------------------------------

/**
 * Extract override IDs from changed files.
 */
export function changedOverrideIds(changedFiles: string[]): string[] {
  const ids: string[] = [];
  for (const file of changedFiles) {
    const match = OVERRIDE_CONFIG_REGEX.exec(file);
    if (match) {
      ids.push(match[1]);
    }
  }
  return ids;
}

/**
 * Enumerate which site domains need rebuilding given override config changes.
 * Reads each override's targets and each site's groups to determine affected sites.
 */
export async function affectedSitesForOverrideChange(
  networkRepoPath: string,
  changedFiles: string[],
): Promise<string[]> {
  const overrideIds = changedOverrideIds(changedFiles);
  const orgChanged = changedFiles.includes("org.yaml");

  // Track which sites had their own site.yaml touched.
  const directlyChangedSites = new Set<string>();
  for (const file of changedFiles) {
    const match = /^sites\/([^/]+)\/site\.yaml$/.exec(file);
    if (match) directlyChangedSites.add(match[1]!);
  }

  if (overrideIds.length === 0 && directlyChangedSites.size === 0 && !orgChanged) {
    return [];
  }

  // Read override target info
  const overrideTargetGroups = new Set<string>();
  const overrideTargetSites = new Set<string>();

  for (const id of overrideIds) {
    try {
      const raw = await readFile(
        join(networkRepoPath, "overrides", "config", `${id}.yaml`),
        "utf-8",
      );
      const parsed = parseYaml(raw) as {
        targets?: { groups?: string[]; sites?: string[] };
      } | null;
      for (const g of parsed?.targets?.groups ?? []) overrideTargetGroups.add(g);
      for (const s of parsed?.targets?.sites ?? []) overrideTargetSites.add(s);
    } catch {
      // Override file may have been deleted — skip
    }
  }

  const sitesDir = join(networkRepoPath, "sites");
  let entries: string[];
  try {
    entries = await readdir(sitesDir);
  } catch {
    return [];
  }

  const affected = new Set<string>();
  for (const entry of entries) {
    const sitePath = join(sitesDir, entry);
    let isDir = false;
    try {
      isDir = (await stat(sitePath)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    if (directlyChangedSites.has(entry) || orgChanged) {
      affected.add(entry);
      continue;
    }

    // Check if override targets this site directly
    if (overrideTargetSites.has(entry)) {
      affected.add(entry);
      continue;
    }

    // Check if site is in a targeted group
    if (overrideTargetGroups.size > 0) {
      try {
        const siteRaw = await readFile(join(sitePath, "site.yaml"), "utf-8");
        const siteParsed = parseYaml(siteRaw) as {
          groups?: string[];
          group?: string;
        } | null;
        const siteGroupList = siteParsed?.groups ?? (siteParsed?.group ? [siteParsed.group] : []);
        for (const g of siteGroupList) {
          if (overrideTargetGroups.has(g)) {
            affected.add(entry);
            break;
          }
        }
      } catch {
        continue;
      }
    }
  }

  return [...affected].sort();
}

// Legacy compatibility exports
export const changedMonetizationProfiles = changedOverrideIds;
export const affectedSitesForMonetizationChange = affectedSitesForOverrideChange;
