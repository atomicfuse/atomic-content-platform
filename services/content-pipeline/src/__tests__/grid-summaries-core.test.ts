import { describe, expect, it } from "vitest";
import { decideAction, sha256 } from "../agents/grid-summaries/decide.js";
import { parseSummaryFile, serializeSummaryFile, summaryPath, type SummaryFrontmatter } from "../agents/grid-summaries/files.js";
import { articleText, isValidSummary, sanitizeSummaryMarkdown } from "../agents/grid-summaries/prompt.js";
import { isAiGridConfig, isSafeId, parseDashboardIndex, poolUrlFor } from "../agents/grid-summaries/targets.js";

const fm = (over: Partial<SummaryFrontmatter> = {}): SummaryFrontmatter => ({
  source_site: "a", slug: "s", body_hash: "h1", generated_at: "2026-09-27T00:00:00.000Z", model: "m",
  edited: false, edited_by: null, edited_at: null, source_changed: false, pinned: false, ...over,
});

describe("decideAction", () => {
  it.each([
    [null, "h1", "generate"],
    [fm(), "h1", "skip"],
    [fm(), "h2", "regenerate"],
    [fm({ edited: true }), "h2", "flag_source_changed"],
    [fm({ edited: true, source_changed: true }), "h2", "skip"],
    [fm({ edited: true }), "h1", "skip"],
  ])("existing=%o hash=%s → %s", (existing, hash, action) => {
    expect(decideAction(existing as SummaryFrontmatter | null, hash)).toBe(action);
  });
  it("sha256 is stable hex", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("summary files", () => {
  it("round-trips and quotes generated_at as a string", () => {
    const raw = serializeSummaryFile(fm(), "## H\n\nBody");
    expect(raw).toMatch(/generated_at: ['"]2026-09-27T00:00:00.000Z['"]/);
    expect(parseSummaryFile(raw)).toEqual({ fm: fm(), markdown: "## H\n\nBody" });
  });
  it("path format", () => expect(summaryPath("a", "s")).toBe("grid-summaries/a/s.md"));
  it("invalid file → null", () => expect(parseSummaryFile("no frontmatter")).toBeNull());
});

describe("prompt helpers", () => {
  it("sanitize unwraps fences and strips html, links, images, urls", () => {
    const md = "```markdown\n## T\n\nHi <b>x</b> [l](http://a) ![i](b.png) https://c.com\n```";
    expect(sanitizeSummaryMarkdown(md)).toBe("## T\n\nHi x l");
  });
  it("isValidSummary enforces structure and length", () => {
    const body = Array.from({ length: 30 }, () => "word").join(" ");
    const good = `## H\n\n${body}\n\n### A\n\n${body}\n\n### B\n\n${body}`;
    expect(isValidSummary(good)).toBe(true);
    expect(isValidSummary(`## H\n\nshort`)).toBe(false);
    expect(isValidSummary(`## H\n\n## H2\n\n${body} ${body} ${body}\n\n### A\n\n### B`)).toBe(false);
  });
  it("articleText flattens HTML and truncates", () => {
    const t = articleText(`<h2>Head</h2><p>${"x".repeat(20000)}</p>`);
    expect(t.startsWith("Head")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(12000);
  });
});

describe("targets", () => {
  it("parses dashboard-index entries", () => {
    const entries = parseDashboardIndex("sites:\n  - domain: a\n    status: Live\n    custom_domain: a.com\n  - domain: b\n    status: Staging\n  - domain: c\n    status: Live\n    deleted_at: 2026-01-01\n");
    expect(entries).toEqual([
      { domain: "a", status: "live", custom_domain: "a.com", deleted: false },
      { domain: "b", status: "staging", custom_domain: null, deleted: false },
      { domain: "c", status: "live", custom_domain: null, deleted: true },
    ]);
  });
  it("pool URL: override > live custom domain > staging preview", () => {
    const env = { stagingWorkerUrl: "https://stg.workers.dev" };
    expect(poolUrlFor({ domain: "a", status: "live", custom_domain: "a.com", deleted: false }, env)).toBe("https://a.com/api/pool");
    expect(poolUrlFor({ domain: "b", status: "staging", custom_domain: null, deleted: false }, env)).toBe("https://stg.workers.dev/api/pool?_atl_site=b");
    expect(poolUrlFor({ domain: "a", status: "live", custom_domain: "a.com", deleted: false }, { ...env, gridWorkerBaseUrl: "http://localhost:8788" })).toBe("http://localhost:8788/api/pool?_atl_site=a");
  });
  it("isAiGridConfig / isSafeId", () => {
    expect(isAiGridConfig({ theme: { template: "grid" }, grid: { story_mode: "ai_summary" } })).toBe(true);
    expect(isAiGridConfig({ theme: { template: "grid" }, grid: { story_mode: "excerpt" } })).toBe(false);
    expect(isAiGridConfig({ theme: { base: "grid" } })).toBe(false);
    expect(isSafeId("best-telescopes-2026")).toBe(true);
    expect(isSafeId("../etc")).toBe(false);
  });
});

describe("aggregator (external) summaries", () => {
  it.each([
    [{ theme: { template: "grid" }, grid: { story_mode: "ai_summary" } }, { network: true, external: false }],
    [{ theme: { template: "grid" }, grid: { external_story_mode: "ai_summary" } }, { network: false, external: true }],
    [{ theme: { template: "grid" }, grid: {} }, { network: false, external: false }],
    [{ theme: { template: "modern" } }, null],
  ])("gridSummaryModes(%o)", async (cfg, expected) => {
    const { gridSummaryModes } = await import("../agents/grid-summaries/targets.js");
    expect(gridSummaryModes(cfg)).toEqual(expected);
  });
  it("needsSummary picks by story kind", async () => {
    const { needsSummary } = await import("../agents/grid-summaries/targets.js");
    expect(needsSummary({ site: "aggregator" }, { network: false, external: true })).toBe(true);
    expect(needsSummary({ site: "coolnews" }, { network: false, external: true })).toBe(false);
    expect(needsSummary({ site: "coolnews" }, { network: true, external: false })).toBe(true);
  });
  it("the external prompt only carries What It Covers / Why It Matters", async () => {
    const { buildExternalUserPrompt } = await import("../agents/grid-summaries/prompt.js");
    const p = buildExternalUserPrompt({ title: "T", whatItCovers: "W", whyItMatters: "Y" });
    expect(p).toContain("W");
    expect(p).toContain("Y");
    expect(p).not.toMatch(/Content Opportunity|Key Angles/);
  });
  it("isValidExternalSummary accepts the short shape and rejects the rest", async () => {
    const { isValidExternalSummary } = await import("../agents/grid-summaries/prompt.js");
    const words = (n: number): string => Array.from({ length: n }, () => "word").join(" ");
    expect(isValidExternalSummary(`## Headline\n\n${words(50)}\n\n### One\n\n${words(40)}\n\n### Two\n\n${words(30)}`)).toBe(true);
    expect(isValidExternalSummary("## H\n\ntoo short")).toBe(false);
    expect(isValidExternalSummary(`## H\n\n${words(400)}\n\n### One\n\n${words(10)}`)).toBe(false);
  });
  it("frontmatter round-trips pinned and defaults it to false", () => {
    expect(parseSummaryFile("---\nsource_site: aggregator\nslug: abc\n---\nx")!.fm.pinned).toBe(false);
    expect(parseSummaryFile(serializeSummaryFile(fm({ pinned: true }), "x"))!.fm.pinned).toBe(true);
  });
});
