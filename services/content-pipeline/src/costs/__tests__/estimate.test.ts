import { describe, it, expect } from "vitest";
import { estimateTokens } from "../estimate.js";
describe("estimateTokens", () => {
  it("returns 0 for empty", () => { expect(estimateTokens("")).toBe(0); });
  it("~ceil(chars/4)", () => { expect(estimateTokens("abcd")).toBe(1); expect(estimateTokens("abcde")).toBe(2); });
  it(">=1 for short non-empty", () => { expect(estimateTokens("a")).toBe(1); });
});
