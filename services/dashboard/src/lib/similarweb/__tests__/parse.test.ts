import { describe, expect, it } from "vitest";
import { parseSimilarwebCsv, parseVisits } from "../parse";

const SAMPLE = [
  "domain,site,similarweb,global_rank,monthly_visits",
  'journeypeaks.com,journeypeaks,yes,79692,"1.34M"',
  'buzzsoaps.com,buzzsoaps,yes,"813,504","68,562"',
  'gamerswiredaily.com,gamerswiredaily,no,,"257"',
  'scoopella.com,scoopella,no,,""',
  "popstorylab.com,popstorylab,unchecked,,",
].join("\n");

describe("parseVisits", () => {
  it("reads the formats the checklist and Similarweb show", () => {
    expect(parseVisits("68,562")).toBe(68562);
    expect(parseVisits("68562")).toBe(68562);
    expect(parseVisits("1.34M")).toBe(1340000);
    expect(parseVisits("12.5K")).toBe(12500);
    expect(parseVisits(" ")).toBeNull();
    expect(parseVisits("n/a")).toBeNull();
  });
});

describe("parseSimilarwebCsv", () => {
  it("parses yes/no rows, ignores unchecked, stores visits only with a rank", () => {
    const out = parseSimilarwebCsv(SAMPLE);
    expect(out.missingColumns).toEqual([]);
    expect(out.ignored).toBe(1);
    expect(out.rejected).toEqual([]);
    expect(out.rows).toEqual([
      { line: 2, domain: "journeypeaks.com", site: "journeypeaks", hasRank: true, globalRank: 79692, monthlyVisits: 1340000 },
      { line: 3, domain: "buzzsoaps.com", site: "buzzsoaps", hasRank: true, globalRank: 813504, monthlyVisits: 68562 },
      { line: 4, domain: "gamerswiredaily.com", site: "gamerswiredaily", hasRank: false, globalRank: null, monthlyVisits: null },
      { line: 5, domain: "scoopella.com", site: "scoopella", hasRank: false, globalRank: null, monthlyVisits: null },
    ]);
  });

  it("accepts a file saved by Excel/Sheets: BOM, CRLF, reordered columns, trailing blank line", () => {
    const text = "﻿Similarweb,Global_Rank,Domain\r\nyes,79692,journeypeaks.com\r\nno,,scoopella.com\r\n\r\n";
    const out = parseSimilarwebCsv(text);
    expect(out.missingColumns).toEqual([]);
    expect(out.rows.map((r) => [r.domain, r.hasRank, r.globalRank])).toEqual([
      ["journeypeaks.com", true, 79692],
      ["scoopella.com", false, null],
    ]);
  });

  it("rejects a yes row without a valid rank and an unknown answer, keeping the others", () => {
    const out = parseSimilarwebCsv("domain,similarweb,global_rank\na.com,yes,\nb.com,yes,abc\nc.com,maybe,\nd.com,yes,10");
    expect(out.rows.map((r) => r.domain)).toEqual(["d.com"]);
    expect(out.rejected).toEqual([
      { line: 2, reason: "a.com: 'yes' needs a global rank" },
      { line: 3, reason: "b.com: 'yes' needs a global rank" },
      { line: 4, reason: "c.com: similarweb must be yes, no or unchecked" },
    ]);
  });

  it("reports missing required columns and parses nothing", () => {
    expect(parseSimilarwebCsv("url,rank\na.com,1").missingColumns).toEqual(["similarweb", "domain or site"]);
    expect(parseSimilarwebCsv("").missingColumns).toEqual(["similarweb", "domain or site"]);
  });
});
