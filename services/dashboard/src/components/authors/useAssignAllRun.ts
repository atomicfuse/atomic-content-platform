"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { normalizeSiteAuthors, siteAudienceOf, siteTopicsOf } from "@/lib/authors/assignment";
import { generateSiteAuthor } from "@/lib/authors/site-author-flow";
import { getVerticals } from "@/lib/reference-data";
import type { AuthorRecord } from "@/lib/authors/types";

export interface AssignableSite {
  domain: string;
  vertical?: string;
}

export interface AssignAllProgress {
  done: number;
  skipped: number;
  failed: number;
  total: number;
  current: string;
}

/**
 * Option A in bulk: every chosen site without authors gets one new author written for it and exclusive to it.
 * One site at a time (each step is a short request); skips sites that already have authors and Grid sites.
 */
export function useAssignAllRun(): { progress: AssignAllProgress | null; start: (sites: AssignableSite[]) => void } {
  const router = useRouter();
  const { toast } = useToast();
  const [progress, setProgress] = useState<AssignAllProgress | null>(null);
  const active = useRef(false);

  async function run(sites: AssignableSite[]): Promise<void> {
    // Show the run (and disable the button) before the first request.
    setProgress({ done: 0, skipped: 0, failed: 0, total: sites.length, current: sites[0]!.domain });
    // Taken names keep every new author unique; without the library list names could repeat, so stop.
    const libRes = await fetch("/api/authors").catch(() => null);
    const library = libRes?.ok ? ((await libRes.json().catch(() => ({}))) as { authors?: AuthorRecord[] }).authors : undefined;
    if (!library) {
      setProgress(null);
      toast("Couldn't read the author library, so nothing was created. Try again.", "error");
      return;
    }
    const verticalOptions = (await getVerticals().catch(() => [])).map((v) => v.name);
    const taken = { names: library.map((a) => a.name), ids: library.map((a) => a.id) };
    let done = 0;
    let skipped = 0;
    let failed = 0;
    const removeOrphan = (id: string): Promise<unknown> => fetch(`/api/authors/${id}`, { method: "DELETE" }).catch(() => null);
    for (const s of sites) {
      setProgress({ done, skipped, failed, total: sites.length, current: s.domain });
      try {
        const cfgRes = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(s.domain)}`);
        const config = cfgRes.ok ? ((await cfgRes.json()) as { config?: Record<string, unknown> }).config : undefined;
        if (!config) { failed++; continue; }
        const theme = (config.theme ?? {}) as { template?: unknown };
        if (normalizeSiteAuthors(config.authors).length > 0 || theme.template === "grid") { skipped++; continue; }
        const brief = (config.brief ?? {}) as { vertical?: unknown; tone?: unknown };
        const draft = await generateSiteAuthor(
          {
            domain: s.domain,
            siteName: typeof config.site_name === "string" ? config.site_name : s.domain,
            vertical: typeof brief.vertical === "string" && brief.vertical ? brief.vertical : s.vertical,
            topics: siteTopicsOf(config),
            tone: typeof brief.tone === "string" ? brief.tone : undefined,
            audience: siteAudienceOf(config),
          },
          taken,
          verticalOptions,
        );
        if (!draft) { failed++; continue; }
        const created = await fetch("/api/authors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: draft }) });
        const author = ((await created.json()) as { author?: { id: string } }).author;
        if (!created.ok || !author) { failed++; continue; }
        taken.names.push(draft.name);
        taken.ids.push(author.id);
        // onlyIfNoAuthors: the save refuses if git shows authors the site list (Mongo) didn't — never replace them.
        const save = await fetch("/api/sites/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: s.domain, logoBase64: null, faviconBase64: null, configUpdates: { authors: [{ id: author.id, topics: [] }], onlyIfNoAuthors: true } }),
        });
        const out = (await save.json().catch(() => ({}))) as { status?: string; code?: string };
        if (save.ok && out.status === "ok") { done++; continue; }
        // Not used by any site: remove it so a later run doesn't leave a second one behind.
        await removeOrphan(author.id);
        if (out.code === "has-authors") skipped++; else failed++;
      } catch {
        failed++;
      } finally {
        router.refresh();
      }
    }
    setProgress(null);
    const site = (n: number): string => `${n} site${n === 1 ? "" : "s"}`;
    toast(
      `Authors created for ${site(done)}.${skipped ? ` ${skipped} skipped (already had authors or Grid).` : ""}${failed ? ` ${failed} need another try.` : ""}`,
      failed ? "info" : "success",
    );
  }

  function start(sites: AssignableSite[]): void {
    if (active.current || sites.length === 0) return;
    active.current = true;
    void run(sites).finally(() => { active.current = false; });
  }

  return { progress, start };
}
