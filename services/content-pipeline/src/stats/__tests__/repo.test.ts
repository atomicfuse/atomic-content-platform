import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { getSiteStats, getAllSiteStats } from "../repo.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer; let originalUrl: string | undefined;
beforeAll(async () => { originalUrl = process.env.MONGODB_URL; mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); process.env.MONGODB_URL = originalUrl; });
beforeEach(async () => { (await getMongoDb()).dropDatabase(); });

const now = new Date("2026-06-10T12:00:00Z"); // Wednesday; startOfWeek = Monday 2026-06-08T00:00Z
const d = (iso: string) => new Date(iso);

async function seed() {
  const db = await getMongoDb();
  await db.collection(COLLECTIONS.siteStats).insertOne({
    _id: "travelswire" as any, lastRunAt: d("2026-06-10T10:00:00Z"),
    lastAddedAt: d("2026-06-10T10:00:00Z"), lastAddedSource: "scheduler", lastAddedCount: 2,
    lastFailedAt: null, totalCreated: 50,
    schedule: { articlesPerDay: 3, preferredDays: ["Monday","Wednesday"], weeklyTarget: 6 },
    updatedAt: d("2026-06-10T10:00:00Z"),
  });
  await db.collection(COLLECTIONS.generationEvents).insertMany([
    { siteDomain: "travelswire", created: 2, failed: 1, finishedAt: d("2026-06-09T10:00:00Z") } as any, // this week, last7d
    { siteDomain: "travelswire", created: 1, failed: 0, finishedAt: d("2026-06-05T10:00:00Z") } as any, // last7d, NOT this week
    { siteDomain: "travelswire", created: 4, failed: 2, finishedAt: d("2026-05-20T10:00:00Z") } as any, // last30d only
    { siteDomain: "other", created: 9, failed: 9, finishedAt: d("2026-06-09T10:00:00Z") } as any,      // different site
  ]);
  await db.collection(COLLECTIONS.imageGenEvents).insertMany([
    { siteDomain: "travelswire", ok: false, at: d("2026-06-09T10:00:00Z") } as any, // last7d
    { siteDomain: "travelswire", ok: true,  at: d("2026-06-09T10:00:00Z") } as any, // success, not counted
    { siteDomain: "travelswire", ok: false, at: d("2026-05-25T10:00:00Z") } as any, // last30d only
  ]);
}

describe("getSiteStats", () => {
  it("computes windows + rollup", async () => {
    await seed();
    const r = await getSiteStats("travelswire", now);
    expect(r.thisWeek).toEqual({ created: 2, expected: 6 });          // only the 06-09 event is >= Mon 06-08
    expect(r.failedArticles).toEqual({ last7d: 1, last30d: 3 });       // 1 (06-09) within 7d; +2 (05-20) within 30d
    expect(r.imageGenFailed).toEqual({ last7d: 1, last30d: 2 });
    expect(r.lastAdded).toEqual({ at: d("2026-06-10T10:00:00Z"), source: "scheduler", count: 2 });
    expect(r.schedule!.weeklyTarget).toBe(6);
  });
  it("returns null/zero defaults for a site with no data", async () => {
    const r = await getSiteStats("ghost", now);
    expect(r.schedule).toBeNull();
    expect(r.thisWeek).toEqual({ created: 0, expected: 0 });
    expect(r.lastAdded).toEqual({ at: null, source: null, count: null });
    expect(r.failedArticles).toEqual({ last7d: 0, last30d: 0 });
  });
});

describe("getAllSiteStats", () => {
  it("returns one entry per site_stats doc", async () => {
    await seed();
    const all = await getAllSiteStats(now);
    expect(all.map((s) => s.siteDomain).sort()).toEqual(["travelswire"]); // only travelswire has a site_stats doc
  });
});
