"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isIncomplete } from "@/lib/authors/record";
import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorsLibrary } from "./AuthorsLibrary";
import { NewAuthorModal } from "./NewAuthorModal";
import { GenerateMissingModal } from "./GenerateMissingModal";
import { useMissingProfilesRun } from "./useMissingProfilesRun";

export function AuthorsPageClient({ authors, sites }: { authors: AuthorListItem[]; sites: Array<{ domain: string }> }): React.ReactElement {
  const [newOpen, setNewOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const incomplete = useMemo(() => authors.filter(isIncomplete), [authors]);
  const missingRun = useMissingProfilesRun();
  const p = missingRun.progress;
  return (
    <>
      <AuthorsLibrary
        authors={authors}
        actions={
          <>
            {p && (
              <p role="status" aria-live="polite" className="text-sm text-[var(--text-secondary)]">
                Generating {p.current}… <span className="tabular-nums text-[var(--text-muted)]">{p.done + p.failed} / {p.total}</span>
              </p>
            )}
            {(incomplete.length > 0 || p) && (
              <Button variant="secondary" disabled={!!p} onClick={(): void => setMissingOpen(true)}>Generate missing profiles ({incomplete.length})</Button>
            )}
            <Button variant="primary" className="min-h-11" onClick={(): void => setNewOpen(true)}>+ New author</Button>
          </>
        }
      />
      {newOpen && <NewAuthorModal open={newOpen} onClose={(): void => setNewOpen(false)} sites={sites} />}
      {missingOpen && <GenerateMissingModal open={missingOpen} onClose={(): void => setMissingOpen(false)} onStart={(): void => missingRun.start(incomplete)} authors={incomplete} />}
    </>
  );
}
