"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ChipMultiSelect } from "@/components/config/grid/ChipMultiSelect";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import { LockIcon, PlusIcon, SparkIcon, UsersIcon } from "@/components/authors/icons";
import { rankForSite, type RankedAuthor } from "@/lib/authors/assignment";
import { generateSiteAuthor } from "@/lib/authors/site-author-flow";
import { getVerticals } from "@/lib/reference-data";
import type { AuthorInput, AuthorListItem, AuthorPart, AuthorRecord, SiteAuthor } from "@/lib/authors/types";

interface SiteAuthorsSectionProps {
  domain: string;
  siteName: string;
  vertical?: string;
  topics: string[];
  tone?: string;
  /** Who reads the site: new authors are written for them. */
  audience?: string;
  initial: SiteAuthor[];
  /** site.yaml `author:` — what new articles are credited to while the site has no authors. */
  legacyAuthor?: string;
}

/** A row: a library author, or a new author that is created when the site is saved. */
interface Row extends SiteAuthor {
  pending?: AuthorInput;
}

const NEW_PREFIX = "new-";
const PART_WORD: Record<AuthorPart, string> = { name: "name", tagline: "tagline", bio: "bio", beats: "beats", verticals: "best fit", portrait: "portrait" };
const EASE = "[transition-timing-function:cubic-bezier(0.32,0.72,0,1)]";

function fitLabel(r: RankedAuthor, vertical?: string): string {
  if (r.fit === "strong") return `Good fit${vertical ? ` for ${vertical}` : ""}`;
  return r.fit === "close" ? "Close fit" : "";
}

/**
 * Site → Content Agent → Authors. Who writes for the site and which topics each covers. Changes are staged and
 * saved together from the bar at the bottom, like the author editor.
 */
export function SiteAuthorsSection({ domain, siteName, vertical, topics, tone, audience, initial, legacyAuthor }: SiteAuthorsSectionProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [library, setLibrary] = useState<AuthorListItem[] | null>(null);
  const [rows, setRows] = useState<Row[]>(initial);
  const [saved, setSaved] = useState<SiteAuthor[]>(initial);
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmFor, setConfirmFor] = useState<AuthorRecord | null>(null);
  const [creating, setCreating] = useState<AuthorPart | "start" | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadLibrary(): Promise<AuthorListItem[]> {
    const list = await fetch("/api/authors")
      .then((r) => r.json() as Promise<{ authors?: AuthorListItem[] }>)
      .then((d) => d.authors ?? [])
      .catch(() => [] as AuthorListItem[]);
    setLibrary(list);
    return list;
  }

  useEffect(() => { void loadLibrary(); }, []);

  const byId = useMemo(() => new Map((library ?? []).map((a) => [a.id, a])), [library]);
  const ranked = useMemo(
    () => rankForSite(library ?? [], { site: domain, vertical, topics }, rows.map((r) => r.id))
      .filter((r) => !query.trim() || `${r.author.name} ${r.author.tagline} ${r.author.beats.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())),
    [library, rows, query, domain, vertical, topics],
  );
  const nameOf = (r: Row): string => r.pending?.name ?? byId.get(r.id)?.name ?? r.id;
  // Who writes a topic: the authors who chose it plus the generalists (authors with no topics share every topic).
  const generalists = rows.filter((r) => r.topics.length === 0);
  const coversOf = (topic: string): Row[] => [...rows.filter((r) => r.topics.some((x) => x.toLowerCase() === topic.toLowerCase())), ...generalists];
  const unassigned = topics.filter((t) => coversOf(t).length === 0);
  const siteTopicSet = new Set(topics.map((t) => t.toLowerCase()));
  // The site's topics can change after the split (new, renamed, removed): saving re-splits them, so allow it.
  const topicsOutOfDate = rows.length > 0 && topics.length > 0
    && (unassigned.length > 0 || rows.some((r) => r.topics.some((t) => !siteTopicSet.has(t.toLowerCase()))));
  const dirty = JSON.stringify(rows.map(({ id, topics: t }) => ({ id, topics: t }))) !== JSON.stringify(saved) || rows.some((r) => r.pending) || topicsOutOfDate;

  function add(a: AuthorRecord, confirmedExclusive = false): void {
    setRows((r) => (r.some((x) => x.id === a.id) ? r : [...r, { id: a.id, topics: [] }]));
    if (confirmedExclusive) setConfirmed((c) => (c.includes(a.id) ? c : [...c, a.id]));
    setPickerOpen(false);
    setQuery("");
  }

  function choose(r: RankedAuthor): void {
    if (r.exclusiveElsewhere) setConfirmFor(r.author);
    else add(r.author);
  }

  async function createForSite(): Promise<void> {
    setCreating("start");
    const verticalOptions = (await getVerticals().catch(() => [])).map((v) => v.name);
    const draft = await generateSiteAuthor(
      { domain, siteName, vertical, topics, tone, audience },
      { names: [...(library ?? []).map((a) => a.name), ...rows.flatMap((r) => (r.pending ? [r.pending.name] : []))], ids: (library ?? []).map((a) => a.id) },
      verticalOptions,
      (part) => setCreating(part),
    );
    setCreating(null);
    if (draft) setRows((r) => [...r, { id: `${NEW_PREFIX}${Date.now()}`, topics: [], pending: draft }]);
    else toast("Couldn't create an author. Try again.", "error");
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const final: SiteAuthor[] = [];
      for (const r of rows) {
        if (!r.pending) { final.push({ id: r.id, topics: r.topics }); continue; }
        const res = await fetch("/api/authors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: r.pending }) });
        const out = (await res.json()) as { author?: AuthorRecord; error?: string };
        if (!res.ok || !out.author) throw new Error(out.error ?? "Couldn't create the new author");
        const created = out.author;
        // Now a library author: a retry after a failed site save reuses it instead of creating another.
        setRows((rs) => rs.map((x) => (x.id === r.id ? { id: created.id, topics: x.topics } : x)));
        setLibrary((l) => [...(l ?? []), { ...created, sites: [] }]);
        final.push({ id: created.id, topics: r.topics });
      }
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, logoBase64: null, faviconBase64: null, configUpdates: { authors: final, confirmedExclusive: confirmed } }),
      });
      const out = (await res.json()) as { status: string; message?: string; authors?: SiteAuthor[]; exclusive?: Array<{ id: string }> };
      if (res.status === 409 && out.exclusive?.length) {
        // Someone made an author exclusive elsewhere since this page loaded: ask, like adding them would.
        const fresh = await loadLibrary();
        const who = fresh.find((a) => a.id === out.exclusive![0]!.id);
        if (who) { setConfirmFor(who); return; }
      }
      if (!res.ok || out.status !== "ok") throw new Error(out.message ?? "Couldn't save the authors");
      const stored = out.authors ?? final;
      setRows(stored);
      setSaved(stored);
      setConfirmed([]);
      toast("Authors saved", "success");
      void loadLibrary();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save the authors", "error");
    } finally {
      setSaving(false);
    }
  }

  function discard(): void {
    setRows(saved);
    setConfirmed([]);
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" className="min-h-11" disabled={!library || !!creating} onClick={(): void => setPickerOpen(true)}>
        <PlusIcon />Add from library
      </Button>
      <Button variant="secondary" className="min-h-11" disabled={!library || !!creating} loading={!!creating} onClick={(): void => { void createForSite(); }}>
        {!creating && <SparkIcon />}Create author
      </Button>
    </div>
  );

  return (
    <section aria-labelledby="site-authors-heading" className="space-y-6 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[60ch] space-y-1">
          <h3 id="site-authors-heading" className="text-base font-semibold text-[var(--text-primary)]">Who writes for {siteName || domain}</h3>
          <p className="text-sm text-[var(--text-secondary)]">New articles go to the authors who cover their topic, taking turns. An author with no topics writes on every topic.</p>
        </div>
        {(rows.length > 0 || creating) && actions}
      </header>

      {topics.length > 0 && rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-[var(--text-muted)]">Topic coverage</p>
          <ul aria-label="Topic coverage" className="flex flex-wrap gap-2">
            {topics.map((t) => {
              const covers = coversOf(t);
              return (
                <li key={t} className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 text-xs ${covers.length > 0 ? "border-[var(--border-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)]" : "border-dashed border-[var(--border-primary)] text-[var(--text-muted)]"}`}>
                  {t}
                  <span className="text-[var(--text-muted)]">{covers.length > 0 ? covers.map(nameOf).join(", ") : "Split on save"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {rows.length === 0 && !creating && (
        <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-surface)] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-lg bg-cyan/10 p-2 text-cyan"><UsersIcon /></span>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">No authors yet</p>
              <p className="text-sm text-[var(--text-secondary)]">
                {legacyAuthor ? `New articles are credited to ${legacyAuthor} until you add authors.` : "New articles are credited to the editorial team until you add authors."}
              </p>
            </div>
          </div>
          {actions}
        </div>
      )}

      {(rows.length > 0 || creating) && (
        <ul className="space-y-3" aria-label="Site authors">
          {rows.map((r) => {
            const a = byId.get(r.id);
            const name = nameOf(r);
            const exclusiveHere = !!a && a.exclusive_sites.includes(domain);
            return (
              <li key={r.id} className={`grid grid-cols-1 gap-4 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4 transition-shadow duration-200 ${EASE} hover:shadow-[0_6px_20px_-14px_rgb(6_182_212/0.4)] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] md:items-center`}>
                <div className="flex min-w-0 items-center gap-3">
                  <AuthorAvatar name={name} portrait={r.pending?.portrait ?? a?.portrait ?? null} preview="button" />
                  <div className="min-w-0">
                    {a ? (
                      <Link href={`/authors/${a.id}`} className="block truncate text-sm font-semibold text-[var(--text-primary)] hover:text-cyan">{name}</Link>
                    ) : (
                      <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{name}</p>
                    )}
                    <p className="truncate text-xs text-[var(--text-muted)]">{r.pending ? "New, added to the library when you save" : a?.tagline || (a ? "" : "Not in the library")}</p>
                    {exclusiveHere && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400"><LockIcon />Exclusive to this site</p>
                    )}
                  </div>
                </div>
                <ChipMultiSelect
                  label={`Topics for ${name}`}
                  addLabel="+ Topic"
                  value={r.topics}
                  options={topics.map((t) => ({ value: t, label: t }))}
                  onChange={(next): void => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, topics: next } : x)))}
                  emptyText="Every topic"
                />
                <Button variant="ghost" size="sm" className="justify-self-start md:justify-self-end" aria-label={`Remove ${name}`} onClick={(): void => { setRows((rs) => rs.filter((x) => x.id !== r.id)); setConfirmed((c) => c.filter((id) => id !== r.id)); }}>
                  Remove
                </Button>
              </li>
            );
          })}
          {creating && (
            <li role="status" aria-label="Creating an author" className="flex items-center gap-3 rounded-xl border border-dashed border-cyan/40 bg-cyan/5 p-4">
              <span aria-hidden="true" className="h-14 w-14 shrink-0 rounded-2xl bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">Writing a new author for {siteName || domain}</p>
                <p className="text-xs text-[var(--text-secondary)]">{creating === "start" ? "Starting" : `Working on the ${PART_WORD[creating]}`}. About a minute in all.</p>
              </div>
            </li>
          )}
        </ul>
      )}

      {dirty && (
        <div role="region" aria-label="Unsaved changes" className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-primary)] bg-[var(--bg-surface)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-surface)]/80">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-secondary)]">
              Unsaved changes to authors{topicsOutOfDate && unassigned.length > 0 ? `. ${unassigned.length} topic${unassigned.length === 1 ? "" : "s"} will be split among them.` : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={discard} disabled={saving}>Discard</Button>
              <Button variant="primary" className="min-h-11" disabled={!!creating} loading={saving} onClick={(): void => { void save(); }}>Save authors</Button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <Modal open onClose={(): void => { setPickerOpen(false); setQuery(""); }} title="Add an author" size="md">
          <div className="space-y-3">
            <input
              type="search"
              autoFocus
              aria-label="Search library authors"
              placeholder="Search by name, tagline or beat"
              value={query}
              onChange={(e): void => setQuery(e.target.value)}
              className="w-full min-h-11 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
            />
            <ul role="listbox" aria-label="Library authors" className="max-h-[min(60vh,28rem)] space-y-1 overflow-y-auto">
              {ranked.length === 0 && <li className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">{query ? "No authors match." : "Everyone in the library already writes for this site."}</li>}
              {ranked.map((r) => (
                <li
                  key={r.author.id}
                  role="option"
                  aria-selected="false"
                  tabIndex={0}
                  onClick={(): void => choose(r)}
                  onKeyDown={(e): void => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(r); } }}
                  className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150 ${EASE} hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60`}
                >
                  <AuthorAvatar name={r.author.name} portrait={r.author.portrait} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{r.author.name}</span>
                    <span className="block truncate text-xs text-[var(--text-muted)]">{r.author.tagline || r.author.beats.join(", ")}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {fitLabel(r, vertical) && <span className="text-xs font-medium text-cyan">{fitLabel(r, vertical)}</span>}
                    {r.exclusiveElsewhere && <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"><LockIcon />Exclusive to {r.author.exclusive_sites.join(", ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Modal>
      )}

      {confirmFor && (
        <Modal open onClose={(): void => setConfirmFor(null)} title="Assign an exclusive author?" size="sm">
          <div role="dialog" aria-label="Assign an exclusive author?">
            <div className="flex items-center gap-3">
              <AuthorAvatar name={confirmFor.name} portrait={confirmFor.portrait} size="sm" />
              <p className="text-sm text-[var(--text-secondary)]">{confirmFor.name} is exclusive to {confirmFor.exclusive_sites.join(", ")}. Assigning them here makes them exclusive to this site too.</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={(): void => setConfirmFor(null)}>Cancel</Button>
              <Button variant="primary" onClick={(): void => { add(confirmFor, true); setConfirmFor(null); }}>Assign</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

