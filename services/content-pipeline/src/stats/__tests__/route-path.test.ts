import { describe, it, expect } from "vitest";
import { parseSiteStatsPath } from "../route-path.js";
describe("parseSiteStatsPath", () => {
  it("maps /site-stats to all", () => { expect(parseSiteStatsPath("/site-stats")).toEqual({ kind: "all" }); });
  it("maps /site-stats/travelswire to one", () => { expect(parseSiteStatsPath("/site-stats/travelswire")).toEqual({ kind: "one", domain: "travelswire" }); });
  it("decodes encoded domain", () => { expect(parseSiteStatsPath("/site-stats/a%2Eb")).toEqual({ kind: "one", domain: "a.b" }); });
  it("returns null for unrelated paths", () => { expect(parseSiteStatsPath("/health")).toBeNull(); });
});
