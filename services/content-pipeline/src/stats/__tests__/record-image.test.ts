import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { recordImageGenEvent } from "../recorder.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer; let originalUrl: string | undefined;
beforeAll(async () => { originalUrl = process.env.MONGODB_URL; mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); process.env.MONGODB_URL = originalUrl; });
beforeEach(async () => { const db = await getMongoDb(); await db.dropDatabase(); });

describe("recordImageGenEvent", () => {
  it("records a failed image event", async () => {
    await recordImageGenEvent({ siteDomain: "travelswire", slug: "x", ok: false, provider: "gemini", error: "n8n status: failed", at: new Date() });
    const db = await getMongoDb();
    const docs = await db.collection(COLLECTIONS.imageGenEvents).find().toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.ok).toBe(false);
  });

  it("records a successful image event", async () => {
    await recordImageGenEvent({ siteDomain: "travelswire", slug: "y", ok: true, provider: "gemini", error: null, at: new Date() });
    const db = await getMongoDb();
    const docs = await db.collection(COLLECTIONS.imageGenEvents).find().toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.ok).toBe(true);
  });

  it("never throws when Mongo unreachable (failure isolation)", async () => {
    await closeMongo(); process.env.MONGODB_URL = "mongodb://127.0.0.1:1/none";
    await expect(recordImageGenEvent({ siteDomain: "d", slug: "s", ok: false, provider: null, error: "x", at: new Date() })).resolves.toBeUndefined();
    await closeMongo(); process.env.MONGODB_URL = mem.getUri();
  }, 15000);
});
