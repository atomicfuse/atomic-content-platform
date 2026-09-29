import type { DashboardSiteEntry } from "@/types/dashboard";

/**
 * RFC-4180 field escaping. Wraps a field in double quotes (doubling any
 * embedded quotes) when it contains a comma, quote, or newline — the
 * characters that would otherwise break a single CSV cell.
 *
 * Shared by the sites-list "Export CSV" button (`buildSitesCsv` below) and
 * `CsvSiteCreator`'s template download — moved here so both stay in sync.
 */
export function escapeCsvField(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n") || field.includes("\r")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Prefixes values that would be interpreted as a formula by Excel/Sheets
 * (leading =, +, -, @) with a leading apostrophe, so opening the exported
 * CSV can't execute attacker-controlled content (CSV formula injection).
 */
function sanitizeFormulaInjection(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  return escapeCsvField(sanitizeFormulaInjection(value));
}

/**
 * Column order for the sites-list CSV export. `template` is intentionally
 * omitted: it isn't present on `DashboardSiteEntry` (dashboard-index.yaml) —
 * only in per-site config, which would mean one extra fetch per site to
 * populate a single column. See task-HB-report.md.
 */
export const SITES_CSV_COLUMNS = [
  "domain",
  "custom_domain",
  "status",
  "company",
  "category",
  "groups",
  "created_at",
  "last_updated",
  "staging_preview_url",
] as const;

type SitesCsvColumn = (typeof SITES_CSV_COLUMNS)[number];

/** Maps one site to a column-name-keyed record. Building rows through this —
 *  and reading them back out via `SITES_CSV_COLUMNS.map(...)` in
 *  `buildSitesCsv` — means the header and each row are driven by the same
 *  column list, so they can't drift out of sync with each other. */
function siteToCsvRecord(
  site: DashboardSiteEntry,
  siteGroups: Record<string, string[]>,
): Record<SitesCsvColumn, string> {
  return {
    domain: site.domain,
    custom_domain: site.custom_domain ?? "",
    status: site.status,
    company: site.company ?? "",
    category: site.vertical ?? "",
    groups: (siteGroups[site.domain] ?? []).join(";"),
    created_at: site.created_at ?? "",
    last_updated: site.last_updated ?? "",
    staging_preview_url: site.preview_url ?? "",
  };
}

/**
 * Builds the CSV text for the sites-list "Export CSV" button. `rows` should
 * already be filtered and sorted the way the table renders them — this
 * function exports exactly what it's given, in that order.
 */
export function buildSitesCsv(
  rows: DashboardSiteEntry[],
  siteGroups: Record<string, string[]>,
): string {
  const lines = [SITES_CSV_COLUMNS.map(csvCell).join(",")];
  for (const site of rows) {
    const record = siteToCsvRecord(site, siteGroups);
    lines.push(SITES_CSV_COLUMNS.map((column) => csvCell(record[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/** `sites-YYYY-MM-DD.csv`, using the local date at call time. */
export function sitesCsvFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `sites-${y}-${m}-${d}.csv`;
}
