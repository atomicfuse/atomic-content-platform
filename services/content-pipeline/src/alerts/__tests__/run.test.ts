import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted to the top of the module by Vitest
// ---------------------------------------------------------------------------

const mockNotifyAttention = vi.fn();
const mockGatherInputs = vi.fn();
const mockReviewCount = vi.fn();
const mockListActiveSites = vi.fn();
const mockReadSiteBrief = vi.fn();
const mockLoadConfig = vi.fn();
const mockCreateOctokit = vi.fn();
const mockReadFile = vi.fn();
const mockLoadAlertConfig = vi.fn();
const mockBuildScheduleFromBrief = vi.fn();

vi.mock("../../lib/notifications.js", () => ({
  notifyAttention: (...args: unknown[]): unknown => mockNotifyAttention(...args),
}));

vi.mock("../inputs.js", () => ({
  gatherInputs: (...args: unknown[]): unknown => mockGatherInputs(...args),
  reviewCount: (...args: unknown[]): unknown => mockReviewCount(...args),
}));

vi.mock("../../lib/site-brief.js", () => ({
  listActiveSites: (...args: unknown[]): unknown => mockListActiveSites(...args),
  readSiteBrief: (...args: unknown[]): unknown => mockReadSiteBrief(...args),
}));

vi.mock("../../lib/config.js", () => ({
  loadConfig: (...args: unknown[]): unknown => mockLoadConfig(...args),
  // run.ts re-exports DASHBOARD_URL from here, so the mock must provide it.
  DASHBOARD_PUBLIC_URL: "https://dashboard.test",
}));

vi.mock("../../lib/github.js", () => ({
  createOctokit: (...args: unknown[]): unknown => mockCreateOctokit(...args),
  readFile: (...args: unknown[]): unknown => mockReadFile(...args),
}));

vi.mock("../../stats/schedule.js", () => ({
  buildScheduleFromBrief: (...args: unknown[]): unknown => mockBuildScheduleFromBrief(...args),
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
import { runAlerts, runAfterRun, DASHBOARD_URL } from "../run.js";
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

/** Config with all reminders disabled — isolates per-condition fire counts. */
function cfgNoReminders(): AlertConfig {
  return cfg({
    reminders: {
      createNewSite: { enabled: false, everyDays: 14 },
      generalImages: { enabled: false },
    },
  });
}

const OK_INPUTS = {
  syncOk: true,
  trackingOff: false,
  reviewCount: 0,
  createdLast30d: 20,
  failedLast30d: 0,
  createdLast14d: 10,
  expectedMonthly: 30,
  siteName: "TravelSwire",
  generalImages: 0,
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
  mockReadSiteBrief.mockResolvedValue({
    domain: SITE,
    siteName: "TravelSwire",
    brief: { schedule: { articles_per_day: 2, preferred_days: ["Monday", "Wednesday", "Friday"] } },
  });
  mockBuildScheduleFromBrief.mockReturnValue({
    articlesPerDay: 2,
    preferredDays: ["Monday", "Wednesday", "Friday"],
    weeklyTarget: 6,
  });
  mockGatherInputs.mockResolvedValue({ ...OK_INPUTS });
  mockReviewCount.mockResolvedValue(0);
  mockNotifyAttention.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// tracking_off
// ---------------------------------------------------------------------------

describe("runAlerts — tracking_off", () => {
  it("fires with updated message (no pixel mention) and includes dashboard link", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, trackingOff: true });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      { slackWebhookUrl: "https://hooks.slack/x" },
      `⚠ TravelSwire: no analytics provider (GA4/GTM) configured\n${DASHBOARD_URL}/sites/${SITE}`,
    );

    const state = await getState(`${SITE}:tracking_off`);
    expect(state).not.toBeNull();
    expect(state!.status).toBe("alerting");
    expect(state!.lastFiredAt).toEqual(NOW);
  });
});

// ---------------------------------------------------------------------------
// monthly_creation_alert
// ---------------------------------------------------------------------------

describe("runAlerts — monthly_creation_alert", () => {
  it("fires when failed > 70% of expected and includes dashboard link", async () => {
    // expectedMonthly=30, failedLast30d=22 → 22 > 0.7*30=21 → alert
    mockGatherInputs.mockResolvedValue({
      ...OK_INPUTS,
      failedLast30d: 22,
      createdLast30d: 8,
      expectedMonthly: 30,
    });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("Article creation alert: TravelSwire — only 8 articles created this month out of 30 expected"),
    );
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(`${DASHBOARD_URL}/sites/${SITE}`),
    );
  });

  it("does not fire when failures are below threshold", async () => {
    // expectedMonthly=30, failedLast30d=5 → 5 > 21 → false
    mockGatherInputs.mockResolvedValue({
      ...OK_INPUTS,
      failedLast30d: 5,
      createdLast30d: 25,
      expectedMonthly: 30,
    });

    await runAlerts(NOW);

    expect(mockNotifyAttention).not.toHaveBeenCalled();
  });

  it("does not fire when expectedMonthly is 0", async () => {
    mockGatherInputs.mockResolvedValue({
      ...OK_INPUTS,
      failedLast30d: 10,
      createdLast30d: 0,
      expectedMonthly: 0,
    });

    await runAlerts(NOW);

    expect(mockNotifyAttention).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// zero_articles_14d
// ---------------------------------------------------------------------------

describe("runAlerts — zero_articles_14d", () => {
  it("fires when 0 articles created in 14d and includes dashboard link", async () => {
    mockGatherInputs.mockResolvedValue({
      ...OK_INPUTS,
      createdLast14d: 0,
    });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("0 articles created in the last 14 days"),
    );
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining(`${DASHBOARD_URL}/sites/${SITE}`),
    );
  });

  it("does not fire when articles were created in 14d", async () => {
    mockGatherInputs.mockResolvedValue({
      ...OK_INPUTS,
      createdLast14d: 5,
    });

    await runAlerts(NOW);

    expect(mockNotifyAttention).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// in_review
// ---------------------------------------------------------------------------

describe("runAlerts — in_review", () => {
  it("fires once when crossing the limit with updated message format", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, reviewCount: 20 });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      `⚠ TravelSwire: 20 articles in review (limit 15)\n${DASHBOARD_URL}/sites/${SITE}`,
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
// sync_failed
// ---------------------------------------------------------------------------

describe("runAlerts — sync_failed", () => {
  it("fires with updated message including siteName and dashboard link", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, syncOk: false });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      `🔴 TravelSwire: content sync failed — visitors see old content\n${DASHBOARD_URL}/sites/${SITE}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Slack failure
// ---------------------------------------------------------------------------

describe("runAlerts — Slack failure", () => {
  it("does NOT persist state when notifyAttention returns false, and retries next run", async () => {
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, trackingOff: true });
    mockNotifyAttention.mockResolvedValue(false);

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
    const state = await getState(`${SITE}:tracking_off`);
    expect(state?.lastFiredAt ?? null).toBeNull();

    // Next run: Slack recovers → it fires again (retry).
    mockNotifyAttention.mockResolvedValue(true);
    await runAlerts(new Date(NOW.getTime() + 60 * 60 * 1000));

    expect(mockNotifyAttention).toHaveBeenCalledTimes(2);
    const after = await getState(`${SITE}:tracking_off`);
    expect(after!.status).toBe("alerting");
    expect(after!.lastFiredAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// general_images reminder
// ---------------------------------------------------------------------------

describe("runAlerts — general_images reminder", () => {
  it("fires when totalGeneralImages > 0 with correct message and link", async () => {
    mockLoadAlertConfig.mockResolvedValue(
      cfg({
        reminders: {
          createNewSite: { enabled: false, everyDays: 14 },
          generalImages: { enabled: true },
        },
      }),
    );
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, generalImages: 12 });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      `📷 There are 12 articles using a general image — review it here:\n${DASHBOARD_URL}/articles/general-images`,
    );
    const state = await getState("__network__:general_images");
    expect(state).not.toBeNull();
    expect(state!.lastFiredAt).toEqual(NOW);
  });

  it("does not fire when totalGeneralImages is 0", async () => {
    mockLoadAlertConfig.mockResolvedValue(
      cfg({
        reminders: {
          createNewSite: { enabled: false, everyDays: 14 },
          generalImages: { enabled: true },
        },
      }),
    );
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, generalImages: 0 });

    await runAlerts(NOW);

    // No per-site conditions firing, no reminder should fire
    expect(mockNotifyAttention).not.toHaveBeenCalled();
  });

  it("respects 7-day interval — does not re-fire within 7 days", async () => {
    mockLoadAlertConfig.mockResolvedValue(
      cfg({
        reminders: {
          createNewSite: { enabled: false, everyDays: 14 },
          generalImages: { enabled: true },
        },
      }),
    );
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS, generalImages: 5 });

    // First fire
    await runAlerts(NOW);
    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);

    // 3 days later — should NOT re-fire
    mockNotifyAttention.mockClear();
    const threeDaysLater = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000);
    await runAlerts(threeDaysLater);
    expect(mockNotifyAttention).not.toHaveBeenCalled();

    // 8 days later — should re-fire
    mockNotifyAttention.mockClear();
    const eightDaysLater = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    await runAlerts(eightDaysLater);
    expect(mockNotifyAttention).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// create_new_site reminder
// ---------------------------------------------------------------------------

describe("runAlerts — create_new_site reminder", () => {
  it("fires with dashboard link to wizard", async () => {
    mockLoadAlertConfig.mockResolvedValue(
      cfg({
        reminders: {
          createNewSite: { enabled: true, everyDays: 14 },
          generalImages: { enabled: false },
        },
      }),
    );
    mockGatherInputs.mockResolvedValue({ ...OK_INPUTS });

    await runAlerts(NOW);

    expect(mockNotifyAttention).toHaveBeenCalledWith(
      expect.anything(),
      `Time to create a new site\n${DASHBOARD_URL}/wizard`,
    );
  });
});

// ---------------------------------------------------------------------------
// orphan cleanup
// ---------------------------------------------------------------------------

describe("runAlerts — orphan cleanup", () => {
  it("clears orphaned failed_articles and review_backlog docs on a full tick", async () => {
    const db = await getMongoDb();
    // Seed stale docs from removed conditions
    await db.collection<AlertState>(COLLECTION).insertMany([
      {
        _id: "travelswire:failed_articles" as any,
        status: "alerting",
        firstDetectedAt: new Date("2026-06-01T00:00:00Z"),
        lastFiredAt: new Date("2026-06-07T00:00:00Z"),
        lastValue: 5,
      },
      {
        _id: "__network__:review_backlog" as any,
        status: "alerting",
        firstDetectedAt: new Date("2026-06-01T00:00:00Z"),
        lastFiredAt: new Date("2026-06-07T00:00:00Z"),
        lastValue: null,
      },
      // This one is valid and should NOT be cleared
      {
        _id: "travelswire:tracking_off" as any,
        status: "alerting",
        firstDetectedAt: new Date("2026-06-01T00:00:00Z"),
        lastFiredAt: new Date("2026-06-07T00:00:00Z"),
        lastValue: null,
      },
    ]);

    await runAlerts(NOW);

    // Orphaned docs should be cleared to "ok"
    const fa = await getState("travelswire:failed_articles");
    expect(fa!.status).toBe("ok");
    expect(fa!.firstDetectedAt).toBeNull();

    const rb = await getState("__network__:review_backlog");
    expect(rb!.status).toBe("ok");
    expect(rb!.firstDetectedAt).toBeNull();

    // Valid doc should still be evaluated (tracking_off is a real condition)
    const to = await getState("travelswire:tracking_off");
    expect(to).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runAfterRun
// ---------------------------------------------------------------------------

describe("runAfterRun", () => {
  it("evaluates only monthly_creation_alert, zero_articles_14d, and in_review for the single domain", async () => {
    mockGatherInputs.mockResolvedValue({
      ...OK_INPUTS,
      syncOk: false, // would fire sync_failed IF it were evaluated
      trackingOff: true, // would fire tracking_off IF it were evaluated
      reviewCount: 20, // over limit → fires
      createdLast14d: 0, // fires zero_articles_14d
      failedLast30d: 22, // over 70% of 30 expected → fires monthly_creation_alert
    });

    await runAfterRun(SITE, NOW);

    // Three conditions evaluated → three fires.
    expect(mockNotifyAttention).toHaveBeenCalledTimes(3);
    const messages = mockNotifyAttention.mock.calls.map((c) => String(c[1]));
    expect(messages).toContainEqual(expect.stringContaining("articles in review"));
    expect(messages).toContainEqual(expect.stringContaining("0 articles created in the last 14 days"));
    expect(messages).toContainEqual(expect.stringContaining("Article creation alert"));

    // sync_failed / tracking_off must NOT have been evaluated.
    expect(await getState(`${SITE}:sync_failed`)).toBeNull();
    expect(await getState(`${SITE}:tracking_off`)).toBeNull();
  });
});
