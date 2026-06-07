import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { recordGeneration } from "../recorder.js";
import { COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer; let originalUrl: string | undefined;
beforeAll(async () => { originalUrl = process.env.MONGODB_URL; mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); process.env.MONGODB_URL = originalUrl; });
beforeEach(async () => { const db = await getMongoDb(); await db.dropDatabase(); });

const started = new Date("2026-06-07T14:00:00Z");
const finished = new Date("2026-06-07T14:02:00Z");
const schedule = { articlesPerDay: 3, preferredDays: ["Monday", "Wednesday"], weeklyTarget: 6 };

function batch(results: Array<{ status: string; message?: string }>, requested = results.length) {
  return { siteDomain: "travelswire", requested, totalSourced: 10, duplicateCount: 0,
    availableNew: 0, n8nImagesTriggered: 0, results } as any;
}

describe("recordGeneration", () => {
  it("inserts an event and upserts rollup with lastAdded set when created>0", async () => {
    await recordGeneration(batch([{ status: "created" }, { status: "created" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: finished }, schedule);
    const db = await getMongoDb();
    const events = await db.collection(COLLECTIONS.generationEvents).find().toArray();
    expect(events).toHaveLength(1);
    const stats = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "travelswire" as any });
    expect(stats!.lastAddedCount).toBe(2);
    expect(stats!.lastAddedSource).toBe("scheduler");
    expect(stats!.totalCreated).toBe(2);
    expect(stats!.lastFailedAt).toBeNull();
    expect(stats!.schedule).toEqual(schedule);
  });

  it("sets lastFailedAt only on full failure (created===0 && status error)", async () => {
    await recordGeneration(batch([{ status: "error", message: "boom" }]),
      { source: "scheduler", forced: false, topicName: null, startedAt: started, finishedAt: finished }, null);
    const db = await getMongoDb();
    const stats = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "travelswire" as any });
    expect(stats!.lastFailedAt).toEqual(finished);
    expect(stats!.lastAddedAt).toBeNull();
  });

  it("accumulates totalCreated across runs", async () => {
    const ctx = { source: "scheduler" as const, forced: false, topicName: null, startedAt: started, finishedAt: finished };
    await recordGeneration(batch([{ status: "created" }]), ctx, schedule);
    await recordGeneration(batch([{ status: "created" }, { status: "created" }]), ctx, schedule);
    const db = await getMongoDb();
    const stats = await db.collection(COLLECTIONS.siteStats).findOne({ _id: "travelswire" as any });
    expect(stats!.totalCreated).toBe(3);
  });

  it("never throws when Mongo is unreachable (failure isolation)", async () => {
    await closeMongo();
    process.env.MONGODB_URL = "mongodb://127.0.0.1:1/none"; // unreachable
    await expect(recordGeneration(batch([{ status: "created" }]),
      { source: "dashboard", forced: false, topicName: null, startedAt: started, finishedAt: finished }, null),
    ).resolves.toBeUndefined();
    await closeMongo(); process.env.MONGODB_URL = mem.getUri(); // restore
  }, 15_000); // mongo serverSelectionTimeoutMS is 5 s; give the test 15 s headroom
});
