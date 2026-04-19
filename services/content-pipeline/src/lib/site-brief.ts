/**
 * Site brief reader.
 *
 * Fetches and parses site.yaml from a network repo to extract
 * the content brief and other site metadata needed by agents.
 */

import { parse as parseYaml } from "yaml";
import { Octokit } from "@octokit/rest";
import { readFile } from "./github.js";
import type { SiteConfig, SiteBrief } from "../types.js";

export interface SiteBriefData {
  domain: string;
  siteName: string;
  group: string;
  brief: SiteBrief;
}

/**
 * Read a site's brief from the network repo.
 */
export async function readSiteBrief(
  octokit: Octokit,
  repo: string,
  domain: string,
  branch?: string,
): Promise<SiteBriefData> {
  const content = await readFile(octokit, repo, `sites/${domain}/site.yaml`, branch);
  const config = parseYaml(content) as SiteConfig;

  if (!config.brief) {
    throw new Error(`Site ${domain} has no content brief defined`);
  }

  // Normalize: ensure audience string is populated from audiences array
  const brief = config.brief;
  if (!brief.audience && brief.audiences?.length) {
    brief.audience = brief.audiences.join(", ");
  }

  return {
    domain: config.domain,
    siteName: config.site_name,
    group: config.group,
    brief,
  };
}

/**
 * List all site domains in a network repo.
 *
 * Reads `dashboard-index.yaml` on main (the authoritative source of truth) —
 * `sites/<domain>/` on main only exists for sites that have been published to
 * prod; new and staging-only sites live on `staging/<domain>` branches.
 * Deleted entries are filtered out.
 */
export async function listSiteDomains(
  octokit: Octokit,
  repo: string,
): Promise<string[]> {
  const entries = await listActiveSites(octokit, repo);
  return entries.map((e) => e.domain);
}

export interface ActiveSiteEntry {
  domain: string;
  /** Branch where the site's config lives. Falls back to `staging/<domain>`. */
  branch: string;
}

interface DashboardIndexFile {
  sites?: Array<{
    domain?: string;
    status?: string;
    staging_branch?: string | null;
  }>;
}

/**
 * List active (non-deleted) sites with the branch to read config from.
 */
export async function listActiveSites(
  octokit: Octokit,
  repo: string,
): Promise<ActiveSiteEntry[]> {
  const raw = await readFile(octokit, repo, "dashboard-index.yaml");
  const parsed = (parseYaml(raw) as DashboardIndexFile | null) ?? {};
  const sites = parsed.sites ?? [];
  return sites
    .filter((s) => s.domain && (s.status ?? "").toLowerCase() !== "deleted")
    .map((s) => ({
      domain: s.domain as string,
      branch: s.staging_branch || `staging/${s.domain}`,
    }));
}

/**
 * Read a site brief, trying the given branch first and falling back to main
 * (for already-published sites whose config is also on main). Returns the
 * branch the brief was actually found on so callers can write back to it.
 */
export async function readSiteBriefWithFallback(
  octokit: Octokit,
  repo: string,
  domain: string,
  branch: string,
): Promise<{ data: SiteBriefData; branch: string }> {
  try {
    const data = await readSiteBrief(octokit, repo, domain, branch);
    return { data, branch };
  } catch {
    const data = await readSiteBrief(octokit, repo, domain);
    return { data, branch: "main" };
  }
}
