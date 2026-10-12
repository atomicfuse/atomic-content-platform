"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { normalizeSiteAuthors, siteAudienceOf, siteTopicsOf } from "@/lib/authors/assignment";
import { generateSiteAuthor } from "@/lib/authors/site-author-flow";
import { getVerticals } from "@/lib/reference-data";
import type { PlanStep } from "@/lib/authors/pairing";
import type { AuthorRecord } from "@/lib/authors/types";

export interface AssignAllProgress {
  done: number;
  skipped: number;
  failed: number;
  total: number;
  current: string;
}

type SiteState = { kind: "ok"; config: Record<string, unknown> } | { kind: "skip" } | { kind: "fail" };

async function readSite(domain: string): Promise<SiteState> {
  const res = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`).catch(() => null);
  const config = res?.ok ? ((await res.json().catch(() => ({}))) as { config?: Record<string, unknown> }).config : undefined;
  if (!config) return { kind: "fail" };
  const theme = (config.theme ?? {}) as { template?: unknown };
  return normalizeSiteAuthors(config.authors).length > 0 || theme.template === "grid" ? { kind: "skip" } : { kind: "ok", config };
}

/** Saves one author onto a site that must still have none (the server re-checks against git). */
async function saveAuthorTo(domain: string, authorId: string, confirmExclusive: boolean): Promise<"ok" | "skip" | "fail"> {
  const res = await fetch("/api/sites/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      domain, logoBase64: null, faviconBase64: null,
      configUpdates: { authors: [{ id: authorId, topics: [] }], onlyIfNoAuthors: true, ...(confirmExclusive ? { confirmedExclusive: [authorId] } : {}) },
    }),
  }).catch(() => null);
  const out = (await res?.json().catch(() => ({})) ?? {}) as { status?: string; code?: string };
  if (res?.ok && out.status === "ok") return "ok";
  return out.code === "has-authors" ? "skip" : "fail";
}

/**
 * Carries out the "Give every site an author" plan, one step at a time (each request is short): an existing author
 * joins a site, or one new author (not exclusive) is written for a pair of sites in the same category and saved to both. Every site
 * is re-checked first; a new author no site took is removed again.
 */
export function useAssignAllRun(): { progress: AssignAllProgress | null; start: (steps: PlanStep[]) => void } {
  const router = useRouter();
  const { toast } = useToast();
  const [progress, setProgress] = useState<AssignAllProgress | null>(null);
  const active = useRef(false);

  async function run(steps: PlanStep[]): Promise<void> {
    const total = steps.reduce((n, s) => n + (s.kind === "join" ? 1 : s.sites.length), 0);
    const first = steps[0]!;
    setProgress({ done: 0, skipped: 0, failed: 0, total, current: first.kind === "join" ? first.site : first.sites.join(" and ") });
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
    let created = 0;
    const tally = (r: "ok" | "skip" | "fail"): void => { if (r === "ok") done++; else if (r === "skip") skipped++; else failed++; };

    for (const step of steps) {
      setProgress({ done, skipped, failed, total, current: step.kind === "join" ? step.site : step.sites.join(" and ") });
      try {
        if (step.kind === "join") {
          const state = await readSite(step.site);
          if (state.kind !== "ok") { tally(state.kind === "skip" ? "skip" : "fail"); continue; }
          tally(await saveAuthorTo(step.site, step.authorId, true));
          continue;
        }
        const states = await Promise.all(step.sites.map(async (d) => ({ domain: d, state: await readSite(d) })));
        const usable = states.filter((x): x is { domain: string; state: { kind: "ok"; config: Record<string, unknown> } } => x.state.kind === "ok");
        for (const x of states) if (x.state.kind !== "ok") tally(x.state.kind === "skip" ? "skip" : "fail");
        if (usable.length === 0) continue;
        const configs = usable.map((x) => x.state.config);
        const brief = (configs[0]!.brief ?? {}) as { vertical?: unknown; tone?: unknown };
        const draft = await generateSiteAuthor(
          {
            domain: usable[0]!.domain,
            siteName: configs.map((c, i) => (typeof c.site_name === "string" ? c.site_name : usable[i]!.domain)).join(" and "),
            vertical: typeof brief.vertical === "string" && brief.vertical ? brief.vertical : undefined,
            topics: [...new Set(configs.flatMap((c) => siteTopicsOf(c)))],
            tone: typeof brief.tone === "string" ? brief.tone : undefined,
            audience: [...new Set(configs.map((c) => siteAudienceOf(c)).filter((a): a is string => !!a))].join(", ") || undefined,
          },
          taken,
          verticalOptions,
        );
        if (!draft) { usable.forEach(() => tally("fail")); continue; }
        const res = await fetch("/api/authors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: draft }),
        }).catch(() => null);
        const author = res?.ok ? ((await res.json().catch(() => ({}))) as { author?: { id: string } }).author : undefined;
        if (!author) { usable.forEach(() => tally("fail")); continue; }
        taken.names.push(draft.name);
        taken.ids.push(author.id);
        let placed = 0;
        for (const x of usable) {
          const r = await saveAuthorTo(x.domain, author.id, false);
          tally(r);
          if (r === "ok") placed++;
        }
        // Not used by any site: remove it so a later run doesn't leave a second one behind.
        if (placed === 0) await fetch(`/api/authors/${author.id}`, { method: "DELETE" }).catch(() => null);
        else created++;
      } catch {
        failed++;
      } finally {
        router.refresh();
      }
    }
    setProgress(null);
    const site = (n: number): string => `${n} site${n === 1 ? "" : "s"}`;
    toast(
      `Authors set for ${site(done)}${created ? ` (${created} new author${created === 1 ? "" : "s"})` : ""}.${skipped ? ` ${skipped} skipped (already had authors or Grid).` : ""}${failed ? ` ${failed} need another try.` : ""}`,
      failed ? "info" : "success",
    );
  }

  function start(steps: PlanStep[]): void {
    if (active.current || steps.length === 0) return;
    active.current = true;
    void run(steps).finally(() => { active.current = false; });
  }

  return { progress, start };
}
