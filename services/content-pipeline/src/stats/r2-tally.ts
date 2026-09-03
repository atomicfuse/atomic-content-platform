import { getMongoDb } from "../lib/mongo.js";

export const R2_COLLECTION = "r2_usage";
const TALLY_ID = "global";

// Default 10GB free tier. Override via R2_CAPACITY_BYTES env var.
const capacityBytes = Number(process.env.R2_CAPACITY_BYTES) || 10 * 1024 * 1024 * 1024;

interface R2TallyDoc {
  _id: string;
  totalBytes: number;
  totalImages: number;
  lastUpdated: Date | null;
}

export interface R2Usage {
  totalBytes: number;
  totalImages: number;
  capacityPct: number;
  lastUpdated: string | null;
}

export async function incrementR2Tally(
  bytes: number,
  imageCount: number,
): Promise<void> {
  const db = await getMongoDb();
  await db.collection<R2TallyDoc>(R2_COLLECTION).updateOne(
    { _id: TALLY_ID },
    {
      $inc: { totalBytes: bytes, totalImages: imageCount },
      $set: { lastUpdated: new Date() },
    },
    { upsert: true },
  );
}

export async function getR2Usage(): Promise<R2Usage> {
  const db = await getMongoDb();
  const doc = await db.collection<R2TallyDoc>(R2_COLLECTION).findOne({ _id: TALLY_ID });

  if (!doc) {
    return { totalBytes: 0, totalImages: 0, capacityPct: 0, lastUpdated: null };
  }

  const totalBytes: number = doc.totalBytes ?? 0;
  const totalImages: number = doc.totalImages ?? 0;
  const capacityPct = (totalBytes / capacityBytes) * 100;
  const lastUpdated = doc.lastUpdated
    ? new Date(doc.lastUpdated).toISOString()
    : null;

  return { totalBytes, totalImages, capacityPct, lastUpdated };
}
