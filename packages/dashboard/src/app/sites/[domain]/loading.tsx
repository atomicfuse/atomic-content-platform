export default function SiteDetailLoading(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-16 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)]" />
      <div className="h-10 w-72 rounded-lg bg-[var(--bg-surface)]" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)]" />
        ))}
      </div>
    </div>
  );
}
