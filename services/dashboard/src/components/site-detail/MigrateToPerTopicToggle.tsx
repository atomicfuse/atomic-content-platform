"use client";

import Link from "next/link";

interface Props {
  domain: string;
  /** Whether the site has already been migrated. When true, renders a status
   *  indicator instead of the toggle. */
  isPerTopic: boolean;
}

export function MigrateToPerTopicToggle({ domain, isPerTopic }: Props): React.ReactElement {
  if (isPerTopic) {
    return (
      <div className="rounded-lg border border-cyan/30 bg-cyan/5 px-4 py-3 flex items-center gap-2">
        <span className="text-cyan">✓</span>
        <span className="text-sm font-semibold text-cyan">Per-topic filters active</span>
        <span className="text-xs text-[var(--text-muted)] ml-auto">Reverting requires a git revert of the migration commit.</span>
      </div>
    );
  }
  return (
    <Link
      href={`/sites/${domain}/migrate-per-topic`}
      className="block rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 hover:border-cyan/50 transition-colors"
    >
      <div className="text-sm font-semibold">Migrate to per-topic filters →</div>
      <div className="text-xs text-[var(--text-muted)] mt-1">
        Replace the site-level bundle subscriptions with per-topic filters. Each topic gets its own filter and schedule. One-way; reverting requires a git revert.
      </div>
    </Link>
  );
}
