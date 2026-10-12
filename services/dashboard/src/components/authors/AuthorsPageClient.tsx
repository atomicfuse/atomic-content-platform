"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isIncomplete } from "@/lib/authors/record";
import type { AuthorListItem } from "@/lib/authors/types";
import { AuthorsLibrary } from "./AuthorsLibrary";
import { NewAuthorModal } from "./NewAuthorModal";
import { GenerateMissingModal } from "./GenerateMissingModal";
import { useMissingProfilesRun } from "./useMissingProfilesRun";
import { AssignAllModal } from "./AssignAllModal";
import { useAssignAllRun } from "./useAssignAllRun";

interface AuthorsPageClientProps {
  authors: AuthorListItem[];
  sites: Array<{ domain: string; vertical?: string; status?: string }>;
}

export function AuthorsPageClient({ authors, sites }: AuthorsPageClientProps): React.ReactElement {
  const [newOpen, setNewOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  // Missing a bio or portrait, or Best fit: "Generate missing profiles" fills any of them.
  const incomplete = useMemo(() => authors.filter((a) => isIncomplete(a) || !(a.verticals?.length)), [authors]);
  const missingRun = useMissingProfilesRun();
  const p = missingRun.progress;
  const assignAll = useAssignAllRun();
  const [assignOpen, setAssignOpen] = useState(false);
  const assignable = useMemo(
    () => sites.filter((s) => (s.status ?? "").toLowerCase() !== "deleted").map((s) => ({ domain: s.domain, vertical: s.vertical })),
    [sites],
  );
  const a = assignAll.progress;
  return (
    <>
      <AuthorsLibrary
        authors={authors}
        actions={
          <>
            {a && (
              <p role="status" aria-live="polite" className="text-sm text-[var(--text-secondary)]">
                Creating an author for {a.current}… <span className="tabular-nums text-[var(--text-muted)]">{a.done + a.skipped + a.failed} / {a.total}</span>
              </p>
            )}
            <Button variant="secondary" disabled={!!a} onClick={(): void => setAssignOpen(true)}>Give every site an author</Button>
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
      {assignOpen && <AssignAllModal open onClose={(): void => setAssignOpen(false)} onStart={(steps): void => assignAll.start(steps)} sites={assignable} authors={authors} />}
      {missingOpen && <GenerateMissingModal open={missingOpen} onClose={(): void => setMissingOpen(false)} onStart={(): void => missingRun.start(incomplete)} authors={incomplete} />}
    </>
  );
}
