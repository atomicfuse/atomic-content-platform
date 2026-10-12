const pulse = "rounded bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none";

/** Profile-shaped skeleton (portrait + fields beside the section cards) while an author loads. */
export default function Loading(): React.ReactElement {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading author">
      <div className={`h-4 w-24 ${pulse}`} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-4 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-5">
          <div className={`mx-auto h-40 w-40 !rounded-2xl ${pulse}`} />
          <div className={`h-9 w-full ${pulse}`} />
          <div className={`h-9 w-full ${pulse}`} />
        </div>
        <div className="space-y-4">
          {[32, 20, 24].map((h) => (
            <div key={h} className="space-y-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-5">
              <div className={`h-3 w-20 ${pulse}`} />
              <div className={`w-full ${pulse}`} style={{ height: `${h * 4}px` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
