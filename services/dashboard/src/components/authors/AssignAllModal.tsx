"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { RESERVED_SITES, planSiteAuthors, type PlanStep } from "@/lib/authors/pairing";
import type { AuthorListItem } from "@/lib/authors/types";

interface AssignAllModalProps {
  open: boolean;
  onClose: () => void;
  onStart: (steps: PlanStep[]) => void;
  sites: Array<{ domain: string; vertical?: string }>;
  authors: AuthorListItem[];
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * "Give every site an author": pick the sites, see the plan (existing authors take a second site, the rest are
 * paired by category, about two sites per author), then start.
 */
export function AssignAllModal({ open, onClose, onStart, sites, authors }: AssignAllModalProps): React.ReactElement {
  const hasAuthor = useMemo(() => new Set(authors.flatMap((a) => a.sites.map((s) => s.site))), [authors]);
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(sites.filter((s) => !hasAuthor.has(s.domain) && !RESERVED_SITES[s.domain]).map((s) => s.domain)),
  );
  const verticalOf = useMemo(() => Object.fromEntries(sites.map((s) => [s.domain, s.vertical])), [sites]);
  const plan = useMemo(
    () => planSiteAuthors(
      sites.filter((s) => chosen.has(s.domain)),
      authors.map((a) => ({ id: a.id, name: a.name, sites: a.sites.map((s) => s.site), exclusive_sites: a.exclusive_sites })),
      verticalOf,
    ),
    [sites, chosen, authors, verticalOf],
  );
  const newCount = plan.filter((s) => s.kind === "new").length;
  const joinCount = plan.length - newCount;
  const title = "Give every site an author";

  function toggle(domain: string, on: boolean): void {
    setChosen((c) => { const n = new Set(c); if (on) n.add(domain); else n.delete(domain); return n; });
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div role="dialog" aria-label={title} className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Each author writes for about two sites in the same category. Authors who have one site take a second; the other sites are paired and get a new author written for both. New authors aren't exclusive, so you can add them to more sites later. About a minute per new author; keep this tab open.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--text-muted)]">Sites</p>
            <ul className="max-h-72 overflow-auto rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)] text-sm">
              {sites.map((s) => {
                const reservedFor = RESERVED_SITES[s.domain];
                const taken = hasAuthor.has(s.domain);
                return (
                  <li key={s.domain}>
                    <label className={`flex min-h-11 items-center gap-3 px-3 ${taken ? "cursor-default opacity-60" : "cursor-pointer"}`}>
                      <input type="checkbox" aria-label={s.domain} checked={!taken && chosen.has(s.domain)} disabled={taken} onChange={(e): void => toggle(s.domain, e.target.checked)} />
                      <span className="flex-1 text-[var(--text-primary)]">{s.domain}</span>
                      <span className="text-xs text-[var(--text-muted)]">{taken ? "Has an author" : reservedFor ? `Kept for ${reservedFor}` : s.vertical ?? ""}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--text-muted)]">Plan</p>
            {plan.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border-primary)] px-3 py-6 text-center text-sm text-[var(--text-muted)]">Nothing to do for the ticked sites.</p>
            ) : (
              <ul aria-label="Plan" className="max-h-72 space-y-1 overflow-auto text-sm">
                {plan.map((step) => (
                  <li key={step.kind === "join" ? `j-${step.site}` : `n-${step.sites.join("+")}`} className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text-primary)]">
                    {step.kind === "join" ? `${step.site} joins ${step.authorName}` : `New author for ${step.sites.join(" and ")}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="min-h-11" disabled={plan.length === 0} onClick={(): void => { onStart(plan); onClose(); }}>
            Start ({plural(newCount, "new author")}, {plural(joinCount, "join")})
          </Button>
        </div>
      </div>
    </Modal>
  );
}
