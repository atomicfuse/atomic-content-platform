import { describe, it, expect, vi, beforeEach } from "vitest";
import { RunHistoryAccumulator } from "../agents/scheduled-publisher/history.js";
import type { AgentConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockReadFile = vi.fn();
const mockCommitFile = vi.fn();

vi.mock("../lib/github.js", () => ({
  createOctokit: () => ({}),
  createGitHubClient: () => ({}),
  readFile: (...args: unknown[]): unknown => mockReadFile(...args),
  commitFile: (...args: unknown[]): unknown => mockCommitFile(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty history (404), successful commits
  mockReadFile.mockRejectedValue(new Error("Not Found"));
  mockCommitFile.mockResolvedValue("sha-mock");
});

function makeConfig(): AgentConfig {
  return {
    github: { token: "ghp_test", repo: "owner/repo" },
    networkRepo: "owner/repo",
    localNetworkPath: undefined,
    geminiApiKey: undefined,
    contentAggregatorUrl: "https://example.com",
    port: 3001,
    notifications: {},
  } as AgentConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RunHistoryAccumulator", () => {
  it("flushes site results and skipped entries to history.json", async () => {
    const acc = new RunHistoryAccumulator("UTC", false, makeConfig());

    acc.recordSiteResult({
      domain: "alpha.com",
      status: "success",
      articlesCreated: 3,
      articlesRequested: 3,
    });
    acc.recordSkipped("beta.com", "no schedule");

    await acc.finalize();

    expect(mockCommitFile).toHaveBeenCalled();
    const commitArg = mockCommitFile.mock.calls[0]![2] as { content: string; path: string };
    expect(commitArg.path).toBe("scheduler/history.json");

    const written = JSON.parse(commitArg.content) as Array<{
      sites: Array<{ domain: string }>;
      skipped: Array<{ domain: string }>;
    }>;
    expect(written).toHaveLength(1);
    expect(written[0]!.sites).toHaveLength(1);
    expect(written[0]!.sites[0]!.domain).toBe("alpha.com");
    expect(written[0]!.skipped).toHaveLength(1);
    expect(written[0]!.skipped[0]!.domain).toBe("beta.com");
  });

  it("does not flush when no outcomes are recorded", async () => {
    const acc = new RunHistoryAccumulator("EST", true, makeConfig());
    await acc.finalize();
    expect(mockCommitFile).not.toHaveBeenCalled();
  });

  it("replaces its own entry on subsequent flushes (same timestamp)", async () => {
    const acc = new RunHistoryAccumulator("UTC", false, makeConfig());

    // First outcome triggers flush 1
    acc.recordSiteResult({
      domain: "first.com",
      status: "success",
      articlesCreated: 1,
      articlesRequested: 1,
    });

    // Wait for flush 1 to complete
    await acc.finalize();

    // After flush 1, readFile should return the entry we just wrote
    const firstWrite = JSON.parse(
      (mockCommitFile.mock.calls[0]![2] as { content: string }).content,
    );
    mockReadFile.mockResolvedValue(JSON.stringify(firstWrite));

    // Second outcome triggers flush 2
    acc.recordSiteResult({
      domain: "second.com",
      status: "success",
      articlesCreated: 2,
      articlesRequested: 2,
    });
    await acc.finalize();

    // Flush 2 should replace the entry, not duplicate it
    expect(mockCommitFile).toHaveBeenCalledTimes(2);
    const secondWrite = JSON.parse(
      (mockCommitFile.mock.calls[1]![2] as { content: string }).content,
    );
    // Still one entry (replaced), with both sites
    expect(secondWrite).toHaveLength(1);
    expect(secondWrite[0].sites).toHaveLength(2);
  });

  it("retries flush when commitFile fails (dirty stays true)", async () => {
    mockCommitFile
      .mockRejectedValueOnce(new Error("GitHub 500"))
      .mockResolvedValueOnce("sha-ok");

    const acc = new RunHistoryAccumulator("UTC", false, makeConfig());

    acc.recordSiteResult({
      domain: "retry.com",
      status: "error",
      articlesCreated: 0,
      articlesRequested: 1,
      message: "boom",
    });

    // First finalize triggers the failed flush
    await acc.finalize();
    // dirty is still true because commit failed — finalize should retry
    await acc.finalize();

    expect(mockCommitFile).toHaveBeenCalledTimes(2);
    // Second attempt should succeed
    const secondWrite = JSON.parse(
      (mockCommitFile.mock.calls[1]![2] as { content: string }).content,
    );
    expect(secondWrite[0].sites[0].domain).toBe("retry.com");
  });

  it("preserves forced and timezone fields in the entry", async () => {
    const acc = new RunHistoryAccumulator("America/Chicago", true, makeConfig());

    acc.recordSkipped("tz-test.com", "no brief");
    await acc.finalize();

    const entry = JSON.parse(
      (mockCommitFile.mock.calls[0]![2] as { content: string }).content,
    )[0];
    expect(entry.timezone).toBe("America/Chicago");
    expect(entry.forced).toBe(true);
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
