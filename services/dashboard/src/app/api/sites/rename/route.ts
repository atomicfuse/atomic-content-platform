import { NextRequest, NextResponse } from "next/server";
import {
  renameSiteFolder,
  createBranch,
  deleteBranch,
  readDashboardIndex,
  writeDashboardIndex,
  readSiteConfig,
  commitSiteFiles,
  invalidateTreeCache,
  triggerWorkflowViaPush,
} from "@/lib/github";
import { stringify as stringifyYaml } from "yaml";
import { moveR2ObjectsByPrefix } from "@/lib/cloudflare";
import { R2_BUCKET_PROD } from "@/lib/constants";
import { getMongoDb } from "@/lib/mongo";
import { COLLECTIONS } from "@/lib/db/collections";

interface RenameRequestBody {
  oldDomain: string;
  newDomain: string;
}

const SLUG_RE = /^[a-z0-9]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RenameRequestBody;
  try {
    body = (await req.json()) as RenameRequestBody;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { oldDomain, newDomain } = body;

  // --- Validate ---
  if (!oldDomain || !newDomain) {
    return NextResponse.json(
      { status: "error", message: "oldDomain and newDomain are required" },
      { status: 400 },
    );
  }
  if (oldDomain === newDomain) {
    return NextResponse.json(
      { status: "error", message: "New slug is the same as the current one" },
      { status: 400 },
    );
  }
  if (!SLUG_RE.test(newDomain)) {
    return NextResponse.json(
      {
        status: "error",
        message: "Slug must contain only lowercase letters and numbers",
      },
      { status: 400 },
    );
  }

  try {
    // Check old site exists
    const index = await readDashboardIndex({ fresh: true });
    const siteIdx = index.sites.findIndex((s) => s.domain === oldDomain);
    if (siteIdx === -1) {
      return NextResponse.json(
        { status: "error", message: `Site "${oldDomain}" not found` },
        { status: 404 },
      );
    }

    // Check new slug not taken
    const taken =
      index.sites.some((s) => s.domain === newDomain) ||
      index.deleted?.some((s) => s.domain === newDomain);
    if (taken) {
      return NextResponse.json(
        { status: "error", message: `Slug "${newDomain}" is already in use` },
        { status: 409 },
      );
    }

    const site = index.sites[siteIdx]!;
    const oldStagingBranch = site.staging_branch;
    const newStagingBranch = `staging/${newDomain}`;
    const isPublished = site.status === "Live" || site.status === "Ready";

    // --- 1. Git: Create new staging branch from old staging HEAD ---
    if (oldStagingBranch) {
      await createBranch(newStagingBranch, oldStagingBranch);

      // --- 2. Git: Rename folder on the new staging branch ---
      await renameSiteFolder(newStagingBranch, oldDomain, newDomain);
      invalidateTreeCache(newStagingBranch);

      // --- 2b. Git: Update domain field inside site.yaml ---
      const siteYaml = await readSiteConfig(newDomain, newStagingBranch);
      if (siteYaml) {
        siteYaml.domain = newDomain;
        await commitSiteFiles(
          newDomain,
          [{ path: `sites/${newDomain}/site.yaml`, content: stringifyYaml(siteYaml, { lineWidth: 0 }) }],
          `update domain field to ${newDomain}`,
          newStagingBranch,
        );
        invalidateTreeCache(newStagingBranch);
      }
    }

    // --- 3. Git: Rename on main if published ---
    if (isPublished) {
      try {
        await renameSiteFolder("main", oldDomain, newDomain, true);
        invalidateTreeCache("main");

        // Update domain field inside site.yaml on main too
        const mainYaml = await readSiteConfig(newDomain, "main");
        if (mainYaml) {
          mainYaml.domain = newDomain;
          await commitSiteFiles(
            newDomain,
            [{ path: `sites/${newDomain}/site.yaml`, content: stringifyYaml(mainYaml, { lineWidth: 0 }) }],
            `update domain field to ${newDomain}`,
            "main",
          );
          invalidateTreeCache("main");
        }
      } catch (err) {
        console.warn(
          `[sites/rename] Failed to rename on main (may not have files yet):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // --- 4. Git: Update dashboard-index.yaml ---
    const freshIndex = await readDashboardIndex({ fresh: true });
    const freshIdx = freshIndex.sites.findIndex((s) => s.domain === oldDomain);
    if (freshIdx !== -1) {
      freshIndex.sites[freshIdx] = {
        ...freshIndex.sites[freshIdx]!,
        domain: newDomain,
        staging_branch: newStagingBranch,
        last_updated: new Date().toISOString(),
      };
      await writeDashboardIndex(
        freshIndex,
        `dashboard: rename ${oldDomain} → ${newDomain}`,
      );
    }

    // --- 5. MongoDB: Rename across collections (soft-fail) ---
    try {
      const db = await getMongoDb();

      // dashboard_index: domain is unique key, so insert new + delete old
      const dashDoc = await db
        .collection(COLLECTIONS.dashboardIndex)
        .findOne({ domain: oldDomain });
      if (dashDoc) {
        const { _id, ...rest } = dashDoc;
        await db.collection(COLLECTIONS.dashboardIndex).insertOne({
          ...rest,
          domain: newDomain,
          staging_branch: newStagingBranch,
          updatedAt: new Date(),
        });
        await db
          .collection(COLLECTIONS.dashboardIndex)
          .deleteOne({ domain: oldDomain });
      }

      // site_configs: same pattern
      const configDoc = await db
        .collection(COLLECTIONS.siteConfigs)
        .findOne({ domain: oldDomain });
      if (configDoc) {
        const { _id, ...rest } = configDoc;
        await db.collection(COLLECTIONS.siteConfigs).insertOne({
          ...rest,
          domain: newDomain,
          updatedAt: new Date(),
        });
        await db
          .collection(COLLECTIONS.siteConfigs)
          .deleteOne({ domain: oldDomain });
      }

      // articles: bulk update domain field
      await db.collection(COLLECTIONS.articles).updateMany(
        { domain: oldDomain },
        {
          $set: {
            domain: newDomain,
            branch: newStagingBranch,
            updatedAt: new Date(),
          },
        },
      );

      // site_stats: _id is the domain string, so insert new + delete old
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const statsDoc = await db
        .collection("site_stats")
        .findOne({ _id: oldDomain as any });
      if (statsDoc) {
        const { _id, ...rest } = statsDoc;
        await db.collection("site_stats").insertOne({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _id: newDomain as any,
          ...rest,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db
          .collection("site_stats")
          .deleteOne({ _id: oldDomain as any });
      }
    } catch (err) {
      console.warn(
        `[sites/rename] MongoDB rename failed (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }

    // --- 6. R2: Move assets from old prefix to new prefix ---
    // Article markdown uses domain-agnostic paths (/assets/images/...) and
    // seed-kv rewrites them to /<siteId>/assets/... at seed time. If R2
    // objects aren't moved, every image URL 404s after rename.
    try {
      const count = await moveR2ObjectsByPrefix(
        R2_BUCKET_PROD,
        `${oldDomain}/`,
        `${newDomain}/`,
      );
      console.log(`[sites/rename] Moved ${count} R2 objects from ${oldDomain}/ to ${newDomain}/`);
    } catch (err) {
      console.warn(
        `[sites/rename] R2 move failed (non-fatal):`,
        err instanceof Error ? err.message : err,
      );
    }

    // --- 8. Git: Delete old staging branch (cleanup, last step) ---
    if (oldStagingBranch) {
      try {
        await deleteBranch(oldStagingBranch);
      } catch (err) {
        console.warn(
          `[sites/rename] Failed to delete old branch ${oldStagingBranch}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // --- 9. Trigger KV sync for the new site ---
    try {
      await triggerWorkflowViaPush(newStagingBranch, newDomain);
    } catch (err) {
      console.warn(
        `[sites/rename] Failed to trigger KV sync:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Invalidate all tree caches
    invalidateTreeCache();

    return NextResponse.json({
      status: "ok",
      newDomain,
      message: `Site renamed from ${oldDomain} to ${newDomain}`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
