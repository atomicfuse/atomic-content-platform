"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { GridPoolItem, GridPoolResponse, GridSummaryStatus } from "@/types/grid";

interface StoriesTableProps {
  pool: GridPoolResponse;
  onTogglePin: (item: GridPoolItem) => void;
  onEdit: (item: GridPoolItem) => void;
  /** True when an item's pin comes from a group or override (not the site's own `grid.pinned`) — it can't be unpinned here. */
  isInheritedPin?: (item: GridPoolItem) => boolean;
  /** "Use AI summary": generate + pin a summary for this story regardless of the site's story mode. */
  onUseAiSummary?: (item: GridPoolItem) => void;
  /** "Back to default": unpin the story's summary (the file is kept). */
  onBackToDefault?: (item: GridPoolItem) => void;
}

const STATUS_LABEL: Record<GridSummaryStatus, string> = {
  none: "Excerpt fallback",
  generated: "AI summary",
  edited: "Edited",
  stale: "Stale — source changed after edit",
};

const STATUS_VARIANT: Record<GridSummaryStatus, "default" | "success" | "warning" | "info"> = {
  none: "default",
  generated: "info",
  edited: "success",
  stale: "warning",
};

function age(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return "—";
  return days <= 0 ? "today" : `${days}d`;
}

/** Summary cell label: pinned summaries say so; an external story's default text is What It Covers. */
function summaryLabel(item: GridPoolItem, status: GridSummaryStatus): string {
  if (item.summary?.pinned) return "AI summary (pinned)";
  if (status === "none" && item.kind === "external") return "What It Covers";
  return STATUS_LABEL[status];
}

/** The Grid site's current feed with pin / summary actions. Summary status shows in every mode — per-story overrides apply regardless of the site's story mode. */
export function StoriesTable({ pool, onTogglePin, onEdit, isInheritedPin, onUseAiSummary, onBackToDefault }: StoriesTableProps): React.ReactElement {
  const ai = pool.storyMode === "ai_summary";
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-[var(--border-primary)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-surface)]">
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Story
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Source
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Age
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Summary
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {pool.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[var(--text-muted)]">
                  No stories in the current feed.
                </td>
              </tr>
            ) : (
              pool.items.map((item) => {
                // No `summary` field = not looked up (worker lookup cap / per-item KV error) → "—", distinct from status "none".
                const status = item.summary?.status;
                const inheritedPin = item.pinned && (isInheritedPin?.(item) ?? false);
                return (
                  <tr
                    key={`${item.site}:${item.slug}`}
                    className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        {item.pinned && <Badge label="Pinned" variant="info" />}
                        <span>{item.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {item.kind === "external" ? <Badge label={`External · ${item.sourceName ?? "aggregator"}`} variant="info" /> : item.site}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{age(item.publishDate)}</td>
                    <td className="px-4 py-3">
                      {status ? (
                        <Badge label={summaryLabel(item, status)} variant={item.summary?.pinned ? "success" : STATUS_VARIANT[status]} />
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]" title="Summary status not looked up">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {inheritedPin ? (
                          <Button variant="secondary" size="sm" disabled aria-label={`Pinned by group: ${item.title}`}>
                            Pinned by group
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`${item.pinned ? "Unpin" : "Pin"} ${item.title}`}
                            onClick={(): void => onTogglePin(item)}
                          >
                            {item.pinned ? "Unpin" : "Pin"}
                          </Button>
                        )}
                        {item.summary?.pinned
                          ? onBackToDefault && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Back to default for ${item.title}`}
                              onClick={(): void => onBackToDefault(item)}
                            >
                              Back to default
                            </Button>
                          )
                          : onUseAiSummary && (
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Use AI summary for ${item.title}`}
                              onClick={(): void => onUseAiSummary(item)}
                            >
                              Use AI summary
                            </Button>
                          )}
                        {(ai || (status !== undefined && status !== "none")) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit summary for ${item.title}`}
                            onClick={(): void => onEdit(item)}
                          >
                            Edit
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {pool.inactivePins.length > 0 && (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-4 py-3">
          <p className="mb-1 text-xs font-semibold text-[var(--text-secondary)]">Inactive pins</p>
          <ul className="space-y-0.5 text-xs text-[var(--text-muted)]">
            {pool.inactivePins.map((p) => (
              <li key={`${p.site}:${p.slug}`}>
                {p.site}/{p.slug} — {p.reason.replace("_", " ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
