import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockCommitBatch = vi.fn().mockResolvedValue("sha");
vi.mock("../lib/github.js", () => ({
  createOctokit: (): unknown => ({}),
  readFile: (...a: unknown[]): unknown => mockReadFile(...a),
  commitBatch: (...a: unknown[]): unknown => mockCommitBatch(...a),
  clearTreeCache: (): void => undefined,
}));
const mockGenerate = vi.fn();
vi.mock("../lib/ai.js", () => ({ generateContent: (...a: unknown[]): unknown => mockGenerate(...a) }));
const mockRecord = vi.fn().mockResolvedValue(undefined);
vi.mock("../costs/recorder.js", () => ({ recordTextUsage: (...a: unknown[]): unknown => mockRecord(...a) }));

import { runGridSummaries, regenerateSummary, saveEditedSummary, GridSummaryError, type GridSummariesDeps } from "../agents/grid-summaries/index.js";
import { serializeSummaryFile } from "../agents/grid-summaries/files.js";
import { sha256 } from "../agents/grid-summaries/decide.js";

const W = Array.from({ length: 30 }, () => "word").join(" ");
const GOOD = `## Headline\n\n${W}\n\n### One\n\n${W}\n\n### Two\n\n${W}`;
const INDEX = "sites:\n  - domain: mygrid\n    status: Live\n    custom_domain: mygrid.com\n  - domain: src\n    status: Live\n    custom_domain: src.com\n";
const config = { github: { token: "t", repo: "o/r" }, networkRepo: "o/r" } as never;

function deps(over: Partial<GridSummariesDeps> = {}): GridSummariesDeps {
  return {
    now: () => new Date("2026-09-27T10:00:00Z"),
    fetchPool: async () => ({ siteId: "mygrid", storyMode: "ai_summary", items: [{ site: "src", slug: "a1", title: "A1" }, { site: "src", slug: "a2", title: "A2" }] }),
    readKv: async (_d, key) => {
      if (key === "site-config:mygrid") return { theme: { template: "grid" }, grid: { story_mode: "ai_summary" } };
      if (key === "site-config:src") return { theme: { base: "classic" } };
      if (key.startsWith("article:src:")) return { frontmatter: { title: key, status: "published" }, body: `<p>${key}</p>` };
      return null;
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
    if (path === "dashboard-index.yaml") return INDEX;
    throw new Error("Expected file at x, got nothing");
  });
  mockGenerate.mockResolvedValue({ text: GOOD, usage: { inputTokens: 10, outputTokens: 20, estimated: false } });
});

describe("runGridSummaries", () => {
  it("generates missing summaries and commits once per source site", async () => {
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ targets: 1, needed: 2, generated: 2, failed: 0, commits: 1 });
    const [, , files, , message, branch] = mockCommitBatch.mock.calls[0] as [unknown, unknown, Array<{ path: string; content: string }>, unknown, string, string];
    expect(files.map((f) => f.path)).toEqual(["grid-summaries/src/a1.md", "grid-summaries/src/a2.md"]);
    expect(message).toBe("grid summaries: src (2 files)");
    expect(branch).toBe("main");
    expect(files[0]?.content).toContain(`body_hash: ${sha256("<p>article:src:a1</p>")}`);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ siteDomain: "src", source: "grid-summaries" }));
  });
  it("never overwrites a hand-edited summary; flags it once when the source changed", async () => {
    const edited = serializeSummaryFile({ source_site: "src", slug: "a1", body_hash: "old", generated_at: "x", model: "m", edited: true, edited_by: "dashboard", edited_at: "y", source_changed: false }, "## Mine\n\nHuman text");
    mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path === "dashboard-index.yaml") return INDEX;
      if (path === "grid-summaries/src/a1.md") return edited;
      throw new Error(`Expected file at ${path}, got nothing`);
    });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ flagged: 1, generated: 1 });
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ path: string; content: string }>;
    const a1 = files.find((f) => f.path.endsWith("a1.md"));
    expect(a1?.content).toContain("source_changed: true");
    expect(a1?.content).toContain("Human text");
  });
  it("an AI failure or invalid output counts as failed and does not stop the run", async () => {
    mockGenerate.mockRejectedValueOnce(new Error("gateway down")).mockResolvedValueOnce({ text: "## too short", usage: { inputTokens: 1, outputTokens: 1, estimated: true } });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ generated: 0, failed: 2, commits: 0 });
  });
  it("skips non-AI Grid sites and unreachable pools", async () => {
    const r = await runGridSummaries(config, deps({ fetchPool: async () => { throw new Error("503"); } }));
    expect(r).toMatchObject({ targets: 1, needed: 0 });
  });
  it("respects the per-run cap", async () => {
    process.env.GRID_SUMMARY_RUN_CAP = "1";
    const r = await runGridSummaries(config, deps());
    delete process.env.GRID_SUMMARY_RUN_CAP;
    expect(r).toMatchObject({ generated: 1, capped: true });
  });
});

describe("saveEditedSummary", () => {
  it("writes edited=true with the CURRENT body hash (clears stale)", async () => {
    await saveEditedSummary(config, { site: "src", slug: "a1", markdown: "## Mine\n\nFixed <b>text</b>", editedBy: "dashboard" }, deps());
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ content: string }>;
    expect(files[0]?.content).toContain("edited: true");
    expect(files[0]?.content).toContain(`body_hash: ${sha256("<p>article:src:a1</p>")}`);
    expect(files[0]?.content).toContain("source_changed: false");
    expect(files[0]?.content).not.toContain("<b>");
  });
  it("unknown article → 404 GridSummaryError", async () => {
    await expect(saveEditedSummary(config, { site: "src", slug: "zz", markdown: "## x\n\ny", editedBy: "d" }, deps({ readKv: async () => null })))
      .rejects.toMatchObject({ status: 404 });
    expect(GridSummaryError).toBeDefined();
  });
});

describe("runGridSummaries — race between planning and commit", () => {
  it("drops a planned generate when the file is hand-edited before the commit, and does not include it", async () => {
    let a1Reads = 0;
    const edited = serializeSummaryFile(
      { source_site: "src", slug: "a1", body_hash: "old", generated_at: "x", model: "m", edited: true, edited_by: "dashboard", edited_at: "raced", source_changed: false },
      "## Raced\n\nHuman text",
    );
    mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path === "dashboard-index.yaml") return INDEX;
      if (path === "grid-summaries/src/a1.md") {
        a1Reads++;
        // Missing at planning time (→ decided "generate"); a saveEditedSummary lands before the commit re-check.
        if (a1Reads === 1) throw new Error(`Expected file at ${path}, got nothing`);
        return edited;
      }
      throw new Error(`Expected file at ${path}, got nothing`); // a2 stays missing throughout — normal generate
    });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ generated: 1, skipped: 1, failed: 0, commits: 1 });
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ path: string; content: string }>;
    expect(files.map((f) => f.path)).toEqual(["grid-summaries/src/a2.md"]);
  });

  it("a readFile error other than 'missing' while checking the existing summary fails that article and never commits it", async () => {
    mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path === "dashboard-index.yaml") return INDEX;
      if (path === "grid-summaries/src/a1.md") throw new Error("GitHub API rate limited (secondary rate limit)");
      throw new Error(`Expected file at ${path}, got nothing`); // a2 has no existing summary — normal generate
    });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ failed: 1, generated: 1, commits: 1 });
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ path: string; content: string }>;
    expect(files.map((f) => f.path)).toEqual(["grid-summaries/src/a2.md"]);
  });
});

describe("runGridSummaries — plan staleness re-check", () => {
  it("drops a planned flag when the edited file is regenerated (edited false, new generated_at) before the commit", async () => {
    let a1Reads = 0;
    const edited = serializeSummaryFile(
      { source_site: "src", slug: "a1", body_hash: "old", generated_at: "x", model: "m", edited: true, edited_by: "dashboard", edited_at: "y", source_changed: false },
      "## Mine\n\nHuman text",
    );
    const regenerated = serializeSummaryFile(
      { source_site: "src", slug: "a1", body_hash: sha256("<p>article:src:a1</p>"), generated_at: "2026-09-27T10:05:00Z", model: "m", edited: false, edited_by: null, edited_at: null, source_changed: false },
      "## Regenerated\n\nAI text",
    );
    mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path === "dashboard-index.yaml") return INDEX;
      if (path === "grid-summaries/src/a1.md") {
        a1Reads++;
        // Edited + source changed at planning (→ "flag_source_changed"); a dashboard Regenerate lands before the re-check.
        return a1Reads === 1 ? edited : regenerated;
      }
      throw new Error(`Expected file at ${path}, got nothing`); // a2 stays missing — normal generate
    });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ flagged: 0, generated: 1, skipped: 1, failed: 0, commits: 1 });
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ path: string; content: string }>;
    expect(files.map((f) => f.path)).toEqual(["grid-summaries/src/a2.md"]);
  });

  it("drops a planned generate when the missing file appears with a fresh generated_at before the commit", async () => {
    let a1Reads = 0;
    const appeared = serializeSummaryFile(
      { source_site: "src", slug: "a1", body_hash: sha256("<p>article:src:a1</p>"), generated_at: "2026-09-27T10:05:00Z", model: "m", edited: false, edited_by: null, edited_at: null, source_changed: false },
      "## Appeared\n\nAI text",
    );
    mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path === "dashboard-index.yaml") return INDEX;
      if (path === "grid-summaries/src/a1.md") {
        a1Reads++;
        if (a1Reads === 1) throw new Error(`Expected file at ${path}, got nothing`);
        return appeared;
      }
      throw new Error(`Expected file at ${path}, got nothing`);
    });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ generated: 1, skipped: 1, failed: 0, commits: 1 });
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ path: string; content: string }>;
    expect(files.map((f) => f.path)).toEqual(["grid-summaries/src/a2.md"]);
  });
});

describe("regenerateSummary", () => {
  it("unknown article → 404 GridSummaryError", async () => {
    await expect(regenerateSummary(config, "src", "zz", deps({ readKv: async () => null }))).rejects.toMatchObject({ status: 404 });
  });
});
