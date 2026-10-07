"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { GridHiddenStoryFields, GridPoolItem, GridPoolResponse, GridSummaryStatus } from "@/types/grid";

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
  /** True while this row's summary request is in flight. */
  isBusy?: (item: GridPoolItem) => boolean;
  /** True when this row's summary was just created and the site hasn't synced it yet. */
  isSyncing?: (item: GridPoolItem) => boolean;
  /** Pin state to show; defaults to the pool's (which lags a site re-sync behind a Pin click). */
  isPinned?: (item: GridPoolItem) => boolean;
  /** "Hide": remove the story from this site. */
  onHide?: (item: GridPoolItem) => void;
  onUnhide?: (entry: GridHiddenStoryFields) => void;
  /** The site's hidden stories (listed under the table, with Unhide). */
  hidden?: GridHiddenStoryFields[];
  /** Rows to leave out of the table (hidden, but the site hasn't re-synced yet). */
  isHidden?: (item: GridPoolItem) => boolean;
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

/** Summary cell label: pinned summaries say so; with no summary, name the text the page actually shows. */
function summaryLabel(item: GridPoolItem, status: GridSummaryStatus, networkAi: boolean): string {
  if (item.summary?.pinned) return "AI summary (set manually)";
  if (status === "none" && item.kind === "external") return "What It Covers";
  if (status === "none" && !networkAi) return "Excerpt";
  return STATUS_LABEL[status];
}

/** The Grid site's current feed with pin / summary actions. Summary status shows in every mode — per-story overrides apply regardless of the site's story mode. */
export function StoriesTable({
  pool, onTogglePin, onEdit, isInheritedPin, onUseAiSummary, onBackToDefault, isBusy, isSyncing, isPinned, onHide, onUnhide, hidden = [], isHidden,
}: StoriesTableProps): React.ReactElement {
  const ai = pool.storyMode === "ai_summary";
  return (
    <div className="space-y-4">
      {onUseAiSummary && (
        <p className="text-xs text-[var(--text-muted)]">
          Each story page uses the site&apos;s story text setting. <span className="font-medium text-[var(--text-secondary)]">Use AI summary</span> gives one story its own AI summary, whatever the setting; <span className="font-medium text-[var(--text-secondary)]">Back to default</span> undoes it.
        </p>
      )}
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
              pool.items.filter((item) => !isHidden?.(item)).map((item) => {
                // No `summary` field = not looked up (worker lookup cap / per-item KV error) → "—", distinct from status "none".
                const status = item.summary?.status;
                const pinned = isPinned?.(item) ?? item.pinned;
                const inheritedPin = pinned && (isInheritedPin?.(item) ?? false);
                return (
                  <tr
                    key={`${item.site}:${item.slug}`}
                    className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        {pinned && <Badge label="Pinned" variant="info" />}
                        <span>{item.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {item.kind === "external" ? <Badge label={`External · ${item.sourceName ?? "aggregator"}`} variant="info" /> : item.site}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{age(item.publishDate)}</td>
                    <td className="px-4 py-3">
                      {isSyncing?.(item) ? (
                        <Badge label="AI summary · syncing" variant="info" />
                      ) : status ? (
                        <Badge label={summaryLabel(item, status, ai)} variant={item.summary?.pinned ? "success" : STATUS_VARIANT[status]} />
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
                            aria-label={`${pinned ? "Unpin" : "Pin"} ${item.title}`}
                            onClick={(): void => onTogglePin(item)}
                          >
                            {pinned ? "Unpin" : "Pin"}
                          </Button>
                        )}
                        {isSyncing?.(item)
                          ? null
                          : item.summary?.pinned
                          ? onBackToDefault && (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={isBusy?.(item)}
                              disabled={isBusy?.(item)}
                              aria-label={`Back to default for ${item.title}`}
                              onClick={(): void => onBackToDefault(item)}
                            >
                              Back to default
                            </Button>
                          )
                          : onUseAiSummary && (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={isBusy?.(item)}
                              disabled={isBusy?.(item)}
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
                        {onHide && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Hide ${item.title}`}
                            title="Remove this story from this site"
                            onClick={(): void => onHide(item)}
                            className="text-red-400 hover:text-red-300"
                          >
                            Hide
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
      {hidden.length > 0 && (
        <details className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)]">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {`Hidden from this site (${hidden.length})`}
          </summary>
          <ul className="divide-y divide-[var(--border-secondary)] border-t border-[var(--border-secondary)]">
            {hidden.map((h) => {
              const name = h.title ?? `${h.site}/${h.slug}`;
              return (
                <li key={`${h.site}:${h.slug}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate text-[var(--text-muted)]" title={name}>{name}</span>
                  {onUnhide && (
                    <Button variant="secondary" size="sm" aria-label={`Unhide ${name}`} onClick={(): void => onUnhide(h)}>
                      Unhide
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
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
