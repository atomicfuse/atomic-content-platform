import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { parse, stringify } from "yaml";
import { IMPORT_FINALIZE_QUEUE } from "./types.js";
import type { ImportFinalizeData, ImportSiteResult } from "./types.js";
import { commitBatch, readFile, createResilientOctokit, parseRepo } from "../lib/github.js";
import type { BatchFileEntry } from "../lib/github.js";
import { updateBatchStatus } from "../agents/migration/import-status.js";

/**
 * Process the parent "import-finalize" job.
 * Runs after ALL child import-site jobs complete.
 *
 * 1. Reads all children's return values
 * 2. Batch-commits new entries to dashboard-index.yaml (one commit)
 * 3. Triggers KV sync for each successful site
 * 4. Updates batch status in Redis
 */
export async function processImportFinalize(
  job: Job<ImportFinalizeData>,
  redisConnection: Redis,
  githubToken: string,
  networkRepo: string,
): Promise<void> {
  const { batchId, siteIds } = job.data;

  await updateBatchStatus(redisConnection, batchId, "running");

  const octokit = createResilientOctokit(githubToken);
  const { owner, repo: repoName } = parseRepo(networkRepo);

  // Collect child results
  const childrenValues = (await job.getChildrenValues()) as Record<string, ImportSiteResult | null>;
  const successfulSites: ImportSiteResult[] = [];
  const failedSiteIds: string[] = [];

  for (const [, result] of Object.entries(childrenValues)) {
    if (result && result.status === "created") {
      successfulSites.push(result);
    }
  }

  // Determine which sites failed (enqueued but not in completed results)
  const completedSiteIds = new Set(successfulSites.map((s) => s.siteId));
  for (const id of siteIds) {
    if (!completedSiteIds.has(id)) {
      failedSiteIds.push(id);
    }
  }

  // 1. Batch update dashboard-index.yaml — one commit for all sites
  if (successfulSites.length > 0) {
    try {
      const indexContent = await readFile(octokit, networkRepo, "dashboard-index.yaml", "main");
      const index = parse(indexContent) as { sites: Array<Record<string, unknown>> };
      const existingDomains = new Set(
        index.sites.map((s: Record<string, unknown>) => s.domain as string),
      );

      const now = new Date().toISOString();
      let added = 0;
      for (const site of successfulSites) {
        if (existingDomains.has(site.siteId)) continue;

        index.sites.push({
          domain: site.siteId,
          company: null,
          vertical: null,
          status: "Staging",
          site_id: `${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`,
          exclusivity: null,
          ob_epid: null,
          ga_info: null,
          cf_apo: false,
          fixed_ad: false,
          last_updated: now,
          created_at: now,
          pages_project: null,
          pages_subdomain: null,
          zone_id: null,
          staging_branch: `staging/${site.siteId}`,
          preview_url: site.previewUrl,
          saved_previews: null,
          custom_domain: null,
        });
        added++;
      }

      if (added > 0) {
        await commitBatch(
          octokit,
          networkRepo,
          [{ path: "dashboard-index.yaml", content: stringify(index, { lineWidth: 0 }) }],
          [],
          `dashboard: add ${added} site(s) from CSV import (batch ${batchId.slice(0, 8)})`,
          "main",
        );
        console.log(`[import-finalize] Added ${added} sites to dashboard-index.yaml`);
      }
    } catch (err) {
      console.error(`[import-finalize] Failed to update dashboard-index:`, err);
      // Non-fatal: sites are created, just not in the index yet
    }

    // 2. Trigger KV sync for each site
    for (const site of successfulSites) {
      try {
        const triggerPath = `sites/${site.siteId}/.build-trigger`;
        let existingSha: string | undefined;
        try {
          const { data } = await octokit.repos.getContent({
            owner,
            repo: repoName,
            path: triggerPath,
            ref: `staging/${site.siteId}`,
          });
          if ("sha" in data) existingSha = data.sha as string;
        } catch {
          /* doesn't exist yet */
        }
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo: repoName,
          path: triggerPath,
          message: `ci: trigger KV sync for ${site.siteId}`,
          content: Buffer.from(new Date().toISOString()).toString("base64"),
          sha: existingSha,
          branch: `staging/${site.siteId}`,
        });
      } catch (err) {
        console.warn(`[import-finalize] KV sync trigger failed for ${site.siteId}:`, err);
      }
    }
  }

  // 3. Update batch status
  const finalStatus = failedSiteIds.length === siteIds.length ? "failed" : "complete";
  await updateBatchStatus(redisConnection, batchId, finalStatus);

  console.log(
    `[import-finalize] Batch ${batchId.slice(0, 8)} done: ${successfulSites.length} created, ${failedSiteIds.length} failed`,
  );
}

export function createImportFinalizeQueue(
  connection: Redis,
): Queue<ImportFinalizeData> {
  return new Queue(IMPORT_FINALIZE_QUEUE, { connection });
}

export function createImportFinalizeWorker(
  connection: Redis,
  githubToken: string,
  networkRepo: string,
): Worker<ImportFinalizeData> {
  return new Worker(
    IMPORT_FINALIZE_QUEUE,
    async (job) => processImportFinalize(job, connection, githubToken, networkRepo),
    { connection },
  );
}
