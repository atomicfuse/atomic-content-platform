"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { LockIcon } from "./icons";

interface AssignToSiteModalProps {
  authorName: string;
  /** Sites this author is exclusive to (empty = not exclusive). */
  exclusiveSites: string[];
  /** Sites the author already writes for (left out of the list). */
  currentSites: string[];
  sites: Array<{ domain: string; vertical?: string }>;
  /** The author's Best fit categories: matching sites are listed first. */
  verticals: string[];
  onClose: () => void;
  /** Resolves when the site is saved; rejects with a message to show. */
  onAssign: (site: string, confirmedExclusive: boolean) => Promise<void>;
}

/** Author profile → Assign to a site: pick a site (good matches first); exclusive authors say so before assigning. */
export function AssignToSiteModal({ authorName, exclusiveSites, currentSites, sites, verticals, onClose, onAssign }: AssignToSiteModalProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wanted = useMemo(() => new Set(verticals.map((v) => v.toLowerCase())), [verticals]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sites
      .filter((s) => !currentSites.includes(s.domain) && (!q || s.domain.toLowerCase().includes(q) || (s.vertical ?? "").toLowerCase().includes(q)))
      .map((s) => ({ ...s, good: !!s.vertical && wanted.has(s.vertical.toLowerCase()) }))
      .sort((a, b) => Number(b.good) - Number(a.good) || a.domain.localeCompare(b.domain));
  }, [sites, currentSites, query, wanted]);

  const exclusiveElsewhere = !!chosen && exclusiveSites.length > 0 && !exclusiveSites.includes(chosen);
  const title = `Assign ${authorName} to a site`;

  async function assign(): Promise<void> {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await onAssign(chosen, exclusiveElsewhere);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't assign the author");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={(): void => { if (!busy) onClose(); }} title={title} size="md">
      <div role="dialog" aria-label={title} className="space-y-3">
        <input
          type="search"
          autoFocus
          aria-label="Search sites"
          placeholder="Search sites or categories"
          value={query}
          onChange={(e): void => setQuery(e.target.value)}
          className="w-full min-h-11 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
        <ul role="listbox" aria-label="Sites" className="max-h-[min(50vh,24rem)] space-y-1 overflow-y-auto">
          {list.length === 0 && <li className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">{query ? "No sites match." : "This author already writes for every site."}</li>}
          {list.map((s) => (
            <li
              key={s.domain}
              role="option"
              aria-selected={chosen === s.domain}
              tabIndex={0}
              onClick={(): void => setChosen(s.domain)}
              onKeyDown={(e): void => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChosen(s.domain); } }}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 ${chosen === s.domain ? "bg-cyan/10 text-[var(--text-primary)] ring-1 ring-cyan/40" : "text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"}`}
            >
              <span className="min-w-0 truncate">{s.domain} {s.vertical && <span className="text-xs text-[var(--text-muted)]">{s.vertical}</span>}</span>
              {s.good && <span className="shrink-0 text-xs font-medium text-cyan">Good match</span>}
            </li>
          ))}
        </ul>
        {exclusiveElsewhere && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <LockIcon />{authorName} is exclusive to {exclusiveSites.join(", ")}. Assigning them to {chosen} makes them exclusive to it too.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" className="min-h-11" disabled={!chosen} loading={busy} onClick={(): void => { void assign(); }}>Assign</Button>
        </div>
      </div>
    </Modal>
  );
}
