import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { getAttention, getAllAttention } from "../repo.js";
import { ALERT_STATE_COLLECTION } from "../run.js";
import type { AlertState } from "../types.js";

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

const d = (iso: string): Date => new Date(iso);
const now = new Date("2026-06-07T12:00:00Z");

async function seed(): Promise<void> {
  const db = await getMongoDb();
  const docs: AlertState[] = [
    // travelswire: two alerting conditions + one ok
    {
      _id: "travelswire:monthly_creation_alert",
      status: "alerting",
      firstDetectedAt: d("2026-06-05T10:00:00Z"),
      lastFiredAt: d("2026-06-06T10:00:00Z"),
      lastValue: 7,
    },
    {
      _id: "travelswire:sync_failed",
      status: "alerting",
      firstDetectedAt: d("2026-06-06T10:00:00Z"),
      lastFiredAt: d("2026-06-06T10:00:00Z"),
      lastValue: null,
    },
    {
      _id: "travelswire:in_review",
      status: "ok",
      firstDetectedAt: null,
      lastFiredAt: null,
      lastValue: 0,
    },
    // wineoceans: one alerting (in_review carries a value)
    {
      _id: "wineoceans:in_review",
      status: "alerting",
      firstDetectedAt: d("2026-06-04T10:00:00Z"),
      lastFiredAt: d("2026-06-06T10:00:00Z"),
      lastValue: 12,
    },
    // wineoceans: tracking_off alerting (no value)
    {
      _id: "wineoceans:tracking_off",
      status: "alerting",
      firstDetectedAt: d("2026-06-03T10:00:00Z"),
      lastFiredAt: d("2026-06-06T10:00:00Z"),
      lastValue: null,
    },
    // network-scoped reminder — must be excluded
    {
      _id: "__network__:general_images",
      status: "alerting",
      firstDetectedAt: d("2026-06-01T10:00:00Z"),
      lastFiredAt: d("2026-06-06T10:00:00Z"),
      lastValue: null,
    },
  ];
  await db.collection<AlertState>(ALERT_STATE_COLLECTION).insertMany(docs);
}

describe("getAttention", () => {
  it("returns only the given domain's alerting items with correct severity/value", async () => {
    await seed();
    const r = await getAttention("travelswire", now);
    expect(r.siteDomain).toBe("travelswire");
    // sorted by condition for deterministic comparison
    const items = [...r.alerting].sort((a, b) => a.condition.localeCompare(b.condition));
    expect(items).toEqual([
      {
        condition: "monthly_creation_alert",
        severity: "warn",
        since: d("2026-06-05T10:00:00Z"),
        value: 7,
      },
      {
        condition: "sync_failed",
        severity: "critical",
        since: d("2026-06-06T10:00:00Z"),
        value: null,
      },
    ]);
  });

  it("excludes ok docs and includes in_review value but not tracking_off value", async () => {
    await seed();
    const r = await getAttention("wineoceans", now);
    const items = [...r.alerting].sort((a, b) => a.condition.localeCompare(b.condition));
    expect(items).toEqual([
      {
        condition: "in_review",
        severity: "warn",
        since: d("2026-06-04T10:00:00Z"),
        value: 12,
      },
      {
        condition: "tracking_off",
        severity: "warn",
        since: d("2026-06-03T10:00:00Z"),
        value: null,
      },
    ]);
  });

  it("returns empty alerting for a domain with no alerts", async () => {
    await seed();
    const r = await getAttention("ghost", now);
    expect(r).toEqual({ siteDomain: "ghost", alerting: [] });
  });
});

describe("getAllAttention", () => {
  it("groups alerting items per site, excluding ok + network docs", async () => {
    await seed();
    const all = await getAllAttention(now);
    expect(all.map((s) => s.siteDomain).sort()).toEqual(["travelswire", "wineoceans"]);

    const tw = all.find((s) => s.siteDomain === "travelswire");
    expect(tw?.alerting.map((a) => a.condition).sort()).toEqual([
      "monthly_creation_alert",
      "sync_failed",
    ]);

    const wo = all.find((s) => s.siteDomain === "wineoceans");
    expect(wo?.alerting.map((a) => a.condition).sort()).toEqual([
      "in_review",
      "tracking_off",
    ]);

    // No network-scoped doc leaks through.
    expect(all.some((s) => s.siteDomain.startsWith("__network__"))).toBe(false);
  });

  it("returns empty array when nothing is alerting", async () => {
    const all = await getAllAttention(now);
    expect(all).toEqual([]);
  });
});
