import type { Redis } from "ioredis";
import type { ImportBatchMeta, ImportBatchSiteStatus } from "../../queue/types.js";

export const BATCH_KEY_PREFIX = "import-batch:";
export const BATCH_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export async function writeBatchMeta(
  redis: Redis,
  batchId: string,
  meta: ImportBatchMeta,
): Promise<void> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  await redis.hset(key, "meta", JSON.stringify(meta));
  await redis.expire(key, BATCH_TTL_SECONDS);
}

export async function updateBatchStatus(
  redis: Redis,
  batchId: string,
  status: ImportBatchMeta["status"],
): Promise<void> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  const raw = await redis.hget(key, "meta");
  if (!raw) return;
  const meta = JSON.parse(raw) as ImportBatchMeta;
  meta.status = status;
  await redis.hset(key, "meta", JSON.stringify(meta));
}

export async function writeSiteStatus(
  redis: Redis,
  batchId: string,
  siteId: string,
  status: ImportBatchSiteStatus,
): Promise<void> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  await redis.hset(key, `site:${siteId}`, JSON.stringify(status));
}

export interface BatchStatusResponse {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  status: ImportBatchMeta["status"];
  createdAt: string;
  sites: Array<ImportBatchSiteStatus & { siteId: string }>;
}

export async function readBatchStatus(
  redis: Redis,
  batchId: string,
): Promise<BatchStatusResponse | null> {
  const key = `${BATCH_KEY_PREFIX}${batchId}`;
  const all = await redis.hgetall(key);

  if (!all || !all["meta"]) return null;

  const meta = JSON.parse(all["meta"]) as ImportBatchMeta;
  const sites: Array<ImportBatchSiteStatus & { siteId: string }> = [];

  for (const [field, value] of Object.entries(all)) {
    if (field.startsWith("site:")) {
      const siteId = field.slice(5);
      const siteStatus = JSON.parse(value) as ImportBatchSiteStatus;
      sites.push({ ...siteStatus, siteId });
    }
  }

  const completed = sites.filter((s) => s.status === "complete").length;
  const failed = sites.filter((s) => s.status === "error").length;

  return {
    batchId,
    total: meta.total,
    completed,
    failed,
    status: meta.status,
    createdAt: meta.createdAt,
    sites,
  };
}
