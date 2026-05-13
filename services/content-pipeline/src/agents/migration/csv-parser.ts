import type { CsvSiteRow, GaInfo } from "./types.js";

/**
 * Parse a color palette string like "primary: #F43656, secondary: #C87137, ..."
 * into a Record<string, string>.
 */
export function parseColorPalette(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const result: Record<string, string> = {};
  const pairs = trimmed.split(",");

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(":");
    if (colonIdx === -1) continue;
    const key = pair.slice(0, colonIdx).trim();
    const value = pair.slice(colonIdx + 1).trim();
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Parse a GA info string like "328395426, G-HL2D8CQ0Z9, GT-5R65N74B"
 * into a GaInfo object. Identifies tokens by prefix:
 *  - G- → measurement ID
 *  - GT- → GTM ID
 *  - numeric → property ID
 */
export function parseGaInfo(raw: string): GaInfo {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const result: GaInfo = {};
  const tokens = trimmed.split(",");

  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;

    if (t.startsWith("GT-")) {
      result.gtmId = t;
    } else if (t.startsWith("G-")) {
      result.gaMeasurementId = t;
    } else if (/^\d+$/.test(t)) {
      result.gaPropertyId = t;
    }
  }

  return result;
}

/**
 * Split a comma-separated string into a trimmed array.
 * Returns [] for empty/whitespace-only input.
 */
function splitCommaSeparated(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Parse a raw CSV row object (keyed by column header) into a typed CsvSiteRow.
 */
export function parseCsvRow(row: Record<string, string>): CsvSiteRow {
  return {
    name: (row["Site Name"] ?? row["Name"] ?? "").trim(),
    domain: (row["domain"] ?? "").trim(),
    company: (row["Company"] ?? "").trim(),
    websiteCategory: (row["Website Category"] ?? "").trim(),
    menuItems: splitCommaSeparated(row["Menu Items"] ?? ""),
    iabCategories: splitCommaSeparated(row["IAB Top Categories (Vertical)"] ?? ""),
    subCategories: splitCommaSeparated(row["Sub Categories"] ?? ""),
    colorPalette: parseColorPalette(row["Color Palette"] ?? ""),
    logoUrl: (row["Logo"] ?? "").trim(),
    faviconUrl: (row["Favicon"] ?? "").trim(),
    postsApiUrl: (row["Posts REST API (articles)"] ?? "").trim(),
    gaInfo: parseGaInfo(row["GA Info"] ?? ""),
  };
}
