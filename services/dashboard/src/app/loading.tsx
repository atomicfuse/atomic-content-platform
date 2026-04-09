export default function Loading(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-6">
      {/* Stats row skeleton */}
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)]"
          />
        ))}
      </div>
      {/* Table skeleton */}
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-[var(--bg-elevated)]" />
        ))}
      </div>
    </div>
  );
}
