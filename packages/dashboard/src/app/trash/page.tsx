import { readDashboardIndex } from "@/lib/github";
import { TrashList } from "@/components/trash/TrashList";

export const dynamic = "force-dynamic";

export default async function TrashPage(): Promise<React.ReactElement> {
  const index = await readDashboardIndex();
  const deleted = index.deleted ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Deleted Domains</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {deleted.length === 0
              ? "No deleted domains."
              : `${deleted.length} domain${deleted.length === 1 ? "" : "s"} in trash`}
          </p>
        </div>
      </div>

      {deleted.length === 0 ? (
        <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-12 text-center">
          <svg
            className="w-12 h-12 mx-auto text-[var(--text-muted)] mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
            />
          </svg>
          <p className="text-[var(--text-muted)]">
            Trash is empty. Deleted domains will appear here.
          </p>
        </div>
      ) : (
        <TrashList items={deleted} />
      )}
    </div>
  );
}
