import type { DashboardStats } from "@/types/dashboard";

interface StatCardProps {
  label: string;
  value: number;
  highlight?: boolean;
}

function StatCard({ label, value, highlight }: StatCardProps): React.ReactElement {
  return (
    <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className={`text-3xl font-bold mt-1 ${
          highlight && value > 0 ? "text-cyan" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

interface StatsPanelProps {
  stats: DashboardStats;
}

export function StatsPanel({ stats }: StatsPanelProps): React.ReactElement {
  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard label="Total Sites" value={stats.totalSites} />
      <StatCard label="Articles This Week" value={stats.articlesThisWeek} highlight />
      <StatCard label="Pending Review" value={stats.pendingReview} highlight />
      <StatCard
        label="Failed Builds"
        value={stats.failedBuilds}
        highlight={stats.failedBuilds > 0}
      />
    </div>
  );
}
