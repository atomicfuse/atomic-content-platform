import { describe, expect, it } from "vitest";
import { parseRegenerateBody, parseSaveBody } from "../agents/grid-summaries/http.js";

describe("grid-summaries http body parsing", () => {
  it("accepts valid regenerate bodies", () => {
    expect(parseRegenerateBody(JSON.stringify({ site: "scienceworld", slug: "best-telescopes-2026" }))).toEqual({ site: "scienceworld", slug: "best-telescopes-2026" });
  });
  it.each(['{"site":"../x","slug":"a"}', '{"site":"a"}', "not json"])("rejects %s with 400", (raw) => {
    expect(() => parseRegenerateBody(raw)).toThrow(expect.objectContaining({ status: 400 }));
  });
  it("save requires markdown ≤ 20k chars and defaults editedBy", () => {
    expect(parseSaveBody(JSON.stringify({ site: "a", slug: "b", markdown: "## x" }))).toEqual({ site: "a", slug: "b", markdown: "## x", editedBy: "dashboard" });
    expect(() => parseSaveBody(JSON.stringify({ site: "a", slug: "b", markdown: "x".repeat(20_001) }))).toThrow(expect.objectContaining({ status: 400 }));
  });
});
