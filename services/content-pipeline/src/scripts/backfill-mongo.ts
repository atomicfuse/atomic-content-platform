/**
 * Backfill MongoDB from Git. Idempotent -- safe to re-run.
 *
 * Usage:
 *   GITHUB_TOKEN=... NETWORK_REPO=atomicfuse/atomic-labs-network \
 *     MONGODB_URL=... npx tsx src/scripts/backfill-mongo.ts
 *
 * Phases (run individually with --phase flag, or all by default):
 *   --phase articles      Backfill articles collection
 *   --phase site-configs  Backfill site_configs collection
 *   --phase index         Backfill dashboard_index collection
 *   --phase configs       Backfill org/group/override/scheduler configs
 */

import { parse as parseYaml } from "yaml";
import matter from "gray-matter";
import type { Db } from "mongodb";
import type { Octokit } from "@octokit/rest";
import type { AnyBulkWriteOperation } from "mongodb";

import { createOctokit, readFile, listFiles, clearTreeCache } from "../lib/github.js";
import { getMongoDb, closeMongo } from "../lib/mongo.js";
import { loadConfig } from "../lib/config.js";
import { listActiveSites, type ActiveSiteEntry } from "../lib/site-brief.js";

// ---------------------------------------------------------------------------
// Collection names (mirrors dashboard/src/lib/db/collections.ts)
// ---------------------------------------------------------------------------

const COLLECTIONS = {
  articles: "articles",
  siteConfigs: "site_configs",
  dashboardIndex: "dashboard_index",
  orgConfig: "org_config",
  groupConfigs: "group_configs",
  overrideConfigs: "override_configs",
  schedulerConfig: "scheduler_config",
} as const;

// ---------------------------------------------------------------------------
// Index setup (mirrors dashboard ensureReadLayerIndexes)
// ---------------------------------------------------------------------------

async function ensureIndexes(db: Db): Promise<void> {
  console.log("[backfill] Ensuring indexes...");

  const articles = db.collection(COLLECTIONS.articles);
  await articles.createIndex({ domain: 1, branch: 1 });
  await articles.createIndex({ domain: 1, branch: 1, status: 1 });
  await articles.createIndex(
    { domain: 1, slug: 1, branch: 1 },
    { unique: true },
  );

  const dashIdx = db.collection(COLLECTIONS.dashboardIndex);
  await dashIdx.createIndex({ domain: 1 }, { unique: true });
  await dashIdx.createIndex({ status: 1 });

  const siteConfigs = db.collection(COLLECTIONS.siteConfigs);
  await siteConfigs.createIndex({ domain: 1 }, { unique: true });

  const groupConfigs = db.collection(COLLECTIONS.groupConfigs);
  await groupConfigs.createIndex({ groupId: 1 }, { unique: true });

  const overrideConfigs = db.collection(COLLECTIONS.overrideConfigs);
  await overrideConfigs.createIndex({ overrideId: 1 }, { unique: true });

  console.log("[backfill] Indexes ensured.");
}

// ---------------------------------------------------------------------------
// Phase: articles
// ---------------------------------------------------------------------------

const ARTICLE_BATCH_SIZE = 100;

async function backfillArticles(
  db: Db,
  octokit: Octokit,
  repo: string,
  sites: ActiveSiteEntry[],
  summary: BackfillSummary,
): Promise<void> {
  console.log(`[backfill] === Phase: articles (${sites.length} sites) ===`);
  const coll = db.collection(COLLECTIONS.articles);

  for (const site of sites) {
    try {
      const branches = new Set<string>();
      branches.add(site.branch); // staging branch
      branches.add("main");

      let siteArticleCount = 0;

      for (const branch of branches) {
        const articleFiles = await safeListArticles(octokit, repo, site.domain, branch);
        if (articleFiles.length === 0) continue;

        const ops: AnyBulkWriteOperation[] = [];

        for (const fileName of articleFiles) {
          if (!fileName.endsWith(".md")) continue;
          const slug = fileName.replace(/\.md$/, "");
          const filePath = `sites/${site.domain}/articles/${fileName}`;

          try {
            const content = await readFile(octokit, repo, filePath, branch);
            const { data: frontmatter } = matter(content);

            ops.push({
              updateOne: {
                filter: { domain: site.domain, slug, branch },
                update: {
                  $set: {
                    ...frontmatter,
                    domain: site.domain,
                    slug,
                    branch,
                    updatedAt: new Date(),
                  },
                },
                upsert: true,
              },
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[backfill]   skip ${filePath}@${branch}: ${msg}`);
          }
        }

        // Bulk write in batches
        for (let i = 0; i < ops.length; i += ARTICLE_BATCH_SIZE) {
          const batch = ops.slice(i, i + ARTICLE_BATCH_SIZE);
          await coll.bulkWrite(batch, { ordered: false });
          siteArticleCount += batch.length;
          console.log(
            `[backfill] articles: ${siteArticleCount}/${ops.length} for ${site.domain}@${branch}`,
          );
        }
      }

      // Clear the tree cache between sites to avoid OOM on large repos
      clearTreeCache();
      summary.articlesBackfilled += siteArticleCount;
      summary.sitesProcessed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] ERROR processing articles for ${site.domain}: ${msg}`);
      summary.errors.push({ site: site.domain, phase: "articles", error: msg });
    }
  }
}

/** List article files, returning [] on 404 (branch or dir missing). */
async function safeListArticles(
  octokit: Octokit,
  repo: string,
  domain: string,
  branch: string,
): Promise<string[]> {
  try {
    return await listFiles(octokit, repo, `sites/${domain}/articles`, branch);
  } catch {
    // Branch or directory doesn't exist -- normal for sites not yet on this branch
    return [];
  }
}

// ---------------------------------------------------------------------------
// Phase: site-configs
// ---------------------------------------------------------------------------

async function backfillSiteConfigs(
  db: Db,
  octokit: Octokit,
  repo: string,
  sites: ActiveSiteEntry[],
  summary: BackfillSummary,
): Promise<void> {
  console.log(`[backfill] === Phase: site-configs (${sites.length} sites) ===`);
  const coll = db.collection(COLLECTIONS.siteConfigs);

  for (const site of sites) {
    try {
      const config = await readSiteYaml(octokit, repo, site.domain, site.branch);
      if (!config) {
        console.warn(`[backfill] site-configs: no site.yaml for ${site.domain}`);
        continue;
      }

      await coll.updateOne(
        { domain: site.domain },
        { $set: { ...config, domain: site.domain, updatedAt: new Date() } },
        { upsert: true },
      );
      console.log(`[backfill] site-configs: upserted ${site.domain}`);
      summary.siteConfigsBackfilled += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[backfill] ERROR site-config for ${site.domain}: ${msg}`);
      summary.errors.push({ site: site.domain, phase: "site-configs", error: msg });
    }
  }
}

/** Read site.yaml from staging branch, falling back to main. */
async function readSiteYaml(
  octokit: Octokit,
  repo: string,
  domain: string,
  branch: string,
): Promise<Record<string, unknown> | null> {
  const path = `sites/${domain}/site.yaml`;
  try {
    const content = await readFile(octokit, repo, path, branch);
    return parseYaml(content) as Record<string, unknown>;
  } catch {
    // Fallback to main
    try {
      const content = await readFile(octokit, repo, path, "main");
      return parseYaml(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Phase: index (dashboard-index.yaml)
// ---------------------------------------------------------------------------

interface DashboardIndexFile {
  sites?: Array<Record<string, unknown>>;
}

async function backfillDashboardIndex(
  db: Db,
  octokit: Octokit,
  repo: string,
  summary: BackfillSummary,
): Promise<void> {
  console.log("[backfill] === Phase: index ===");
  const coll = db.collection(COLLECTIONS.dashboardIndex);

  const raw = await readFile(octokit, repo, "dashboard-index.yaml");
  const parsed = (parseYaml(raw) as DashboardIndexFile | null) ?? {};
  const sites = parsed.sites ?? [];

  const ops: AnyBulkWriteOperation[] = sites
    .filter((s) => typeof s.domain === "string" && s.domain)
    .map((s) => ({
      updateOne: {
        filter: { domain: s.domain as string },
        update: {
          $set: { ...s, updatedAt: new Date() },
        },
        upsert: true,
      },
    }));

  if (ops.length > 0) {
    await coll.bulkWrite(ops, { ordered: false });
  }

  console.log(`[backfill] index: upserted ${ops.length} entries`);
  summary.indexEntriesBackfilled = ops.length;
}

// ---------------------------------------------------------------------------
// Phase: configs (org, groups, overrides, scheduler)
// ---------------------------------------------------------------------------

async function backfillConfigs(
  db: Db,
  octokit: Octokit,
  repo: string,
  summary: BackfillSummary,
): Promise<void> {
  console.log("[backfill] === Phase: configs ===");

  // 1. org.yaml
  try {
    const orgRaw = await readFile(octokit, repo, "org.yaml");
    const orgConfig = parseYaml(orgRaw) as Record<string, unknown>;
    await db.collection(COLLECTIONS.orgConfig).updateOne(
      { _id: "org" as any },
      { $set: { ...orgConfig, updatedAt: new Date() } },
      { upsert: true },
    );
    console.log("[backfill] configs: upserted org.yaml");
    summary.configsBackfilled += 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill] ERROR org.yaml: ${msg}`);
    summary.errors.push({ site: "org.yaml", phase: "configs", error: msg });
  }

  // 2. groups/*.yaml
  try {
    const groupFiles = await safeListFiles(octokit, repo, "groups");
    for (const fileName of groupFiles) {
      if (!fileName.endsWith(".yaml")) continue;
      const groupId = fileName.replace(/\.yaml$/, "");
      try {
        const content = await readFile(octokit, repo, `groups/${fileName}`);
        const config = parseYaml(content) as Record<string, unknown>;
        await db.collection(COLLECTIONS.groupConfigs).updateOne(
          { groupId },
          { $set: { ...config, groupId, updatedAt: new Date() } },
          { upsert: true },
        );
        console.log(`[backfill] configs: upserted group ${groupId}`);
        summary.configsBackfilled += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backfill] ERROR group ${groupId}: ${msg}`);
        summary.errors.push({ site: `groups/${fileName}`, phase: "configs", error: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill] ERROR listing groups: ${msg}`);
    summary.errors.push({ site: "groups/", phase: "configs", error: msg });
  }

  // 3. overrides/config/*.yaml
  try {
    const overrideFiles = await safeListFiles(octokit, repo, "overrides/config");
    for (const fileName of overrideFiles) {
      if (!fileName.endsWith(".yaml")) continue;
      const overrideId = fileName.replace(/\.yaml$/, "");
      try {
        const content = await readFile(octokit, repo, `overrides/config/${fileName}`);
        const config = parseYaml(content) as Record<string, unknown>;
        await db.collection(COLLECTIONS.overrideConfigs).updateOne(
          { overrideId },
          { $set: { ...config, overrideId, updatedAt: new Date() } },
          { upsert: true },
        );
        console.log(`[backfill] configs: upserted override ${overrideId}`);
        summary.configsBackfilled += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backfill] ERROR override ${overrideId}: ${msg}`);
        summary.errors.push({ site: `overrides/config/${fileName}`, phase: "configs", error: msg });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill] ERROR listing overrides: ${msg}`);
    summary.errors.push({ site: "overrides/config/", phase: "configs", error: msg });
  }

  // 4. scheduler/config.yaml
  try {
    const schedulerRaw = await readFile(octokit, repo, "scheduler/config.yaml");
    const schedulerConfig = parseYaml(schedulerRaw) as Record<string, unknown>;
    await db.collection(COLLECTIONS.schedulerConfig).updateOne(
      { _id: "scheduler" as any },
      { $set: { ...schedulerConfig, updatedAt: new Date() } },
      { upsert: true },
    );
    console.log("[backfill] configs: upserted scheduler/config.yaml");
    summary.configsBackfilled += 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[backfill] ERROR scheduler/config.yaml: ${msg}`);
    summary.errors.push({ site: "scheduler/config.yaml", phase: "configs", error: msg });
  }
}

/** List files in a directory, returning [] on 404. */
async function safeListFiles(
  octokit: Octokit,
  repo: string,
  dirPath: string,
): Promise<string[]> {
  try {
    return await listFiles(octokit, repo, dirPath);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

interface BackfillError {
  site: string;
  phase: string;
  error: string;
}

interface BackfillSummary {
  sitesProcessed: number;
  articlesBackfilled: number;
  siteConfigsBackfilled: number;
  indexEntriesBackfilled: number;
  configsBackfilled: number;
  errors: BackfillError[];
}

function printSummary(summary: BackfillSummary): void {
  console.log("\n========================================");
  console.log("[backfill] SUMMARY");
  console.log("========================================");
  console.log(`  Sites processed:     ${summary.sitesProcessed}`);
  console.log(`  Articles backfilled: ${summary.articlesBackfilled}`);
  console.log(`  Site configs:        ${summary.siteConfigsBackfilled}`);
  console.log(`  Index entries:       ${summary.indexEntriesBackfilled}`);
  console.log(`  Other configs:       ${summary.configsBackfilled}`);
  console.log(`  Errors:              ${summary.errors.length}`);
  if (summary.errors.length > 0) {
    console.log("\n  Error details:");
    for (const e of summary.errors) {
      console.log(`    - [${e.phase}] ${e.site}: ${e.error}`);
    }
  }
  console.log("========================================\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

type Phase = "articles" | "site-configs" | "index" | "configs";

const ALL_PHASES: Phase[] = ["articles", "site-configs", "index", "configs"];

function parseArgs(): Phase[] {
  const args = process.argv.slice(2);
  const phaseIdx = args.indexOf("--phase");
  if (phaseIdx === -1) return ALL_PHASES;

  const phaseArg = args[phaseIdx + 1];
  if (!phaseArg || !ALL_PHASES.includes(phaseArg as Phase)) {
    console.error(`Invalid --phase value: ${phaseArg ?? "(missing)"}`);
    console.error(`Valid phases: ${ALL_PHASES.join(", ")}`);
    process.exit(1);
  }
  return [phaseArg as Phase];
}

async function main(): Promise<void> {
  const phases = parseArgs();
  console.log(`[backfill] Starting backfill (phases: ${phases.join(", ")})`);

  const config = loadConfig();
  const octokit = createOctokit(config.github);
  const repo = config.networkRepo;
  const db = await getMongoDb();

  // Ensure indexes before any writes
  await ensureIndexes(db);

  // Load site list (needed by articles + site-configs phases)
  let sites: ActiveSiteEntry[] = [];
  if (phases.includes("articles") || phases.includes("site-configs")) {
    sites = await listActiveSites(octokit, repo);
    console.log(`[backfill] Found ${sites.length} active sites`);
  }

  const summary: BackfillSummary = {
    sitesProcessed: 0,
    articlesBackfilled: 0,
    siteConfigsBackfilled: 0,
    indexEntriesBackfilled: 0,
    configsBackfilled: 0,
    errors: [],
  };

  for (const phase of phases) {
    switch (phase) {
      case "articles":
        await backfillArticles(db, octokit, repo, sites, summary);
        break;
      case "site-configs":
        await backfillSiteConfigs(db, octokit, repo, sites, summary);
        break;
      case "index":
        await backfillDashboardIndex(db, octokit, repo, summary);
        break;
      case "configs":
        await backfillConfigs(db, octokit, repo, summary);
        break;
    }
  }

  printSummary(summary);

  await closeMongo();

  if (summary.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(2);
});
