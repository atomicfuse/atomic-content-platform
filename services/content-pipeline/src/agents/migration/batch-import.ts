import { randomUUID } from "node:crypto";
import type { FlowProducer, JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import {
  IMPORT_SITE_QUEUE,
  IMPORT_FINALIZE_QUEUE,
  MAX_IMPORT_BATCH_SIZE,
  DEFAULT_IMPORT_JOB_OPTIONS,
} from "../../queue/types.js";
import type { ImportSiteJobData, ImportFinalizeData } from "../../queue/types.js";
import { domainToSiteId } from "./site-scaffolder.js";
import { writeBatchMeta, writeSiteStatus } from "./import-status.js";

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate CSV rows before enqueuing.
 * Checks: non-empty, max size, no duplicates, every row has a name or domain.
 */
export function validateBatch(rows: Record<string, string>[]): ValidationResult {
  if (rows.length === 0) {
    return { ok: false, error: "CSV is empty — no rows to import" };
  }

  if (rows.length > MAX_IMPORT_BATCH_SIZE) {
    return {
      ok: false,
      error: `Batch too large: ${rows.length} rows exceeds maximum of ${MAX_IMPORT_BATCH_SIZE}`,
    };
  }

  // Check for missing identifiers
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const name = row["Site Name"]?.trim() || row["Name"]?.trim() || "";
    const domain = row["domain"]?.trim() || "";
    if (!name && !domain) {
      return { ok: false, error: `Row ${i + 1} is missing both "Site Name" and "domain"` };
    }
  }

  // Check for duplicate domains
  const seen = new Set<string>();
  for (const row of rows) {
    const domain = row["domain"]?.trim() || row["Site Name"]?.trim() || "";
    const siteId = domainToSiteId(domain);
    if (seen.has(siteId)) {
      return { ok: false, error: `Duplicate domain in CSV: "${domain}" (siteId: ${siteId})` };
    }
    seen.add(siteId);
  }

  return { ok: true };
}

export interface SubmitBatchResult {
  batchId: string;
  total: number;
  siteIds: string[];
}

/**
 * Submit a validated batch of CSV rows as BullMQ jobs.
 *
 * Creates:
 * - One Redis hash with batch metadata + per-site "pending" status
 * - One BullMQ Flow: parent finalize + child site imports
 *
 * Returns the batch ID for polling.
 */
export async function submitBatch(
  rows: Record<string, string>[],
  flowProducer: FlowProducer,
  redis: Redis,
): Promise<SubmitBatchResult> {
  const batchId = randomUUID();
  const now = new Date().toISOString();

  // Compute siteIds
  const siteIds: string[] = [];
  const children: Array<{
    name: string;
    queueName: string;
    data: ImportSiteJobData;
    opts: JobsOptions;
  }> = [];

  for (const row of rows) {
    const domain = row["domain"]?.trim() || row["Site Name"]?.trim() || "";
    const siteId = domainToSiteId(domain);
    siteIds.push(siteId);

    children.push({
      name: `import-${siteId}`,
      queueName: IMPORT_SITE_QUEUE,
      data: { batchId, siteId, row },
      opts: DEFAULT_IMPORT_JOB_OPTIONS,
    });
  }

  // Write batch metadata to Redis
  await writeBatchMeta(redis, batchId, {
    total: rows.length,
    status: "pending",
    createdAt: now,
  });

  // Write initial "pending" status for each site
  for (const siteId of siteIds) {
    await writeSiteStatus(redis, batchId, siteId, { status: "pending" });
  }

  // Create the BullMQ Flow: parent finalize + child site imports
  await flowProducer.add({
    name: "import-finalize",
    queueName: IMPORT_FINALIZE_QUEUE,
    data: {
      batchId,
      siteIds,
    } satisfies ImportFinalizeData,
    opts: {
      jobId: `import-finalize-${batchId.slice(0, 8)}`,
    },
    children,
  });

  // Update batch status to running
  await writeBatchMeta(redis, batchId, {
    total: rows.length,
    status: "running",
    createdAt: now,
  });

  console.log(`[batch-import] Enqueued batch ${batchId.slice(0, 8)}: ${rows.length} sites`);

  return { batchId, total: rows.length, siteIds };
}
