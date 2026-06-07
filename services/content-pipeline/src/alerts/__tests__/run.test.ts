import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted to the top of the module by Vitest
// ---------------------------------------------------------------------------

const mockNotifyAttention = vi.fn();
const mockGatherInputs = vi.fn();
const mockReviewCount = vi.fn();
const mockListActiveSites = vi.fn();
const mockLoadConfig = vi.fn();
const mockCreateOctokit = vi.fn();
const mockReadFile = vi.fn();
const mockLoadAlertConfig = vi.fn();

vi.mock("../../lib/notifications.js", () => ({
  notifyAttention: (...args: unknown[]): unknown => mockNotifyAttention(...args),
}));

vi.mock("../inputs.js", () => ({
  gatherInputs: (...args: unknown[]): unknown => mockGatherInputs(...args),
  reviewCount: (...args: unknown[]): unknown => mockReviewCount(...args),
}));

vi.mock("../../lib/site-brief.js", () => ({
  listActiveSites: (...args: unknown[]): unknown => mockListActiveSites(...args),
}));

vi.mock("../../lib/config.js", () => ({
  loadConfig: (...args: unknown[]): unknown => mockLoadConfig(...args),
}));

vi.mock("../../lib/github.js", () => ({
  createOctokit: (...args: unknown[]): unknown => mockCreateOctokit(...args),
  readFile: (...args: unknown[]): unknown => mockReadFile(...args),
}));

// loadAlertConfig is the only thing we mock from config.ts; keep the real
// DEFAULT_ALERT_CONFIG / mergeAlertConfig exports via importOriginal.
vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return {
    ...actual,
    loadAlertConfig: (...args: unknown[]): unknown => mockLoadAlertConfig(...args),
  };
});

// Import the real default config + runner AFTER mocks.
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from "../config.js";
import { getMongoDb, closeMongo } from "../../lib/mongo.js";
import { runAlerts, runAfterRun } from "../run.js";
import type { AlertState } from "../types.js";

// ---------------------------------------------------------------------------
// In-memory Mongo
// ---------------------------------------------------------------------------

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

const COLLECTION = "alert_state";

async function getState(id: string): Promise<AlertState | null> {
  const db = await getMongoDb();
  return db.collection<AlertState>(COLLECTION).findOne({ _id: id });
}

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const SITE = "travelswire";
const NOW = new Date("2026-06-08T12:00:00Z"); // Monday (UTC weekday = 1)

function cfg(overrides: Partial<AlertConfig> = {}): AlertConfig {
  return { ...DEFAULT_ALERT_CONFIG, ...overrides };
}

/** Config with both reminders disabled — isolates per-condition fire counts. */
function cfgNoReminders(): AlertConfig {
  return cfg({
    reminders: {
      reviewBacklog: { enabled: false, weekday: 1 },
      createNewSite: { enabled: false, everyDays: 14 },
    },
  });
}

const OK_INPUTS = {
  failedArticles7d: 0,
  syncOk: true,
  trackingOff: false,
  reviewCount: 0,
};

beforeEach(async () => {
  vi.clearAllMocks();
  await (await getMongoDb()).dropDatabase();

  // Default mock wiring
  mockLoadConfig.mockReturnValue({
    github: { token: "t", repo: "owner/repo" },
    networkRepo: "owner/repo",
    notifications: { slackWebhookUrl: "https://hooks.slack/x" },
  });
  mockCreateOctokit.mockReturnValue({});
  mockReadFile.mockResolvedValue("");
  mockLoadAlertConfig.mockResolvedValue(cfgNoReminders());
  mockListActiveSites.mockResolvedValue([
    { domain: SITE, branch: `staging/${SITE}`, status: "live" },
  ]);
  mockGatherInputs.mockResolvedValue({ ...OK_INPUTS });
  mockReviewCount.mockResolvedValue(0);
  mockNotifyAttention.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// failed_articles
// ---------------------------------------------------------------------------

describe("runAlerts — failed_articles", () => {
  it("fires once with exact text and writes alerting state with lastFiredAt=now", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, failedArticles7d: 5 });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      { slackWebhookUrl: "https://hooks.slack/x" },
      `⚠ ${SITE}: 5 failed articles in 7d (limit 3)`,
    );

    const state = await getState(`${SITE}:failed_articles`);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("alerting");
    expect(state!.lastFiredAt).toEqual(NOW);
    expect(state!.lastValue).toBe(5);
  });

  it("does not fire a second time the same day (transition_then_daily dedup)", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, failedArticles7d: 5 });

    await runAlerts(NOW);
    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);

    // Same day, a few hours later.
    const later = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    await runAlerts(later);

    // Still only one send total.
    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
  });
});

describe("runAlerts — Slack failure", () => {
  it("does NOT persist state when notifyAttention returns false, and retries next run", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, failedArticles7d: 5 });
    mockNotifyAttention.mockResolvedValue(false);

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    // Nothing persisted (or lastFiredAt stays null).
    const state = await getState(`${SITE}:failed_articles`);
    expect(state?.lastFiredAt ?? null).toBeNull();

    // Next run: Slack recovers → it fires again (retry).
    mockNotifyAttention.mockResolvedValue(true);
    await runAlerts(new Date(NOW.getTime() + 60 * 60 * 1000));

    expect(mockNotifyAttention).toHaveBeenCalledTimes(2);
    const after = await getState(`${SITE}:failed_articles`);
    expect(after!.status).toBe("alerting");
    expect(after!.lastFiredAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// in_review
// ---------------------------------------------------------------------------

describe("runAlerts — in_review", () => {
  it("fires once when crossing the limit and clears state when dropping below", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, reviewCount: 20 });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      `⚠ ${SITE}: 20 articles in review (limit 15)`,
    );
    let state = await getState(`${SITE}:in_review`);
    expect(state!.status).toBe("alerting");

    // Drop below the limit → recovery clears status, no new fire.
    mockNotifyAttention.mockClear();
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, reviewCount: 2 });
    await runAlerts(new Date(NOW.getTime() + 60 * 60 * 1000));

    expect(mockNotifyAttention).not.toHaveBeenCalled();
    state = await getState(`${SITE}:in_review`);
    expect(state!.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// review_backlog reminder
// ---------------------------------------------------------------------------

describe("runAlerts — review_backlog reminder", () => {
  it("fires on its weekday with the summed review count and writes __network__ state", async () => {
    // NOW is Monday (weekday 1) which is the default reviewBacklog weekday.
    // Disable createNewSite so only review_backlog can fire as a reminder.
    mockLoadAlertConfig.mockResolvedValue(
      cfg({
        reminders: {
          reviewBacklog: { enabled: true, weekday: 1 },
          createNewSite: { enabled: false, everyDays: 14 },
        },
      }),
    );
    mockListActiveSites.mockResolvedValue([
      { domain: "siteA", branch: "staging/siteA", status: "live" },
      { domain: "siteB", branch: "staging/siteB", status: "live" },
    ]);
    mockGatherInputs.mockImplementation((domain: string) =>
      Promise.resolve({
        ...OK_INPUTS,
        reviewCount: domain === "siteA" ? 4 : 6,
      }),
    );

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      `10 articles waiting for review across the network`,
    );
    const state = await getState("__network__:review_backlog");
    expect(state).not.toBeNull();
    expect(state!.lastFiredAt).toEqual(NOW);
  });

  it("does not fire on a non-weekday", async () => {
    mockLoadAlertConfig.mockResolvedValue(
      cfg({
        reminders: {
          reviewBacklog: { enabled: true, weekday: 1 },
          createNewSite: { enabled: false, everyDays: 14 },
        },
      }),
    );
    // Tuesday (weekday 2) — not the configured Monday.
    const tuesday = new Date("2026-06-09T12:00:00Z");

    await runAlerts(tuesday);

    const reminderCalls = mockNotifyAttention.mock.calls.filter((c) =>
      String(c[1]).includes("waiting for review across the network"),
    );
    expect(reminderCalls).toHaveLength(0);
    expect(await getState("__network__:review_backlog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runAfterRun
// ---------------------------------------------------------------------------

describe("runAfterRun", () => {
  it("evaluates only failed_articles and in_review for the single domain", async () => {
    mockGatherInputs.mockResolvedValue({
      failedArticles7d: 5, // over limit → fires
      syncOk: false, // would fire sync_failed IF it were evaluated
      trackingOff: true, // would fire tracking_off IF it were evaluated
      reviewCount: 20, // over limit → fires
    });

    await runAfterRun(SITE, NOW);

    // Exactly two conditions evaluated → two fires.
    expect(mockNotifyAttention).toHaveBeenCalledTimes(2);
    const messages = mockNotifyAttention.mock.calls.map((c) => String(c[1]));
    expect(messages).toContain(`⚠ ${SITE}: 5 failed articles in 7d (limit 3)`);
    expect(messages).toContain(`⚠ ${SITE}: 20 articles in review (limit 15)`);

    // sync_failed / tracking_off must NOT have been evaluated.
    expect(await getState(`${SITE}:sync_failed`)).toBeNull();
    expect(await getState(`${SITE}:tracking_off`)).toBeNull();
    // gatherInputs called for exactly this site.
    expect(mockGatherInputs).toHaveBeenCalledWith(SITE, NOW);
  });
});
