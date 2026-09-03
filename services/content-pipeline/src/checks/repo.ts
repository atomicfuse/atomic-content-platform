import type { AgentConfig } from "../lib/config.js";
import { createOctokit } from "../lib/github.js";
import { listActiveSites } from "../lib/site-brief.js";
import { readSyncStatus, type SyncCheck } from "./sync.js";
import { readTracking, type TrackingCheck } from "./tracking.js";

export interface AtlChecks {
  siteDomain: string;
  sync: SyncCheck;
  tracking: TrackingCheck;
}

export async function getAtlChecks(domain: string): Promise<AtlChecks> {
  const [sync, tracking] = await Promise.all([
    readSyncStatus(domain),
    readTracking(domain),
  ]);
  return { siteDomain: domain, sync, tracking };
}

/**
 * Run getAtlChecks over an array of domains with bounded concurrency.
 * Each getAtlChecks call is independently failure-isolated (sync/tracking never throw).
 */
async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i] as T);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

export async function getAllAtlChecks(config: AgentConfig): Promise<AtlChecks[]> {
  const octokit = createOctokit(config.github);
  const sites = await listActiveSites(octokit, config.networkRepo);
  const domains = sites.map((s) => s.domain);
  return mapWithConcurrency(domains, 5, getAtlChecks);
}
