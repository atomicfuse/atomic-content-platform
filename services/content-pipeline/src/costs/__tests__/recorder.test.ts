import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { recordTextUsage, recordImageUsage } from "../recorder.js";
import { COST_COLLECTIONS } from "../types.js";

let mem: MongoMemoryServer; let originalUrl: string | undefined;
beforeAll(async () => { originalUrl = process.env.MONGODB_URL; mem = await MongoMemoryServer.create(); process.env.MONGODB_URL = mem.getUri(); });
afterAll(async () => { await closeMongo(); await mem.stop(); process.env.MONGODB_URL = originalUrl; });
beforeEach(async () => { (await getMongoDb()).dropDatabase(); });

describe("recordTextUsage", () => {
  it("records text usage: event + rollup", async () => {
    await recordTextUsage({ siteDomain: "travelswire", source: "scheduler", model: "claude-sonnet", inputTokens: 1_000_000, outputTokens: 1_000_000, estimated: true });
    const db = await getMongoDb();
    expect(await db.collection(COST_COLLECTIONS.costEvents).countDocuments()).toBe(1);
    const sc = await db.collection(COST_COLLECTIONS.siteCosts).findOne({ _id: "travelswire" as any });
    expect(sc!.byModel["claude-sonnet-4-6"].inputTokens).toBe(1_000_000);   // normalized key
    expect(sc!.byModel["claude-sonnet-4-6"].costUsd).toBeCloseTo(18);
    expect(sc!.byModel["claude-sonnet-4-6"].estimated).toBe(true);
    expect(sc!.totalCostUsd).toBeCloseTo(18);
  });

  it("accumulates across calls and tracks images", async () => {
    await recordTextUsage({ siteDomain: "s", source: "dashboard", model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0, estimated: false });
    await recordImageUsage({ siteDomain: "s", source: "scheduler", model: "gemini-2.5-flash-image", images: 10 });
    const db = await getMongoDb();
    const sc = await db.collection(COST_COLLECTIONS.siteCosts).findOne({ _id: "s" as any });
    expect(sc!.byModel["gpt-4o-mini"].costUsd).toBeCloseTo(0.15);
    expect(sc!.byModel["gemini-2.5-flash-image"].images).toBe(10);
    expect(sc!.byModel["gemini-2.5-flash-image"].costUsd).toBeCloseTo(0.39);
    expect(sc!.totalCostUsd).toBeCloseTo(0.54);
  });

  it("never throws when Mongo unreachable", async () => {
    await closeMongo(); process.env.MONGODB_URL = "mongodb://127.0.0.1:1/none";
    await expect(recordTextUsage({ siteDomain:"d", source:"dashboard", model:"gpt-4o-mini", inputTokens:1, outputTokens:1, estimated:false })).resolves.toBeUndefined();
    await closeMongo(); process.env.MONGODB_URL = mem.getUri();
  }, 15000);
});
