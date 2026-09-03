/**
 * Idempotent backfill: scan all objects in the R2 bucket via S3 API
 * and write the totals to the r2_usage MongoDB collection.
 *
 * CLI usage: cd services/content-pipeline && pnpm tsx src/stats/backfill-r2.ts
 * HTTP usage: POST /backfill-r2 on the content-pipeline server
 *
 * Requires: MONGODB_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CLOUDFLARE_ACCOUNT_ID
 * Optional: R2_BUCKET (defaults to "atl-assets-prod")
 */
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getMongoDb, closeMongo } from "../lib/mongo.js";
import { R2_COLLECTION } from "./r2-tally.js";

interface R2TallyDoc {
  _id: string;
  totalBytes: number;
  totalImages: number;
  lastUpdated: Date | null;
}

export interface BackfillR2Result {
  totalBytes: number;
  totalImages: number;
  totalMB: string;
}

/**
 * Scan the entire R2 bucket and overwrite the r2_usage tally in MongoDB.
 * Returns the totals. Throws on missing credentials or S3/Mongo errors.
 */
export async function runBackfillR2(): Promise<BackfillR2Result> {
  const bucket = process.env.R2_BUCKET ?? "atl-assets-prod";
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKey || !secretKey) {
    throw new Error("Missing R2 credentials. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });

  let totalBytes = 0;
  let totalImages = 0;
  let continuationToken: string | undefined;

  console.log(`[backfill-r2] Scanning bucket "${bucket}"...`);

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );

    for (const obj of resp.Contents ?? []) {
      totalBytes += obj.Size ?? 0;
      totalImages += 1;
    }

    continuationToken = resp.NextContinuationToken;
    console.log(`[backfill-r2] Scanned ${totalImages} objects so far...`);
  } while (continuationToken);

  const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`[backfill-r2] Total: ${totalImages} objects, ${totalMB} MB`);

  const db = await getMongoDb();
  await db.collection<R2TallyDoc>(R2_COLLECTION).updateOne(
    { _id: "global" },
    { $set: { totalBytes, totalImages, lastUpdated: new Date() } },
    { upsert: true },
  );

  console.log("[backfill-r2] Tally written to MongoDB. Done.");
  return { totalBytes, totalImages, totalMB };
}

// CLI entry point — only runs when this file is executed directly
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("backfill-r2.ts") || process.argv[1].endsWith("backfill-r2.js"));

if (isDirectRun) {
  runBackfillR2()
    .then(() => closeMongo())
    .catch((err) => {
      console.error("[backfill-r2] Fatal:", err);
      process.exit(1);
    });
}
