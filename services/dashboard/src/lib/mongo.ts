import { MongoClient } from "mongodb";
import type { Db } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;

/** Extract the database name from a mongodb:// URL path segment. */
function dbNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // pathname is "/<dbName>" or "/<dbName>?authSource=admin" — strip leading slash
    const name = parsed.pathname.replace(/^\//, "");
    if (name) return name;
  } catch {
    // malformed URL — fall through
  }
  return "atl_ops"; // ultimate fallback
}

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

    /** DB name: explicit env > parsed from URL path > fallback.
     *  CloudGrid injects the provisioned DB name in the URL path
     *  (e.g. …/sites-platform-e297?authSource=admin). */
    const dbName =
      process.env.MONGODB_DB ?? dbNameFromUrl(url);

    dbPromise = clientPromise.then((c) => c.db(dbName));
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
