/**
 * One-time, idempotent backfill: scan all objects in the R2 bucket via S3 API
 * and write the totals to the r2_usage MongoDB collection.
 *
 * Usage: cd services/content-pipeline && pnpm tsx src/stats/backfill-r2.ts
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

const BUCKET = process.env.R2_BUCKET ?? "atl-assets-prod";
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

async function main(): Promise<void> {
  if (!ACCOUNT_ID || !ACCESS_KEY || !SECRET_KEY) {
    console.error("Missing R2 credentials. Set CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
    process.exit(1);
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  });

  let totalBytes = 0;
  let totalImages = 0;
  let continuationToken: string | undefined;

  console.log(`[backfill-r2] Scanning bucket "${BUCKET}"...`);

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
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

  console.log(`[backfill-r2] Total: ${totalImages} objects, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  const db = await getMongoDb();
  await db.collection<R2TallyDoc>(R2_COLLECTION).updateOne(
    { _id: "global" },
    { $set: { totalBytes, totalImages, lastUpdated: new Date() } },
    { upsert: true },
  );

  console.log("[backfill-r2] Tally written to MongoDB. Done.");
  await closeMongo();
}

main().catch((err) => {
  console.error("[backfill-r2] Fatal:", err);
  process.exit(1);
});
