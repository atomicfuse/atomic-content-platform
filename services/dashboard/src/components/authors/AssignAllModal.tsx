"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { AssignableSite } from "./useAssignAllRun";

interface AssignAllModalProps {
  open: boolean;
  onClose: () => void;
  onStart: (sites: AssignableSite[]) => void;
  sites: AssignableSite[];
}

/** Confirmation for "Give every site an author": pick the sites (all ticked; untick test sites). */
export function AssignAllModal({ open, onClose, onStart, sites }: AssignAllModalProps): React.ReactElement {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(sites.map((s) => s.domain)));
  const picked = sites.filter((s) => chosen.has(s.domain));
  return (
    <Modal open={open} onClose={onClose} title="Give every site an author" size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">Each ticked site without authors gets one new author written for it, with a bio, Best fit and a realistic portrait, exclusive to that site. Sites that already have authors, and Grid sites, are skipped. About a minute per site; you can close this and keep working in this tab.</p>
        <ul className="max-h-64 overflow-auto rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)] text-sm">
          {sites.map((s) => (
            <li key={s.domain}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                <input type="checkbox" aria-label={s.domain} checked={chosen.has(s.domain)} onChange={(e): void => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(s.domain); else n.delete(s.domain); return n; })} />
                <span className="flex-1 text-[var(--text-primary)]">{s.domain}</span>
                {s.vertical && <span className="text-xs text-[var(--text-muted)]">{s.vertical}</span>}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={picked.length === 0} onClick={(): void => { onStart(picked); onClose(); }}>Start ({picked.length} site{picked.length === 1 ? "" : "s"})</Button>
        </div>
      </div>
    </Modal>
  );
}
