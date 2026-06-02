export default function SettingsLoading(): React.ReactElement {
  return (
    <div className="max-w-6xl animate-pulse space-y-6">
      {/* Tab bar skeleton */}
      <div className="flex gap-1 border-b border-[var(--border-secondary)]">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 w-24 rounded-t-lg bg-[var(--bg-surface)]" />
        ))}
      </div>
      {/* Form fields skeleton */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-32 rounded bg-[var(--bg-surface)]" />
            <div className="h-10 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
