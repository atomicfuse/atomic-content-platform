import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { incrementR2Tally, getR2Usage, R2_COLLECTION } from "../r2-tally.js";

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
  await db.collection(R2_COLLECTION).deleteMany({});
});

describe("incrementR2Tally", () => {
  it("creates tally document on first call", async () => {
    await incrementR2Tally(1024, 1);
    const usage = await getR2Usage();
    expect(usage.totalBytes).toBe(1024);
    expect(usage.totalImages).toBe(1);
  });

  it("increments existing tally", async () => {
    await incrementR2Tally(1000, 1);
    await incrementR2Tally(2000, 3);
    const usage = await getR2Usage();
    expect(usage.totalBytes).toBe(3000);
    expect(usage.totalImages).toBe(4);
  });
});

describe("getR2Usage", () => {
  it("returns zeroes when no tally exists", async () => {
    const usage = await getR2Usage();
    expect(usage).toEqual({
      totalBytes: 0,
      totalImages: 0,
      capacityPct: 0,
      lastUpdated: null,
    });
  });

  it("computes capacityPct from totalBytes", async () => {
    // 5GB of 10GB default capacity = 50%
    await incrementR2Tally(5 * 1024 * 1024 * 1024, 100);
    const usage = await getR2Usage();
    expect(usage.capacityPct).toBeCloseTo(50, 0);
    expect(usage.totalImages).toBe(100);
  });
});
