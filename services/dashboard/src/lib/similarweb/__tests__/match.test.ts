import { describe, expect, it } from "vitest";
import { matchSimilarwebRows, normalizeHost } from "../match";
import type { ParsedRow } from "../types";

const row = (domain: string, site: string, hasRank: boolean, rank: number | null = null, visits: number | null = null, line = 2): ParsedRow =>
  ({ line, domain, site, hasRank, globalRank: rank, monthlyVisits: visits });
const SITES = [
  { domain: "scoopella", custom_domain: "scoopella.com" },
  { domain: "journeypeaks", custom_domain: "www.journeypeaks.com" },
  { domain: "danatest", custom_domain: null },
];
const AT = "2026-10-11T08:00:00.000Z";

describe("normalizeHost", () => {
  it("lowercases and strips protocol, www and trailing slash", () => {
    expect(normalizeHost("https://www.Scoopella.com/")).toBe("scoopella.com");
  });
});

describe("matchSimilarwebRows", () => {
  it("matches by custom domain (www/protocol tolerant), else by site id; reports unknown", () => {
    const out = matchSimilarwebRows([
      row("https://www.Scoopella.com/", "", false),
      row("journeypeaks.com", "journeypeaks", true, 79692, 1340000),
      row("", "danatest", false),
      row("nowhere.com", "nowhere", false),
    ], SITES, AT);
    expect(out.statuses).toEqual([
      { site: "scoopella", domain: "scoopella.com", has_rank: false, global_rank: null, monthly_visits: null, checked_at: AT, source: "manual" },
      { site: "journeypeaks", domain: "journeypeaks.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: AT, source: "manual" },
      { site: "danatest", domain: "", has_rank: false, global_rank: null, monthly_visits: null, checked_at: AT, source: "manual" },
    ]);
    expect(out.unknown).toEqual(["nowhere.com"]);
  });
  it("the same site twice: the last row wins, counted once", () => {
    const out = matchSimilarwebRows([row("scoopella.com", "scoopella", false), row("scoopella.com", "scoopella", true, 5, 10, 3)], SITES, AT);
    expect(out.statuses).toHaveLength(1);
    expect(out.statuses[0]).toMatchObject({ has_rank: true, global_rank: 5 });
  });
});

describe("stored domain", () => {
  it("is the domain that was checked, even when the row matched by site id", () => {
    const out = matchSimilarwebRows([row("old-scoopella.com", "scoopella", true, 9, null)], SITES, AT);
    expect(out.statuses[0]).toMatchObject({ site: "scoopella", domain: "old-scoopella.com" });
  });
});
