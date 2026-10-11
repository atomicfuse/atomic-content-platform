# Similarweb Status per Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard shows, per site, whether Similarweb ranks it (Yes with rank + monthly visits / No rank / No domain / not checked) on the Sites list and the site page header, filled by pasting the monthly checklist results.

**Architecture:** Pure helpers in `src/lib/similarweb/` parse the checklist CSV, match rows to dashboard sites and format what the UI shows. Results live in a new Mongo collection `similarweb` (latest result per site), written by `POST /api/sites/similarweb/import` and read by `GET /api/sites/similarweb` (Sites list, lazily) and directly by the site page (header badge). The Sites table gains a column (sort + filter + CSV) and an import modal.

**Tech Stack:** Next.js 15 App Router (route handlers, server components), React client components, MongoDB driver (`getMongoDb`), vitest + Testing Library, Tailwind tokens already used in the dashboard.

**Spec:** `docs/superpowers/specs/2026-10-11-similarweb-status-design.md` (approved 2026-10-11).

## Global Constraints

- Rule (D1): **Yes** only when Similarweb shows a global rank; a visits estimate without a rank is **No**; a site without `custom_domain` is **No domain**; a domain never imported is **not checked** (`—`).
- Import format: header `domain,site,similarweb,global_rank,monthly_visits` (columns matched by name, case-insensitive; `monthly_visits` optional); `similarweb` = `yes` | `no` | `unchecked`; `unchecked` rows ignored; a `yes` row needs a positive integer rank (commas allowed) or is rejected; visits accept `68,562`, `68562`, `1.34M`, `12.5K`, empty; visits are stored only for `yes` rows.
- Matching: `domain` vs the site's `custom_domain` (lowercase, `www.` and protocol stripped), else `site` vs the dashboard site id (`DashboardSiteEntry.domain`). Unknown rows are reported, never stored.
- Storage: Mongo collection `similarweb`, one document per site (`site` unique), replaced on import; fields `site, domain, has_rank, global_rank, monthly_visits, checked_at, source: "manual" | "api"`. Not part of the git dual-write rule.
- Every request well under the ~60 s CloudGrid gateway limit (one bulk write).
- Imports must be done on the production dashboard to show there (local `grid dev` has its own Mongo).
- Conventions: TS strict, no `any`, explicit return types, React components return `React.ReactElement`; user-visible feature → guide page in `public/guide/` registered in `GUIDE_PAGES`; conventional commits ending `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; stage specific files; never commit to `main`.
- Local testing gate: no commit/push until Asaf has tested locally and approved.

## Review Focus

1. A results file saved by Excel/Sheets (CRLF line endings, quoted `"1.34M"`, a trailing empty line, BOM at the start) → imports the same as the copied text (tests in Task 1).
2. The same site twice in one file (e.g. re-checked) → the last row wins, counted once (test in Task 2).
3. A domain written as `https://www.Scoopella.com/` → matches scoopella (test in Task 2).
4. Someone who had customised their visible columns before this release → still sees the new Similarweb column once, and can hide it for good (test in Task 4).
5. Filtering by "No rank" before the Similarweb data has loaded → shows a loading note, never a wrong empty list (Task 5 implementation + manual check).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `services/dashboard/src/lib/similarweb/types.ts` (new) | `SimilarwebStatus`, `ParsedRow`, `ParseResult`, `SimilarwebFilter` |
| `services/dashboard/src/lib/similarweb/parse.ts` (new) | CSV text → parsed rows / ignored / rejected / missing columns |
| `services/dashboard/src/lib/similarweb/match.ts` (new) | parsed rows + sites → statuses + unknown |
| `services/dashboard/src/lib/similarweb/format.ts` (new) | cell/badge text, compact visits, sort value, filter predicate |
| `services/dashboard/src/lib/db/collections.ts` | `COLLECTIONS.similarweb` |
| `services/dashboard/src/lib/db/similarweb.ts` (new) | read all / read one / bulk upsert |
| `services/dashboard/src/app/api/sites/similarweb/route.ts` (new) | `GET` all statuses |
| `services/dashboard/src/app/api/sites/similarweb/import/route.ts` (new) | `POST` import |
| `services/dashboard/src/lib/site-columns.ts` | column def, `similarweb?` in context, new-default-column reveal |
| `services/dashboard/src/lib/site-sort.ts` | `similarweb` sort key |
| `services/dashboard/src/components/dashboard/SimilarwebCell.tsx` (new) | the cell |
| `services/dashboard/src/components/dashboard/Filters.tsx` | Similarweb filter select |
| `services/dashboard/src/components/dashboard/SitesTable.tsx` | lazy load, cell, header, sort, filter, CSV ctx, import button |
| `services/dashboard/src/components/dashboard/SimilarwebImportModal.tsx` (new) | paste/upload → preview → import |
| `services/dashboard/src/components/site-detail/SiteDetailHeader.tsx`, `src/app/sites/[domain]/page.tsx` | header badge |
| `services/dashboard/public/guide/25-similarweb.md` (new), `src/app/guide/page.tsx` | guide page |

---

### Task 1: Types and CSV parser

**Files:**
- Create: `services/dashboard/src/lib/similarweb/types.ts`, `services/dashboard/src/lib/similarweb/parse.ts`
- Test: `services/dashboard/src/lib/similarweb/__tests__/parse.test.ts`

**Interfaces:**
- Produces: types below; `parseSimilarwebCsv(text: string): ParseResult`; `parseVisits(raw: string): number | null`.

- [ ] **Step 1: Write the types**

```ts
// services/dashboard/src/lib/similarweb/types.ts
/** Latest Similarweb result for one site (Mongo collection `similarweb`). */
export interface SimilarwebStatus {
  /** Dashboard site id (`DashboardSiteEntry.domain`). Unique. */
  site: string;
  /** The real domain that was checked. */
  domain: string;
  has_rank: boolean;
  global_rank: number | null;
  monthly_visits: number | null;
  /** ISO timestamp of the import (or API fetch later). */
  checked_at: string;
  source: "manual" | "api";
}

/** One accepted line of the checklist results. */
export interface ParsedRow {
  line: number;
  domain: string;
  site: string;
  hasRank: boolean;
  globalRank: number | null;
  monthlyVisits: number | null;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** `unchecked` rows (the site keeps its previous result). */
  ignored: number;
  rejected: Array<{ line: number; reason: string }>;
  /** Required columns the header lacks — when non-empty, nothing else is parsed. */
  missingColumns: string[];
}

/** Sites-list filter value. */
export type SimilarwebFilter = "" | "yes" | "no" | "unchecked";
```

- [ ] **Step 2: Write the failing test**

```ts
// services/dashboard/src/lib/similarweb/__tests__/parse.test.ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/dashboard && npx vitest run src/lib/similarweb/__tests__/parse.test.ts`
Expected: FAIL — `Failed to resolve import "../parse"`.

- [ ] **Step 4: Implement**

```ts
// services/dashboard/src/lib/similarweb/parse.ts
import type { ParseResult, ParsedRow } from "./types";

/** One CSV line → fields (double-quoted fields may contain commas; "" is an escaped quote). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/** "68,562" | "68562" | "1.34M" | "12.5K" → integer; anything else → null. */
export function parseVisits(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "").toUpperCase();
  const m = /^(\d+(?:\.\d+)?)([KM]?)$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]!) * (m[2] === "M" ? 1_000_000 : m[2] === "K" ? 1_000 : 1);
  return Math.round(n);
}

function parseRank(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  return /^\d+$/.test(s) && Number(s) > 0 ? Number(s) : null;
}

/** Checklist results (see spec "Import format") → accepted rows, ignored count, rejected lines. */
export function parseSimilarwebCsv(text: string): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  const col = (name: string): number => header.indexOf(name);
  const iDomain = col("domain");
  const iSite = col("site");
  const iAnswer = col("similarweb");
  const iRank = col("global_rank");
  const iVisits = col("monthly_visits");

  const missingColumns = [
    ...(iAnswer < 0 ? ["similarweb"] : []),
    ...(iDomain < 0 && iSite < 0 ? ["domain or site"] : []),
  ];
  const result: ParseResult = { rows: [], ignored: 0, rejected: [], missingColumns };
  if (missingColumns.length > 0) return result;

  lines.slice(1).forEach((raw, idx) => {
    if (!raw.trim()) return;
    const line = idx + 2;
    const f = splitCsvLine(raw);
    const domain = iDomain >= 0 ? (f[iDomain] ?? "") : "";
    const site = iSite >= 0 ? (f[iSite] ?? "") : "";
    const label = domain || site || `line ${line}`;
    const answer = (f[iAnswer] ?? "").toLowerCase();
    if (answer === "unchecked") { result.ignored++; return; }
    if (answer !== "yes" && answer !== "no") {
      result.rejected.push({ line, reason: `${label}: similarweb must be yes, no or unchecked` });
      return;
    }
    if (!domain && !site) {
      result.rejected.push({ line, reason: `line ${line}: no domain or site` });
      return;
    }
    if (answer === "no") {
      result.rows.push({ line, domain, site, hasRank: false, globalRank: null, monthlyVisits: null });
      return;
    }
    const rank = iRank >= 0 ? parseRank(f[iRank] ?? "") : null;
    if (rank === null) {
      result.rejected.push({ line, reason: `${label}: 'yes' needs a global rank` });
      return;
    }
    const row: ParsedRow = {
      line, domain, site, hasRank: true, globalRank: rank,
      monthlyVisits: iVisits >= 0 ? parseVisits(f[iVisits] ?? "") : null,
    };
    result.rows.push(row);
  });
  return result;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/dashboard && npx vitest run src/lib/similarweb/__tests__/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit (after approval)**

```bash
git add services/dashboard/src/lib/similarweb/types.ts services/dashboard/src/lib/similarweb/parse.ts services/dashboard/src/lib/similarweb/__tests__/parse.test.ts
git commit -m "feat(dashboard): parse Similarweb checklist results"
```

---

### Task 2: Match rows to sites + display helpers

**Files:**
- Create: `services/dashboard/src/lib/similarweb/match.ts`, `services/dashboard/src/lib/similarweb/format.ts`
- Test: `services/dashboard/src/lib/similarweb/__tests__/match.test.ts`, `services/dashboard/src/lib/similarweb/__tests__/format.test.ts`

**Interfaces:**
- Consumes: `ParsedRow`, `SimilarwebStatus`, `SimilarwebFilter` (Task 1).
- Produces:
  - `normalizeHost(value: string): string`
  - `matchSimilarwebRows(rows: ParsedRow[], sites: Array<{ domain: string; custom_domain?: string | null }>, checkedAt: string): { statuses: SimilarwebStatus[]; unknown: string[] }`
  - `compactVisits(n: number): string`
  - `type SimilarwebCellKind = "rank" | "no-rank" | "no-domain" | "unchecked"`
  - `similarwebCell(site: { custom_domain?: string | null }, status: SimilarwebStatus | undefined): { kind: SimilarwebCellKind; text: string }`
  - `similarwebBadgeText(status: SimilarwebStatus | null | undefined): string | null`
  - `similarwebSortValue(site: { custom_domain?: string | null }, status: SimilarwebStatus | undefined): number`
  - `matchesSimilarwebFilter(site: { custom_domain?: string | null }, status: SimilarwebStatus | undefined, filter: SimilarwebFilter): boolean`

- [ ] **Step 1: Failing tests**

```ts
// services/dashboard/src/lib/similarweb/__tests__/match.test.ts
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
```

```ts
// services/dashboard/src/lib/similarweb/__tests__/format.test.ts
import { describe, expect, it } from "vitest";
import { compactVisits, matchesSimilarwebFilter, similarwebBadgeText, similarwebCell, similarwebSortValue } from "../format";
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

describe("sort and filter", () => {
  it("ranked (best first) < no rank < not checked < no domain", () => {
    const values = [
      similarwebSortValue(noDomain, undefined),
      similarwebSortValue(live, undefined),
      similarwebSortValue(live, st(false, null, null)),
      similarwebSortValue(live, st(true, 900000, null)),
      similarwebSortValue(live, st(true, 79692, null)),
    ];
    expect([...values].sort((a, b) => a - b)).toEqual([...values].reverse());
  });
  it("filter values", () => {
    expect(matchesSimilarwebFilter(live, st(true, 1, null), "yes")).toBe(true);
    expect(matchesSimilarwebFilter(live, st(false, null, null), "no")).toBe(true);
    expect(matchesSimilarwebFilter(live, undefined, "unchecked")).toBe(true);
    expect(matchesSimilarwebFilter(noDomain, undefined, "unchecked")).toBe(false);
    expect(matchesSimilarwebFilter(noDomain, undefined, "")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/dashboard && npx vitest run src/lib/similarweb/__tests__/match.test.ts src/lib/similarweb/__tests__/format.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// services/dashboard/src/lib/similarweb/match.ts
import type { ParsedRow, SimilarwebStatus } from "./types";

export function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
}

/**
 * Parsed checklist rows → one status per known site (last row for a site wins). A row matches a site by
 * its real domain (`custom_domain`), else by the dashboard site id. Rows matching nothing are returned in
 * `unknown` (by the text they gave) and never stored.
 */
export function matchSimilarwebRows(
  rows: ParsedRow[],
  sites: Array<{ domain: string; custom_domain?: string | null }>,
  checkedAt: string,
): { statuses: SimilarwebStatus[]; unknown: string[] } {
  const byHost = new Map<string, { domain: string; custom_domain?: string | null }>();
  const byId = new Map<string, { domain: string; custom_domain?: string | null }>();
  for (const s of sites) {
    if (s.custom_domain) byHost.set(normalizeHost(s.custom_domain), s);
    byId.set(s.domain.toLowerCase(), s);
  }
  const statuses = new Map<string, SimilarwebStatus>();
  const unknown: string[] = [];
  for (const r of rows) {
    const site = (r.domain ? byHost.get(normalizeHost(r.domain)) : undefined) ?? (r.site ? byId.get(r.site.toLowerCase()) : undefined);
    if (!site) {
      unknown.push(r.domain || r.site);
      continue;
    }
    statuses.delete(site.domain); // keep insertion order = last occurrence
    statuses.set(site.domain, {
      site: site.domain,
      domain: site.custom_domain ? normalizeHost(site.custom_domain) : "",
      has_rank: r.hasRank,
      global_rank: r.hasRank ? r.globalRank : null,
      monthly_visits: r.hasRank ? r.monthlyVisits : null,
      checked_at: checkedAt,
      source: "manual",
    });
  }
  return { statuses: [...statuses.values()], unknown };
}
```

```ts
// services/dashboard/src/lib/similarweb/format.ts
import type { SimilarwebFilter, SimilarwebStatus } from "./types";

type SiteLike = { custom_domain?: string | null };
export type SimilarwebCellKind = "rank" | "no-rank" | "no-domain" | "unchecked";

/** 1.34M · 853K · 6K · 257 */
export function compactVisits(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function rankText(status: SimilarwebStatus): string {
  const rank = `#${(status.global_rank ?? 0).toLocaleString("en-US")}`;
  return status.monthly_visits != null ? `${rank} · ${compactVisits(status.monthly_visits)}/mo` : rank;
}

export function similarwebCell(site: SiteLike, status: SimilarwebStatus | undefined): { kind: SimilarwebCellKind; text: string } {
  if (status?.has_rank) return { kind: "rank", text: rankText(status) };
  if (status) return { kind: "no-rank", text: "No rank" };
  if (!site.custom_domain) return { kind: "no-domain", text: "No domain" };
  return { kind: "unchecked", text: "—" };
}

export function similarwebBadgeText(status: SimilarwebStatus | null | undefined): string | null {
  if (!status) return null;
  return status.has_rank ? `Similarweb ${rankText(status)}` : "Similarweb: no rank";
}

/** Ascending order: ranked sites by rank (best first), then no rank, then not checked, then no domain. */
export function similarwebSortValue(site: SiteLike, status: SimilarwebStatus | undefined): number {
  const kind = similarwebCell(site, status).kind;
  if (kind === "rank") return status!.global_rank ?? 0;
  if (kind === "no-rank") return 1e12;
  if (kind === "unchecked") return 2e12;
  return 3e12;
}

export function matchesSimilarwebFilter(site: SiteLike, status: SimilarwebStatus | undefined, filter: SimilarwebFilter): boolean {
  if (!filter) return true;
  const kind = similarwebCell(site, status).kind;
  if (filter === "yes") return kind === "rank";
  if (filter === "no") return kind === "no-rank";
  return kind === "unchecked";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/dashboard && npx vitest run src/lib/similarweb`
Expected: PASS (all three files).

- [ ] **Step 5: Commit (after approval)**

```bash
git add services/dashboard/src/lib/similarweb/match.ts services/dashboard/src/lib/similarweb/format.ts services/dashboard/src/lib/similarweb/__tests__/match.test.ts services/dashboard/src/lib/similarweb/__tests__/format.test.ts
git commit -m "feat(dashboard): match Similarweb results to sites and format them"
```

---

### Task 3: Storage and API routes

**Files:**
- Modify: `services/dashboard/src/lib/db/collections.ts`
- Create: `services/dashboard/src/lib/db/similarweb.ts`, `services/dashboard/src/app/api/sites/similarweb/route.ts`, `services/dashboard/src/app/api/sites/similarweb/import/route.ts`
- Test: `services/dashboard/src/app/api/sites/similarweb/__tests__/import.test.ts`

**Interfaces:**
- Consumes: `parseSimilarwebCsv` (Task 1), `matchSimilarwebRows` (Task 2), `getDashboardIndex` (`@/lib/db/dashboard-index`), `getMongoDb` (`@/lib/mongo`).
- Produces: `readSimilarwebStatuses(): Promise<Record<string, SimilarwebStatus>>`; `readSimilarwebStatus(site: string): Promise<SimilarwebStatus | null>`; `upsertSimilarwebStatuses(statuses: SimilarwebStatus[]): Promise<void>`; `GET /api/sites/similarweb` → `{ statuses }`; `POST /api/sites/similarweb/import` `{ csv }` → `{ updated, ignored, rejected, unknown }` or `400 { error }`.

- [ ] **Step 1: Failing route test**

```ts
// services/dashboard/src/app/api/sites/similarweb/__tests__/import.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/db/similarweb", () => ({ upsertSimilarwebStatuses: (...a: unknown[]) => upsert(...a) }));
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(async () => ({ sites: [
    { domain: "scoopella", custom_domain: "scoopella.com" },
    { domain: "journeypeaks", custom_domain: "journeypeaks.com" },
  ] })),
}));

import { POST } from "../import/route";

const req = (body: unknown): Request => new Request("http://x/api/sites/similarweb/import", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/sites/similarweb/import", () => {
  beforeEach(() => upsert.mockClear());

  it("stores matched rows and reports counts", async () => {
    const csv = "domain,site,similarweb,global_rank,monthly_visits\njourneypeaks.com,journeypeaks,yes,79692,1.34M\nscoopella.com,scoopella,no,,\nx.com,x,no,,\na.com,a,unchecked,,";
    const res = await POST(req({ csv }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2, ignored: 1, rejected: [], unknown: ["x.com"] });
    const stored = upsert.mock.calls[0]![0] as Array<{ site: string }>;
    expect(stored.map((s) => s.site)).toEqual(["journeypeaks", "scoopella"]);
  });

  it("writes nothing and returns 400 when no row is valid", async () => {
    const res = await POST(req({ csv: "url,rank\na.com,1" }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing column/i);
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

Run: `cd services/dashboard && npx vitest run src/app/api/sites/similarweb/__tests__/import.test.ts`
Expected: FAIL — `../import/route` not found.

- [ ] **Step 2: Storage**

In `collections.ts` add to `COLLECTIONS`: `similarweb: "similarweb",`.

```ts
// services/dashboard/src/lib/db/similarweb.ts
import { getMongoDb } from "../mongo";
import { COLLECTIONS } from "./collections";
import type { SimilarwebStatus } from "@/lib/similarweb/types";

/** Latest Similarweb result per site (not git-backed — see spec "Storage"). */
async function collection(): Promise<import("mongodb").Collection<SimilarwebStatus>> {
  const db = await getMongoDb();
  return db.collection<SimilarwebStatus>(COLLECTIONS.similarweb);
}

function strip(doc: SimilarwebStatus & { _id?: unknown }): SimilarwebStatus {
  const { _id: _ignored, ...rest } = doc;
  return rest;
}

export async function readSimilarwebStatuses(): Promise<Record<string, SimilarwebStatus>> {
  const docs = await (await collection()).find({}).toArray();
  return Object.fromEntries(docs.map((d) => [d.site, strip(d)]));
}

export async function readSimilarwebStatus(site: string): Promise<SimilarwebStatus | null> {
  const doc = await (await collection()).findOne({ site });
  return doc ? strip(doc) : null;
}

export async function upsertSimilarwebStatuses(statuses: SimilarwebStatus[]): Promise<void> {
  if (statuses.length === 0) return;
  const col = await collection();
  await col.createIndex({ site: 1 }, { unique: true });
  await col.bulkWrite(statuses.map((s) => ({ replaceOne: { filter: { site: s.site }, replacement: s, upsert: true } })));
}
```

- [ ] **Step 3: Routes**

```ts
// services/dashboard/src/app/api/sites/similarweb/route.ts
import { NextResponse } from "next/server";
import { readSimilarwebStatuses } from "@/lib/db/similarweb";
import type { SimilarwebStatus } from "@/lib/similarweb/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<{ statuses: Record<string, SimilarwebStatus> } | { error: string }>> {
  try {
    return NextResponse.json({ statuses: await readSimilarwebStatuses() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

```ts
// services/dashboard/src/app/api/sites/similarweb/import/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { upsertSimilarwebStatuses } from "@/lib/db/similarweb";
import { parseSimilarwebCsv } from "@/lib/similarweb/parse";
import { matchSimilarwebRows } from "@/lib/similarweb/match";

interface ImportResponse {
  updated: number;
  ignored: number;
  rejected: Array<{ line: number; reason: string }>;
  unknown: string[];
}

/** Checklist results → latest Similarweb status per matched site. One bulk write (well under the gateway limit). */
export async function POST(request: NextRequest): Promise<NextResponse<ImportResponse | { error: string }>> {
  let csv = "";
  try {
    const body = (await request.json()) as { csv?: unknown };
    csv = typeof body.csv === "string" ? body.csv : "";
  } catch { /* empty body → handled below */ }

  const parsed = parseSimilarwebCsv(csv);
  if (parsed.missingColumns.length > 0) {
    return NextResponse.json({ error: `This doesn't look like the checklist results — missing column: ${parsed.missingColumns.join(", ")}` }, { status: 400 });
  }
  try {
    const index = await getDashboardIndex();
    const { statuses, unknown } = matchSimilarwebRows(parsed.rows, index.sites, new Date().toISOString());
    if (statuses.length === 0) {
      return NextResponse.json({ error: "No rows matched a site — nothing was imported" }, { status: 400 });
    }
    await upsertSimilarwebStatuses(statuses);
    return NextResponse.json({ updated: statuses.length, ignored: parsed.ignored, rejected: parsed.rejected, unknown });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the route test, then typecheck**

Run: `cd services/dashboard && npx vitest run src/app/api/sites/similarweb/__tests__/import.test.ts && pnpm typecheck`
Expected: PASS (2 tests); typecheck exit 0.

- [ ] **Step 5: Commit (after approval)**

```bash
git add services/dashboard/src/lib/db/collections.ts services/dashboard/src/lib/db/similarweb.ts services/dashboard/src/app/api/sites/similarweb/route.ts services/dashboard/src/app/api/sites/similarweb/import/route.ts services/dashboard/src/app/api/sites/similarweb/__tests__/import.test.ts
git commit -m "feat(dashboard): store Similarweb status per site with import and read routes"
```

---

### Task 4: Column definition, sort key, reveal of new default columns

**Files:**
- Modify: `services/dashboard/src/lib/site-columns.ts`, `services/dashboard/src/lib/site-sort.ts`
- Modify tests: `services/dashboard/src/lib/__tests__/site-columns.test.ts`, `services/dashboard/src/lib/__tests__/site-sort.test.ts`, `services/dashboard/src/components/dashboard/__tests__/SitesTable.columns.test.tsx` (expected default lists)

**Interfaces:**
- Consumes: `SimilarwebStatus` (Task 1), `similarwebCell`, `similarwebSortValue` (Task 2).
- Produces: `SiteColumnSource` gains `"similarweb"`; `SiteColumnContext.similarweb?: Record<string, SimilarwebStatus>`; column `{ id: "similarweb", label: "Similarweb", defaultVisible: true, source: "similarweb", sortable: true }` placed right after `status`; `hasColumnSource(visibleIds: string[], source: SiteColumnSource): boolean`; `COLUMNS_SEEN_KEY`; `SiteSortKey` gains `"similarweb"`; `SiteSortContext.similarweb?: Record<string, SimilarwebStatus>`.

- [ ] **Step 1: Failing tests** (append to `site-columns.test.ts`; import `COLUMN_STORAGE_KEY, COLUMNS_SEEN_KEY, hasColumnSource, getColumnById` as needed)

```ts
describe("Similarweb column", () => {
  const ctx = { siteGroups: {}, articleCounts: {}, latestArticles: {}, liveConfig: {} };
  const site = { domain: "journeypeaks", custom_domain: "journeypeaks.com" } as never;
  it("is a default column right after Status, sourced separately", () => {
    expect(DEFAULT_VISIBLE_COLUMN_IDS.indexOf("similarweb")).toBe(DEFAULT_VISIBLE_COLUMN_IDS.indexOf("status") + 1);
    expect(hasColumnSource(["similarweb"], "similarweb")).toBe(true);
    expect(hasColumnSource(DEFAULT_VISIBLE_COLUMN_IDS.filter((id) => id !== "similarweb"), "similarweb")).toBe(false);
  });
  it("CSV cell uses the same text as the table", () => {
    const col = getColumnById("similarweb")!;
    const status = { site: "journeypeaks", domain: "journeypeaks.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: "x", source: "manual" as const };
    expect(col.csv(site, { ...ctx, similarweb: { journeypeaks: status } })).toBe("#79,692 · 1.34M/mo");
    expect(col.csv(site, ctx)).toBe("");
  });
});

describe("new default columns reach people who customised their columns", () => {
  beforeEach(() => window.localStorage.clear());
  it("a saved selection from before the column existed gets it appended once", () => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(["company", "status"]));
    expect(loadVisibleColumnIds()).toEqual(["company", "status", "similarweb"]);
  });
  it("hiding it afterwards sticks", () => {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(["company", "status"]));
    loadVisibleColumnIds();
    saveVisibleColumnIds(["company", "status"]);
    expect(loadVisibleColumnIds()).toEqual(["company", "status"]);
    expect(JSON.parse(window.localStorage.getItem(COLUMNS_SEEN_KEY) ?? "[]")).toContain("similarweb");
  });
});
```

(If `site-columns.test.ts` doesn't already import `beforeEach`, `saveVisibleColumnIds` or `loadVisibleColumnIds`, add them.)

Append to `site-sort.test.ts`:

```ts
describe("similarweb sort", () => {
  it("asc = best rank first, then no rank, not checked, no domain", () => {
    const mk = (domain: string, custom: string | null) => ({ domain, custom_domain: custom } as never);
    const sites = [mk("nodomain", null), mk("unchecked", "u.com"), mk("norank", "n.com"), mk("rank9", "r9.com"), mk("rank1", "r1.com")];
    const sw = {
      norank: { site: "norank", domain: "n.com", has_rank: false, global_rank: null, monthly_visits: null, checked_at: "x", source: "manual" as const },
      rank9: { site: "rank9", domain: "r9.com", has_rank: true, global_rank: 900, monthly_visits: null, checked_at: "x", source: "manual" as const },
      rank1: { site: "rank1", domain: "r1.com", has_rank: true, global_rank: 1, monthly_visits: null, checked_at: "x", source: "manual" as const },
    };
    const ctx = { articleCounts: {}, latestArticles: {}, siteGroups: {}, groupNames: {}, similarweb: sw };
    expect(sortSites(sites, { key: "similarweb", dir: "asc" }, ctx).map((s) => s.domain)).toEqual(["rank1", "rank9", "norank", "unchecked", "nodomain"]);
  });
});
```

Update the two expected default lists (`site-columns.test.ts` `DEFAULT_VISIBLE_COLUMN_IDS` test and `SitesTable.columns.test.tsx` ~line 190) by inserting `"similarweb"` after `"status"`.

Run: `cd services/dashboard && npx vitest run src/lib/__tests__/site-columns.test.ts src/lib/__tests__/site-sort.test.ts`
Expected: FAIL (no `similarweb` column / sort key / `hasColumnSource` / `COLUMNS_SEEN_KEY`).

- [ ] **Step 2: Implement in `site-columns.ts`**

Add imports:

```ts
import type { SimilarwebStatus } from "@/lib/similarweb/types";
import { similarwebCell } from "@/lib/similarweb/format";
```

Change `export type SiteColumnSource = "index" | "groups" | "articles" | "live";` to

```ts
export type SiteColumnSource = "index" | "groups" | "articles" | "live" | "similarweb";
```

In `SiteColumnContext` add:

```ts
  /** Latest Similarweb result per site id (fetched lazily; absent until loaded). */
  similarweb?: Record<string, SimilarwebStatus>;
```

In `SITE_COLUMNS`, right after the `status` entry:

```ts
  {
    id: "similarweb",
    label: "Similarweb",
    defaultVisible: true,
    source: "similarweb",
    sortable: true,
    tooltip: "Similarweb global rank and monthly visits from the last monthly check (Update Similarweb data). No rank = Similarweb has no ranking for the domain.",
    csv: (site, ctx) => {
      const status = ctx.similarweb?.[site.domain];
      const cell = similarwebCell(site, status);
      return cell.kind === "unchecked" ? "" : cell.text;
    },
  },
```

Below `COLUMN_STORAGE_KEY` add:

```ts
/** Column ids this browser has already been offered — lets a NEW default column appear once for people who
 *  customised their columns before it existed, without overriding a later choice to hide it. */
export const COLUMNS_SEEN_KEY = "sites-table-columns-seen-v1";
/** Every column that existed before seen-tracking was added (2026-10-11). */
const COLUMNS_BEFORE_SEEN_TRACKING = SITE_COLUMNS.map((c) => c.id).filter((id) => id !== "similarweb");

function markAllSeen(): void {
  try {
    window.localStorage.setItem(COLUMNS_SEEN_KEY, JSON.stringify(SITE_COLUMNS.map((c) => c.id)));
  } catch { /* storage unavailable */ }
}
```

Replace `loadVisibleColumnIds` body's stored-selection return with:

```ts
    const stored = parsed.filter((id): id is string => typeof id === "string" && VALID_COLUMN_IDS.has(id));
    let seen: string[] = COLUMNS_BEFORE_SEEN_TRACKING;
    try {
      const rawSeen = window.localStorage.getItem(COLUMNS_SEEN_KEY);
      const parsedSeen: unknown = rawSeen ? JSON.parse(rawSeen) : null;
      if (Array.isArray(parsedSeen)) seen = parsedSeen.filter((id): id is string => typeof id === "string");
    } catch { /* keep the pre-tracking list */ }
    const added = SITE_COLUMNS.filter((c) => c.defaultVisible && !seen.includes(c.id) && !stored.includes(c.id)).map((c) => c.id);
    markAllSeen();
    return [...stored, ...added];
```

and in `saveVisibleColumnIds`, after `setItem(COLUMN_STORAGE_KEY …)` add `markAllSeen();` (inside the same try).

Add next to `hasLiveColumn`:

```ts
/** Whether any visible column reads from the given lazily-fetched source. */
export function hasColumnSource(visibleIds: string[], source: SiteColumnSource): boolean {
  const visible = new Set(visibleIds);
  return SITE_COLUMNS.some((c) => c.source === source && visible.has(c.id));
}
```

- [ ] **Step 3: Implement in `site-sort.ts`**

```ts
import type { SimilarwebStatus } from "@/lib/similarweb/types";
import { similarwebSortValue } from "@/lib/similarweb/format";
```

`SiteSortKey` → `"website" | "group" | "category" | "articles" | "lastArticles" | "created" | "similarweb"`; add to `SiteSortContext`:

```ts
  /** Latest Similarweb result per site id. */
  similarweb?: Record<string, SimilarwebStatus>;
```

In `sortSites`, before the numeric branch:

```ts
  if (key === "similarweb") {
    return sorted.sort((a, b) => {
      const diff = similarwebSortValue(a, ctx.similarweb?.[a.domain]) - similarwebSortValue(b, ctx.similarweb?.[b.domain]);
      return dir === "asc" ? diff : -diff;
    });
  }
```

and narrow `sortNumber`'s key type accordingly (its switch already excludes `similarweb`; change the final `return sorted.sort(...)` call to pass `key as "articles" | "lastArticles" | "created"` if TypeScript requires).

- [ ] **Step 4: Run tests + typecheck**

Run: `cd services/dashboard && npx vitest run src/lib/__tests__/site-columns.test.ts src/lib/__tests__/site-sort.test.ts src/lib/__tests__/csv.test.ts && pnpm typecheck`
Expected: PASS; typecheck exit 0.

- [ ] **Step 5: Commit (after approval)**

```bash
git add services/dashboard/src/lib/site-columns.ts services/dashboard/src/lib/site-sort.ts services/dashboard/src/lib/__tests__/site-columns.test.ts services/dashboard/src/lib/__tests__/site-sort.test.ts services/dashboard/src/components/dashboard/__tests__/SitesTable.columns.test.tsx
git commit -m "feat(dashboard): Similarweb column, sort key and reveal of new default columns"
```

---

### Task 5: Table wiring — cell, header, lazy load, filter

**Files:**
- Create: `services/dashboard/src/components/dashboard/SimilarwebCell.tsx`, `services/dashboard/src/components/dashboard/__tests__/SimilarwebCell.test.tsx`
- Modify: `services/dashboard/src/components/dashboard/Filters.tsx`, `services/dashboard/src/components/dashboard/SitesTable.tsx`

**Interfaces:**
- Consumes: `similarwebCell`, `matchesSimilarwebFilter` (Task 2), `hasColumnSource`, `SiteColumnContext.similarweb` (Task 4), `GET /api/sites/similarweb` (Task 3).
- Produces: `SimilarwebCell({ site, status, loaded }): React.ReactElement`; `Filters` props `similarweb: SimilarwebFilter`, `onSimilarwebChange(v: SimilarwebFilter): void`.

- [ ] **Step 1: Failing cell test**

```tsx
// services/dashboard/src/components/dashboard/__tests__/SimilarwebCell.test.tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SimilarwebCell } from "../SimilarwebCell";

afterEach(cleanup);
const status = { site: "s", domain: "s.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" as const };

describe("SimilarwebCell", () => {
  it("ranked: check mark + rank text (state in text, not colour only)", () => {
    render(<SimilarwebCell site={{ custom_domain: "s.com" }} status={status} loaded />);
    expect(screen.getByText("#79,692 · 1.34M/mo")).toBeTruthy();
    expect(screen.getByLabelText("Has Similarweb rank")).toBeTruthy();
  });
  it("no rank / no domain / loading", () => {
    const { rerender } = render(<SimilarwebCell site={{ custom_domain: "s.com" }} status={{ ...status, has_rank: false, global_rank: null, monthly_visits: null }} loaded />);
    expect(screen.getByText("No rank")).toBeTruthy();
    rerender(<SimilarwebCell site={{ custom_domain: null }} status={undefined} loaded />);
    expect(screen.getByText("No domain")).toBeTruthy();
    rerender(<SimilarwebCell site={{ custom_domain: "s.com" }} status={undefined} loaded={false} />);
    expect(screen.getByLabelText("Loading Similarweb data")).toBeTruthy();
  });
});
```

Run: `cd services/dashboard && npx vitest run src/components/dashboard/__tests__/SimilarwebCell.test.tsx` → Expected: FAIL (module not found).

- [ ] **Step 2: The cell**

```tsx
// services/dashboard/src/components/dashboard/SimilarwebCell.tsx
import { similarwebCell } from "@/lib/similarweb/format";
import type { SimilarwebStatus } from "@/lib/similarweb/types";

interface SimilarwebCellProps {
  site: { custom_domain?: string | null };
  status: SimilarwebStatus | undefined;
  loaded: boolean;
}

/** Sites-list cell: ✓ rank · visits / ✗ No rank / No domain / — (never checked). */
export function SimilarwebCell({ site, status, loaded }: SimilarwebCellProps): React.ReactElement {
  if (!loaded && site.custom_domain) {
    return <span aria-label="Loading Similarweb data" className="inline-block w-16 h-3 rounded bg-[var(--bg-elevated)] animate-pulse" />;
  }
  const cell = similarwebCell(site, status);
  switch (cell.kind) {
    case "rank":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-[var(--text-primary)]">
          <span aria-label="Has Similarweb rank" className="text-emerald-500">✓</span>
          {cell.text}
        </span>
      );
    case "no-rank":
      return (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--text-muted)]">
          <span aria-hidden="true" className="text-red-400">✗</span>
          No rank
        </span>
      );
    case "no-domain":
      return <span className="text-xs text-[var(--text-muted)]">No domain</span>;
    default:
      return <span className="text-xs text-[var(--text-muted)]">—</span>;
  }
}
```

Run the cell test → Expected: PASS.

- [ ] **Step 3: Filter select in `Filters.tsx`**

Add props to `FiltersProps`:

```ts
  similarweb: SimilarwebFilter;
  onSimilarwebChange: (value: SimilarwebFilter) => void;
  /** True while the Similarweb data hasn't loaded — the filter result isn't reliable yet. */
  similarwebLoading: boolean;
```

(import `type SimilarwebFilter` from `@/lib/similarweb/types`; destructure the three props), and after the Status filter select add:

```tsx
      {/* Similarweb filter */}
      <select
        aria-label="Similarweb filter"
        value={similarweb}
        onChange={(e): void => onSimilarwebChange(e.target.value as SimilarwebFilter)}
        className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
      >
        <option value="">Similarweb: all</option>
        <option value="yes">Has rank</option>
        <option value="no">No rank</option>
        <option value="unchecked">Not checked</option>
      </select>
      {similarweb && similarwebLoading && (
        <span className="text-xs text-[var(--text-muted)]">Loading Similarweb data…</span>
      )}
```

- [ ] **Step 4: Wire `SitesTable.tsx`**

Imports: `hasColumnSource` from `@/lib/site-columns`; `SimilarwebCell`; `matchesSimilarwebFilter` from `@/lib/similarweb/format`; types `SimilarwebStatus`, `SimilarwebFilter`.

State (next to the live-config state):

```ts
  const [similarweb, setSimilarweb] = useState<Record<string, SimilarwebStatus>>({});
  const [similarwebLoaded, setSimilarwebLoaded] = useState(false);
  const [similarwebFilter, setSimilarwebFilter] = useState<SimilarwebFilter>("");
  const similarwebRequested = useRef(false);

  const loadSimilarweb = useCallback((): void => {
    fetch("/api/sites/similarweb")
      .then((r) => r.json())
      .then((data: { statuses?: Record<string, SimilarwebStatus> }) => setSimilarweb(data.statuses ?? {}))
      .catch(() => { /* leave empty — cells show "—" */ })
      .finally(() => setSimilarwebLoaded(true));
  }, []);

  // Fetch once, the first time the column is visible or the filter is used.
  useEffect(() => {
    if (similarwebRequested.current) return;
    if (!hasColumnSource(visibleColumnIds, "similarweb") && !similarwebFilter) return;
    similarwebRequested.current = true;
    loadSimilarweb();
  }, [visibleColumnIds, similarwebFilter, loadSimilarweb]);
```

`renderColumnHeader`: add `case "similarweb": return sortHeader("Similarweb", "similarweb");`.
`cellClassName`: add `case "similarweb": return "px-4 py-3";`.
`renderColumnCell`: add before `default:`

```tsx
      case "similarweb":
        return <SimilarwebCell site={site} status={similarweb[site.domain]} loaded={similarwebLoaded} />;
```

In the `filteredSites` memo, after `filterSites(...)`:

```ts
    const swFiltered = similarwebFilter
      ? filtered.filter((s) => matchesSimilarwebFilter(s, similarweb[s.domain], similarwebFilter))
      : filtered;
```

use `swFiltered` instead of `filtered` in the `sortSites` call; add `: sort.key === "similarweb" ? similarwebLoaded` to the `sortReady` chain; pass `similarweb` in the sort context; add `similarweb, similarwebFilter, similarwebLoaded` to the deps array.

Add `const similarwebFilterPending = Boolean(similarwebFilter) && !similarwebLoaded;` next to `groupFilterPending`, and show the existing pending row when `groupFilterPending || similarwebFilterPending` (same spot as the groups "Loading…" row; change its text to "Loading…").

Pass to `<Filters …>`: `similarweb={similarwebFilter} onSimilarwebChange={setSimilarwebFilter} similarwebLoading={!similarwebLoaded}`.

CSV export context: add `similarweb` to the object passed to `buildSitesCsvForColumns`, and disable export while `hasColumnSource(visibleColumnIds, "similarweb") && !similarwebLoaded` (extend the existing `exportWaitingOnLiveConfig` condition and title text: "Waiting for site data to finish loading…").

- [ ] **Step 5: Suite + typecheck**

Run: `cd services/dashboard && npx vitest run src/components/dashboard && pnpm typecheck`
Expected: PASS (existing SitesTable tests unaffected — the new fetch fails into the `.catch` in their mocks); typecheck exit 0.

- [ ] **Step 6: Commit (after approval)**

```bash
git add services/dashboard/src/components/dashboard/SimilarwebCell.tsx services/dashboard/src/components/dashboard/__tests__/SimilarwebCell.test.tsx services/dashboard/src/components/dashboard/Filters.tsx services/dashboard/src/components/dashboard/SitesTable.tsx
git commit -m "feat(dashboard): Similarweb column, sort and filter on the Sites list"
```

---

### Task 6: Import modal

**Files:**
- Create: `services/dashboard/src/components/dashboard/SimilarwebImportModal.tsx`, `services/dashboard/src/components/dashboard/__tests__/SimilarwebImportModal.test.tsx`
- Modify: `services/dashboard/src/components/dashboard/SitesTable.tsx` (button + modal)

**Interfaces:**
- Consumes: `parseSimilarwebCsv` (Task 1), `matchSimilarwebRows` (Task 2), `POST /api/sites/similarweb/import` (Task 3), `Modal`, `Button`, `useToast`.
- Produces: `SimilarwebImportModal({ open, onClose, sites, onImported }): React.ReactElement` where `sites: Array<{ domain: string; custom_domain?: string | null }>`, `onImported(): void`.

- [ ] **Step 1: Failing test**

```tsx
// services/dashboard/src/components/dashboard/__tests__/SimilarwebImportModal.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ toast }) }));

import { SimilarwebImportModal } from "../SimilarwebImportModal";

afterEach(() => { cleanup(); vi.restoreAllMocks(); toast.mockClear(); });
const SITES = [{ domain: "journeypeaks", custom_domain: "journeypeaks.com" }, { domain: "scoopella", custom_domain: "scoopella.com" }];
const CSV = "domain,site,similarweb,global_rank,monthly_visits\njourneypeaks.com,journeypeaks,yes,79692,1.34M\nscoopella.com,scoopella,no,,\nx.com,x,no,,";

describe("SimilarwebImportModal", () => {
  it("previews counts, then imports and reports", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ updated: 2, ignored: 0, rejected: [], unknown: ["x.com"] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onImported = vi.fn();
    render(<SimilarwebImportModal open onClose={vi.fn()} sites={SITES} onImported={onImported} />);
    fireEvent.change(screen.getByLabelText("Checklist results"), { target: { value: CSV } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("3 rows · 1 has rank · 1 no rank · 1 not matched · 0 rejected")).toBeTruthy();
    expect(screen.getByText("x.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 sites" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Similarweb updated for 2 sites", "success");
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).csv).toBe(CSV);
  });

  it("explains a file that isn't the checklist results and keeps Import disabled", () => {
    render(<SimilarwebImportModal open onClose={vi.fn()} sites={SITES} onImported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Checklist results"), { target: { value: "url,rank\na.com,1" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText(/missing column: similarweb, domain or site/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull();
  });
});
```

Run: `cd services/dashboard && npx vitest run src/components/dashboard/__tests__/SimilarwebImportModal.test.tsx` → Expected: FAIL (module not found).

- [ ] **Step 2: The modal**

```tsx
// services/dashboard/src/components/dashboard/SimilarwebImportModal.tsx
"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { parseSimilarwebCsv } from "@/lib/similarweb/parse";
import { matchSimilarwebRows } from "@/lib/similarweb/match";

/** Asaf's checklist page (private — share it from its Share menu to let others run the monthly check). */
const CHECKLIST_URL = "https://claude.ai/artifact/PRfFbfoS77CbdpJZPpjqgk";

interface SimilarwebImportModalProps {
  open: boolean;
  onClose: () => void;
  sites: Array<{ domain: string; custom_domain?: string | null }>;
  onImported: () => void;
}

interface Preview {
  error: string | null;
  rows: number;
  yes: number;
  no: number;
  unknown: string[];
  rejected: Array<{ line: number; reason: string }>;
  matched: number;
}

function buildPreview(text: string, sites: SimilarwebImportModalProps["sites"]): Preview {
  const parsed = parseSimilarwebCsv(text);
  if (parsed.missingColumns.length > 0) {
    return { error: `This doesn't look like the checklist results — missing column: ${parsed.missingColumns.join(", ")}`, rows: 0, yes: 0, no: 0, unknown: [], rejected: [], matched: 0 };
  }
  const { statuses, unknown } = matchSimilarwebRows(parsed.rows, sites, new Date().toISOString());
  return {
    error: null,
    rows: parsed.rows.length + parsed.rejected.length + parsed.ignored,
    yes: statuses.filter((s) => s.has_rank).length,
    no: statuses.filter((s) => !s.has_rank).length,
    unknown,
    rejected: parsed.rejected,
    matched: statuses.length,
  };
}

export function SimilarwebImportModal({ open, onClose, sites, onImported }: SimilarwebImportModalProps): React.ReactElement {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    void file.text().then((content) => { setText(content); setPreview(null); });
    e.target.value = "";
  }

  async function handleImport(): Promise<void> {
    setImporting(true);
    try {
      const res = await fetch("/api/sites/similarweb/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: text }),
      });
      const data = (await res.json()) as { updated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast(`Similarweb updated for ${data.updated ?? 0} sites`, "success");
      onImported();
      setText("");
      setPreview(null);
      onClose();
    } catch (err) {
      toast(`Import failed: ${err instanceof Error ? err.message : "Unknown"}`, "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Update Similarweb data" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Once a month, check each site with the Similarweb extension on the{" "}
          <a href={CHECKLIST_URL} target="_blank" rel="noopener noreferrer" className="text-cyan underline">checklist page</a>
          , click <strong>Copy results</strong>, and paste them here (or upload the saved .csv).
        </p>
        <label htmlFor="sw-results" className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Checklist results
        </label>
        <textarea
          id="sw-results"
          value={text}
          onChange={(e): void => { setText(e.target.value); setPreview(null); }}
          rows={8}
          placeholder="domain,site,similarweb,global_rank,monthly_visits"
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3 font-mono text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer text-sm text-[var(--text-secondary)] underline">
            Upload .csv
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </label>
          <Button variant="secondary" size="sm" onClick={(): void => setPreview(buildPreview(text, sites))} disabled={!text.trim()}>
            Preview
          </Button>
        </div>

        {preview && (
          <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-3 space-y-2" role="status">
            {preview.error ? (
              <p className="text-sm text-red-400">{preview.error}</p>
            ) : (
              <>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {`${preview.rows} rows · ${preview.yes} has rank · ${preview.no} no rank · ${preview.unknown.length} not matched · ${preview.rejected.length} rejected`}
                </p>
                {preview.unknown.length > 0 && (
                  <div className="text-xs text-[var(--text-muted)]">
                    Not matched to a site (skipped):
                    <ul className="mt-1 flex flex-wrap gap-2">{preview.unknown.map((u) => <li key={u} className="font-mono">{u}</li>)}</ul>
                  </div>
                )}
                {preview.rejected.length > 0 && (
                  <ul className="text-xs text-red-400 space-y-0.5">
                    {preview.rejected.map((r) => <li key={r.line}>Line {r.line}: {r.reason}</li>)}
                  </ul>
                )}
                {preview.matched > 0 && (
                  <Button variant="primary" size="sm" loading={importing} onClick={(): void => { void handleImport(); }}>
                    {`Import ${preview.matched} sites`}
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
```

Run the modal test → Expected: PASS.

- [ ] **Step 3: Button + modal in `SitesTable.tsx`**

State: `const [similarwebImportOpen, setSimilarwebImportOpen] = useState(false);`. In the toolbar, before the Export CSV button:

```tsx
          <Button type="button" variant="secondary" size="md" onClick={(): void => setSimilarwebImportOpen(true)} title="Paste this month's Similarweb checklist results">
            Update Similarweb data
          </Button>
```

After the `BulkPublishModal` block:

```tsx
      {similarwebImportOpen && (
        <SimilarwebImportModal
          open={similarwebImportOpen}
          onClose={(): void => setSimilarwebImportOpen(false)}
          sites={sites}
          onImported={(): void => { similarwebRequested.current = true; loadSimilarweb(); }}
        />
      )}
```

- [ ] **Step 4: Suite + typecheck**

Run: `cd services/dashboard && npx vitest run src/components/dashboard && pnpm typecheck`
Expected: PASS; exit 0.

- [ ] **Step 5: Commit (after approval)**

```bash
git add services/dashboard/src/components/dashboard/SimilarwebImportModal.tsx services/dashboard/src/components/dashboard/__tests__/SimilarwebImportModal.test.tsx services/dashboard/src/components/dashboard/SitesTable.tsx
git commit -m "feat(dashboard): Update Similarweb data — paste checklist results"
```

---

### Task 7: Site header badge + guide page

**Files:**
- Modify: `services/dashboard/src/components/site-detail/SiteDetailHeader.tsx`, `services/dashboard/src/app/sites/[domain]/page.tsx`, `services/dashboard/src/app/guide/page.tsx`
- Create: `services/dashboard/src/components/site-detail/__tests__/SiteDetailHeader.similarweb.test.tsx`, `services/dashboard/public/guide/25-similarweb.md`

**Interfaces:**
- Consumes: `similarwebBadgeText` (Task 2), `readSimilarwebStatus` (Task 3).
- Produces: `SiteDetailHeader` prop `similarweb?: SimilarwebStatus | null`.

- [ ] **Step 1: Failing test**

```tsx
// services/dashboard/src/components/site-detail/__tests__/SiteDetailHeader.similarweb.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../RefreshCacheButton", () => ({ RefreshCacheButton: () => null }));
import { SiteDetailHeader } from "../SiteDetailHeader";

afterEach(cleanup);
const site = { domain: "journeypeaks", custom_domain: "journeypeaks.com", status: "Live", company: "ATL", vertical: "Travel" } as never;
const status = { site: "journeypeaks", domain: "journeypeaks.com", has_rank: true, global_rank: 79692, monthly_visits: 1340000, checked_at: "2026-10-11T08:00:00.000Z", source: "manual" as const };

describe("SiteDetailHeader Similarweb badge", () => {
  it("shows rank and visits with the check date in the tooltip", () => {
    render(<SiteDetailHeader site={site} similarweb={status} />);
    const badge = screen.getByText("Similarweb #79,692 · 1.34M/mo");
    expect(badge.getAttribute("title")).toBe("Checked Oct 11, 2026 (manual)");
  });
  it("no badge when never checked", () => {
    render(<SiteDetailHeader site={site} similarweb={null} />);
    expect(screen.queryByText(/Similarweb/)).toBeNull();
  });
});
```

Run: `cd services/dashboard && npx vitest run src/components/site-detail/__tests__/SiteDetailHeader.similarweb.test.tsx` → Expected: FAIL (no badge).

- [ ] **Step 2: Badge**

In `SiteDetailHeader.tsx`: import `similarwebBadgeText` and `type SimilarwebStatus`; add `similarweb?: SimilarwebStatus | null;` to the props and destructure it; after `<StatusBadge status={site.status} />`:

```tsx
            {similarwebBadgeText(similarweb) && (
              <span
                title={`Checked ${new Date(similarweb!.checked_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} (${similarweb!.source})`}
                className={`rounded-full border px-2.5 py-0.5 text-xs tabular-nums ${similarweb!.has_rank ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-[var(--border-secondary)] text-[var(--text-muted)]"}`}
              >
                {similarwebBadgeText(similarweb)}
              </span>
            )}
```

In `src/app/sites/[domain]/page.tsx`: `import { readSimilarwebStatus } from "@/lib/db/similarweb";`, then before the `return`:

```ts
  // Similarweb badge — Mongo-only data; a failed read just hides the badge.
  const similarweb = await readSimilarwebStatus(site.domain).catch(() => null);
```

and pass `similarweb={similarweb}` to `<SiteDetailHeader …>`.

Run the badge test → Expected: PASS.

- [ ] **Step 3: Guide page**

```md
<!-- services/dashboard/public/guide/25-similarweb.md -->
# Similarweb

The **Similarweb** column on the Sites list shows whether Similarweb ranks each site:

| Shows | Means |
|---|---|
| ✓ #79,692 · 1.34M/mo | Similarweb has a global rank for the domain (and its monthly visits estimate) |
| ✗ No rank | Similarweb has no ranking — even if it shows a small visits estimate |
| No domain | The site has no real domain yet (staging-only) |
| — | Never checked |

Sort by the column to see the best-ranked sites first, or filter to **No rank**. The same result shows as a badge on each site's page.

## Monthly update (about 10 minutes)
1. Open the Similarweb checklist page and check each site with the Similarweb browser extension (or its Similarweb page): mark **Has rank** with the rank, or **No rank**.
2. Click **Copy results**.
3. On the Sites list click **Update Similarweb data**, paste, **Preview**, then **Import**.

Do the import on the **production** dashboard — a local dashboard has its own database.

Rows that don't match a site, or say "yes" without a rank, are listed in the preview and skipped. A site left "unchecked" keeps its previous result.

## Later
With Similarweb REST API access, the dashboard will refresh this automatically every month — same column, no pasting.
```

In `src/app/guide/page.tsx` append to `GUIDE_PAGES`: `{ slug: "25-similarweb", title: "Similarweb" },`.

- [ ] **Step 4: Full suite + typecheck**

Run: `cd services/dashboard && npx vitest run && pnpm typecheck`
Expected: all tests pass; exit 0.

- [ ] **Step 5: Local check, then commit (after approval)**

In `grid dev`: Sites list → **Update Similarweb data** → paste the 2026-10-11 results (saved at `scratchpad/sw-results.csv`) → Preview shows `56 rows · 21 has rank · 35 no rank · 0 not matched · 0 rejected` → Import → column fills; sort by Similarweb (journeypeaks first); filter No rank (35); open journeypeaks → header badge. Then:

```bash
git add services/dashboard/src/components/site-detail/SiteDetailHeader.tsx "services/dashboard/src/app/sites/[domain]/page.tsx" services/dashboard/src/components/site-detail/__tests__/SiteDetailHeader.similarweb.test.tsx services/dashboard/public/guide/25-similarweb.md services/dashboard/src/app/guide/page.tsx
git commit -m "feat(dashboard): Similarweb badge on the site page and guide page"
```

---

## Rollout
1. Merge + `grid plug`.
2. Production dashboard → Sites → **Update Similarweb data** → paste the 2026-10-11 results → Import.
3. Monthly: checklist → Copy results → paste → Import.
