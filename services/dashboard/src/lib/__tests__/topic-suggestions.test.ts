import { describe, expect, it, vi } from "vitest";
import { buildTopicPrompt, parseTopics, requestTopicsFromGemini } from "../topic-suggestions";

const CTX = { siteName: "Scoopella", vertical: "Entertainment", theme: "Celebrity gossip and fashion for women 25-45", audience: "Women 25-45" };

describe("parseTopics", () => {
  it("reads a fenced JSON array, trims, dedupes (case-insensitive) and caps at 4", () => {
    expect(parseTopics('```json\n["Red Carpet Looks", " Celebrity Couples ", "red carpet looks", "Royal Watch", "Reality TV Drama", "Extra"]\n```', []))
      .toEqual(["Red Carpet Looks", "Celebrity Couples", "Royal Watch", "Reality TV Drama"]);
  });
  it("drops topics that were already suggested or are generic", () => {
    expect(parseTopics('["Royal Watch", "Latest News", "Street Style", "Celebrity Breakups"]', ["royal watch"]))
      .toEqual(["Street Style", "Celebrity Breakups"]);
  });
  it("returns null for truncated or junk output, or fewer than 2 usable topics", () => {
    expect(parseTopics('```json\n[\n  "Relationship', [])).toBeNull();
    expect(parseTopics("no list here", [])).toBeNull();
    expect(parseTopics('["Only One"]', [])).toBeNull();
  });
});

describe("buildTopicPrompt", () => {
  it("anchors on the theme and lists everything already suggested as off-limits", () => {
    const p = buildTopicPrompt(CTX, ["Royal Watch", "Street Style"]);
    expect(p).toContain("Celebrity gossip and fashion for women 25-45");
    expect(p).toContain("Women 25-45");
    expect(p).toMatch(/Do NOT repeat[\s\S]*Royal Watch[\s\S]*Street Style/);
  });
  it("has no off-limits section on the first suggestion", () => {
    expect(buildTopicPrompt(CTX, [])).not.toContain("Do NOT repeat");
  });
});

describe("requestTopicsFromGemini", () => {
  const ok = (text: string): Response =>
    ({ ok: true, json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }) }) as Response;

  it("turns thinking off so the short answer is never cut off, and asks for JSON", async () => {
    const fetchFn = vi.fn(async () => ok('["A Topic", "B Topic", "C Topic", "D Topic"]'));
    expect(await requestTopicsFromGemini(CTX, [], "k", fetchFn as unknown as typeof fetch)).toEqual(["A Topic", "B Topic", "C Topic", "D Topic"]);
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as {
      generationConfig: { thinkingConfig?: { thinkingBudget?: number }; responseMimeType?: string; maxOutputTokens: number };
    };
    expect(body.generationConfig.thinkingConfig?.thinkingBudget).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(300);
  });
  it("returns null on an HTTP error or an unusable answer", async () => {
    expect(await requestTopicsFromGemini(CTX, [], "k", (async () => ({ ok: false, status: 500 }) as Response) as typeof fetch)).toBeNull();
    expect(await requestTopicsFromGemini(CTX, [], "k", (async () => ok('["Only"]')) as typeof fetch)).toBeNull();
  });
});
