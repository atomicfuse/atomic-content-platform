/**
 * Resolves the ads.txt profile content for a given site domain.
 *
 * Reads the ads-txt-assignments.json file to determine which profile is
 * assigned to the site. If no assignment is found, falls back to the
 * "default" profile. If the assigned profile file does not exist, also
 * falls back to the default.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface AdsTxtAssignments {
  [domain: string]: string; // domain -> profile name
}

/**
 * Read the ads.txt profile content for a site.
 *
 * @param siteDomain      - The domain of the site (e.g. "coolnews.dev").
 * @param adsTxtDir       - Path to the ads-txt profiles directory.
 * @param assignmentsPath - Path to the ads-txt-assignments.json file.
 * @returns The profile file content, or an empty string if nothing is found.
 */
export async function resolveAdsTxtProfile(
  siteDomain: string,
  adsTxtDir: string,
  assignmentsPath: string,
): Promise<string> {
  let assignments: AdsTxtAssignments = {};
  try {
    const raw = await readFile(assignmentsPath, "utf-8");
    assignments = JSON.parse(raw) as AdsTxtAssignments;
  } catch {
    // No assignments file or invalid JSON — use default profile.
  }

  const profileName = assignments[siteDomain] ?? "default";
  const profilePath = join(adsTxtDir, `${profileName}.txt`);

  try {
    return await readFile(profilePath, "utf-8");
  } catch {
    // Assigned profile file not found — try default.
    try {
      return await readFile(join(adsTxtDir, "default.txt"), "utf-8");
    } catch {
      return "";
    }
  }
}
