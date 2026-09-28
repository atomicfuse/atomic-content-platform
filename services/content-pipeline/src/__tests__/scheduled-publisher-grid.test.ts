import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScheduledPublish } from "../agents/scheduled-publisher/index.js";

// ---------------------------------------------------------------------------
// Mocks — heavy dependencies used by runScheduledPublish
// (copied from scheduled-publisher.test.ts lines 17-58)
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn();
const mockCommitFile = vi.fn().mockResolvedValue("sha-mock");
const mockCreateOctokit = vi.fn(() => ({}));
const mockListActiveSites = vi.fn();
const mockReadSiteBriefWithFallback = vi.fn();
const mockRunContentGeneration = vi.fn();

vi.mock("../lib/github.js", () => ({
  createOctokit: (): unknown => mockCreateOctokit(),
  createGitHubClient: (): unknown => mockCreateOctokit(),
  readFile: (_o: unknown, _r: unknown, _p: unknown): unknown => mockReadFile(_o, _r, _p),
  commitFile: (_o: unknown, _r: unknown, _c: unknown): unknown => mockCommitFile(_o, _r, _c),
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
// Grid sites must never get scheduler-generated articles
// ---------------------------------------------------------------------------
describe("scheduled publisher — Grid sites", () => {
  it("skips a site whose site.yaml sets theme.template: grid, with reason 'grid template'", async () => {
    // Scheduler config: enabled, current hour — matches the existing "eligible site" arrange block
    // so the run isn't gated off at the global level.
    mockReadFile.mockResolvedValue(
      "enabled: true\nrun_at_hours: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]\ntimezone: UTC\n",
    );
    mockListActiveSites.mockResolvedValue([{ domain: "mygrid", branch: "staging/mygrid", status: "live" }]);
    mockReadSiteBriefWithFallback.mockResolvedValue({
      data: {
        domain: "mygrid",
        siteName: "My Grid",
        group: "",
        themeTemplate: "grid",
        brief: {
          schedule: {
            articles_per_day: 3,
            preferred_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          },
        },
      },
      branch: "staging/mygrid",
    });

    // queueInstances=undefined -> exercises the direct-execution path (processSingleSite),
    // matching how the existing test suite calls runScheduledPublish.
    const result = await runScheduledPublish(makeConfig(), true, undefined);

    expect(JSON.stringify(result)).toContain("grid template");
    expect(JSON.stringify(result)).not.toContain('"kind":"triggered"');
    expect(mockRunContentGeneration).not.toHaveBeenCalled();
  });
});
