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

  return {
    domain: config.domain,
    siteName: config.site_name,
    group: config.group,
    brief: config.brief,
  };
}

/**
 * List all site domains in a network repo.
 */
export async function listSiteDomains(
  octokit: Octokit,
  repo: string,
): Promise<string[]> {
  const { listFiles } = await import("./github.js");
  return listFiles(octokit, repo, "sites");
}
