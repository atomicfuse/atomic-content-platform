import type { HistoryEntry } from "@/types/dashboard";

interface HistoryListProps {
  items: HistoryEntry[];
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function HistoryList({ items }: HistoryListProps): React.ReactElement {
  return (
    <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] overflow-hidden">
      <div className="overflow-auto max-h-[80vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-surface)]">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Site
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Domain
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Company
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Category
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Permanently Deleted
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={`${item.domain}-${i}`}
                className="border-b border-[var(--border-secondary)] last:border-b-0"
              >
                <td className="px-4 py-3 font-medium text-[var(--text-secondary)]">
                  {item.domain}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">
                  {item.custom_domain ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {item.company ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  {item.vertical ?? "—"}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                  {formatDateTime(item.permanently_deleted_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
