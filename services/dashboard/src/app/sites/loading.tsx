export default function SitesLoading(): React.ReactElement {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-32 rounded-lg bg-[var(--bg-surface)] animate-pulse" />
      </div>
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] animate-pulse">
        {/* Filter bar skeleton */}
        <div className="p-4 border-b border-[var(--border-secondary)] flex gap-3">
          <div className="h-9 w-48 rounded-lg bg-[var(--bg-elevated)]" />
          <div className="h-9 w-32 rounded-lg bg-[var(--bg-elevated)]" />
          <div className="h-9 w-32 rounded-lg bg-[var(--bg-elevated)]" />
        </div>
        {/* Table rows skeleton */}
        <div className="p-4 space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-[var(--bg-elevated)]" />
          ))}
        </div>
      </div>
    </div>
  );
}
