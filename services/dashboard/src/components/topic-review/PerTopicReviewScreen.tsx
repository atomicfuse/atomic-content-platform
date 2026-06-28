"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TopicV2, TopicV2Schedule, TopicV2Source } from "@/types/dashboard";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useAllCategories, useTags } from "@/hooks/useReferenceData";
import { resolveCategoryNames, resolveTagNames } from "@/lib/reference-data";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface PerTopicReviewItem {
  /** The user-facing topic name. */
  name: string;
  /** Optional description that's passed to the AI proposer. */
  description?: string;
  /** Filter state (loaded from AI proposal or starts empty). */
  source: TopicV2Source;
  /** Schedule state. */
  schedule: TopicV2Schedule;
  /** AI rationale text, if a proposal has been run. */
  rationale?: string;
  /** AI proposal loading state. */
  loading: boolean;
  /** AI proposal error message, if any. */
  error?: string;
}

export interface PerTopicReviewScreenProps {
  siteTheme: string;
  /** Initial topic names. The component creates one PerTopicReviewItem per name,
   *  empty filter + default schedule, and kicks off AI proposals on mount. */
  initialTopicNames: string[];
  /** Default schedule applied to each topic before AI proposes. */
  defaultSchedule: TopicV2Schedule;
  onSave: (topics: TopicV2[]) => Promise<void> | void;
  saveLabel?: string;
  onCancel?: () => void;
  /** Heading shown at the top of the screen. */
  title?: string;
  /** Optional banner text under the title (e.g. migration warning). */
  banner?: React.ReactNode;
}

export function PerTopicReviewScreen({
  siteTheme,
  initialTopicNames,
  defaultSchedule,
  onSave,
  saveLabel = "Save",
  onCancel,
  title = "Topic Filters",
  banner,
}: PerTopicReviewScreenProps): React.ReactElement {
  const { categories: allCategories } = useAllCategories();
  const { tags: allTags } = useTags();

  const [items, setItems] = useState<PerTopicReviewItem[]>(() =>
    initialTopicNames.map((name) => ({
      name,
      source: { type: "filter", category_ids: [], tag_ids: [] },
      schedule: { ...defaultSchedule },
      loading: true,
    })),
  );
  const [saving, setSaving] = useState(false);

  const proposeForIndex = useCallback(async (idx: number) => {
    const topicName = items[idx]?.name;
    const topicDescription = items[idx]?.description;
    if (!topicName) return;
    setItems((prev) => prev.map((p, i) => i === idx ? { ...p, loading: true, error: undefined } : p));
    try {
      const res = await fetch("/api/ai/propose-filter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteTheme,
          topicName,
          topicDescription,
          categories: allCategories.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id })),
          tags: allTags.map((t) => ({ id: t.id, name: t.name, usage_count: t.usage_count })),
        }),
      });
      if (!res.ok) throw new Error(`Propose-filter returned ${res.status}`);
      const data = (await res.json()) as { category_ids?: string[]; tag_ids?: string[]; rationale?: string };
      setItems((prev) => prev.map((p, i) => i === idx ? {
        ...p,
        source: { type: "filter", category_ids: data.category_ids ?? [], tag_ids: data.tag_ids ?? [] },
        rationale: data.rationale,
        loading: false,
        error: undefined,
      } : p));
    } catch (err) {
      setItems((prev) => prev.map((p, i) => i === idx ? { ...p, loading: false, error: err instanceof Error ? err.message : "Proposal failed" } : p));
    }
  }, [items, siteTheme, allCategories, allTags]);

  // Initial AI proposals — kick off once when categories + tags have loaded.
  const [didInitialPropose, setDidInitialPropose] = useState(false);
  useEffect(() => {
    if (didInitialPropose) return;
    if (allCategories.length === 0 || allTags.length === 0) return;
    if (!siteTheme.trim()) return;
    setDidInitialPropose(true);
    for (let i = 0; i < items.length; i++) {
      void proposeForIndex(i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCategories.length, allTags.length, siteTheme, didInitialPropose, items.length]);

  function updateItem(idx: number, patch: Partial<PerTopicReviewItem>): void {
    setItems((prev) => prev.map((p, i) => i === idx ? { ...p, ...patch } : p));
  }

  function toggleDay(idx: number, day: string): void {
    const item = items[idx];
    if (!item) return;
    const next = item.schedule.preferred_days.includes(day)
      ? item.schedule.preferred_days.filter((d) => d !== day)
      : [...item.schedule.preferred_days, day];
    updateItem(idx, { schedule: { ...item.schedule, preferred_days: next } });
  }

  function removeFilterId(idx: number, kind: "category_ids" | "tag_ids", id: string): void {
    const item = items[idx];
    if (!item || item.source.type !== "filter") return;
    const next = item.source[kind].filter((x) => x !== id);
    updateItem(idx, { source: { ...item.source, [kind]: next } });
  }

  // Resolve any proposed/selected ids that aren't in the loaded lists via the
  // aggregator `?ids=` endpoint (scales regardless of taxonomy size).
  const [resolvedNames, setResolvedNames] = useState<{ cat: Record<string, string>; tag: Record<string, string> }>({ cat: {}, tag: {} });
  const attemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const catIds = new Set<string>();
    const tagIds = new Set<string>();
    for (const it of items) {
      if (it.source.type !== "filter") continue;
      it.source.category_ids.forEach((id) => catIds.add(id));
      it.source.tag_ids.forEach((id) => tagIds.add(id));
    }
    const needsCat = [...catIds].filter((id) => !resolvedNames.cat[id] && !allCategories.some((c) => c.id === id) && !attemptedRef.current.has(`c:${id}`));
    const needsTag = [...tagIds].filter((id) => !resolvedNames.tag[id] && !allTags.some((t) => t.id === id) && !attemptedRef.current.has(`t:${id}`));
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
  }, [items, allCategories, allTags, resolvedNames]);

  function nameForCategory(id: string): string {
    return resolvedNames.cat[id] ?? allCategories.find((c) => c.id === id)?.name ?? id;
  }
  function nameForTag(id: string): string {
    return resolvedNames.tag[id] ?? allTags.find((t) => t.id === id)?.name ?? id;
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const topics: TopicV2[] = items.map((it) => {
        let source = it.source;
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
          source = { ...source, category_names, tag_names };
        }
        return { name: it.name, description: it.description, source, schedule: it.schedule };
      });
      await onSave(topics);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto py-6">
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        {banner && <div className="mt-3">{banner}</div>}
        <p className="text-sm text-[var(--text-muted)] mt-2">
          AI proposed a filter for each topic based on this site&apos;s theme. Review and edit before saving.
        </p>
      </header>

      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={`${idx}-${item.name}`} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-base font-semibold">{item.name}</h3>
              {item.loading && <span className="text-xs text-[var(--text-muted)]">Proposing filter…</span>}
            </div>

            {item.error && (
              <p className="text-xs text-red-400">AI proposal failed: {item.error}. <button type="button" onClick={(): void => void proposeForIndex(idx)} className="underline">Retry</button></p>
            )}

            {item.source.type === "filter" && (
              <>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Categories ({item.source.category_ids.length})</div>
                  <div className="flex flex-wrap gap-2">
                    {item.source.category_ids.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 text-violet-400 px-2 py-0.5 text-xs font-semibold">
                        {nameForCategory(id)}
                        <button type="button" onClick={(): void => removeFilterId(idx, "category_ids", id)} className="hover:text-red-400">×</button>
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Tags ({item.source.tag_ids.length})</div>
                  <div className="flex flex-wrap gap-2">
                    {item.source.tag_ids.map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold">
                        {nameForTag(id)}
                        <button type="button" onClick={(): void => removeFilterId(idx, "tag_ids", id)} className="hover:text-red-400">×</button>
                      </span>
                    ))}
                  </div>
                </div>

                {item.rationale && (
                  <div className="rounded border-l-2 border-cyan/50 pl-3 py-1 text-xs text-[var(--text-muted)] italic">
                    ✨ {item.rationale}
                  </div>
                )}

                <Button variant="ghost" onClick={(): void => void proposeForIndex(idx)}>
                  ✨ Re-propose with AI
                </Button>
              </>
            )}

            <div className="flex items-end gap-4 pt-2 border-t border-[var(--border-primary)]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Articles / week</div>
                <Input
                  type="number"
                  min="0"
                  value={String(item.schedule.articles_per_week)}
                  onChange={(e): void => updateItem(idx, {
                    schedule: { ...item.schedule, articles_per_week: Math.max(0, Number(e.target.value) || 0) },
                  })}
                  style={{ width: "70px", textAlign: "center" }}
                />
              </div>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">Preferred days</div>
                <div className="flex gap-1">
                  {DAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={(): void => toggleDay(idx, day)}
                      className={`px-2 py-1 rounded text-[11px] font-medium border ${
                        item.schedule.preferred_days.includes(day)
                          ? "bg-cyan/20 border-cyan text-cyan"
                          : "bg-[var(--bg-surface)] border-[var(--border-primary)] text-[var(--text-secondary)]"
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border-primary)]">
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button onClick={(): void => void handleSave()} disabled={saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
