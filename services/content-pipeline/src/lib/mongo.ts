import { MongoClient, type Db } from "mongodb";

/** DB name within the cluster. Override via MONGODB_DB if needed. */
const DB_NAME = process.env.MONGODB_DB ?? "atl_ops";

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
    dbPromise = clientPromise.then((c) => c.db(DB_NAME));
  }
  return dbPromise;
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
