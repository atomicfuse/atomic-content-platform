/** Skeleton cards while the library loads (> 300 ms). */
export default function Loading(): React.ReactElement {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading authors">
      <div className="h-10 w-48 rounded-lg bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-40 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4">
            <div className="flex gap-3"><div className="h-14 w-14 rounded-2xl bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" /><div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" /><div className="h-3 w-1/2 rounded bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" /></div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
