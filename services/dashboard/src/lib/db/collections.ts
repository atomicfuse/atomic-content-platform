import type { Db } from "mongodb";

/** MongoDB collection names for the dashboard read layer. */
export const COLLECTIONS = {
  articles: "articles",
  siteConfigs: "site_configs",
  dashboardIndex: "dashboard_index",
  orgConfig: "org_config",
  groupConfigs: "group_configs",
  overrideConfigs: "override_configs",
  schedulerConfig: "scheduler_config",
} as const;

/** Ensure indexes exist. Call once at startup or from backfill script. */
export async function ensureReadLayerIndexes(db: Db): Promise<void> {
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
}
