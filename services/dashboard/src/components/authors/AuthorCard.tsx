import Link from "next/link";
import { isIncomplete } from "@/lib/authors/record";
import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorAvatar } from "./AuthorAvatar";

const LockIcon = (): React.ReactElement => (
  <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
);

/** One library card — the whole card is a single link to the profile. */
export function AuthorCard({ author }: { author: AuthorListItem }): React.ReactElement {
  const shownBeats = author.beats.slice(0, 2);
  const extra = author.beats.length - shownBeats.length;
  return (
    <Link
      href={`/authors/${author.id}`}
      className="group relative hover:z-10 focus-within:z-10 flex flex-col gap-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4 transition-[transform,box-shadow] duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-px hover:shadow-[0_6px_20px_-12px_rgb(6_182_212/0.35)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60"
    >
      <div className="flex items-start gap-3">
        <AuthorAvatar name={author.name} portrait={author.portrait} preview="hover" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{author.name}</h3>
            {author.exclusive_sites.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <LockIcon />Exclusive
              </span>
            )}
          </div>
          <p className="truncate text-xs text-[var(--text-secondary)]">{author.tagline || "No tagline yet"}</p>
          {(author.verticals?.length ?? 0) > 0 && <p data-verticals className="truncate text-[11px] font-medium text-cyan">{author.verticals.join(" · ")}</p>}
        </div>
      </div>
      {shownBeats.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Beats">
          {shownBeats.map((b) => <li key={b} className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">{b}</li>)}
          {extra > 0 && <li className="rounded-full px-1 py-0.5 text-[11px] text-[var(--text-muted)]">+{extra}</li>}
        </ul>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-secondary)] pt-3 text-xs text-[var(--text-muted)]">
        <span className="truncate">
          {author.sites.length === 0 ? "Not on any site" : `${author.sites.length} site${author.sites.length === 1 ? "" : "s"} · ${author.sites.map((s) => s.site).join(", ")}`}
        </span>
        {isIncomplete(author) && (
          <span className="inline-flex shrink-0 items-center gap-1 text-amber-600 dark:text-amber-400">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />Incomplete profile
          </span>
        )}
      </div>
    </Link>
  );
}
