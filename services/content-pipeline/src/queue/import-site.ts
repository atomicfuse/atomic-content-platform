import { Queue, Worker } from "bullmq";
import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import { stringify } from "yaml";
import { IMPORT_SITE_QUEUE } from "./types.js";
import type { ImportSiteJobData, ImportSiteResult } from "./types.js";
import { parseCsvRow } from "../agents/migration/csv-parser.js";
import { resolveCategories } from "../agents/migration/category-resolver.js";
import {
  buildFullSiteConfig,
  buildSkillMd,
  generateAuthorName,
} from "../agents/migration/site-scaffolder.js";
import { commitBatch, parseRepo, createOctokit } from "../lib/github.js";
import type { BatchFileEntry } from "../lib/github.js";
import { uploadToR2 } from "../lib/r2-upload.js";
import { writeSiteStatus } from "../agents/migration/import-status.js";

async function fetchImageAsBase64(url: string): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export async function processImportSiteJob(
  job: Job<ImportSiteJobData>,
  redisConnection: Redis,
  githubToken: string,
  networkRepo: string,
): Promise<ImportSiteResult> {
  const { batchId, siteId, row } = job.data;

  const site = parseCsvRow(row);
  const domainOrName = site.domain || site.name;
  const previewUrl = `https://atomic-site-worker-staging.accounts-4a8.workers.dev/?_atl_site=${siteId}`;
  const warnings: string[] = [];

  const updateStatus = (phase: string): Promise<void> =>
    writeSiteStatus(redisConnection, batchId, siteId, { status: "running", phase });

  try {
    // Mark as running
    await updateStatus("resolving-categories");

    // 1. Resolve categories
    let resolved: Awaited<ReturnType<typeof resolveCategories>> = null;
    try {
      resolved = await resolveCategories(site.websiteCategory, site.subCategories, site.name);
    } catch (err) {
      warnings.push(`Category resolution failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Fetch assets
    await updateStatus("fetching-assets");
    const logoBase64 = await fetchImageAsBase64(site.logoUrl);
    if (site.logoUrl && !logoBase64) warnings.push("Could not fetch logo");
    const faviconBase64 = await fetchImageAsBase64(site.faviconUrl);
    if (site.faviconUrl && !faviconBase64) warnings.push("Could not fetch favicon");

    // 3. Build config
    await updateStatus("building-config");
    const author = generateAuthorName();
    const config = buildFullSiteConfig(site, resolved, author, !!logoBase64, !!faviconBase64);
    const skillContent = buildSkillMd(
      site.name || siteId,
      config.brief.topics,
      site.websiteCategory || "General",
    );

    // 4. Create staging branch
    await updateStatus("creating-branch");
    const octokit = createOctokit(githubToken);
    const { owner, repo: repoName } = parseRepo(networkRepo);
    try {
      const { data: mainRef } = await octokit.git.getRef({ owner, repo: repoName, ref: "heads/main" });
      await octokit.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/staging/${siteId}`,
        sha: mainRef.object.sha,
      });
    } catch (e: unknown) {
      if ((e as { status?: number }).status !== 422) throw e;
      // 422 = branch already exists, non-fatal
    }

    // 5. Commit files to staging branch
    await updateStatus("committing");
    const textFiles: BatchFileEntry[] = [
      { path: `sites/${siteId}/site.yaml`, content: stringify(config, { lineWidth: 0 }) },
      { path: `sites/${siteId}/skill.md`, content: skillContent },
      { path: `sites/${siteId}/assets/.gitkeep`, content: "" },
      { path: `sites/${siteId}/articles/.gitkeep`, content: "" },
    ];
    // Logos/favicons are R2-native — upload directly to R2, never commit to
    // git (committing binary via the GitHub API corrupted logos historically).
    if (logoBase64) {
      await uploadToR2(`${siteId}/assets/logo.png`, Buffer.from(logoBase64, "base64"), "image/png");
    }
    if (faviconBase64) {
      await uploadToR2(`${siteId}/assets/favicon.png`, Buffer.from(faviconBase64, "base64"), "image/png");
    }

    await commitBatch(
      octokit,
      networkRepo,
      textFiles,
      [],
      `feat: scaffold site ${siteId} from CSV import`,
      `staging/${siteId}`,
    );

    // 6. Update Redis — mark site as complete
    const result: ImportSiteResult = {
      siteId,
      domain: domainOrName,
      status: "created",
      previewUrl,
      warnings: warnings.length > 0 ? warnings : undefined,
      postsApiUrl: site.postsApiUrl || undefined,
      company: site.company || undefined,
      vertical: site.websiteCategory || undefined,
    };

    await writeSiteStatus(redisConnection, batchId, siteId, {
      status: "complete",
      previewUrl,
      warnings: warnings.length > 0 ? warnings : undefined,
      postsApiUrl: site.postsApiUrl || undefined,
    });

    console.log(`[import-site] Created ${siteId} (${warnings.length} warnings)`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await writeSiteStatus(redisConnection, batchId, siteId, {
      status: "error",
      error: message,
    });

    console.error(`[import-site] Error for ${siteId}:`, message);
    throw err; // Let BullMQ retry
  }
}

export function createImportSiteQueue(
  connection: Redis,
): Queue<ImportSiteJobData, ImportSiteResult> {
  return new Queue(IMPORT_SITE_QUEUE, { connection });
}

export function createImportSiteWorker(
  connection: Redis,
  concurrency: number,
  githubToken: string,
  networkRepo: string,
): Worker<ImportSiteJobData, ImportSiteResult> {
  return new Worker(
    IMPORT_SITE_QUEUE,
    async (job) => processImportSiteJob(job, connection, githubToken, networkRepo),
    { connection, concurrency },
  );
}
