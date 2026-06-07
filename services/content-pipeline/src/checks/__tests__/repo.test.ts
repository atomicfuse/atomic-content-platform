import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../sync.js", () => ({
  readSyncStatus: vi.fn(async (_d: string) => ({
    state: "ok",
    ok: true,
    syncedAt: null,
    gitSha: null,
    error: null,
  })),
}));

vi.mock("../tracking.js", () => ({
  readTracking: vi.fn(async (_d: string) => ({
    state: "ok",
    ga4: true,
    gtm: false,
    pixel: true,
  })),
}));

vi.mock("../../lib/github.js", () => ({
  createOctokit: () => ({}),
}));

vi.mock("../../lib/site-brief.js", () => ({
  listActiveSites: vi.fn(async () => [
    { domain: "travelswire", branch: "staging/travelswire", status: "live" },
    { domain: "wtpop", branch: "staging/wtpop", status: "staging" },
  ]),
}));

import { getAtlChecks, getAllAtlChecks } from "../repo.js";
import type { AgentConfig } from "../../lib/config.js";

afterEach(() => {
  vi.clearAllMocks();
});

const fakeConfig: AgentConfig = {
  github: { token: "tok", repo: "owner/network" },
  networkRepo: "owner/network",
  localNetworkPath: undefined,
  geminiApiKey: undefined,
  contentAggregatorUrl: "http://localhost",
  port: 5000,
  notifications: {},
};

describe("getAtlChecks", () => {
  it("composes sync + tracking into AtlChecks for a single domain", async () => {
    const result = await getAtlChecks("travelswire");

    expect(result.siteDomain).toBe("travelswire");
    expect(result.sync).toEqual({
      state: "ok",
      ok: true,
      syncedAt: null,
      gitSha: null,
      error: null,
    });
    expect(result.tracking).toEqual({
      state: "ok",
      ga4: true,
      gtm: false,
      pixel: true,
    });
  });

  it("uses the domain passed in as siteDomain", async () => {
    const result = await getAtlChecks("wtpop");
    expect(result.siteDomain).toBe("wtpop");
  });
});

describe("getAllAtlChecks", () => {
  it("returns one AtlChecks entry per active site", async () => {
    const results = await getAllAtlChecks(fakeConfig);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.siteDomain)).toEqual(
      expect.arrayContaining(["travelswire", "wtpop"]),
    );
  });

  it("each entry has sync and tracking", async () => {
    const results = await getAllAtlChecks(fakeConfig);

    for (const r of results) {
      expect(r.sync).toBeDefined();
      expect(r.tracking).toBeDefined();
      expect(typeof r.sync.state).toBe("string");
      expect(typeof r.tracking.state).toBe("string");
    }
  });
});
