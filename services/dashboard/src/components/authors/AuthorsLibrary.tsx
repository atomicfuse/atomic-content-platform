"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { filterAuthors, filterCounts, verticalsIn, type LibraryFilter, type LibrarySort } from "@/lib/authors/library";
import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorCard } from "./AuthorCard";

const FILTERS: Array<{ id: LibraryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "exclusive", label: "Exclusive" },
  { id: "unassigned", label: "Not on any site" },
  { id: "incomplete", label: "Incomplete profile" },
];
const SORTS: Array<{ id: LibrarySort; label: string }> = [
  { id: "updated", label: "Recently updated" },
  { id: "name", label: "Name" },
  { id: "sites", label: "Most sites" },
];

interface AuthorsLibraryProps {
  authors: AuthorListItem[];
  /** Header actions (New author, Generate missing profiles) are rendered by the page via this slot. */
  actions?: React.ReactNode;
}

export function AuthorsLibrary({ authors, actions }: AuthorsLibraryProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = (FILTERS.some((f) => f.id === params.get("filter")) ? params.get("filter") : "all") as LibraryFilter;
  const sort = (SORTS.some((s) => s.id === params.get("sort")) ? params.get("sort") : "updated") as LibrarySort;
  const vertical = params.get("v") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");

  function setParam(key: string, value: string, fallback: string): void {
    const next = new URLSearchParams(params.toString());
    if (!value || value === fallback) next.delete(key); else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const counts = useMemo(() => filterCounts(authors), [authors]);
  const shown = useMemo(() => filterAuthors(authors, q, filter, sort, vertical), [authors, q, filter, sort, vertical]);
  const verticalOptions = useMemo(() => verticalsIn(authors), [authors]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Authors</p>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Authors <span className="text-[var(--text-muted)] font-normal tabular-nums">· {authors.length}</span></h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Search authors"
          placeholder="Search authors…"
          value={q}
          onChange={(e): void => { setQ(e.target.value); setParam("q", e.target.value.trim(), ""); }}
          className="w-full sm:w-72 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
        <div role="group" aria-label="Filter authors" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={(): void => setParam("filter", f.id, "all")}
              className={`min-h-11 rounded-full border px-4 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${filter === f.id ? "border-cyan bg-cyan/10 text-cyan" : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-primary)]"}`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        {verticalOptions.length > 0 && (
          <label className="ml-auto flex items-center gap-2 text-xs text-[var(--text-muted)]">
            Best fit
            <select aria-label="Best fit" value={vertical} onChange={(e): void => setParam("v", e.target.value, "")} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50">
              <option value="">Any</option>
              {verticalOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        )}
        <label className={`${verticalOptions.length > 0 ? "" : "ml-auto "}flex items-center gap-2 text-xs text-[var(--text-muted)]`}>
          Sort
          <select
            value={sort}
            onChange={(e): void => setParam("sort", e.target.value, "updated")}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {authors.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-10 text-center">
          <p className="text-sm font-semibold text-[var(--text-primary)]">No authors yet</p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Create one with <strong>New author</strong>. AI can write the whole profile for you.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-10 text-center">
          <p className="text-sm font-semibold text-[var(--text-primary)]">{q.trim() ? `No authors match “${q.trim()}”` : "No authors in this filter"}</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={(): void => { setQ(""); router.replace(pathname, { scroll: false }); }}>
            Clear search and filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((a) => <AuthorCard key={a.id} author={a} />)}
        </div>
      )}
    </div>
  );
}
