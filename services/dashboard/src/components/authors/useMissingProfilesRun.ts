"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { missingParts, runParts } from "@/lib/authors/generate-flow";
import { getVerticals } from "@/lib/reference-data";
import type { AuthorListItem, AuthorRecord } from "@/lib/authors/types";

export interface MissingRunProgress {
  done: number;
  failed: number;
  total: number;
  current: string;
}

/**
 * Fills the missing parts of each author in turn and saves each one. One run at a time; each save goes onto the
 * author as it is now (re-read just before the PUT) and the library refreshes after every author.
 */
export function useMissingProfilesRun(): { progress: MissingRunProgress | null; start: (authors: AuthorListItem[]) => void } {
  const router = useRouter();
  const { toast } = useToast();
  const [progress, setProgress] = useState<MissingRunProgress | null>(null);
  const active = useRef(false);

  async function run(authors: AuthorListItem[]): Promise<void> {
    const taken = authors.map((a) => a.name);
    // The verticals part needs the network's category list; without it that part is left out.
    const verticalOptions = (await getVerticals().catch(() => [])).map((v) => v.name);
    let done = 0;
    let failed = 0;
    for (const a of authors) {
      setProgress({ done, failed, total: authors.length, current: a.name });
      let partFailed = false;
      let patch: Partial<AuthorRecord> = {};
      await runParts(missingParts(a).filter((p) => p !== "verticals" || verticalOptions.length > 0), a, { authorIdFor: () => a.id, takenNames: taken, verticalOptions, onPatch: (part) => { patch = { ...patch, ...part }; } }, (_p, s) => { if (s === "error") partFailed = true; });
      let ok = false;
      try {
        const latest = await fetch(`/api/authors/${a.id}`);
        const current = latest.ok ? ((await latest.json()) as { author?: AuthorRecord }).author : undefined;
        if (current) {
          const { id: _id, created_at: _c, updated_at: _u, sites: _s, ...input } = { ...current, ...patch } as AuthorListItem;
          const res = await fetch(`/api/authors/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: input }) });
          ok = res.ok;
        }
      } catch {
        ok = false;
      }
      if (!ok || partFailed) failed++; else done++;
      router.refresh();
    }
    setProgress(null);
    toast(failed ? `Profiles generated for ${done} authors. ${failed} need another try.` : `Profiles generated for ${done} authors`, failed ? "info" : "success");
  }

  function start(authors: AuthorListItem[]): void {
    if (active.current || authors.length === 0) return;
    active.current = true;
    void run(authors).finally(() => { active.current = false; });
  }

  return { progress, start };
}
