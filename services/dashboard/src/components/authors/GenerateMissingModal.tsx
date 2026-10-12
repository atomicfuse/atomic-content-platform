"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { missingParts } from "@/lib/authors/generate-flow";
import type { AuthorListItem } from "@/lib/authors/types";

interface GenerateMissingModalProps {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
  authors: AuthorListItem[];
}

/**
 * "Generate missing profiles (N)" confirmation. The run itself belongs to the Authors page (useMissingProfilesRun),
 * so it keeps going and stays visible after this dialog closes.
 */
export function GenerateMissingModal({ open, onClose, onStart, authors }: GenerateMissingModalProps): React.ReactElement {
  return (
    <Modal open={open} onClose={onClose} title={`Generate missing profiles (${authors.length})`} size="md">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">AI fills in the missing bio, tagline, beats or portrait for these authors and saves each one. It takes about 30 to 60 seconds per author; you can close this and keep working.</p>
        <ul className="max-h-48 overflow-auto rounded-lg border border-[var(--border-secondary)] divide-y divide-[var(--border-secondary)] text-sm">
          {authors.map((a) => <li key={a.id} className="flex justify-between gap-3 px-3 py-2 text-[var(--text-primary)]">{a.name} <span className="text-xs text-[var(--text-muted)]">needs {missingParts(a).join(", ")}</span></li>)}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={(): void => { onStart(); onClose(); }}>Generate {authors.length} profiles</Button>
        </div>
      </div>
    </Modal>
  );
}
