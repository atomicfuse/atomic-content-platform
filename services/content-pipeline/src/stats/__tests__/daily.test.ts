import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { countTodayCreated } from "../daily.js";
import { COLLECTIONS } from "../types.js";

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
  await db.collection(COLLECTIONS.generationEvents).deleteMany({});
});

describe("countTodayCreated", () => {
  it("returns 0 when no events exist", async () => {
    const result = await countTodayCreated("travelswire", new Date("2026-06-08T14:00:00Z"));
    expect(result).toBe(0);
  });

  it("counts only today's published articles for the given domain", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COLLECTIONS.generationEvents);
    const today = new Date("2026-06-08T14:00:00Z");
    const yesterday = new Date("2026-06-07T14:00:00Z");

    await coll.insertMany([
      { siteDomain: "travelswire", finishedAt: today, created: 3, failed: 0, status: "success" },
      { siteDomain: "travelswire", finishedAt: yesterday, created: 2, failed: 0, status: "success" },
      { siteDomain: "wineoceans", finishedAt: today, created: 1, failed: 0, status: "success" },
      { siteDomain: "travelswire", finishedAt: today, created: 0, failed: 1, status: "error" },
    ]);

    const result = await countTodayCreated("travelswire", today);
    expect(result).toBe(3);
  });

  it("handles events at midnight boundary correctly", async () => {
    const db = await getMongoDb();
    const coll = db.collection(COLLECTIONS.generationEvents);
    await coll.insertOne({
      siteDomain: "travelswire",
      finishedAt: new Date("2026-06-07T23:59:59Z"),
      created: 5, failed: 0,
      status: "success",
    });
    await coll.insertOne({
      siteDomain: "travelswire",
      finishedAt: new Date("2026-06-08T00:00:00Z"),
      created: 2, failed: 0,
      status: "success",
    });

    const result = await countTodayCreated("travelswire", new Date("2026-06-08T12:00:00Z"));
    expect(result).toBe(2);
  });
});
