import { describe, expect, it } from "vitest";
import { compactVisits, compareSimilarweb, latestCheckedAt, matchesSimilarwebFilter, similarwebBadgeText, similarwebCell } from "../format";
import type { SimilarwebStatus } from "../types";

const st = (has_rank: boolean, global_rank: number | null, monthly_visits: number | null): SimilarwebStatus =>
  ({ site: "s", domain: "s.com", has_rank, global_rank, monthly_visits, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" });
const live = { custom_domain: "s.com" };
const noDomain = { custom_domain: null };

describe("compactVisits", () => {
  it("1.34M / 853K / 6K / 257", () => {
    expect(compactVisits(1340000)).toBe("1.34M");
    expect(compactVisits(2000000)).toBe("2M");
    expect(compactVisits(852816)).toBe("853K");
    expect(compactVisits(6008)).toBe("6K");
    expect(compactVisits(257)).toBe("257");
  });
});

describe("similarwebCell", () => {
  it("covers the four states", () => {
    expect(similarwebCell(live, st(true, 79692, 1340000))).toEqual({ kind: "rank", text: "#79,692 · 1.34M/mo" });
    expect(similarwebCell(live, st(true, 79692, null))).toEqual({ kind: "rank", text: "#79,692" });
    expect(similarwebCell(live, st(false, null, null))).toEqual({ kind: "no-rank", text: "No rank" });
    expect(similarwebCell(noDomain, undefined)).toEqual({ kind: "no-domain", text: "No domain" });
    expect(similarwebCell(live, undefined)).toEqual({ kind: "unchecked", text: "—" });
  });
});

describe("similarwebBadgeText", () => {
  it("badge text, or nothing when never checked", () => {
    expect(similarwebBadgeText(st(true, 79692, 1340000))).toBe("Similarweb #79,692 · 1.34M/mo");
    expect(similarwebBadgeText(st(false, null, null))).toBe("Similarweb: no rank");
    expect(similarwebBadgeText(null)).toBeNull();
  });
});

describe("filter", () => {
  it("filter values", () => {
    expect(matchesSimilarwebFilter(live, st(true, 1, null), "yes")).toBe(true);
    expect(matchesSimilarwebFilter(live, st(false, null, null), "no")).toBe(true);
    expect(matchesSimilarwebFilter(live, undefined, "unchecked")).toBe(true);
    expect(matchesSimilarwebFilter(noDomain, undefined, "unchecked")).toBe(false);
    expect(matchesSimilarwebFilter(noDomain, undefined, "")).toBe(true);
  });
});

describe("a site without a domain is always 'No domain'", () => {
  it("even when an old result matched it by site id", () => {
    expect(similarwebCell(noDomain, st(true, 5, 10))).toEqual({ kind: "no-domain", text: "No domain" });
    expect(similarwebCell(noDomain, st(false, null, null))).toEqual({ kind: "no-domain", text: "No domain" });
  });
});

describe("review follow-ups", () => {
  it("compactVisits rounds before picking the unit", () => {
    expect(compactVisits(999_600)).toBe("1M");
    expect(compactVisits(999_400)).toBe("999K");
    expect(compactVisits(999)).toBe("999");
  });
  it("high-to-low sort lists the worst rank first and keeps empty states at the bottom", () => {
    const rows = [
      { s: noDomain, st: undefined },
      { s: live, st: undefined },
      { s: live, st: st(false, null, null) },
      { s: live, st: st(true, 10, null) },
      { s: live, st: st(true, 500, null) },
    ];
    const order = (dir: "asc" | "desc"): string[] =>
      [...rows].sort((a, b) => compareSimilarweb(a.s, a.st, b.s, b.st, dir)).map((r) => similarwebCell(r.s, r.st).text);
    expect(order("asc")).toEqual(["#10", "#500", "No rank", "—", "No domain"]);
    expect(order("desc")).toEqual(["#500", "#10", "No rank", "—", "No domain"]);
  });
  it("latestCheckedAt picks the newest check date", () => {
    expect(latestCheckedAt({ a: { ...st(true, 1, null), checked_at: "2026-09-01T00:00:00.000Z" }, b: st(false, null, null) })).toBe("2026-10-11T08:00:00.000Z");
    expect(latestCheckedAt({})).toBeNull();
  });
});
