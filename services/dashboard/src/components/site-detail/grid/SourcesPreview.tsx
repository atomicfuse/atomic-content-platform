"use client";

import { resolveTopicSlugs } from "@/lib/grid-slugs";
import type { BundleOption, GridSourceStatus, GridTopicFields } from "@/types/grid";

interface SourcesPreviewProps {
  sources: GridSourceStatus[];
  topics: Array<GridTopicFields & { slug?: string }>;
  /** Aggregator bundles, to show pill bundles by name. */
  bundles?: BundleOption[];
}

type Reason = NonNullable<GridSourceStatus["reason"]>;

const REASON: Record<Reason, string> = {
  self: "this site",
  grid_site: "another Grid site",
  not_live: "not Live",
  dev1_account: "legacy account (unavailable)",
  excluded: "excluded in settings",
  no_matching_vertical: "no vertical matches a pill",
  missing_index: "no articles synced yet",
};

const chip = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs";
const siteChip = `${chip} border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]`;
const bundleChip = `${chip} border-cyan/40 bg-cyan/5 text-cyan`;
const missingChip = `${chip} border-dashed border-[var(--border-primary)] text-[var(--text-muted)]`;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Which sites and bundles feed which pill, and why the other sites don't. */
export function SourcesPreview({ sources, topics, bundles = [] }: SourcesPreviewProps): React.ReactElement {
  const included = sources.filter((s) => s.included);
  const excluded = sources.filter((s) => !s.included && s.reason !== "self");
  const allOnly = included.filter((s) => s.pills.length === 0);
  // resolveTopicSlugs skips label-less pills, so pair slugs with the labelled topics in order.
  const labelled = topics.filter((t) => typeof t.label === "string" && t.label.trim());
  const pills = resolveTopicSlugs(labelled).map((p, i) => ({ ...p, bundles: labelled[i]?.bundles ?? [] }));
  const bundleName = new Map(bundles.map((b) => [b.id, b.name]));

  // Group exclusions by reason, largest group first.
  const groups = new Map<string, string[]>();
  for (const s of excluded) {
    const label = capitalize(s.reason ? REASON[s.reason] : "unknown");
    groups.set(label, [...(groups.get(label) ?? []), s.siteId]);
  }
  const byReason = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="grid gap-4 text-sm lg:grid-cols-[2fr_1fr]">
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)]">
        <h4 className="px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Included, by pill
        </h4>
        {pills.length === 0 && allOnly.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-[var(--text-muted)]">No pills configured yet.</p>
        ) : (
          <div className="divide-y divide-[var(--border-secondary)]">
            {pills.map((topic) => {
              const pillSites = included.filter((s) => s.pills.includes(topic.slug));
              const pillBundles = topic.bundles;
              return (
                <div key={topic.slug} className="grid gap-1.5 px-4 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
                  <p className="font-medium text-[var(--text-primary)]">
                    {topic.label} ({pillSites.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {pillBundles.map((id) => {
                      const name = bundleName.get(id);
                      return name ? (
                        <span key={`b:${id}`} className={bundleChip} title="Aggregator bundle">{name}</span>
                      ) : (
                        <span key={`b:${id}`} className={missingChip} title="Aggregator bundle not found">{id} (missing)</span>
                      );
                    })}
                    {pillSites.map((s) => (
                      <span key={s.siteId} className={siteChip}>{s.siteId}</span>
                    ))}
                    {pillSites.length === 0 && pillBundles.length === 0 && (
                      <span className="text-xs text-[var(--text-muted)]">No sources</span>
                    )}
                  </div>
                </div>
              );
            })}
            {allOnly.length > 0 && (
              <div className="grid gap-1.5 px-4 py-2.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
                <p className="font-medium text-[var(--text-primary)]">All only ({allOnly.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {allOnly.map((s) => (
                    <span key={s.siteId} className={siteChip}>{s.siteId}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {bundles.length > 0 || pills.some((p) => p.bundles.length > 0) ? (
          <p className="flex items-center gap-3 border-t border-[var(--border-secondary)] px-4 py-2 text-[11px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan" />Aggregator bundle</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--text-muted)]" />Network site</span>
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)]">
        <h4 className="px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Not included ({excluded.length})
        </h4>
        {excluded.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-[var(--text-muted)]">All eligible sites are included.</p>
        ) : (
          <div className="divide-y divide-[var(--border-secondary)]">
            {byReason.map(([label, ids]) => (
              <details key={label} className="group px-4 py-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="text-[var(--text-muted)] transition-transform group-open:rotate-90">&rsaquo;</span>
                  <span>{`${label} · ${ids.length}`}</span>
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5 pl-4">
                  {ids.map((id) => (
                    <span key={id} className={siteChip}>{id}</span>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
