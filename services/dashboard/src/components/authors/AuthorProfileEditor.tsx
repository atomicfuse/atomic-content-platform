"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ChipMultiSelect } from "@/components/config/grid/ChipMultiSelect";
import { authorIdFromName } from "@/lib/authors/record";
import { normalizeSiteAuthors } from "@/lib/authors/assignment";
import { ALL_PARTS, generatePart, runParts, type GenerateContext, type PartStatus } from "@/lib/authors/generate-flow";
import type { AuthorInput, AuthorListItem, AuthorPart, PortraitStyle } from "@/lib/authors/types";
import { AuthorAvatar } from "./AuthorAvatar";
import { LockIcon, PlusIcon, SparkIcon } from "./icons";
import { AssignToSiteModal } from "./AssignToSiteModal";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";
import { useVerticals } from "@/hooks/useReferenceData";

interface AuthorProfileEditorProps {
  author: AuthorListItem | null;
  mode: "create" | "edit";
  sites: Array<{ domain: string; vertical?: string }>;
  takenNames: string[];
  /** Ids already in the library, so files made before the first save use the id the author will get. */
  takenIds?: string[];
  autoGenerate?: boolean;
  context?: GenerateContext;
}

const EMPTY: AuthorInput = { name: "", tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [] };
const PART_LABEL: Record<AuthorPart, string> = { name: "Name", tagline: "Tagline", bio: "Bio", beats: "Beats", verticals: "Best fit", portrait: "Portrait" };
const FIELD_PART: Record<string, string> = { name: "name", tagline: "tagline", bio: "bio", beats: "beats", verticals: "best fit", portrait: "portrait", links: "links", exclusive_sites: "exclusive sites" };

const toInput = (a: AuthorListItem | null): AuthorInput =>
  a ? { name: a.name, tagline: a.tagline, bio: a.bio, beats: a.beats, verticals: a.verticals ?? [], portrait: a.portrait, links: a.links, exclusive_sites: a.exclusive_sites } : EMPTY;

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

function SectionCard({ eyebrow, action, children }: { eyebrow: string; action?: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{eyebrow}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Free-text chips (ChipMultiSelect only picks from fixed options). */
function BeatsEditor({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }): React.ReactElement {
  const [text, setText] = useState("");
  function add(): void {
    const b = text.trim();
    if (b && !value.some((v) => v.toLowerCase() === b.toLowerCase())) onChange([...value, b]);
    setText("");
  }
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-1.5" aria-label="Beats">
        {value.map((b) => (
          <li key={b} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-elevated)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--text-primary)]">
            {b}
            <button type="button" aria-label={`Remove ${b}`} className="rounded-full px-1 text-[var(--text-muted)] hover:text-red-400" onClick={(): void => onChange(value.filter((v) => v !== b))}>×</button>
          </li>
        ))}
        {value.length === 0 && <li className="text-xs text-[var(--text-muted)]">No beats yet</li>}
      </ul>
      <div className="flex gap-2">
        <input aria-label="New beat" value={text} onChange={(e): void => setText(e.target.value)} onKeyDown={(e): void => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Add a beat" className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50" />
        <Button variant="secondary" size="sm" onClick={add} disabled={!text.trim()}>+ Add</Button>
      </div>
    </div>
  );
}

const STYLE_OPTIONS: Array<{ id: PortraitStyle; label: string }> = [
  { id: "realistic", label: "Realistic" },
  { id: "illustrated", label: "Illustrated" },
];

/** Segmented choice for the next generated portrait (Regenerate and Generate everything). */
function PortraitStylePicker({ value, onChange, disabled }: { value: PortraitStyle; onChange: (s: PortraitStyle) => void; disabled: boolean }): React.ReactElement {
  return (
    <div role="radiogroup" aria-label="Portrait style" className="mx-auto flex w-fit rounded-full border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-1">
      {STYLE_OPTIONS.map((o) => (
        <label
          key={o.id}
          className={`flex min-h-9 cursor-pointer items-center rounded-full px-4 text-xs font-medium transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan/50 ${value === o.id ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"} ${disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          <input type="radio" name="portrait-style" value={o.id} checked={value === o.id} disabled={disabled} onChange={(): void => onChange(o.id)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function RegenerateButton({ part, busy, locked, onClick }: { part: AuthorPart; busy: boolean; locked?: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={busy || locked} aria-label={`Regenerate ${part}`} loading={busy}>
      <SparkIcon />Regenerate
    </Button>
  );
}

export function AuthorProfileEditor({ author, mode, sites, takenNames, takenIds = [], autoGenerate, context }: AuthorProfileEditorProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [saved, setSaved] = useState<AuthorInput>(() => toInput(author));
  const [draft, setDraft] = useState<AuthorInput>(saved);
  useEffect(() => { setSaved(toInput(author)); }, [author]);
  const [busy, setBusy] = useState<Partial<Record<AuthorPart, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<AuthorPart, string>>>({});
  const [checklist, setChecklist] = useState<Partial<Record<AuthorPart, PartStatus>> | null>(null);
  const [running, setRunning] = useState(false);
  const [portraitStyle, setPortraitStyle] = useState<PortraitStyle>("realistic");
  const { verticals: verticalItems, loading: verticalsLoading } = useVerticals();
  const verticalOptions = verticalItems.map((v) => v.name);
  // The verticals part needs the network's category list; without it, it is left out of Generate everything.
  const genParts = ALL_PARTS.filter((p) => p !== "verticals" || verticalOptions.length > 0);
  /** A new name was generated while a generated portrait (made for the old name) is shown. */
  const [portraitBehindName, setPortraitBehindName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [removeFrom, setRemoveFrom] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [showAllMatches, setShowAllMatches] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const generatedOnce = useRef(false);

  const changed = (Object.keys(FIELD_PART) as Array<keyof AuthorInput>).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]));
  const dirty = changed.length > 0;
  const idFor = (d: Partial<AuthorInput>): string => author?.id ?? authorIdFromName(d.name || "author", takenIds);
  const others = takenNames.filter((n) => n.toLowerCase() !== (author?.name ?? "").toLowerCase());

  async function regenerate(part: AuthorPart): Promise<void> {
    setBusy((b) => ({ ...b, [part]: true }));
    setErrors((e) => ({ ...e, [part]: undefined }));
    try {
      const patch = await generatePart(part, draft, { authorId: part === "portrait" ? idFor(draft) : undefined, context, takenNames: others, portraitStyle, verticalOptions });
      setDraft((d) => ({ ...d, ...patch }));
      if (part === "name" && draft.portrait?.kind === "generated") setPortraitBehindName(true);
      if (part === "portrait") setPortraitBehindName(false);
    } catch (err) {
      setErrors((e) => ({ ...e, [part]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy((b) => ({ ...b, [part]: false }));
    }
  }

  /** Each part is applied as it lands (only that field), so edits made during the run are kept. */
  async function generateEverything(): Promise<void> {
    if (running) return;
    setRunning(true);
    setChecklist({});
    try {
      await runParts(genParts, draft, { authorIdFor: idFor, context, takenNames: others, portraitStyle, verticalOptions, onPatch: (patch) => setDraft((d) => ({ ...d, ...patch })) }, (part, status, error) => {
        setChecklist((c) => ({ ...c, [part]: status }));
        if (status === "error") setErrors((e) => ({ ...e, [part]: error }));
      });
    } finally {
      setRunning(false);
    }
  }

  // Waits for the category list, so a generated author gets Best fit too.
  useEffect(() => {
    if (autoGenerate && !verticalsLoading && !generatedOnce.current) { generatedOnce.current = true; void generateEverything(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, verticalsLoading]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(mode === "create" ? "/api/authors" : `/api/authors/${author!.id}`, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: draft }),
      });
      const out = (await res.json()) as { author?: AuthorListItem; error?: string };
      if (!res.ok || !out.author) throw new Error(out.error ?? `Save failed (${res.status})`);
      toast("Author saved", "success");
      // What the server stored (trimmed, empty links dropped) becomes the clean state, so nothing looks unsaved.
      const stored = toInput(out.author);
      setSaved(stored);
      setDraft(stored);
      if (mode === "create") router.push(`/authors/${out.author.id}`); else router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File): Promise<void> {
    setBusy((b) => ({ ...b, portrait: true }));
    setErrors((e) => ({ ...e, portrait: undefined }));
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("authorId", idFor(draft));
      const res = await fetch("/api/authors/portrait", { method: "POST", body: form });
      const out = (await res.json()) as { portrait?: AuthorInput["portrait"]; error?: string };
      if (!res.ok || !out.portrait) throw new Error(out.error ?? "Upload failed");
      setDraft((d) => ({ ...d, portrait: out.portrait! }));
      setPortraitBehindName(false);
    } catch (err) {
      setErrors((e) => ({ ...e, portrait: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy((b) => ({ ...b, portrait: false }));
    }
  }

  /** Adds this author to a site's authors (the site's saved list, read fresh) through the regular site save. */
  async function assignToSite(site: string, confirmedExclusive: boolean): Promise<void> {
    const cfgRes = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(site)}`);
    if (!cfgRes.ok) throw new Error("Couldn't read the site's settings. Try again.");
    const config = ((await cfgRes.json()) as { config?: { authors?: unknown } }).config;
    const current = normalizeSiteAuthors(config?.authors);
    const res = await fetch("/api/sites/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: site, logoBase64: null, faviconBase64: null, configUpdates: { authors: [...current, { id: author!.id, topics: [] }], confirmedExclusive: confirmedExclusive ? [author!.id] : [] } }),
    });
    const out = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
    if (!res.ok || out.status !== "ok") throw new Error(out.message ?? "Couldn't assign the author");
    toast(`${author!.name} now writes for ${site}`, "success");
    router.refresh();
  }

  /**
   * Takes this author off a site's authors (the site's saved list, read fresh) and, if they were exclusive to it,
   * drops that reservation from their saved profile. Unsaved edits on this page are left as they are.
   */
  async function removeFromSite(site: string): Promise<void> {
    setRemoving(true);
    try {
      const cfgRes = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(site)}`);
      if (!cfgRes.ok) throw new Error("Couldn't read the site's settings. Try again.");
      const config = ((await cfgRes.json()) as { config?: { authors?: unknown } }).config;
      const rest = normalizeSiteAuthors(config?.authors).filter((a) => a.id !== author!.id);
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: site, logoBase64: null, faviconBase64: null, configUpdates: { authors: rest } }),
      });
      const out = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
      if (!res.ok || out.status !== "ok") throw new Error(out.message ?? "Couldn't remove the author from the site");
      if (saved.exclusive_sites.includes(site)) {
        const nextSaved = { ...saved, exclusive_sites: saved.exclusive_sites.filter((x) => x !== site) };
        const put = await fetch(`/api/authors/${author!.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: nextSaved }) });
        if (put.ok) {
          setSaved(nextSaved);
          setDraft((d) => ({ ...d, exclusive_sites: d.exclusive_sites.filter((x) => x !== site) }));
        }
      }
      toast(`${author!.name} no longer writes for ${site}`, "success");
      setRemoveFrom(null);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove the author from the site", "error");
    } finally {
      setRemoving(false);
    }
  }

  async function remove(): Promise<void> {
    // Delete checks every site's config and removes the portrait files, so it takes a few seconds.
    setDeleting(true);
    const res = await fetch(`/api/authors/${author!.id}`, { method: "DELETE" }).catch(() => null);
    const out = (await res?.json().catch(() => ({})) ?? {}) as { error?: string };
    if (!res?.ok) { setDeleting(false); toast(out.error ?? "Delete failed", "error"); return; }
    toast(`${author!.name} deleted`, "success");
    router.push("/authors");
  }

  const bioWords = wordCount(draft.bio);
  const onSites = new Set((author?.sites ?? []).map((s) => s.site));
  const wantedVerticals = new Set(draft.verticals.map((v) => v.toLowerCase()));
  const connectedSites = (author?.sites ?? []).map((s) => s.site);
  const goodMatch = sites.filter((s) => s.vertical && wantedVerticals.has(s.vertical.toLowerCase()) && !onSites.has(s.domain));

  return (
    <div className="space-y-6 pb-24">
      <UnsavedChangesGuard when={dirty} />
      <a href="/authors" className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">← Authors</a>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Identity column */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-5">
          <div className="flex justify-center">
            {busy.portrait
              ? <div aria-label="Generating portrait" className="h-40 w-40 rounded-2xl bg-[var(--bg-elevated)] animate-pulse motion-reduce:animate-none" />
              : <AuthorAvatar name={draft.name || "New author"} portrait={draft.portrait} size="lg" preview="button" />}
          </div>
          <PortraitStylePicker value={portraitStyle} onChange={setPortraitStyle} disabled={running || !!busy.portrait} />
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={(): void => { void regenerate("portrait"); }} disabled={running || busy.portrait} aria-label="Regenerate portrait"><SparkIcon />Regenerate</Button>
            <Button variant="secondary" size="sm" onClick={(): void => fileRef.current?.click()} disabled={running || busy.portrait}>Upload</Button>
            {draft.portrait && <Button variant="ghost" size="sm" onClick={(): void => { setDraft((d) => ({ ...d, portrait: null })); setPortraitBehindName(false); }}>Remove</Button>}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e): void => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </div>
          {portraitBehindName && !busy.portrait && (
            <p className="text-center text-xs text-[var(--text-secondary)]">
              This portrait was made for the previous name.{" "}
              <button type="button" className="font-medium text-cyan underline-offset-2 hover:underline" disabled={running} onClick={(): void => { void regenerate("portrait"); }}>Make a matching portrait</button>
            </p>
          )}
          {errors.portrait && (
            <p role="alert" className="text-center text-xs text-red-400">
              {errors.portrait}{" "}
              <button type="button" className="underline" onClick={(): void => { void regenerate("portrait"); }}>Retry portrait</button>
            </p>
          )}
          <div className="space-y-1">
            <Input label="Name" value={draft.name} onChange={(e): void => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
              <span className="font-mono">{author?.id ?? (draft.name ? authorIdFromName(draft.name, []) : "id from name")}</span>
              <button type="button" className="underline disabled:opacity-50" disabled={running || busy.name} aria-label="Regenerate name" onClick={(): void => { void regenerate("name"); }}>New name</button>
            </div>
            {errors.name && <p role="alert" className="text-xs text-red-400">{errors.name}</p>}
          </div>
          {draft.exclusive_sites.length > 0 && (
            <p className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><LockIcon />Exclusive to {draft.exclusive_sites.join(", ")}</p>
          )}
          <Button variant="secondary" className="w-full min-h-11" onClick={(): void => { void generateEverything(); }} disabled={running || Object.values(busy).some(Boolean)} loading={running}>
            <SparkIcon />Generate everything
          </Button>
          {checklist && (
            <ul aria-label="Generation progress" className="space-y-1 text-xs">
              {genParts.map((p) => (
                <li key={p} className="flex justify-between text-[var(--text-secondary)]">
                  <span>{PART_LABEL[p]}</span>
                  <span className={checklist[p] === "error" ? "text-red-400" : checklist[p] === "done" ? "text-emerald-500" : "text-[var(--text-muted)]"}>
                    {checklist[p] === "done" ? "Done" : checklist[p] === "running" ? "Working…" : checklist[p] === "error" ? "Failed" : "Waiting"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Sections */}
        <div className="space-y-4">
          <SectionCard eyebrow="About" action={<RegenerateButton part="bio" busy={!!busy.bio} locked={running} onClick={(): void => { void regenerate("bio"); }} />}>
            <Textarea label="Bio" rows={6} value={draft.bio} onChange={(e): void => setDraft((d) => ({ ...d, bio: e.target.value }))} />
            <p className={`text-xs tabular-nums ${bioWords && (bioWords < 60 || bioWords > 120) ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-muted)]"}`}>{bioWords} words (60 to 120 recommended)</p>
            {errors.bio && <p role="alert" className="text-xs text-red-400">{errors.bio}</p>}
            <div className="flex items-end gap-2">
              <div className="flex-1"><Input label="Tagline" value={draft.tagline} onChange={(e): void => setDraft((d) => ({ ...d, tagline: e.target.value }))} /></div>
              <RegenerateButton part="tagline" busy={!!busy.tagline} locked={running} onClick={(): void => { void regenerate("tagline"); }} />
            </div>
            {errors.tagline && <p role="alert" className="text-xs text-red-400">{errors.tagline}</p>}
          </SectionCard>

          <SectionCard eyebrow="Beats" action={<RegenerateButton part="beats" busy={!!busy.beats} locked={running} onClick={(): void => { void regenerate("beats"); }} />}>
            <BeatsEditor value={draft.beats} onChange={(next): void => setDraft((d) => ({ ...d, beats: next }))} />
            {errors.beats && <p role="alert" className="text-xs text-red-400">{errors.beats}</p>}
          </SectionCard>

          <SectionCard eyebrow="Best fit" action={<RegenerateButton part="verticals" busy={!!busy.verticals} locked={running || verticalOptions.length === 0} onClick={(): void => { void regenerate("verticals"); }} />}>
            <ChipMultiSelect
              label="Site categories this author fits"
              addLabel="+ Category"
              value={draft.verticals}
              options={[...new Set([...verticalOptions, ...draft.verticals])].map((v) => ({ value: v, label: v }))}
              onChange={(next): void => setDraft((d) => ({ ...d, verticals: next.slice(0, 3) }))}
              emptyText="No categories yet"
            />
            {draft.verticals.length >= 3 && <p className="text-xs text-[var(--text-muted)]">Up to 3 categories. Remove one to add another.</p>}
            {errors.verticals && <p role="alert" className="text-xs text-red-400">{errors.verticals}</p>}
            {goodMatch.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs text-[var(--text-muted)]">Good match for</p>
                <ul aria-label="Good match for" className="flex flex-wrap gap-1.5">
                  {(showAllMatches ? goodMatch : goodMatch.slice(0, 8)).map((s) => (
                    <li key={s.domain}><a href={`/sites/${s.domain}`} className="inline-flex min-h-8 items-center rounded-full border border-[var(--border-primary)] px-3 text-xs text-[var(--text-primary)] hover:border-cyan/60">{s.domain}</a></li>
                  ))}
                  {goodMatch.length > 8 && (
                    <li>
                      <button type="button" onClick={(): void => setShowAllMatches((v) => !v)} className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium text-cyan hover:bg-cyan/10">
                        {showAllMatches ? "Show fewer" : `Show all ${goodMatch.length}`}
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </SectionCard>

          <SectionCard eyebrow="Links">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["website", "x", "instagram", "linkedin"] as const).map((k) => (
                <Input key={k} label={{ website: "Website", x: "X", instagram: "Instagram", linkedin: "LinkedIn" }[k]} placeholder="https://" value={draft.links[k] ?? ""} onChange={(e): void => setDraft((d) => ({ ...d, links: { ...d.links, [k]: e.target.value || undefined } }))} />
              ))}
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Writes for"
            action={mode === "edit" && author ? (
              <Button variant="secondary" size="sm" className="min-h-9" onClick={(): void => setAssignOpen(true)}><PlusIcon />Assign to a site</Button>
            ) : undefined}
          >
            {author && author.sites.length > 0 ? (
              <ul className="space-y-2">
                {author.sites.map((s) => (
                  <li key={s.site} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2.5">
                    <div className="min-w-0">
                      <a href={`/sites/${s.site}`} className="text-sm font-medium text-[var(--text-primary)] hover:text-cyan">{s.site}</a>
                      <p className="truncate text-xs text-[var(--text-muted)]">{s.topics.length > 0 ? `Covers ${s.topics.join(", ")}` : "Writes on every topic"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <a href={`/sites/${s.site}`} className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-cyan hover:bg-cyan/10">Open site</a>
                      {mode === "edit" && (
                        <Button variant="ghost" size="sm" className="min-h-9" aria-label={`Remove from ${s.site}`} onClick={(): void => setRemoveFrom(s.site)}>Remove</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                {mode === "edit" ? "Not on any site yet. Assign this author to a site, or add them from a site's Authors tab." : "Save the author first, then assign them to a site."}
              </p>
            )}
            <div className="flex items-start justify-between gap-4 border-t border-[var(--border-secondary)] pt-3">
              <div className="min-w-0">
                <p id="exclusive-label" className="text-sm font-medium text-[var(--text-primary)]">Exclusive</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {draft.exclusive_sites.length > 0
                    ? `Reserved for ${draft.exclusive_sites.join(", ")}. Other sites have to confirm before using this author.`
                    : connectedSites.length > 0 ? "Any site can add this author." : "Assign a site first to make this author exclusive to it."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.exclusive_sites.length > 0}
                aria-labelledby="exclusive-label"
                disabled={draft.exclusive_sites.length === 0 && connectedSites.length === 0}
                onClick={(): void => setDraft((d) => ({ ...d, exclusive_sites: d.exclusive_sites.length > 0 ? [] : connectedSites }))}
                className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/60 disabled:cursor-not-allowed disabled:opacity-40 ${draft.exclusive_sites.length > 0 ? "bg-cyan" : "bg-[var(--border-primary)]"}`}
              >
                <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 [transition-timing-function:cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${draft.exclusive_sites.length > 0 ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>
          </SectionCard>

          {mode === "edit" && (
            <section className="rounded-xl border border-red-500/30 p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-400">Danger zone</h2>
              <Button variant="danger" size="sm" className="mt-3" onClick={(): void => setConfirmDelete(true)}>Delete author</Button>
            </section>
          )}
        </div>
      </div>

      {dirty && (
        <div role="region" aria-label="Unsaved changes" className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-primary)] bg-[var(--bg-surface)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg-surface)]/80">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <p className="text-sm text-[var(--text-secondary)]">Unsaved changes: {changed.map((k) => FIELD_PART[k]).join(", ")}</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={(): void => { setDraft(saved); setErrors({}); setPortraitBehindName(false); }}>Discard</Button>
              <Button variant="primary" className="min-h-11" loading={saving} onClick={(): void => { void save(); }} disabled={!draft.name.trim()}>Save author</Button>
            </div>
          </div>
        </div>
      )}

      {removeFrom && author && (
        <Modal open onClose={(): void => { if (!removing) setRemoveFrom(null); }} title={`Remove ${author.name} from ${removeFrom}?`} size="sm">
          <div role="dialog" aria-label={`Remove ${author.name} from ${removeFrom}?`} className="space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">
              Articles {author.name} already wrote on {removeFrom} keep their name. New articles there go to the site&apos;s other authors, or to its default name if none are left.
              {saved.exclusive_sites.includes(removeFrom) ? ` ${author.name} also stops being exclusive to ${removeFrom}.` : ""}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={removing} onClick={(): void => setRemoveFrom(null)}>Cancel</Button>
              <Button variant="danger" loading={removing} onClick={(): void => { void removeFromSite(removeFrom); }}>Remove</Button>
            </div>
          </div>
        </Modal>
      )}

      {assignOpen && author && (
        <AssignToSiteModal
          authorName={author.name}
          exclusiveSites={author.exclusive_sites}
          currentSites={connectedSites}
          sites={sites}
          verticals={draft.verticals}
          onClose={(): void => setAssignOpen(false)}
          onAssign={assignToSite}
        />
      )}

      {confirmDelete && author && (
        <Modal open onClose={(): void => { if (!deleting) setConfirmDelete(false); }} title={`Delete ${author.name}?`} size="sm">
          {author.sites.length > 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">{author.name} writes for {author.sites.map((s) => s.site).join(", ")}. Remove them from those sites first.</p>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">The profile and its portrait are removed from the library. Articles keep the name as plain text.</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" disabled={deleting} onClick={(): void => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" disabled={author.sites.length > 0} loading={deleting} onClick={(): void => { void remove(); }}>{deleting ? "Deleting…" : "Delete"}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
