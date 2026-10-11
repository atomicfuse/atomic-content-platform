import type { SimilarwebFilter, SimilarwebStatus } from "./types";

type SiteLike = { custom_domain?: string | null };
export type SimilarwebCellKind = "rank" | "no-rank" | "no-domain" | "unchecked";

/** 1.34M · 853K · 6K · 257 */
export function compactVisits(n: number): string {
  // Round first, then pick the unit, so 999,600 reads "1M" rather than "1000K".
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function rankText(status: SimilarwebStatus): string {
  const rank = `#${(status.global_rank ?? 0).toLocaleString("en-US")}`;
  return status.monthly_visits != null ? `${rank} · ${compactVisits(status.monthly_visits)}/mo` : rank;
}

export function similarwebCell(site: SiteLike, status: SimilarwebStatus | undefined): { kind: SimilarwebCellKind; text: string } {
  // No real domain → nothing Similarweb could rank, whatever an old import stored (spec D1).
  if (!site.custom_domain) return { kind: "no-domain", text: "No domain" };
  if (status?.has_rank) return { kind: "rank", text: rankText(status) };
  if (status) return { kind: "no-rank", text: "No rank" };
  return { kind: "unchecked", text: "—" };
}

export function similarwebBadgeText(status: SimilarwebStatus | null | undefined): string | null {
  if (!status) return null;
  return status.has_rank ? `Similarweb ${rankText(status)}` : "Similarweb: no rank";
}

const GROUP_ORDER: Record<SimilarwebCellKind, number> = { rank: 0, "no-rank": 1, unchecked: 2, "no-domain": 3 };

/**
 * Sort comparator: ranked sites first (best rank first ascending, worst first descending), then
 * no rank, not checked and no domain — those stay at the bottom in both directions.
 */
export function compareSimilarweb(
  a: SiteLike, aStatus: SimilarwebStatus | undefined,
  b: SiteLike, bStatus: SimilarwebStatus | undefined,
  dir: "asc" | "desc",
): number {
  const ka = similarwebCell(a, aStatus).kind;
  const kb = similarwebCell(b, bStatus).kind;
  if (ka !== kb) return GROUP_ORDER[ka] - GROUP_ORDER[kb];
  if (ka !== "rank") return 0;
  const diff = (aStatus!.global_rank ?? 0) - (bStatus!.global_rank ?? 0);
  return dir === "asc" ? diff : -diff;
}

/** Newest `checked_at` across all results (for "last checked" labels), or null when there are none. */
export function latestCheckedAt(statuses: Record<string, SimilarwebStatus>): string | null {
  let latest: string | null = null;
  for (const s of Object.values(statuses)) if (s.checked_at && (!latest || s.checked_at > latest)) latest = s.checked_at;
  return latest;
}

export function matchesSimilarwebFilter(site: SiteLike, status: SimilarwebStatus | undefined, filter: SimilarwebFilter): boolean {
  if (!filter) return true;
  const kind = similarwebCell(site, status).kind;
  if (filter === "yes") return kind === "rank";
  if (filter === "no") return kind === "no-rank";
  return kind === "unchecked";
}
