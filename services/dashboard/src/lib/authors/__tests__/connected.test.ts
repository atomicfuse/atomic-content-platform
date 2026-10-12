import { describe, expect, it } from "vitest";
import { connectedSitesByAuthor } from "../connected";

describe("connectedSitesByAuthor", () => {
  it("maps author id → sites with their topics; ignores malformed entries", () => {
    const map = connectedSitesByAuthor([
      { domain: "scoopella", authors: [{ id: "ella-hughes", topics: ["Royals"] }, { id: "ben-foster" }] },
      { domain: "popstorylab", authors: [{ id: "ben-foster", topics: [] }, "junk"] },
      { domain: "nope" },
    ]);
    expect(map.get("ella-hughes")).toEqual([{ site: "scoopella", topics: ["Royals"] }]);
    expect(map.get("ben-foster")).toEqual([{ site: "scoopella", topics: [] }, { site: "popstorylab", topics: [] }]);
  });
});
