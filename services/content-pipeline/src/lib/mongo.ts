import { MongoClient, type Db } from "mongodb";
import { COLLECTIONS } from "../stats/types.js";

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

/** Lazy, memoized Mongo client. Throws if MONGODB_URL is unset. */
export async function getMongoDb(): Promise<Db> {
  if (!dbPromise) {
    if (!clientPromise) {
      const url = process.env.MONGODB_URL;
      if (!url) throw new Error("MONGODB_URL is not set");
      const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
      clientPromise = client.connect().catch((err) => {
        clientPromise = null; // allow retry on next call
        dbPromise = null;
        throw err;
      });
    }
    /** DB name read at call time so MONGODB_DB set after import (e.g. in tests) is honoured. */
    const dbName = process.env.MONGODB_DB ?? "atl_ops";
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

/** Close for test teardown / graceful shutdown. */
export async function closeMongo(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.close();
    clientPromise = null;
    dbPromise = null;
  }
}
