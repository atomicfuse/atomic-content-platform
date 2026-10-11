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
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/); // strip a byte-order mark (Excel)
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
