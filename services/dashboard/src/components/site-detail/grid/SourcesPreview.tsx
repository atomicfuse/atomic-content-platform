"use client";

import { resolveTopicSlugs } from "@/lib/grid-slugs";
import type { GridSourceStatus, GridTopicFields } from "@/types/grid";

interface SourcesPreviewProps {
  sources: GridSourceStatus[];
  topics: Array<GridTopicFields & { slug?: string }>;
}

const REASON: Record<NonNullable<GridSourceStatus["reason"]>, string> = {
  self: "this site",
  grid_site: "another Grid site",
  not_live: "not Live",
  dev1_account: "legacy account (unavailable)",
  excluded: "excluded in settings",
  no_matching_vertical: "no vertical matches a pill",
  missing_index: "no articles synced yet",
};

/** Which sites feed which pill, and why the others don't. */
export function SourcesPreview({ sources, topics }: SourcesPreviewProps): React.ReactElement {
  const included = sources.filter((s) => s.included);
  const excluded = sources.filter((s) => !s.included && s.reason !== "self");
  const allOnly = included.filter((s) => s.pills.length === 0);
  const pills = resolveTopicSlugs(topics);

  return (
    <div className="grid gap-4 md:grid-cols-2 text-sm">
      <div className="space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Included, by pill
        </h4>
        {pills.length === 0 && allOnly.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">No pills configured yet.</p>
        )}
        {pills.map((topic) => {
          const pillSites = included.filter((s) => s.pills.includes(topic.slug));
          return (
            <div key={topic.slug}>
              <p className="font-medium text-[var(--text-primary)]">
                {topic.label} ({pillSites.length})
              </p>
              <p className="text-xs text-[var(--text-muted)]">{pillSites.map((s) => s.siteId).join(", ") || "—"}</p>
            </div>
          );
        })}
        {allOnly.length > 0 && (
          <div>
            <p className="font-medium text-[var(--text-primary)]">All only ({allOnly.length})</p>
            <p className="text-xs text-[var(--text-muted)]">{allOnly.map((s) => s.siteId).join(", ")}</p>
          </div>
        )}
      </div>
      <div className="space-y-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Not included</h4>
        {excluded.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">All eligible sites are included.</p>
        ) : (
          <ul className="space-y-1 text-xs text-[var(--text-muted)]">
            {excluded.map((s) => (
              <li key={s.siteId}>
                {s.siteId} — {s.reason ? REASON[s.reason] : "unknown"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
