import { describe, expect, it } from "vitest";
import { isSafeId, parseSummaryFileText } from "../grid-summary-file";

describe("parseSummaryFileText", () => {
  it("reads flags and markdown", () => {
    expect(
      parseSummaryFileText(
        "---\nedited: true\nsource_changed: false\ngenerated_at: '2026-09-27T00:00:00Z'\n---\n## H\n\nBody\n",
      ),
    ).toEqual({ markdown: "## H\n\nBody", edited: true, sourceChanged: false, generatedAt: "2026-09-27T00:00:00Z" });
  });

  it("no frontmatter → null", () => expect(parseSummaryFileText("## H")).toBeNull());

  it("defaults missing flags to false/null", () => {
    expect(parseSummaryFileText("---\n\n---\n## H\n")).toEqual({
      markdown: "## H",
      edited: false,
      sourceChanged: false,
      generatedAt: null,
    });
  });
});

describe("isSafeId", () => {
  it("accepts kebab ids only", () => {
    expect(isSafeId("best-telescopes-2026")).toBe(true);
    expect(isSafeId("../x")).toBe(false);
    expect(isSafeId(3)).toBe(false);
  });

  it("rejects empty strings and ids starting with a hyphen", () => {
    expect(isSafeId("")).toBe(false);
    expect(isSafeId("-leading")).toBe(false);
  });
});
