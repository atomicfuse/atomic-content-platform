"use client";

import { useState, useEffect, useRef } from "react";
import type { TopicV2, TopicV2Source } from "@/types/dashboard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAllCategories, useTags, useTagSearch, useBundles } from "@/hooks/useReferenceData";
import { resolveCategoryNames, resolveTagNames } from "@/lib/reference-data";

interface Props {
  /** When provided, edit mode. When undefined, add-new mode. */
  initial?: TopicV2;
  /** Site theme — passed to AI for proposals. */
  siteTheme: string;
  /** List of existing topic names on the site, for uniqueness validation. */
  existingNames: string[];
  onClose: () => void;
  onSave: (topic: TopicV2) => void;
}

export function TopicEditModal({ initial, siteTheme, existingNames, onClose, onSave }: Props): React.ReactElement {
  const { categories: allCategories, loading: categoriesLoading } = useAllCategories();
  const { tags: allTags, loading: tagsLoading } = useTags();
  const { bundles } = useBundles();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [source, setSource] = useState<TopicV2Source>(initial?.source ?? { type: "filter", category_ids: [], tag_ids: [] });
  const [aiRationale, setAiRationale] = useState<string | undefined>();
  const [aiLoading, setAiLoading] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const { results: tagSearchResults } = useTagSearch(tagSearch);

  // Denormalized id→name resolution. Precedence: persisted names on the topic
  // source → names resolved via the aggregator `?ids=` endpoint → the in-memory
  // taxonomy lists → the raw id (last resort). This means a topic's selected
  // categories/tags display as names without depending on fetching the full
  // (unbounded) tag taxonomy.
  const initialNames =
    initial?.source.type === "filter"
      ? { cat: initial.source.category_names ?? {}, tag: initial.source.tag_names ?? {} }
      : { cat: {}, tag: {} };
  const [resolvedNames, setResolvedNames] = useState<{ cat: Record<string, string>; tag: Record<string, string> }>(initialNames);
  // Ids we've already attempted to resolve via `?ids=` — prevents refetch loops
  // for ids that the aggregator can't resolve (e.g. a deleted tag).
  const attemptedRef = useRef<Set<string>>(new Set());

  function nameForCategory(id: string): string {
    return resolvedNames.cat[id] ?? allCategories.find((c) => c.id === id)?.name ?? id;
  }
  function nameForTag(id: string): string {
    return resolvedNames.tag[id] ?? allTags.find((t) => t.id === id)?.name ?? id;
  }

  // Resolve any selected ids that still lack a name (not persisted, not in the
  // loaded lists) via `?ids=`. Each id is attempted at most once.
  useEffect(() => {
    if (source.type !== "filter") return;
    const needsCat = source.category_ids.filter(
      (id) => !resolvedNames.cat[id] && !allCategories.some((c) => c.id === id) && !attemptedRef.current.has(`c:${id}`),
    );
    const needsTag = source.tag_ids.filter(
      (id) => !resolvedNames.tag[id] && !allTags.some((t) => t.id === id) && !attemptedRef.current.has(`t:${id}`),
    );
    if (needsCat.length === 0 && needsTag.length === 0) return;
    needsCat.forEach((id) => attemptedRef.current.add(`c:${id}`));
    needsTag.forEach((id) => attemptedRef.current.add(`t:${id}`));
    let cancelled = false;
    void Promise.all([
      needsCat.length ? resolveCategoryNames(needsCat) : Promise.resolve({}),
      needsTag.length ? resolveTagNames(needsTag) : Promise.resolve({}),
    ]).then(([cat, tag]) => {
      if (cancelled) return;
      if (Object.keys(cat).length || Object.keys(tag).length) {
        setResolvedNames((prev) => ({ cat: { ...prev.cat, ...cat }, tag: { ...prev.tag, ...tag } }));
      }
    });
    return (): void => {
      cancelled = true;
    };
  }, [source, allCategories, allTags, resolvedNames]);

  // Taxonomy must be loaded before the AI proposal — otherwise the model is
  // handed an empty category list and silently proposes tags-only.
  const taxonomyLoading = categoriesLoading || tagsLoading;
  const taxonomyFailed = !taxonomyLoading && allCategories.length === 0;
  const canPropose = !taxonomyLoading && !taxonomyFailed && allCategories.length > 0;

  async function proposeWithAI(): Promise<void> {
    if (!name.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/propose-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteTheme,
          topicName: name,
          topicDescription: description,
          categories: allCategories.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id })),
          tags: allTags.map((t) => ({ id: t.id, name: t.name, usage_count: t.usage_count })),
        }),
      });
      if (!res.ok) throw new Error(`Propose returned ${res.status}`);
      const data = (await res.json()) as { category_ids?: string[]; tag_ids?: string[]; rationale?: string };
      setSource({ type: "filter", category_ids: data.category_ids ?? [], tag_ids: data.tag_ids ?? [] });
      setAiRationale(data.rationale);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  }

  function handleSave(): void {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const lowerName = trimmedName.toLowerCase();
    const conflict = existingNames.some((n) => n.toLowerCase() === lowerName && n !== initial?.name);
    if (conflict) {
      alert(`A topic named "${trimmedName}" already exists on this site.`);
      return;
    }
    // Persist resolved names so the topic self-heals — display never falls back
    // to raw ids again, even if the taxonomy changes or grows.
    let finalSource = source;
    if (source.type === "filter") {
      const category_names: Record<string, string> = {};
      for (const id of source.category_ids) {
        const n = nameForCategory(id);
        if (n && n !== id) category_names[id] = n;
      }
      const tag_names: Record<string, string> = {};
      for (const id of source.tag_ids) {
        const n = nameForTag(id);
        if (n && n !== id) tag_names[id] = n;
      }
      finalSource = { ...source, category_names, tag_names };
    }
    onSave({ name: trimmedName, description: description.trim() || undefined, source: finalSource });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={(e): void => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{initial ? "Edit topic" : "Add topic"}</h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl">×</button>
        </header>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Topic name *</div>
          <Input value={name} onChange={(e): void => setName(e.target.value)} placeholder="e.g. Wine & Beer" />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            This is the label shown in the site&apos;s navigation menu.
          </p>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Brief description (optional — helps AI)</div>
          <Input value={description} onChange={(e): void => setDescription(e.target.value)} placeholder="Wine and brewery culture for travelers" />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Internal only — used to guide AI filter proposals. Not shown anywhere on the live site.
          </p>
        </div>

        {/* Filter section */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3 space-y-3">
          {source.type === "filter" ? (
            <>
              {taxonomyFailed && (
                <div className="rounded border-l-2 border-red-500/60 bg-red-500/10 pl-3 py-2 text-xs text-red-300">
                  Couldn&apos;t load the content taxonomy. AI proposals are disabled until it loads — close and reopen, or check the connection.
                </div>
              )}
              {source.category_ids.length === 0 && source.tag_ids.length === 0 && (
                <Button onClick={(): void => void proposeWithAI()} disabled={!name.trim() || aiLoading || !siteTheme.trim() || !canPropose}>
                  {aiLoading ? "Proposing…" : taxonomyLoading ? "Loading taxonomy…" : "✨ Propose filter with AI"}
                </Button>
              )}
              {(source.category_ids.length > 0 || source.tag_ids.length > 0) && (
                <>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Categories ({source.category_ids.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {source.category_ids.map((id) => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 text-violet-400 px-2 py-0.5 text-xs font-semibold">
                          {nameForCategory(id)}
                          <button type="button" onClick={(): void => setSource({ ...source, category_ids: source.category_ids.filter((x) => x !== id) })} className="hover:text-red-400">×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Tags ({source.tag_ids.length})</div>
                    <div className="flex flex-wrap gap-2">
                      {source.tag_ids.map((id) => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold">
                          {nameForTag(id)}
                          <button type="button" onClick={(): void => setSource({ ...source, tag_ids: source.tag_ids.filter((x) => x !== id) })} className="hover:text-red-400">×</button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 relative">
                      <Input placeholder="Search and add a tag…" value={tagSearch} onChange={(e): void => setTagSearch(e.target.value)} />
                      {tagSearch.trim() && tagSearchResults.length > 0 && (
                        <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
                          {tagSearchResults.filter((t) => !source.tag_ids.includes(t.id)).slice(0, 10).map((t) => (
                            <button key={t.id} type="button" onClick={(): void => { setSource({ ...source, tag_ids: [...source.tag_ids, t.id] }); setTagSearch(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)]">
                              {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {aiRationale && (
                    <div className="rounded border-l-2 border-cyan/50 pl-3 py-1 text-xs text-[var(--text-muted)] italic">✨ {aiRationale}</div>
                  )}
                  <Button variant="ghost" onClick={(): void => void proposeWithAI()} disabled={aiLoading || !canPropose} title={!canPropose ? "Waiting for the taxonomy to load…" : undefined}>
                    {taxonomyLoading ? "Loading taxonomy…" : "✨ Re-propose with AI"}
                  </Button>
                </>
              )}
              <button type="button" className="text-xs text-cyan hover:underline" onClick={(): void => setSource({ type: "bundle", bundle_id: "" })}>
                Use a shared bundle instead →
              </button>
            </>
          ) : (
            <>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Linked bundle</div>
              <select
                value={source.bundle_id}
                onChange={(e): void => setSource({ type: "bundle", bundle_id: e.target.value })}
                className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
              >
                <option value="">— pick a bundle —</option>
                {bundles.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.content_count ?? "?"} articles)</option>)}
              </select>
              <button type="button" className="text-xs text-cyan hover:underline" onClick={(): void => setSource({ type: "filter", category_ids: [], tag_ids: [] })}>
                ← Back to AI-proposed filter
              </button>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 pt-2 border-t border-[var(--border-primary)]">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>{initial ? "Save changes" : "Add topic"}</Button>
        </footer>
      </div>
    </div>
  );
}
