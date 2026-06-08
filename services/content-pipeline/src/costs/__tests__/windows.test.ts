import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { extendWindows } from "../windows.js";
import { COST_COLLECTIONS } from "../types.js";
import { COLLECTIONS as STATS_COLLECTIONS } from "../../stats/types.js";

let mem: MongoMemoryServer;
let originalUrl: string | undefined;

beforeAll(async () => {
  originalUrl = process.env.MONGODB_URL;
  mem = await MongoMemoryServer.create();
  process.env.MONGODB_URL = mem.getUri();
});
afterAll(async () => {
  await closeMongo();
  await mem.stop();
  process.env.MONGODB_URL = originalUrl;
});
beforeEach(async () => {
  const db = await getMongoDb();
  await db.collection(COST_COLLECTIONS.costEvents).deleteMany({});
  await db.collection(STATS_COLLECTIONS.generationEvents).deleteMany({});
});

describe("extendWindows", () => {
  const now = new Date("2026-06-08T14:00:00Z");

  it("returns zeroes when no events exist", async () => {
    const result = await extendWindows("travelswire", now);
    expect(result).toEqual({
      todayUsd: 0,
      allTimeTokens: { input: 0, output: 0 },
      avgPerArticle7dUsd: 0,
      created7d: 0,
    });
  });

  it("sums todayUsd from cost_events on the same UTC day", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COST_COLLECTIONS.costEvents);
    await coll.insertMany([
      { siteDomain: "travelswire", at: now, costUsd: 0.50, inputTokens: 1000, outputTokens: 500 },
      { siteDomain: "travelswire", at: now, costUsd: 0.30, inputTokens: 800, outputTokens: 200 },
      { siteDomain: "travelswire", at: new Date("2026-06-07T14:00:00Z"), costUsd: 1.00, inputTokens: 5000, outputTokens: 2000 },
    ]);

    const result = await extendWindows("travelswire", now);
    expect(result.todayUsd).toBeCloseTo(0.80, 2);
  });

  it("sums allTimeTokens across all cost_events", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COST_COLLECTIONS.costEvents);
    await coll.insertMany([
      { siteDomain: "travelswire", at: now, costUsd: 0.50, inputTokens: 1000, outputTokens: 500 },
      { siteDomain: "travelswire", at: new Date("2026-01-01T00:00:00Z"), costUsd: 2.00, inputTokens: 4000, outputTokens: 1500 },
    ]);

    const result = await extendWindows("travelswire", now);
    expect(result.allTimeTokens).toEqual({ input: 5000, output: 2000 });
  });

  it("computes avgPerArticle7dUsd and created7d correctly", async () => {
    const db = await getMongoDb();
    const costColl = db.collection(COST_COLLECTIONS.costEvents);
    const genColl = db.collection(STATS_COLLECTIONS.generationEvents);
    const threeDaysAgo = new Date("2026-06-05T14:00:00Z");

    await costColl.insertMany([
      { siteDomain: "travelswire", at: threeDaysAgo, costUsd: 1.00, inputTokens: 1000, outputTokens: 500 },
      { siteDomain: "travelswire", at: now, costUsd: 0.50, inputTokens: 800, outputTokens: 200 },
    ]);
    await genColl.insertMany([
      { siteDomain: "travelswire", finishedAt: threeDaysAgo, created: 3, status: "success" },
      { siteDomain: "travelswire", finishedAt: now, created: 2, status: "success" },
    ]);

    const result = await extendWindows("travelswire", now);
    expect(result.created7d).toBe(5);
    expect(result.avgPerArticle7dUsd).toBeCloseTo(0.30, 2); // 1.50 / 5
  });

  it("returns 0 avgPerArticle7dUsd when no articles created", async () => {
    const db = await getMongoDb();
    await db.collection(COST_COLLECTIONS.costEvents).insertOne({
      siteDomain: "travelswire", at: now, costUsd: 1.00, inputTokens: 1000, outputTokens: 500,
    });

    const result = await extendWindows("travelswire", now);
    expect(result.avgPerArticle7dUsd).toBe(0);
    expect(result.created7d).toBe(0);
  });
});
