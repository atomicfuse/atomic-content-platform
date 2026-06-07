import { describe, it, expect } from "vitest";
import { costFor, normalizeModelId } from "../pricing.js";

describe("costFor", () => {
  it("sonnet text cost", () => {
    expect(costFor("claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 1_000_000, images: 0 }).costUsd).toBeCloseTo(18);
  });

  it("normalizes the gateway alias and the dated id to the same rate", () => {
    expect(costFor("claude-sonnet", { inputTokens: 1_000_000, outputTokens: 0, images: 0 }).costUsd).toBeCloseTo(3);
    expect(costFor("claude-sonnet-4-20250514", { inputTokens: 1_000_000, outputTokens: 0, images: 0 }).costUsd).toBeCloseTo(3);
  });

  it("opus text cost", () => {
    expect(costFor("claude-opus-4-7", { inputTokens: 1_000_000, outputTokens: 1_000_000, images: 0 }).costUsd).toBeCloseTo(30);
  });

  it("gpt-4o-mini", () => {
    expect(costFor("gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 1_000_000, images: 0 }).costUsd).toBeCloseTo(0.75);
  });

  it("gemini image cost", () => {
    expect(costFor("gemini-2.5-flash-image", { inputTokens: 0, outputTokens: 0, images: 10 }).costUsd).toBeCloseTo(0.39);
  });

  it("unknown model → cost 0, known false", () => {
    expect(costFor("mystery", { inputTokens: 1000, outputTokens: 0, images: 0 })).toEqual({ costUsd: 0, known: false });
  });

  it("normalizeModelId maps aliases", () => {
    expect(normalizeModelId("claude-sonnet")).toBe("claude-sonnet-4-6");
    expect(normalizeModelId("claude-sonnet-4-20250514")).toBe("claude-sonnet-4-6");
    expect(normalizeModelId("gpt-4o-mini")).toBe("gpt-4o-mini");
  });
});
