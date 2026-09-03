import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo, ensureStatsIndexes } from "../../lib/mongo.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer;
let originalUrl: string | undefined;
beforeAll(async () => { originalUrl = process.env.MONGODB_URL; mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); process.env.MONGODB_URL = originalUrl; });

describe("ensureStatsIndexes", () => {
  it("creates the expected indexes", async () => {
    await ensureStatsIndexes();
    const db = await getMongoDb();
    const ge = await db.collection(COLLECTIONS.generationEvents).indexes();
    const names = ge.map((i) => i.name);
    expect(names.some((n) => n!.includes("siteDomain"))).toBe(true);
  });
});
