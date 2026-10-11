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
