"use client";

import { useEffect, useRef, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TopicV2 } from "@/types/dashboard";
import { Button } from "@/components/ui/Button";
import { TopicEditModal } from "./TopicEditModal";
import { useAllCategories, useTags } from "@/hooks/useReferenceData";

interface Props {
  domain: string;
  topics: TopicV2[];
  siteTheme: string;
  onChange: (next: TopicV2[]) => void;
  /** Names of topics that exist on the saved site config. Generate is
   *  disabled for topics that have been added/renamed locally but not
   *  yet saved — the agent would otherwise return "topic not found". */
  savedTopicNames: Set<string>;
}

export function TopicsListPanel({
  domain,
  topics,
  siteTheme,
  onChange,
  savedTopicNames,
}: Props): React.ReactElement {
  const { categories: allCategories } = useAllCategories();
  const { tags: allTags } = useTags();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  // Bulk AI re-proposal progress. `null` when idle.
  const [regenAll, setRegenAll] = useState<{ done: number; total: number } | null>(null);

  // Topics that can be AI-regenerated: filter-source only (bundle topics carry
  // their filter on the aggregator, not here).
  const filterTopicCount = topics.filter((t) => t.source.type === "filter").length;
  const canRegenerateAll = filterTopicCount > 0 && !!siteTheme.trim() && regenAll === null;

  /** Re-propose a filter for every filter-source topic from the site theme.
   *  Overwrites each topic's categories + tags with the AI suggestion. Updates
   *  local state only — the user still clicks "Save changes" to persist. */
  async function handleRegenerateAll(): Promise<void> {
    const targets = topics.filter((t) => t.source.type === "filter");
    if (targets.length === 0) return;
    if (
      !confirm(
        `Re-propose filters for ${targets.length} topic${targets.length > 1 ? "s" : ""} from the site theme?\n\n` +
          `This overwrites the current categories and tags on each. You can still review before saving.`,
      )
    ) {
      return;
    }
    setRegenAll({ done: 0, total: targets.length });
    const next = [...topics];
    const categoriesPayload = allCategories.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id }));
    const tagsPayload = allTags.map((t) => ({ id: t.id, name: t.name, usage_count: t.usage_count }));
    let done = 0;
    for (let i = 0; i < next.length; i++) {
      const t = next[i]!;
      if (t.source.type !== "filter") continue;
      try {
        const res = await fetch("/api/ai/propose-filter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteTheme,
            topicName: t.name,
            topicDescription: t.description,
            categories: categoriesPayload,
            tags: tagsPayload,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { category_ids?: string[]; tag_ids?: string[] };
          next[i] = {
            ...t,
            source: { type: "filter", category_ids: data.category_ids ?? [], tag_ids: data.tag_ids ?? [] },
          };
          onChange([...next]); // reflect each topic as it completes
        }
      } catch {
        // Skip this topic on error; continue with the rest.
      }
      done += 1;
      setRegenAll({ done, total: targets.length });
    }
    setRegenAll(null);
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = topics.findIndex((t) => t.name === active.id);
    const newIdx = topics.findIndex((t) => t.name === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(topics, oldIdx, newIdx));
  }

  function summarize(t: TopicV2): { cats: number; tags: number; firstFew: string } {
    if (t.source.type === "bundle") {
      return { cats: 0, tags: 0, firstFew: `Bundle: ${t.source.bundle_id}` };
    }
    const catNames = t.source.category_ids
      .slice(0, 3)
      .map((id) => allCategories.find((c) => c.id === id)?.name ?? id)
      .join(", ");
    return { cats: t.source.category_ids.length, tags: t.source.tag_ids.length, firstFew: catNames };
  }

  function isEmptyFilter(t: TopicV2): boolean {
    return t.source.type === "filter" && t.source.category_ids.length === 0 && t.source.tag_ids.length === 0;
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm uppercase tracking-wider font-semibold text-[var(--text-secondary)]">
          Topics ({topics.length})
        </h3>
        <div className="flex items-center gap-2">
          {filterTopicCount > 0 && (
            <button
              type="button"
              onClick={(): void => void handleRegenerateAll()}
              disabled={!canRegenerateAll}
              title={
                !siteTheme.trim()
                  ? "Set a site theme first — the AI proposes filters from it"
                  : `Re-propose filters for all ${filterTopicCount} filter topic${filterTopicCount > 1 ? "s" : ""} from the site theme`
              }
              className="text-xs px-2 py-1 rounded border border-cyan/40 text-cyan hover:bg-cyan/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {regenAll
                ? `Regenerating… ${regenAll.done}/${regenAll.total}`
                : "✨ Regenerate all"}
            </button>
          )}
          <Button variant="ghost" onClick={(): void => setAddingNew(true)}>+ Add Topic</Button>
        </div>
      </div>
      {regenAll && (
        <p className="text-[11px] text-[var(--text-muted)] mb-2">
          Re-proposing filters from the site theme — review the results, then click “Save changes”.
        </p>
      )}

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={topics.map((t) => t.name)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2">
            {topics.map((t, idx) => (
              <SortableTopicRow
                key={t.name}
                domain={domain}
                topic={t}
                summary={summarize(t)}
                isEmpty={isEmptyFilter(t)}
                canGenerate={savedTopicNames.has(t.name) && !isEmptyFilter(t)}
                onEdit={(): void => setEditingIdx(idx)}
                onRemove={(): void => {
                  if (confirm(`Remove topic "${t.name}"?`)) {
                    onChange(topics.filter((_, i) => i !== idx));
                  }
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {topics.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">
          No topics yet — add one to get started.
        </p>
      )}

      {addingNew && (
        <TopicEditModal
          siteTheme={siteTheme}
          existingNames={topics.map((t) => t.name)}
          onClose={(): void => setAddingNew(false)}
          onSave={(topic): void => {
            onChange([...topics, topic]);
            setAddingNew(false);
          }}
        />
      )}
      {editingIdx !== null && topics[editingIdx] && (
        <TopicEditModal
          initial={topics[editingIdx]}
          siteTheme={siteTheme}
          existingNames={topics.map((t) => t.name)}
          onClose={(): void => setEditingIdx(null)}
          onSave={(topic): void => {
            onChange(topics.map((t, i) => (i === editingIdx ? topic : t)));
            setEditingIdx(null);
          }}
        />
      )}
    </div>
  );
}

function SortableTopicRow({
  domain,
  topic,
  summary,
  isEmpty,
  canGenerate,
  onEdit,
  onRemove,
}: {
  domain: string;
  topic: TopicV2;
  summary: { cats: number; tags: number; firstFew: string };
  isEmpty: boolean;
  canGenerate: boolean;
  onEdit: () => void;
  onRemove: () => void;
}): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: topic.name });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const [generating, setGenerating] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [genStatus, setGenStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; created: number; skipped: number; skippedReason?: string }
    | { kind: "accepted" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect((): (() => void) => {
    return (): void => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  async function handleGenerate(): Promise<void> {
    setGenerating(true);
    setGenStatus({ kind: "idle" });
    setElapsedSec(0);
    const startedAt = Date.now();
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval((): void => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    try {
      const res = await fetch("/api/agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteDomain: domain, topicName: topic.name, count: 1 }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (res.status === 202) {
        setGenStatus({ kind: "accepted" });
        return;
      }
      if (!res.ok) {
        const msg = typeof data.message === "string" ? data.message : `HTTP ${res.status}`;
        setGenStatus({ kind: "error", message: msg });
        return;
      }
      const results = Array.isArray(data.results)
        ? (data.results as Array<{ status?: string; reason?: string; message?: string }>)
        : [];
      const created = results.filter((r) => r.status === "created").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const errored = results.filter((r) => r.status === "error");
      // If anything errored and nothing was created, surface the first error.
      if (created === 0 && errored.length > 0) {
        const first = errored[0];
        setGenStatus({
          kind: "error",
          message: first?.message ?? first?.reason ?? "Generation failed",
        });
        return;
      }
      const skippedReason = results.find((r) => r.status === "skipped")?.reason;
      setGenStatus({ kind: "success", created, skipped, skippedReason });
    } catch (err) {
      setGenStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Request failed",
      });
    } finally {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      setGenerating(false);
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-3 rounded-lg border ${
        isEmpty
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-[var(--border-primary)] bg-[var(--bg-elevated)]"
      } px-3 py-2`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-[var(--text-muted)] cursor-grab pt-1"
        title="Drag to reorder"
      >
        ⠿
      </button>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">
          {topic.name}
          {isEmpty && (
            <span className="ml-2 text-[10px] text-amber-400 font-normal">
              &#9888; filter not set
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-1">
          {topic.source.type === "bundle" ? (
            <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded text-[10px]">
              {summary.firstFew}
            </span>
          ) : !isEmpty ? (
            <>
              <span className="bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded text-[10px] mr-1">
                {summary.cats} cats
              </span>
              <span className="bg-cyan/10 text-cyan px-1.5 py-0.5 rounded text-[10px]">
                {summary.tags} tags
              </span>
              <span className="ml-2">
                {topic.schedule.articles_per_week}/week &middot;{" "}
                {topic.schedule.preferred_days.map((d) => d.slice(0, 3)).join(", ")}
              </span>
            </>
          ) : (
            <span>Topic has no filter — no articles will be fetched.</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={(): void => void handleGenerate()}
            disabled={!canGenerate || generating}
            className="text-xs px-2 py-1 rounded border border-cyan/40 text-cyan hover:bg-cyan/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              !canGenerate
                ? isEmpty
                  ? "Set a filter before generating"
                  : "Save the site first to generate for this topic"
                : "Generate 1 article for this topic now"
            }
          >
            {generating ? `Generating… ${elapsedSec}s` : "Generate"}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="text-xs px-2 py-1 rounded border border-[var(--border-primary)] hover:border-cyan transition-colors"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="text-[var(--text-muted)] hover:text-red-400 transition-colors px-1"
            title="Remove topic"
          >
            &times;
          </button>
        </div>
        {generating && (
          <span className="text-[10px] text-[var(--text-muted)] max-w-[18rem] text-right">
            {elapsedSec < 8
              ? "Fetching candidates from the aggregator…"
              : elapsedSec < 25
                ? "Writing article with Claude…"
                : elapsedSec < 55
                  ? "Scoring and committing to staging…"
                  : "Still working — large prompts can take a minute+"}
          </span>
        )}
        {!generating && genStatus.kind === "success" && (
          genStatus.created > 0 ? (
            <span className="text-[10px] text-emerald-400">
              Created {genStatus.created} article{genStatus.created > 1 ? "s" : ""} in {elapsedSec}s
            </span>
          ) : (
            <span
              className="text-[10px] text-amber-400 max-w-[20rem] text-right"
              title={genStatus.skippedReason ?? undefined}
            >
              No article created — {genStatus.skippedReason ?? "no new items from aggregator"}
            </span>
          )
        )}
        {!generating && genStatus.kind === "accepted" && (
          <span className="text-[10px] text-cyan">
            Queued — still running in background. Refresh the Content tab in a minute.
          </span>
        )}
        {!generating && genStatus.kind === "error" && (
          <span className="text-[10px] text-red-400 max-w-[18rem] text-right" title={genStatus.message}>
            {genStatus.message}
          </span>
        )}
      </div>
    </li>
  );
}
