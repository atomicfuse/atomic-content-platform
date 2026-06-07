import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { backfillFromHistory } from "../backfill.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer; let originalUrl: string | undefined;
beforeAll(async () => { originalUrl = process.env.MONGODB_URL; mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); process.env.MONGODB_URL = originalUrl; });
beforeEach(async () => { (await getMongoDb()).dropDatabase(); });

const entries = [
  { timestamp: "2026-06-01T14:00:00Z", timezone: "EST", forced: false,
    sites: [
      { domain: "travelswire", status: "success", articlesCreated: 3, articlesRequested: 3 },
      { domain: "wtpop", status: "error", articlesCreated: 0, articlesRequested: 2, message: "boom" },
    ], skipped: [] },
  { timestamp: "2026-06-02T14:00:00Z", timezone: "EST", forced: false,
    sites: [ { domain: "travelswire", status: "partial", articlesCreated: 1, articlesRequested: 3 } ], skipped: [] },
] as any;

describe("backfillFromHistory", () => {
  it("creates events + rebuilds rollups", async () => {
    const r = await backfillFromHistory(entries);
    expect(r.eventsUpserted).toBe(3);
    const db = await getMongoDb();
    expect(await db.collection(COLLECTIONS.generationEvents).countDocuments()).toBe(3);
    const tw = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "travelswire" as any });
    expect(tw!.totalCreated).toBe(4);                                   // 3 + 1
    expect(tw!.lastAddedAt).toEqual(new Date("2026-06-02T14:00:00Z"));  // latest with created>0
    expect(tw!.lastAddedCount).toBe(1);
    expect(tw!.lastFailedAt).toBeNull();
    const wt = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "wtpop" as any });
    expect(wt!.lastFailedAt).toEqual(new Date("2026-06-01T14:00:00Z"));
    expect(wt!.lastAddedAt).toBeNull();
  });

  it("is idempotent (re-run does not duplicate)", async () => {
    await backfillFromHistory(entries);
    await backfillFromHistory(entries);
    const db = await getMongoDb();
    expect(await db.collection(COLLECTIONS.generationEvents).countDocuments()).toBe(3);
    const tw = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "travelswire" as any });
    expect(tw!.totalCreated).toBe(4); // not 8
  });
});
