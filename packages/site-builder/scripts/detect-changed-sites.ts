/**
 * Changed-site detection for CI/CD pipelines.
 *
 * Determines whether a given site needs to be rebuilt based on which files
 * changed in the most recent commit.  This allows the build matrix to skip
 * sites whose configuration has not been touched.
 */

import { execSync } from "node:child_process";

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
    // Most likely there is no HEAD~1 (first commit).  Signal that everything
    // should be rebuilt.
    return ["*"];
  }
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

/**
 * Decide whether a site needs rebuilding based on which files changed.
 *
 * Rebuild rules:
 *  - Any file inside `sites/{siteDomain}/`          -> YES
 *  - `org.yaml` changed                             -> YES (affects all sites)
 *  - `network.yaml` changed                         -> YES (platform version)
 *  - `groups/{siteGroup}.yaml` changed              -> YES
 *  - The sentinel value `"*"` is in the list        -> YES (first commit)
 *  - Changes only in other sites' directories       -> NO
 *
 * @param siteDomain  - The domain slug for the site (e.g. "coolnews.dev").
 * @param siteGroup   - The group ID the site belongs to (e.g. "tech-sites").
 * @param changedFiles - List of changed file paths from {@link getChangedFiles}.
 * @returns `true` if the site should be rebuilt.
 */
export function shouldBuildSite(
  siteDomain: string,
  siteGroup: string,
  changedFiles: string[],
): boolean {
  // First-commit sentinel: rebuild everything.
  if (changedFiles.includes("*")) {
    return true;
  }

  const sitePrefix = `sites/${siteDomain}/`;
  const groupFile = `groups/${siteGroup}.yaml`;

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

    // Group config that this site belongs to.
    if (file === groupFile) {
      return true;
    }
  }

  return false;
}
