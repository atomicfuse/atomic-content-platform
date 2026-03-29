export default function ReviewQueuePage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Review Queue</h1>
      <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-8 text-center">
        <p className="text-[var(--text-secondary)]">
          Review queue will show flagged articles across all sites.
        </p>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Coming soon — articles flagged by the quality agent will appear here.
        </p>
      </div>
    </div>
  );
}
