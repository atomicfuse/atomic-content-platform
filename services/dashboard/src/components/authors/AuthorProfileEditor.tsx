"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ChipMultiSelect } from "@/components/config/grid/ChipMultiSelect";
import { authorIdFromName } from "@/lib/authors/record";
import { ALL_PARTS, generatePart, runParts, type GenerateContext, type PartStatus } from "@/lib/authors/generate-flow";
import type { AuthorInput, AuthorListItem, AuthorPart } from "@/lib/authors/types";
import { AuthorAvatar } from "./AuthorAvatar";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";

interface AuthorProfileEditorProps {
  author: AuthorListItem | null;
  mode: "create" | "edit";
  sites: Array<{ domain: string }>;
  takenNames: string[];
  autoGenerate?: boolean;
  context?: GenerateContext;
}

const EMPTY: AuthorInput = { name: "", tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] };
const PART_LABEL: Record<AuthorPart, string> = { name: "Name", tagline: "Tagline", bio: "Bio", beats: "Beats", portrait: "Portrait" };
const FIELD_PART: Record<string, string> = { name: "name", tagline: "tagline", bio: "bio", beats: "beats", portrait: "portrait", links: "links", exclusive_sites: "exclusive sites" };

const toInput = (a: AuthorListItem | null): AuthorInput =>
  a ? { name: a.name, tagline: a.tagline, bio: a.bio, beats: a.beats, portrait: a.portrait, links: a.links, exclusive_sites: a.exclusive_sites } : EMPTY;

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

function SparkIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
    </svg>
  );
}

function LockIcon(): React.ReactElement {
  return (
    <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
  );
}

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

function RegenerateButton({ part, busy, locked, onClick }: { part: AuthorPart; busy: boolean; locked?: boolean; onClick: () => void }): React.ReactElement {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={busy || locked} aria-label={`Regenerate ${part}`} loading={busy}>
      <SparkIcon />Regenerate
    </Button>
  );
}

export function AuthorProfileEditor({ author, mode, sites, takenNames, autoGenerate, context }: AuthorProfileEditorProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const saved = useMemo(() => toInput(author), [author]);
  const [draft, setDraft] = useState<AuthorInput>(saved);
  const [busy, setBusy] = useState<Partial<Record<AuthorPart, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<AuthorPart, string>>>({});
  const [checklist, setChecklist] = useState<Partial<Record<AuthorPart, PartStatus>> | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const generatedOnce = useRef(false);

  const changed = (Object.keys(FIELD_PART) as Array<keyof AuthorInput>).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]));
  const dirty = changed.length > 0;
  const idFor = (d: Partial<AuthorInput>): string => author?.id ?? authorIdFromName(d.name || "author", []);
  const others = takenNames.filter((n) => n.toLowerCase() !== (author?.name ?? "").toLowerCase());

  async function regenerate(part: AuthorPart): Promise<void> {
    setBusy((b) => ({ ...b, [part]: true }));
    setErrors((e) => ({ ...e, [part]: undefined }));
    try {
      const patch = await generatePart(part, draft, { authorId: part === "portrait" ? idFor(draft) : undefined, context, takenNames: others });
      setDraft((d) => ({ ...d, ...patch }));
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
      await runParts(ALL_PARTS, draft, { authorIdFor: idFor, context, takenNames: others, onPatch: (patch) => setDraft((d) => ({ ...d, ...patch })) }, (part, status, error) => {
        setChecklist((c) => ({ ...c, [part]: status }));
        if (status === "error") setErrors((e) => ({ ...e, [part]: error }));
      });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (autoGenerate && !generatedOnce.current) { generatedOnce.current = true; void generateEverything(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(mode === "create" ? "/api/authors" : `/api/authors/${author!.id}`, {
        method: mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: draft }),
      });
      const out = (await res.json()) as { author?: { id: string }; error?: string };
      if (!res.ok || !out.author) throw new Error(out.error ?? `Save failed (${res.status})`);
      toast("Author saved", "success");
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
    } catch (err) {
      setErrors((e) => ({ ...e, portrait: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy((b) => ({ ...b, portrait: false }));
    }
  }

  async function remove(): Promise<void> {
    const res = await fetch(`/api/authors/${author!.id}`, { method: "DELETE" });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { toast(out.error ?? "Delete failed", "error"); return; }
    toast(`${author!.name} deleted`, "success");
    router.push("/authors");
  }

  const exclusiveOptions = sites.map((s) => ({ value: s.domain, label: s.domain }));
  const bioWords = wordCount(draft.bio);

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
              : <AuthorAvatar name={draft.name || "New author"} portrait={draft.portrait} size="lg" />}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={(): void => { void regenerate("portrait"); }} disabled={running || busy.portrait} aria-label="Regenerate portrait"><SparkIcon />Regenerate</Button>
            <Button variant="secondary" size="sm" onClick={(): void => fileRef.current?.click()} disabled={running || busy.portrait}>Upload</Button>
            {draft.portrait && <Button variant="ghost" size="sm" onClick={(): void => setDraft((d) => ({ ...d, portrait: null }))}>Remove</Button>}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e): void => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </div>
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
              {ALL_PARTS.map((p) => (
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

          <SectionCard eyebrow="Links">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["website", "x", "instagram", "linkedin"] as const).map((k) => (
                <Input key={k} label={{ website: "Website", x: "X", instagram: "Instagram", linkedin: "LinkedIn" }[k]} placeholder="https://" value={draft.links[k] ?? ""} onChange={(e): void => setDraft((d) => ({ ...d, links: { ...d.links, [k]: e.target.value || undefined } }))} />
              ))}
            </div>
          </SectionCard>

          <SectionCard eyebrow="Sites">
            {author && author.sites.length > 0 ? (
              <ul className="divide-y divide-[var(--border-secondary)] text-sm">
                {author.sites.map((s) => (
                  <li key={s.site} className="flex items-center justify-between py-2">
                    <span className="text-[var(--text-primary)]">{s.site} <span className="text-xs text-[var(--text-muted)]">{s.topics.join(", ")}</span></span>
                    <a className="text-xs text-cyan underline" href={`/sites/${s.site}`}>Open site</a>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--text-muted)]">Not on any site yet.</p>}
            <ChipMultiSelect
              label="Exclusive to"
              addLabel="+ Add site"
              value={draft.exclusive_sites}
              options={exclusiveOptions}
              onChange={(next): void => setDraft((d) => ({ ...d, exclusive_sites: next }))}
              emptyText="Not exclusive. Can be picked for any site."
            />
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
              <Button variant="ghost" onClick={(): void => { setDraft(saved); setErrors({}); }}>Discard</Button>
              <Button variant="primary" className="min-h-11" loading={saving} onClick={(): void => { void save(); }} disabled={!draft.name.trim()}>Save author</Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && author && (
        <Modal open onClose={(): void => setConfirmDelete(false)} title={`Delete ${author.name}?`} size="sm">
          {author.sites.length > 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">{author.name} writes for {author.sites.map((s) => s.site).join(", ")}. Remove them from those sites first.</p>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">The profile and its portrait are removed from the library. Articles keep the name as plain text.</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={(): void => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" disabled={author.sites.length > 0} onClick={(): void => { void remove(); }}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
