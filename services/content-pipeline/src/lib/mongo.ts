import { MongoClient, type Db } from "mongodb";
import { COLLECTIONS } from "../stats/types.js";
import { COST_COLLECTIONS } from "../costs/types.js";

/** Extract the database name from a mongodb:// URL path segment. */
function dbNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // pathname is "/<dbName>" — strip leading slash
    const name = parsed.pathname.replace(/^\//, "");
    if (name) return name;
  } catch {
    // malformed URL — fall through
  }
  return "atl_ops"; // ultimate fallback
}

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

/** Lazy, memoized Mongo client. Throws if neither MONGODB_URL nor MONGODB_URI is set. */
export async function getMongoDb(): Promise<Db> {
  if (!dbPromise) {
    if (!clientPromise) {
      const url = process.env.MONGODB_URL ?? process.env.MONGODB_URI;
      if (!url) throw new Error("MONGODB_URL (or MONGODB_URI) is not set");
      const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
      clientPromise = client.connect().catch((err) => {
        clientPromise = null; // allow retry on next call
        dbPromise = null;
        throw err;
      });
    }
    /** DB name: explicit env > parsed from URL path > fallback.
     *  CloudGrid injects the provisioned DB name in the URL path
     *  (e.g. …/sites-platform-e297?authSource=admin). */
    const dbName = process.env.MONGODB_DB ?? dbNameFromUrl(
      process.env.MONGODB_URL ?? process.env.MONGODB_URI ?? "",
    );
    dbPromise = clientPromise.then((c) => c.db(dbName));
  }
  return dbPromise;
}

export async function ensureStatsIndexes(): Promise<void> {
  const db = await getMongoDb();
  await db.collection(COLLECTIONS.generationEvents).createIndexes([
    { key: { siteDomain: 1, finishedAt: -1 }, name: "siteDomain_finishedAt" },
    { key: { finishedAt: -1 }, name: "finishedAt" },
  ]);
  await db.collection(COLLECTIONS.imageGenEvents).createIndex(
    { siteDomain: 1, at: -1 }, { name: "siteDomain_at" },
  );
}

export async function ensureCostIndexes(): Promise<void> {
  const db = await getMongoDb();
  await db.collection(COST_COLLECTIONS.costEvents).createIndexes([
    { key: { siteDomain: 1, at: -1 }, name: "siteDomain_at" },
    { key: { model: 1, at: -1 }, name: "model_at" },
  ]);
}

/** Close for test teardown / graceful shutdown. */
export async function closeMongo(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.close();
    clientPromise = null;
    dbPromise = null;
  }
}
