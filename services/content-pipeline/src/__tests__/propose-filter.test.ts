import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shared AI abstraction so tests don't make real API calls.
// proposeFilter routes through generateContent (CloudGrid gateway / SDK
// fallback) rather than instantiating the Anthropic SDK directly.
vi.mock("../lib/ai.js", () => ({
  generateContent: vi.fn(),
}));

import { generateContent } from "../lib/ai.js";
import { proposeFilter, type ProposeFilterRequest } from "../agents/content-generation/propose-filter.js";

function makeRequest(overrides: Partial<ProposeFilterRequest> = {}): ProposeFilterRequest {
  return {
    siteTheme: "Travel and eating while traveling",
    topicName: "Wine & Beer",
    topicDescription: "Wine and brewery culture for travelers",
    categories: [
      { id: "cat-travel", name: "Travel", parent_id: null },
      { id: "cat-food", name: "Food & Drink", parent_id: null },
      { id: "cat-alc", name: "Alcoholic Beverages", parent_id: "cat-food" },
    ],
    tags: [
      { id: "tag-wine-tourism", name: "wine-tourism", usage_count: 50 },
      { id: "tag-culinary-travel", name: "culinary-travel", usage_count: 80 },
    ],
    ...overrides,
  };
}

function mockClaudeResponse(jsonStr: string): void {
  vi.mocked(generateContent).mockResolvedValue({
    text: jsonStr,
    usage: { inputTokens: 0, outputTokens: 0, estimated: true },
  });
}

describe("proposeFilter", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns validated category_ids and tag_ids when Claude returns valid IDs", async () => {
    mockClaudeResponse(JSON.stringify({
      category_ids: ["cat-alc"],
      tag_ids: ["tag-wine-tourism", "tag-culinary-travel"],
      rationale: "Wine/beer with travel context",
    }));

    const result = await proposeFilter(makeRequest());

    expect(result.category_ids).toEqual(["cat-alc"]);
    expect(result.tag_ids).toEqual(["tag-wine-tourism", "tag-culinary-travel"]);
    expect(result.rationale).toBe("Wine/beer with travel context");
    expect(result.dropped_unknown_ids).toEqual([]);
  });

  it("drops unknown IDs that Claude hallucinates", async () => {
    mockClaudeResponse(JSON.stringify({
      category_ids: ["cat-alc", "cat-doesnt-exist"],
      tag_ids: ["tag-wine-tourism", "tag-fake-hallucination"],
      rationale: "...",
    }));

    const result = await proposeFilter(makeRequest());

    expect(result.category_ids).toEqual(["cat-alc"]);
    expect(result.tag_ids).toEqual(["tag-wine-tourism"]);
    expect(result.dropped_unknown_ids.sort()).toEqual(
      ["cat-doesnt-exist", "tag-fake-hallucination"].sort(),
    );
  });

  it("extracts JSON when Claude wraps it in markdown code fences", async () => {
    mockClaudeResponse(
      "Here's my proposal:\n```json\n" +
      JSON.stringify({ category_ids: ["cat-alc"], tag_ids: [], rationale: "..." }) +
      "\n```\nHope that helps!"
    );

    const result = await proposeFilter(makeRequest());
    expect(result.category_ids).toEqual(["cat-alc"]);
  });

  it("throws when Claude returns no JSON at all", async () => {
    mockClaudeResponse("Sorry, I cannot help with that request.");
    await expect(proposeFilter(makeRequest())).rejects.toThrow(/no JSON/);
  });

  it("throws when Claude returns malformed JSON", async () => {
    // Wrap in braces so the regex matches, but the content is invalid JSON
    mockClaudeResponse('{ "category_ids": [bad json }');
    await expect(proposeFilter(makeRequest())).rejects.toThrow(/invalid JSON/);
  });

  it("throws when siteTheme is empty", async () => {
    await expect(
      proposeFilter(makeRequest({ siteTheme: "" })),
    ).rejects.toThrow(/siteTheme is required/);
  });
});
