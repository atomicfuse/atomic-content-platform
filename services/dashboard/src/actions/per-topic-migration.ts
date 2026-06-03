"use server";

import { stringify as stringifyYaml } from "yaml";
import type { TopicV2 } from "@/types/dashboard";
import {
  commitSiteFiles,
  readDashboardIndex,
  readSiteConfig as readSiteConfigFromGit,
} from "@/lib/github";

const RAW_AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd.atomic.cloudgrid.io";
const AGGREGATOR_URL = RAW_AGGREGATOR_URL.replace(/\/api\/?$/, "");

export interface MigrateSiteToPerTopicArgs {
  domain: string;
  theme: string;
  topics_v2: TopicV2[];
  deleteOrphanBundleIds: string[];
}

export interface MigrateSiteToPerTopicResult {
  status: "ok" | "error";
  message?: string;
  bundlesDeleted: number;
  bundlesFailedToDelete: string[];
}

export async function migrateSiteToPerTopic(
  args: MigrateSiteToPerTopicArgs,
): Promise<MigrateSiteToPerTopicResult> {
  if (!args.theme.trim()) {
    return { status: "error", message: "Theme is required", bundlesDeleted: 0, bundlesFailedToDelete: [] };
  }
  if (args.topics_v2.length === 0) {
    return { status: "error", message: "At least one topic is required", bundlesDeleted: 0, bundlesFailedToDelete: [] };
  }

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === args.domain);
  if (!site?.staging_branch) {
    return { status: "error", message: "No staging branch for this site", bundlesDeleted: 0, bundlesFailedToDelete: [] };
  }

  const existing = await readSiteConfigFromGit(args.domain, site.staging_branch);
  if (!existing) {
    return { status: "error", message: "Could not read site config", bundlesDeleted: 0, bundlesFailedToDelete: [] };
  }

  // Rewrite the brief to the new shape.
  const brief = (existing.brief ?? {}) as Record<string, unknown>;
  brief.theme = args.theme;
  brief.topics_v2 = args.topics_v2;
  delete brief.bundle_ids;
  delete brief.bundle_id;
  delete brief.category_ids;
  delete brief.tag_ids;
  (existing as Record<string, unknown>).brief = brief;
  delete (existing as Record<string, unknown>).bundle_id;

  // Commit the site.yaml change.
  const yamlContent = stringifyYaml(existing);
  await commitSiteFiles(
    args.domain,
    [{ path: `sites/${args.domain}/site.yaml`, content: yamlContent }],
    `feat: migrate ${args.domain} to per-topic filters`,
    site.staging_branch,
  );

  // Best-effort delete orphan bundles on the aggregator.
  let bundlesDeleted = 0;
  const bundlesFailedToDelete: string[] = [];
  for (const bundleId of args.deleteOrphanBundleIds) {
    try {
      const res = await fetch(`${AGGREGATOR_URL}/api/bundles/${bundleId}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        bundlesDeleted++;
      } else {
        bundlesFailedToDelete.push(bundleId);
        console.warn(`[migrate] DELETE /api/bundles/${bundleId} -> ${res.status}`);
      }
    } catch (err) {
      bundlesFailedToDelete.push(bundleId);
      console.warn(`[migrate] DELETE /api/bundles/${bundleId} threw:`, err);
    }
  }

  return { status: "ok", bundlesDeleted, bundlesFailedToDelete };
}
