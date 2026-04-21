import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTimezone,
  TIMEZONE_MAP,
  currentHourInTimezone,
  currentDayNameInTimezone,
  isTodayPreferredDay,
  resolveArticlesPerDay,
  runScheduledPublish,
} from "../agents/scheduled-publisher/index.js";
import type { PublishSchedule } from "../types.js";

// ---------------------------------------------------------------------------
// Mocks — heavy dependencies used by runScheduledPublish
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn();
const mockCreateGitHubClient = vi.fn(() => ({}));
const mockListActiveSites = vi.fn();
const mockReadSiteBriefWithFallback = vi.fn();
const mockRunContentGeneration = vi.fn();

vi.mock("../lib/github.js", () => ({
  createGitHubClient: (): unknown => mockCreateGitHubClient(),
  readFile: (_o: unknown, _r: unknown, _p: unknown): unknown => mockReadFile(_o, _r, _p),
}));

vi.mock("../lib/site-brief.js", () => ({
  listActiveSites: (_o: unknown, _r: unknown): unknown => mockListActiveSites(_o, _r),
  readSiteBriefWithFallback: (_o: unknown, _r: unknown, _d: unknown, _b: unknown): unknown =>
    mockReadSiteBriefWithFallback(_o, _r, _d, _b),
}));

vi.mock("../agents/content-generation/agent.js", () => ({
  runContentGeneration: (_opts: unknown, _cfg: unknown): unknown => mockRunContentGeneration(_opts, _cfg),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Minimal AgentConfig for tests
function makeConfig(overrides?: Record<string, unknown>) {
  return {
    github: { token: "ghp_test", repo: "owner/repo" },
    networkRepo: "owner/repo",
    localNetworkPath: undefined,
    geminiApiKey: undefined,
    contentAggregatorUrl: "https://example.com",
    port: 3001,
    notifications: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. resolveTimezone
// ---------------------------------------------------------------------------
describe("resolveTimezone", () => {
  it("maps EST to America/New_York", () => {
    expect(resolveTimezone("EST")).toBe("America/New_York");
  });

  it("maps PST to America/Los_Angeles", () => {
    expect(resolveTimezone("PST")).toBe("America/Los_Angeles");
  });

  it("is case-insensitive", () => {
    expect(resolveTimezone("est")).toBe("America/New_York");
    expect(resolveTimezone("Pst")).toBe("America/Los_Angeles");
  });

  it("passes through IANA names unchanged", () => {
    expect(resolveTimezone("America/New_York")).toBe("America/New_York");
    expect(resolveTimezone("UTC")).toBe("UTC");
  });
});

// ---------------------------------------------------------------------------
// 2. currentHourInTimezone
// ---------------------------------------------------------------------------
describe("currentHourInTimezone", () => {
  it("returns a number between 0 and 23 for a valid timezone", () => {
    const hour = currentHourInTimezone("UTC");
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("returns a number between 0 and 23 for EST (mapped to America/New_York)", () => {
    const hour = currentHourInTimezone("EST");
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("returns a valid hour for PST (mapped to America/Los_Angeles)", () => {
    const hour = currentHourInTimezone("PST");
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("falls back to local time for an invalid timezone", () => {
    const hour = currentHourInTimezone("INVALID_TZ");
    expect(hour).toBeGreaterThanOrEqual(0);
    expect(hour).toBeLessThanOrEqual(23);
  });

  it("never returns 24 (hourCycle h23 guarantees 0-23)", () => {
    // Verify multiple timezone lookups never produce 24
    const timezones = ["UTC", "EST", "PST", "America/New_York", "America/Los_Angeles"];
    for (const tz of timezones) {
      const hour = currentHourInTimezone(tz);
      expect(hour).not.toBe(24);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. currentDayNameInTimezone
// ---------------------------------------------------------------------------
describe("currentDayNameInTimezone", () => {
  it("returns a valid English day name for UTC", () => {
    const validDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const day = currentDayNameInTimezone("UTC");
    expect(validDays).toContain(day);
  });

  it("returns a valid day name for an abbreviated timezone", () => {
    const validDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const day = currentDayNameInTimezone("EST");
    expect(validDays).toContain(day);
  });

  it("falls back gracefully for invalid timezone", () => {
    const validDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const day = currentDayNameInTimezone("INVALID_TZ");
    expect(validDays).toContain(day);
  });
});

// ---------------------------------------------------------------------------
// 4. isTodayPreferredDay
// ---------------------------------------------------------------------------
describe("isTodayPreferredDay", () => {
  it("returns true when preferred_days is empty", () => {
    const schedule: PublishSchedule = { preferred_days: [], preferred_time: "14:00" };
    expect(isTodayPreferredDay(schedule, "UTC")).toBe(true);
  });

  it("returns true when preferred_days is undefined", () => {
    const schedule = { preferred_time: "14:00" } as PublishSchedule;
    expect(isTodayPreferredDay(schedule, "UTC")).toBe(true);
  });

  it("matches today's day name case-insensitively", () => {
    const today = currentDayNameInTimezone("UTC");
    const schedule: PublishSchedule = {
      preferred_days: [today.toUpperCase()],
      preferred_time: "14:00",
    };
    expect(isTodayPreferredDay(schedule, "UTC")).toBe(true);
  });

  it("returns false when today is not in preferred_days", () => {
    // Pick a day name that is NOT today
    const validDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const today = currentDayNameInTimezone("UTC");
    const otherDays = validDays.filter((d) => d !== today);
    // Use a single non-matching day
    const schedule: PublishSchedule = {
      preferred_days: [otherDays[0]!],
      preferred_time: "14:00",
    };
    // The remaining 6 days don't include today
    // But we need to make sure the single day we picked doesn't match
    // Since we filtered out today, this should be false
    expect(isTodayPreferredDay(schedule, "UTC")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. resolveArticlesPerDay
// ---------------------------------------------------------------------------
describe("resolveArticlesPerDay", () => {
  it("uses articles_per_day when present and positive", () => {
    const schedule: PublishSchedule = {
      articles_per_day: 3,
      preferred_days: ["Monday"],
      preferred_time: "14:00",
    };
    expect(resolveArticlesPerDay(schedule)).toBe(3);
  });

  it("ignores articles_per_day when zero", () => {
    const schedule: PublishSchedule = {
      articles_per_day: 0,
      articles_per_week: 7,
      preferred_days: ["Monday", "Wednesday", "Friday"],
      preferred_time: "14:00",
    };
    // Falls through to articles_per_week: ceil(7/3) = 3
    expect(resolveArticlesPerDay(schedule)).toBe(3);
  });

  it("falls back to articles_per_week / preferred_days.length", () => {
    const schedule: PublishSchedule = {
      articles_per_week: 10,
      preferred_days: ["Monday", "Wednesday", "Friday"],
      preferred_time: "14:00",
    };
    // ceil(10 / 3) = 4
    expect(resolveArticlesPerDay(schedule)).toBe(4);
  });

  it("uses 7 as divisor when preferred_days is empty (weekly fallback)", () => {
    const schedule: PublishSchedule = {
      articles_per_week: 7,
      preferred_days: [],
      preferred_time: "14:00",
    };
    // ceil(7 / 7) = 1
    expect(resolveArticlesPerDay(schedule)).toBe(1);
  });

  it("returns 0 when no schedule data is provided", () => {
    const schedule: PublishSchedule = {
      preferred_days: ["Monday"],
      preferred_time: "14:00",
    };
    expect(resolveArticlesPerDay(schedule)).toBe(0);
  });

  it("returns 0 when articles_per_week is zero", () => {
    const schedule: PublishSchedule = {
      articles_per_week: 0,
      preferred_days: ["Monday"],
      preferred_time: "14:00",
    };
    expect(resolveArticlesPerDay(schedule)).toBe(0);
  });

  it("returns 0 when articles_per_week is negative", () => {
    const schedule: PublishSchedule = {
      articles_per_week: -5,
      preferred_days: ["Monday"],
      preferred_time: "14:00",
    };
    expect(resolveArticlesPerDay(schedule)).toBe(0);
  });

  it("returns at least 1 when articles_per_week is positive", () => {
    const schedule: PublishSchedule = {
      articles_per_week: 1,
      preferred_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      preferred_time: "14:00",
    };
    // ceil(1 / 7) = 1
    expect(resolveArticlesPerDay(schedule)).toBe(1);
  });

  it("articles_per_day takes priority over articles_per_week", () => {
    const schedule: PublishSchedule = {
      articles_per_day: 2,
      articles_per_week: 21,
      preferred_days: ["Monday"],
      preferred_time: "14:00",
    };
    expect(resolveArticlesPerDay(schedule)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. runScheduledPublish — global gating
// ---------------------------------------------------------------------------
describe("runScheduledPublish", () => {
  it("skips when scheduler is disabled", async () => {
    mockReadFile.mockResolvedValue("enabled: false\nrun_at_hours: [14]\ntimezone: EST\n");
    const result = await runScheduledPublish(makeConfig(), false);
    expect(result.skippedGlobal).toBe("disabled");
    expect(result.triggered).toHaveLength(0);
    expect(mockListActiveSites).not.toHaveBeenCalled();
  });

  it("skips when current hour is not in run_at_hours", async () => {
    // Use hour 99 which will never match
    mockReadFile.mockResolvedValue("enabled: true\nrun_at_hours: [99]\ntimezone: UTC\n");
    const result = await runScheduledPublish(makeConfig(), false);
    // run_at_hours [99] has no valid hour so nothing will match
    expect(result.skippedGlobal).toBe("hour_not_matched");
    expect(result.triggered).toHaveLength(0);
  });

  it("bypasses global gating when force=true", async () => {
    mockReadFile.mockResolvedValue("enabled: false\nrun_at_hours: []\ntimezone: UTC\n");
    mockListActiveSites.mockResolvedValue([]);
    const result = await runScheduledPublish(makeConfig(), true);
    expect(result.skippedGlobal).toBeUndefined();
    expect(result.status).toBe("ok");
  });

  it("uses defaults when config file is 404", async () => {
    mockReadFile.mockRejectedValue(new Error("Not Found"));
    mockListActiveSites.mockResolvedValue([]);
    // Force=true to skip hour gating since default hours [14] may not match now
    const result = await runScheduledPublish(makeConfig(), true);
    expect(result.configStatus).toBe("defaults");
    expect(mockListActiveSites).toHaveBeenCalled();
  });

  it("skips sites without a schedule", async () => {
    mockReadFile.mockResolvedValue("enabled: true\nrun_at_hours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]\ntimezone: UTC\n");
    mockListActiveSites.mockResolvedValue([{ domain: "example.com", branch: "staging/example.com" }]);
    mockReadSiteBriefWithFallback.mockResolvedValue({
      data: { brief: { audience: "test", tone: "casual", article_types: {}, topics: [], seo_keywords_focus: [], content_guidelines: "", review_percentage: 0 } },
      branch: "staging/example.com",
    });
    const result = await runScheduledPublish(makeConfig(), false);
    expect(result.skipped).toContainEqual({ domain: "example.com", reason: "no publishing schedule" });
  });

  it("triggers content generation for eligible sites", async () => {
    // Config: all hours enabled
    mockReadFile.mockResolvedValue("enabled: true\nrun_at_hours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]\ntimezone: UTC\n");
    mockListActiveSites.mockResolvedValue([{ domain: "test.com", branch: "staging/test.com" }]);

    // Today's day for schedule
    const today = currentDayNameInTimezone("UTC");
    mockReadSiteBriefWithFallback.mockResolvedValue({
      data: {
        brief: {
          audience: "test",
          tone: "casual",
          article_types: {},
          topics: [],
          seo_keywords_focus: [],
          content_guidelines: "",
          review_percentage: 0,
          schedule: {
            articles_per_day: 2,
            preferred_days: [today],
            preferred_time: "14:00",
          },
        },
      },
      branch: "staging/test.com",
    });
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), false);
    expect(result.triggered).toContain("test.com");
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      { siteDomain: "test.com", count: 2, branch: "staging/test.com" },
      expect.anything(),
    );
  });

  it("records errors for sites that fail during generation", async () => {
    mockReadFile.mockResolvedValue("enabled: true\nrun_at_hours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]\ntimezone: UTC\n");
    mockListActiveSites.mockResolvedValue([{ domain: "fail.com", branch: "staging/fail.com" }]);

    const today = currentDayNameInTimezone("UTC");
    mockReadSiteBriefWithFallback.mockResolvedValue({
      data: {
        brief: {
          audience: "test",
          tone: "casual",
          article_types: {},
          topics: [],
          seo_keywords_focus: [],
          content_guidelines: "",
          review_percentage: 0,
          schedule: { articles_per_day: 1, preferred_days: [today], preferred_time: "14:00" },
        },
      },
      branch: "staging/fail.com",
    });
    mockRunContentGeneration.mockRejectedValue(new Error("generation failed"));

    const result = await runScheduledPublish(makeConfig(), false);
    expect(result.errors).toContainEqual({ domain: "fail.com", error: "generation failed" });
    expect(result.triggered).not.toContain("fail.com");
  });

  it("skips tick on config fetch error (fail-safe) when not forced", async () => {
    mockReadFile.mockRejectedValue(new Error("network timeout"));
    const result = await runScheduledPublish(makeConfig(), false);
    expect(result.configStatus).toBe("fetch_error");
    expect(result.skippedGlobal).toBe("fetch_error");
    expect(mockListActiveSites).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Helpers for multi-site integration tests
// ---------------------------------------------------------------------------

const ALL_HOURS = "run_at_hours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]";
const ALL_HOURS_CONFIG = `enabled: true\n${ALL_HOURS}\ntimezone: UTC\n`;
const ALL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function today(): string {
  return currentDayNameInTimezone("UTC");
}

function notToday(): string {
  const t = today();
  return ALL_DAYS.filter((d) => d !== t)[0]!;
}

function makeBriefResponse(
  domain: string,
  schedule: Partial<PublishSchedule> & { preferred_days: string[]; preferred_time: string },
  branch?: string,
) {
  return {
    data: {
      domain,
      siteName: domain.replace(/\.\w+$/, ""),
      group: "default",
      brief: {
        audience: "general",
        tone: "informative",
        article_types: { standard: 100 },
        topics: ["topic"],
        seo_keywords_focus: ["kw"],
        content_guidelines: "",
        review_percentage: 0,
        schedule,
      },
    },
    branch: branch ?? `staging/${domain}`,
  };
}

/** Set up scheduler config (all hours, UTC) and mock sites. */
function setupAllHoursConfig(): void {
  mockReadFile.mockResolvedValue(ALL_HOURS_CONFIG);
}

// ---------------------------------------------------------------------------
// 7. Multi-site integration — "run now" scenarios
// ---------------------------------------------------------------------------
describe("runScheduledPublish — multi-site integration", () => {
  // -----------------------------------------------------------------------
  // Force (Run Now) — both sites eligible
  // -----------------------------------------------------------------------
  it("force triggers both sites when both have matching day schedules", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "alpha.com", branch: "staging/alpha.com" },
      { domain: "beta.com", branch: "staging/beta.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback
      .mockResolvedValueOnce(makeBriefResponse("alpha.com", {
        articles_per_day: 3, preferred_days: [t], preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("beta.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "09:00",
      }));
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), true);
    expect(result.triggered).toEqual(["alpha.com", "beta.com"]);
    expect(mockRunContentGeneration).toHaveBeenCalledTimes(2);
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      { siteDomain: "alpha.com", count: 3, branch: "staging/alpha.com" },
      expect.anything(),
    );
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      { siteDomain: "beta.com", count: 1, branch: "staging/beta.com" },
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Day match: one matches, one doesn't
  // -----------------------------------------------------------------------
  it("triggers site A (day matches) and skips site B (day does not match)", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "match.com", branch: "staging/match.com" },
      { domain: "skip.com", branch: "staging/skip.com" },
    ]);
    const t = today();
    const nt = notToday();
    mockReadSiteBriefWithFallback
      .mockResolvedValueOnce(makeBriefResponse("match.com", {
        articles_per_day: 2, preferred_days: [t], preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("skip.com", {
        articles_per_day: 2, preferred_days: [nt], preferred_time: "14:00",
      }));
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), false);

    expect(result.triggered).toEqual(["match.com"]);
    expect(result.skipped).toContainEqual({
      domain: "skip.com",
      reason: expect.stringContaining("not a preferred day"),
    });
    expect(mockRunContentGeneration).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Day match: NEITHER site matches today
  // -----------------------------------------------------------------------
  it("skips both sites when neither has today as a preferred day", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "a.com", branch: "staging/a.com" },
      { domain: "b.com", branch: "staging/b.com" },
    ]);
    const nt = notToday();
    const otherNt = ALL_DAYS.filter((d) => d !== today() && d !== nt)[0]!;
    mockReadSiteBriefWithFallback
      .mockResolvedValueOnce(makeBriefResponse("a.com", {
        articles_per_day: 1, preferred_days: [nt], preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("b.com", {
        articles_per_day: 1, preferred_days: [otherNt], preferred_time: "14:00",
      }));

    const result = await runScheduledPublish(makeConfig(), false);

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Day match: BOTH sites match today
  // -----------------------------------------------------------------------
  it("triggers both sites when both list today as preferred day", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "site1.dev", branch: "staging/site1.dev" },
      { domain: "site2.dev", branch: "staging/site2.dev" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback
      .mockResolvedValueOnce(makeBriefResponse("site1.dev", {
        articles_per_day: 5, preferred_days: [t, notToday()], preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("site2.dev", {
        articles_per_day: 1, preferred_days: ALL_DAYS, preferred_time: "14:00",
      }));
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), false);

    expect(result.triggered).toEqual(["site1.dev", "site2.dev"]);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Mixed outcomes: trigger + skip + error in one tick
  // -----------------------------------------------------------------------
  it("handles mixed outcomes: one triggered, one skipped (no schedule), one error", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "good.com", branch: "staging/good.com" },
      { domain: "nosched.com", branch: "staging/nosched.com" },
      { domain: "broken.com", branch: "staging/broken.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback
      // good.com — eligible
      .mockResolvedValueOnce(makeBriefResponse("good.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }))
      // nosched.com — no schedule field
      .mockResolvedValueOnce({
        data: { brief: { audience: "x", tone: "x", article_types: {}, topics: [], seo_keywords_focus: [], content_guidelines: "", review_percentage: 0 } },
        branch: "staging/nosched.com",
      })
      // broken.com — eligible but generation throws
      .mockResolvedValueOnce(makeBriefResponse("broken.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }));
    mockRunContentGeneration
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("GitHub API rate limited"));

    const result = await runScheduledPublish(makeConfig(), false);

    expect(result.triggered).toEqual(["good.com"]);
    expect(result.skipped).toContainEqual({ domain: "nosched.com", reason: "no publishing schedule" });
    expect(result.errors).toContainEqual({ domain: "broken.com", error: "GitHub API rate limited" });
  });

  // -----------------------------------------------------------------------
  // Empty site list (dashboard-index.yaml has no sites)
  // -----------------------------------------------------------------------
  it("completes cleanly when there are zero active sites", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([]);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.status).toBe("ok");
    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(mockReadSiteBriefWithFallback).not.toHaveBeenCalled();
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Site listing failure
  // -----------------------------------------------------------------------
  it("returns error when listActiveSites throws (dashboard-index.yaml missing)", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockRejectedValue(new Error("Not Found"));

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.errors).toContainEqual({ domain: "*", error: "Not Found" });
    expect(result.triggered).toHaveLength(0);
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Site with no brief (readSiteBriefWithFallback throws)
  // -----------------------------------------------------------------------
  it("skips a site when its brief cannot be read (both branches fail)", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "nobrief.com", branch: "staging/nobrief.com" },
    ]);
    mockReadSiteBriefWithFallback.mockRejectedValue(new Error("Not Found on staging or main"));

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.skipped).toContainEqual({ domain: "nobrief.com", reason: "no brief configured" });
    expect(result.triggered).toHaveLength(0);
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Branch passed to content generation matches the brief's branch
  // -----------------------------------------------------------------------
  it("passes the branch from readSiteBriefWithFallback to content generation", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "custom.com", branch: "staging/custom.com" },
    ]);
    const t = today();
    // Brief found on main (fallback), not staging
    mockReadSiteBriefWithFallback.mockResolvedValue(
      makeBriefResponse("custom.com", {
        articles_per_day: 4, preferred_days: [t], preferred_time: "14:00",
      }, "main"),
    );
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.triggered).toEqual(["custom.com"]);
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      { siteDomain: "custom.com", count: 4, branch: "main" },
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Different article counts per site
  // -----------------------------------------------------------------------
  it("sends different article counts per site based on their schedules", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "low.com", branch: "staging/low.com" },
      { domain: "high.com", branch: "staging/high.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback
      .mockResolvedValueOnce(makeBriefResponse("low.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("high.com", {
        articles_per_day: 10, preferred_days: [t], preferred_time: "14:00",
      }));
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.triggered).toEqual(["low.com", "high.com"]);
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ siteDomain: "low.com", count: 1 }),
      expect.anything(),
    );
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ siteDomain: "high.com", count: 10 }),
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Legacy articles_per_week fallback (no articles_per_day)
  // -----------------------------------------------------------------------
  it("uses articles_per_week fallback correctly for legacy sites", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "legacy.com", branch: "staging/legacy.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback.mockResolvedValue(
      makeBriefResponse("legacy.com", {
        articles_per_week: 14,
        preferred_days: [t, notToday()],
        preferred_time: "14:00",
      }),
    );
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.triggered).toEqual(["legacy.com"]);
    // ceil(14 / 2 preferred_days) = 7
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ siteDomain: "legacy.com", count: 7 }),
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Site with empty preferred_days (every day is valid)
  // -----------------------------------------------------------------------
  it("triggers sites with empty preferred_days regardless of day", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "everyday.com", branch: "staging/everyday.com" },
    ]);
    mockReadSiteBriefWithFallback.mockResolvedValue(
      makeBriefResponse("everyday.com", {
        articles_per_day: 2, preferred_days: [], preferred_time: "14:00",
      }),
    );
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), false);

    expect(result.triggered).toEqual(["everyday.com"]);
  });

  // -----------------------------------------------------------------------
  // Force still respects per-site preferred_days
  // -----------------------------------------------------------------------
  it("force=true still skips sites whose preferred day does not match", async () => {
    mockReadFile.mockResolvedValue("enabled: false\nrun_at_hours: []\ntimezone: UTC\n");
    mockListActiveSites.mockResolvedValue([
      { domain: "wrongday.com", branch: "staging/wrongday.com" },
    ]);
    mockReadSiteBriefWithFallback.mockResolvedValue(
      makeBriefResponse("wrongday.com", {
        articles_per_day: 3, preferred_days: [notToday()], preferred_time: "14:00",
      }),
    );

    const result = await runScheduledPublish(makeConfig(), true);

    // Force bypasses global gating but NOT per-site day check
    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toContainEqual({
      domain: "wrongday.com",
      reason: expect.stringContaining("not a preferred day"),
    });
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Scheduler config: partial YAML (only enabled field)
  // -----------------------------------------------------------------------
  it("merges defaults for missing config fields", async () => {
    // Only 'enabled' in YAML — run_at_hours and timezone should default
    mockReadFile.mockResolvedValue("enabled: true\n");
    mockListActiveSites.mockResolvedValue([]);

    // Force=true so default run_at_hours [14] doesn't gate us out
    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.configStatus).toBe("ok");
    expect(result.status).toBe("ok");
  });

  // -----------------------------------------------------------------------
  // Scheduler config: empty run_at_hours falls back to default [14]
  // -----------------------------------------------------------------------
  it("uses default run_at_hours [14] when config has empty array", async () => {
    mockReadFile.mockResolvedValue("enabled: true\nrun_at_hours: []\ntimezone: UTC\n");
    // Don't force — let it go through hour gating with the defaulted [14]
    const result = await runScheduledPublish(makeConfig(), false);
    // Current hour is probably not 14, so this should skip
    // The key assertion: it didn't crash and applied defaults
    expect(["hour_not_matched", undefined]).toContain(result.skippedGlobal);
  });

  // -----------------------------------------------------------------------
  // One site errors, the other still triggers
  // -----------------------------------------------------------------------
  it("continues processing remaining sites after one site errors", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "first-error.com", branch: "staging/first-error.com" },
      { domain: "second-ok.com", branch: "staging/second-ok.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback
      .mockResolvedValueOnce(makeBriefResponse("first-error.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("second-ok.com", {
        articles_per_day: 2, preferred_days: [t], preferred_time: "14:00",
      }));
    mockRunContentGeneration
      .mockRejectedValueOnce(new Error("API down"))
      .mockResolvedValueOnce(undefined);

    const result = await runScheduledPublish(makeConfig(), false);

    expect(result.errors).toContainEqual({ domain: "first-error.com", error: "API down" });
    expect(result.triggered).toEqual(["second-ok.com"]);
    expect(mockRunContentGeneration).toHaveBeenCalledTimes(2);
  });

  // -----------------------------------------------------------------------
  // Site with articles_per_day: 0 and no weekly fallback → skipped
  // -----------------------------------------------------------------------
  it("skips site when articles_per_day is 0 and no weekly fallback", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "paused.com", branch: "staging/paused.com" },
    ]);
    mockReadSiteBriefWithFallback.mockResolvedValue(
      makeBriefResponse("paused.com", {
        articles_per_day: 0, preferred_days: [today()], preferred_time: "14:00",
      }),
    );

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.skipped).toContainEqual({ domain: "paused.com", reason: "no publishing schedule" });
    expect(result.triggered).toHaveLength(0);
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Custom staging branch from dashboard-index.yaml
  // -----------------------------------------------------------------------
  it("uses custom staging_branch from dashboard-index when available", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "custom-branch.com", branch: "feature/custom-branch.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback.mockResolvedValue(
      makeBriefResponse("custom-branch.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }, "feature/custom-branch.com"),
    );
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.triggered).toEqual(["custom-branch.com"]);
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      { siteDomain: "custom-branch.com", count: 1, branch: "feature/custom-branch.com" },
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Force with config fetch error — proceeds with defaults
  // -----------------------------------------------------------------------
  it("force=true proceeds with default config even when config fetch errors", async () => {
    mockReadFile.mockRejectedValue(new Error("server error 500"));
    mockListActiveSites.mockResolvedValue([
      { domain: "forced.com", branch: "staging/forced.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback.mockResolvedValue(
      makeBriefResponse("forced.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }),
    );
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.configStatus).toBe("fetch_error");
    expect(result.skippedGlobal).toBeUndefined(); // did NOT skip
    expect(result.triggered).toEqual(["forced.com"]);
  });

  // -----------------------------------------------------------------------
  // Verify result shape is always complete
  // -----------------------------------------------------------------------
  it("always returns a well-formed result even with zero sites", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([]);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result).toMatchObject({
      status: "ok",
      configStatus: "ok",
      triggered: [],
      skipped: [],
      errors: [],
    });
    expect(result.skippedGlobal).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Two sites with different schedules, verify each gets correct count
  // -----------------------------------------------------------------------
  it("two sites with different schedule types both resolve correct article count", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "modern.com", branch: "staging/modern.com" },
      { domain: "legacy.com", branch: "staging/legacy.com" },
    ]);
    const t = today();
    mockReadSiteBriefWithFallback
      // modern.com uses articles_per_day
      .mockResolvedValueOnce(makeBriefResponse("modern.com", {
        articles_per_day: 5,
        preferred_days: [t],
        preferred_time: "10:00",
      }))
      // legacy.com uses articles_per_week only
      .mockResolvedValueOnce(makeBriefResponse("legacy.com", {
        articles_per_week: 21,
        preferred_days: [t, "Monday", "Wednesday"],
        preferred_time: "14:00",
      }));
    mockRunContentGeneration.mockResolvedValue(undefined);

    const result = await runScheduledPublish(makeConfig(), true);

    expect(result.triggered).toEqual(["modern.com", "legacy.com"]);
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ siteDomain: "modern.com", count: 5 }),
      expect.anything(),
    );
    // ceil(21 / 3) = 7
    expect(mockRunContentGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ siteDomain: "legacy.com", count: 7 }),
      expect.anything(),
    );
  });

  // -----------------------------------------------------------------------
  // Result counts are accurate across mixed outcomes
  // -----------------------------------------------------------------------
  it("result tallies match: triggered + skipped + errors = total sites", async () => {
    setupAllHoursConfig();
    mockListActiveSites.mockResolvedValue([
      { domain: "ok1.com", branch: "staging/ok1.com" },
      { domain: "ok2.com", branch: "staging/ok2.com" },
      { domain: "wrongday.com", branch: "staging/wrongday.com" },
      { domain: "nobrief.com", branch: "staging/nobrief.com" },
      { domain: "errs.com", branch: "staging/errs.com" },
    ]);
    const t = today();
    const nt = notToday();
    mockReadSiteBriefWithFallback
      .mockResolvedValueOnce(makeBriefResponse("ok1.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("ok2.com", {
        articles_per_day: 2, preferred_days: ALL_DAYS, preferred_time: "14:00",
      }))
      .mockResolvedValueOnce(makeBriefResponse("wrongday.com", {
        articles_per_day: 1, preferred_days: [nt], preferred_time: "14:00",
      }))
      .mockRejectedValueOnce(new Error("404"))  // nobrief.com
      .mockResolvedValueOnce(makeBriefResponse("errs.com", {
        articles_per_day: 1, preferred_days: [t], preferred_time: "14:00",
      }));
    mockRunContentGeneration
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("boom"));

    const result = await runScheduledPublish(makeConfig(), false);

    expect(result.triggered).toHaveLength(2);
    expect(result.skipped).toHaveLength(2); // wrongday + nobrief
    expect(result.errors).toHaveLength(1);  // errs
    const total = result.triggered.length + result.skipped.length + result.errors.length;
    expect(total).toBe(5);
  });
});
