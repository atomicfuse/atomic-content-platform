import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { getSiteCosts, getAllSiteCosts } from "../repo.js";
import { COST_COLLECTIONS } from "../types.js";

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
  await (await getMongoDb()).dropDatabase();
});

// Wednesday — startOfWeek = Monday 2026-06-08T00:00:00.000Z
const now = new Date("2026-06-10T12:00:00Z");
const d = (iso: string): Date => new Date(iso);

async function seed(): Promise<void> {
  const db = await getMongoDb();

  // site_costs rollup — two models
  await db.collection(COST_COLLECTIONS.siteCosts).insertOne({
    _id: "travelswire" as any,
    byModel: {
      "claude-sonnet-4-6": {
        inputTokens: 2_000_000,
        outputTokens: 1_000_000,
        images: 0,
        costUsd: 21.0,     // 2*3 + 1*15
        estimated: false,
      },
      "gemini-2.5-flash-image": {
        inputTokens: 0,
        outputTokens: 0,
        images: 5,
        costUsd: 0.195,    // 5 * 0.039
        estimated: false,
      },
    },
    totalCostUsd: 21.195,
    updatedAt: d("2026-06-10T10:00:00Z"),
  });

  // cost_events for travelswire
  await db.collection(COST_COLLECTIONS.costEvents).insertMany([
    // this week (>= Mon 2026-06-08) AND last 30d
    { siteDomain: "travelswire", costUsd: 5.0, at: d("2026-06-09T10:00:00Z") } as any,
    // this week AND last 30d
    { siteDomain: "travelswire", costUsd: 3.0, at: d("2026-06-08T01:00:00Z") } as any,
    // NOT this week, but last 30d
    { siteDomain: "travelswire", costUsd: 2.0, at: d("2026-06-05T00:00:00Z") } as any,
    // NOT last 30d
    { siteDomain: "travelswire", costUsd: 100.0, at: d("2026-05-01T00:00:00Z") } as any,
    // different site — should be excluded
    { siteDomain: "other", costUsd: 999.0, at: d("2026-06-09T10:00:00Z") } as any,
  ]);
}

describe("getSiteCosts", () => {
  it("returns rollup + byModel array with costForToken rates + window sums", async () => {
    await seed();
    const r = await getSiteCosts("travelswire", now);

    expect(r.siteDomain).toBe("travelswire");
    expect(r.totalCostUsd).toBeCloseTo(21.195);

    // byModel array
    expect(r.byModel).toHaveLength(2);

    const sonnet = r.byModel.find((m) => m.model === "claude-sonnet-4-6");
    expect(sonnet).toBeDefined();
    expect(sonnet!.tokensUse).toEqual({ input: 2_000_000, output: 1_000_000 });
    expect(sonnet!.images).toBe(0);
    expect(sonnet!.costUsd).toBeCloseTo(21.0);
    expect(sonnet!.estimated).toBe(false);
    // costForToken should carry the pricing-table rates
    expect(sonnet!.costForToken).toEqual({ input: 3.0, output: 15.0 });

    const gemini = r.byModel.find((m) => m.model === "gemini-2.5-flash-image");
    expect(gemini).toBeDefined();
    expect(gemini!.images).toBe(5);
    expect(gemini!.costForToken).toEqual({ perImage: 0.039 });

    // windows: this week = 5 + 3 = 8; last 30d = 5 + 3 + 2 = 10
    expect(r.windows.thisWeekUsd).toBeCloseTo(8.0);
    expect(r.windows.last30dUsd).toBeCloseTo(10.0);
  });

  it("returns zero defaults for a site with no site_costs doc", async () => {
    // No seed — site has no data at all
    const r = await getSiteCosts("ghost", now);

    expect(r.siteDomain).toBe("ghost");
    expect(r.totalCostUsd).toBe(0);
    expect(r.byModel).toEqual([]);
    expect(r.windows.thisWeekUsd).toBe(0);
    expect(r.windows.last30dUsd).toBe(0);
  });

  it("returns zero windows when no cost_events match, even if rollup exists", async () => {
    // Insert a rollup but no cost_events
    const db = await getMongoDb();
    await db.collection(COST_COLLECTIONS.siteCosts).insertOne({
      _id: "onlyrollup" as any,
      byModel: {},
      totalCostUsd: 42.0,
      updatedAt: d("2026-06-01T00:00:00Z"),
    });

    const r = await getSiteCosts("onlyrollup", now);
    expect(r.totalCostUsd).toBeCloseTo(42.0);
    expect(r.windows.thisWeekUsd).toBe(0);
    expect(r.windows.last30dUsd).toBe(0);
  });

  it("costForToken is null for unknown model ids in the rollup", async () => {
    const db = await getMongoDb();
    await db.collection(COST_COLLECTIONS.siteCosts).insertOne({
      _id: "unknownmodel" as any,
      byModel: {
        "mystery-llm-v99": {
          inputTokens: 100,
          outputTokens: 50,
          images: 0,
          costUsd: 0,
          estimated: true,
        },
      },
      totalCostUsd: 0,
      updatedAt: d("2026-06-10T00:00:00Z"),
    });

    const r = await getSiteCosts("unknownmodel", now);
    expect(r.byModel).toHaveLength(1);
    expect(r.byModel[0]!.costForToken).toBeNull();
  });
});

describe("getAllSiteCosts", () => {
  it("returns one entry per site_costs doc", async () => {
    await seed();
    const all = await getAllSiteCosts(now);
    expect(all.map((s) => s.siteDomain).sort()).toEqual(["travelswire"]);
    expect(all[0]!.byModel).toHaveLength(2);
  });

  it("returns empty array when no site_costs docs exist", async () => {
    const all = await getAllSiteCosts(now);
    expect(all).toEqual([]);
  });
});
