"use client";

import { useState } from "react";
import type { TopicV2, TopicV2Source, TopicV2Schedule } from "@/types/dashboard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAllCategories, useTags, useTagSearch, useBundles } from "@/hooks/useReferenceData";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
  const { categories: allCategories } = useAllCategories();
  const { tags: allTags } = useTags();
  const { bundles } = useBundles();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [source, setSource] = useState<TopicV2Source>(initial?.source ?? { type: "filter", category_ids: [], tag_ids: [] });
  const [schedule, setSchedule] = useState<TopicV2Schedule>(initial?.schedule ?? { articles_per_week: 1, preferred_days: ["Monday"] });
  const [aiRationale, setAiRationale] = useState<string | undefined>();
  const [aiLoading, setAiLoading] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const { results: tagSearchResults } = useTagSearch(tagSearch);

  function nameForCategory(id: string): string { return allCategories.find((c) => c.id === id)?.name ?? id; }
  function nameForTag(id: string): string { return allTags.find((t) => t.id === id)?.name ?? id; }

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
    onSave({ name: trimmedName, description: description.trim() || undefined, source, schedule });
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
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Brief description (optional — helps AI)</div>
          <Input value={description} onChange={(e): void => setDescription(e.target.value)} placeholder="Wine and brewery culture for travelers" />
        </div>

        {/* Filter section */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3 space-y-3">
          {source.type === "filter" ? (
            <>
              {source.category_ids.length === 0 && source.tag_ids.length === 0 && (
                <Button onClick={(): void => void proposeWithAI()} disabled={!name.trim() || aiLoading || !siteTheme.trim()}>
                  {aiLoading ? "Proposing…" : "✨ Propose filter with AI"}
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
                  <Button variant="ghost" onClick={(): void => void proposeWithAI()} disabled={aiLoading}>
                    ✨ Re-propose with AI
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

        {/* Schedule */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Schedule</div>
          <div className="flex items-end gap-4">
            <div>
              <div className="text-[10px] text-[var(--text-muted)] mb-1">Articles/week</div>
              <Input type="number" min="0" value={String(schedule.articles_per_week)} onChange={(e): void => setSchedule({ ...schedule, articles_per_week: Math.max(0, Number(e.target.value) || 0) })} style={{ width: "70px", textAlign: "center" }} />
            </div>
            <div className="flex-1">
              <div className="text-[10px] text-[var(--text-muted)] mb-1">Preferred days</div>
              <div className="flex gap-1">
                {DAYS.map((day) => (
                  <button key={day} type="button" onClick={(): void => setSchedule({ ...schedule, preferred_days: schedule.preferred_days.includes(day) ? schedule.preferred_days.filter((d) => d !== day) : [...schedule.preferred_days, day] })} className={`px-2 py-1 rounded text-[11px] font-medium border ${schedule.preferred_days.includes(day) ? "bg-cyan/20 border-cyan text-cyan" : "bg-[var(--bg-surface)] border-[var(--border-primary)] text-[var(--text-secondary)]"}`}>
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex justify-end gap-2 pt-2 border-t border-[var(--border-primary)]">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>{initial ? "Save changes" : "Add topic"}</Button>
        </footer>
      </div>
    </div>
  );
}
