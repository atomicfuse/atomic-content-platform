import { MongoClient } from "mongodb";
import type { Db } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

/**
 * Lazy, memoized MongoDB connection for the dashboard.
 * Same pattern as content-pipeline's getMongoDb().
 * Reads MONGODB_URL (or MONGODB_URI) from env.
 */
export async function getMongoDb(): Promise<Db> {
  if (dbPromise) return dbPromise;

  if (!clientPromise) {
    const url = process.env.MONGODB_URL ?? process.env.MONGODB_URI;
    if (!url) {
      throw new Error(
        "MONGODB_URL (or MONGODB_URI) is required. " +
          "Set it in .env.local for local dev or via cloudgrid secrets.",
      );
    }

    const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000 });
    clientPromise = client.connect().catch((err) => {
      clientPromise = null; // allow retry on next call
      dbPromise = null;
      throw err;
    });

    /** DB name: explicit env override, or let the driver use the name from
     *  the connection string (e.g. …/sites-platform-e297?authSource=admin).
     *  Avoids hand-parsing MongoDB URLs that `new URL()` can't handle
     *  (replica sets, SRV, etc.). */
    const explicitDb = process.env.MONGODB_DB;
    dbPromise = clientPromise.then((c) =>
      explicitDb ? c.db(explicitDb) : c.db(),
    );
  }

  return dbPromise!;
}

/** Graceful shutdown — for tests. */
export async function closeMongo(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise;
  await client.close();
  clientPromise = null;
  dbPromise = null;
}
