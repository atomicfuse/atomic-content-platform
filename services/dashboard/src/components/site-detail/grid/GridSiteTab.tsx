"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { BundleOption, GridFields, GridHiddenStoryFields, GridPinFields, GridPoolItem, GridPoolResponse } from "@/types/grid";
import { summarySlugOf } from "@/lib/grid-summary-file";
import { SourcesPreview } from "./SourcesPreview";
import { StoriesTable } from "./StoriesTable";

const GridSettingsSection = dynamic(
  () => import("@/components/config/grid/GridSettingsSection").then((m) => m.GridSettingsSection),
  { ssr: false },
);
const SummaryEditor = dynamic(
  () => import("./SummaryEditor").then((m) => m.SummaryEditor),
  { ssr: false },
);

interface GridSiteTabProps {
  domain: string;
}

/** Grid tab: feed settings, source preview, and the live Stories list (pin / edit / regenerate). */
export function GridSiteTab({ domain }: GridSiteTabProps): React.ReactElement {
  const [grid, setGrid] = useState<GridFields>({});
  const [savedGrid, setSavedGrid] = useState<string>("{}");
  const [pool, setPool] = useState<GridPoolResponse | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<GridPoolItem | null>(null);
  // Site-level pins as loaded from the site config. Kept alongside the saved pins so an item unpinned
  // this session (pool still says pinned until the site re-syncs) is not mistaken for a group pin.
  const [loadedPins, setLoadedPins] = useState<GridPinFields[]>([]);
  // Per-story summary requests: in flight, and done but not yet synced to the site (the pool still shows the old text).
  const [busyStories, setBusyStories] = useState<ReadonlySet<string>>(new Set());
  const [syncingStories, setSyncingStories] = useState<ReadonlySet<string>>(new Set());
  const [bundles, setBundles] = useState<BundleOption[]>([]);
  const { toast } = useToast();

  // Bundle names for the Sources panel; optional, ids are shown if this fails.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/bundles")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((data: { items?: Array<{ id: string; name: string; content_count?: number }> }) => {
        if (!cancelled) setBundles((data.items ?? []).map((b) => ({ id: b.id, name: b.name, count: b.content_count ?? 0 })));
      })
      .catch((err: unknown) => console.error("[grid] failed to load bundles", err));
    return (): void => {
      cancelled = true;
    };
  }, []);

  const loadPool = useCallback(async (): Promise<void> => {
    setPoolLoading(true);
    setPoolError(null);
    try {
      const res = await fetch(`/api/grid/pool?domain=${encodeURIComponent(domain)}`);
      if (res.ok) {
        setPool((await res.json()) as GridPoolResponse);
      } else {
        setPoolError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not load stories");
      }
    } finally {
      setPoolLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    void (async (): Promise<void> => {
      const res = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`);
      if (res.ok) {
        const data = (await res.json()) as { config?: { grid?: GridFields } };
        const g = data.config?.grid ?? {};
        setGrid(g);
        setSavedGrid(JSON.stringify(g));
        setLoadedPins(g.pinned ?? []);
      }
      await loadPool();
    })();
  }, [domain, loadPool]);

  async function save(next: GridFields): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, logoBase64: null, faviconBase64: null, configUpdates: { grid: next } }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
      if (!res.ok || body.status === "error") throw new Error(body.message ?? `Save failed (${res.status})`);
      setSavedGrid(JSON.stringify(next));
      setMessage("Saved. The site updates after it re-syncs (about a minute).");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Saves list changes (pins, hidden stories) on top of the last SAVED grid, never the live (possibly
   * unsaved) form state — otherwise a click would silently commit half-edited Feed settings. The live
   * form gets the same change optimistically and is reverted if the save fails.
   */
  async function saveListChange(patch: Pick<GridFields, "pinned" | "hidden_stories">, success: string, failure: string): Promise<void> {
    const saved = JSON.parse(savedGrid) as GridFields;
    const before: Pick<GridFields, "pinned" | "hidden_stories"> = { pinned: saved.pinned, hidden_stories: saved.hidden_stories };
    const next: GridFields = { ...saved, ...patch };
    setGrid((prev) => ({ ...prev, ...patch }));
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, logoBase64: null, faviconBase64: null, configUpdates: { grid: next } }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
      if (!res.ok || body.status === "error") throw new Error(body.message ?? `Save failed (${res.status})`);
      setSavedGrid(JSON.stringify(next));
      toast(success, "success");
    } catch (err) {
      setGrid((prev) => ({ ...prev, ...before }));
      toast(`${failure}: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  }

  async function togglePin(item: GridPoolItem): Promise<void> {
    const savedPins = (JSON.parse(savedGrid) as GridFields).pinned ?? [];
    const exists = savedPins.some((p) => p.site === item.site && p.slug === item.slug);
    const pinned = exists
      ? savedPins.filter((p) => !(p.site === item.site && p.slug === item.slug))
      : [...savedPins, { site: item.site, slug: item.slug, until: null }];
    await saveListChange(
      { pinned },
      exists
        ? `Unpinned "${item.title}". The site updates in about a minute.`
        : `Pinned "${item.title}" to the top of the feed. The site updates in about a minute.`,
      `Couldn't update the pin for "${item.title}"`,
    );
  }

  /** "Hide": removes the story from this site (feed + story page). Hiding also drops its pin. */
  async function hideStory(item: GridPoolItem): Promise<void> {
    const saved = JSON.parse(savedGrid) as GridFields;
    const hidden = saved.hidden_stories ?? [];
    if (hidden.some((h) => sameStory(h, item))) return;
    await saveListChange(
      {
        hidden_stories: [...hidden, { site: item.site, slug: item.slug, title: item.title }],
        pinned: (saved.pinned ?? []).filter((p) => !sameStory(p, item)),
      },
      `"${item.title}" is hidden from this site. It disappears from the site in about a minute.`,
      `Couldn't hide "${item.title}"`,
    );
  }

  async function unhideStory(entry: GridHiddenStoryFields): Promise<void> {
    const hidden = (JSON.parse(savedGrid) as GridFields).hidden_stories ?? [];
    const name = entry.title ?? entry.slug;
    await saveListChange(
      { hidden_stories: hidden.filter((h) => !(h.site === entry.site && h.slug === entry.slug)) },
      `"${name}" is back on this site in about a minute.`,
      `Couldn't unhide "${name}"`,
    );
  }

  const dirty = JSON.stringify(grid) !== savedGrid;

  /** "Use AI summary" (generate + pin) or "Back to default" (unpin) for one story. */
  async function setStorySummary(item: GridPoolItem, use: boolean): Promise<void> {
    if (use && item.summary?.status === "edited" && !window.confirm("Replace the hand-edited summary with a new AI summary?")) return;
    const key = storyKey(item);
    setBusyStories((prev) => new Set(prev).add(key));
    try {
      const res = use
        ? await fetch("/api/grid/regenerate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site: item.site, slug: summarySlugOf(item), pin: true }),
        })
        : await fetch("/api/grid/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site: item.site, slug: summarySlugOf(item), pinned: false }),
        });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast(`Couldn't update "${item.title}": ${out.error ?? `request failed (${res.status})`}`, "error");
        return;
      }
      setSyncingStories((prev) => {
        const next = new Set(prev);
        if (use) next.add(key);
        else next.delete(key);
        return next;
      });
      toast(
        use
          ? `AI summary created for "${item.title}". It reaches the story page in a minute or two.`
          : `"${item.title}" goes back to the default text in a minute or two.`,
        "success",
      );
      await loadPool();
    } catch (err) {
      toast(`Couldn't update "${item.title}": ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setBusyStories((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  /** Saved site pins win over the pool, which only catches up after the site re-syncs; group pins come from the pool. */
  function isPinned(item: GridPoolItem): boolean {
    const sitePins = (JSON.parse(savedGrid) as GridFields).pinned ?? [];
    if (sitePins.some((p) => p.site === item.site && p.slug === item.slug)) return true;
    return item.pinned && isInheritedPin(item);
  }

  /** Pinned in the pool but not by this site's own `grid.pinned` → pinned by a group or override. */
  function isInheritedPin(item: GridPoolItem): boolean {
    const sitePins = [...loadedPins, ...((JSON.parse(savedGrid) as GridFields).pinned ?? [])];
    return !sitePins.some((p) => p.site === item.site && p.slug === item.slug);
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Feed settings</h3>
        <GridSettingsSection value={grid} onChange={setGrid} />
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-secondary)]">
          {dirty ? (
            <p className="text-xs text-amber-500 flex-1">You have unsaved changes — click Save Grid settings to apply.</p>
          ) : (
            <span className="flex-1" />
          )}
          <Button onClick={(): void => void save(grid)} loading={saving} disabled={!dirty || saving}>
            Save Grid settings
          </Button>
        </div>
        {message && <p className="text-xs text-[var(--text-secondary)]">{message}</p>}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Sources</h3>
          <button
            type="button"
            className="text-xs text-cyan hover:underline"
            onClick={(): void => void loadPool()}
          >
            Refresh
          </button>
        </div>
        {poolLoading && !pool ? (
          <p className="text-sm text-[var(--text-muted)]">Loading sources…</p>
        ) : poolError ? (
          <p className="text-sm text-amber-500">{poolError}</p>
        ) : (
          pool && <SourcesPreview sources={pool.sources} topics={grid.topics ?? []} bundles={bundles} />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Stories{pool ? ` (${pool.items.length})` : ""}</h3>
        {poolLoading && !pool ? (
          <p className="text-sm text-[var(--text-muted)]">Loading stories…</p>
        ) : poolError ? (
          <p className="text-sm text-amber-500">{poolError}</p>
        ) : (
          pool && (
            <StoriesTable
              pool={pool}
              onTogglePin={(item): void => void togglePin(item)}
              onEdit={setEditing}
              isInheritedPin={isInheritedPin}
              onUseAiSummary={(item): void => void setStorySummary(item, true)}
              onBackToDefault={(item): void => void setStorySummary(item, false)}
              isBusy={(item): boolean => busyStories.has(storyKey(item))}
              isPinned={isPinned}
              onHide={(item): void => void hideStory(item)}
              onUnhide={(entry): void => void unhideStory(entry)}
              hidden={(JSON.parse(savedGrid) as GridFields).hidden_stories ?? []}
              isHidden={(item): boolean => ((JSON.parse(savedGrid) as GridFields).hidden_stories ?? []).some((h) => sameStory(h, item))}
              isSyncing={(item): boolean => syncingStories.has(storyKey(item)) && !item.summary?.pinned}
            />
          )
        )}
      </section>

      {editing && (
        <SummaryEditor
          site={editing.site}
          slug={summarySlugOf(editing)}
          title={editing.title}
          status={editing.summary?.status ?? "none"}
          onClose={(): void => setEditing(null)}
          onSaved={(): void => void loadPool()}
        />
      )}
    </div>
  );
}

function storyKey(item: GridPoolItem): string {
  return `${item.site}/${item.slug}`;
}

/** Same story? Aggregator stories compare by item id (the slug's 24-hex tail), so a title change doesn't matter. */
function sameStory(a: { site: string; slug: string }, b: { site: string; slug: string }): boolean {
  if (a.site !== b.site) return false;
  if (a.site !== "aggregator") return a.slug === b.slug;
  const id = (slug: string): string | undefined => /([0-9a-f]{24})$/.exec(slug)?.[1];
  return (id(a.slug) ?? a.slug) === (id(b.slug) ?? b.slug);
}
