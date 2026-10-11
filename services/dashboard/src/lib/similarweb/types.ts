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
