"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { GridFields, GridPinFields, GridPoolItem, GridPoolResponse } from "@/types/grid";
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
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<GridPoolItem | null>(null);
  // Site-level pins as loaded from the site config. Kept alongside the saved pins so an item unpinned
  // this session (pool still says pinned until the site re-syncs) is not mistaken for a group pin.
  const [loadedPins, setLoadedPins] = useState<GridPinFields[]>([]);

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

  async function togglePin(item: GridPoolItem): Promise<void> {
    // Base the pin change on the last SAVED grid, never the live (possibly unsaved) form state —
    // otherwise clicking Pin would silently commit half-edited Feed settings.
    const saved = JSON.parse(savedGrid) as GridFields;
    const savedPins = saved.pinned ?? [];
    const exists = savedPins.some((p) => p.site === item.site && p.slug === item.slug);
    const nextPins = exists
      ? savedPins.filter((p) => !(p.site === item.site && p.slug === item.slug))
      : [...savedPins, { site: item.site, slug: item.slug, until: null }];
    const next: GridFields = { ...saved, pinned: nextPins };

    // Optimistic UI: only the `pinned` field changes in the live form, any unsaved edits to
    // other fields are preserved untouched.
    setGrid((prev) => ({ ...prev, pinned: nextPins }));
    setPinMessage(null);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, logoBase64: null, faviconBase64: null, configUpdates: { grid: next } }),
      });
      const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
      if (!res.ok || body.status === "error") throw new Error(body.message ?? `Save failed (${res.status})`);
      setSavedGrid(JSON.stringify(next));
      setGrid((prev) => ({ ...prev, pinned: nextPins }));
    } catch (err) {
      // The pin was never persisted — revert the optimistic UI change back to the last saved value.
      setGrid((prev) => ({ ...prev, pinned: savedPins }));
      setPinMessage(err instanceof Error ? err.message : "Could not update pin");
    }
  }

  const dirty = JSON.stringify(grid) !== savedGrid;

  /** "Use AI summary" (generate + pin) or "Back to default" (unpin) for one story. */
  async function setStorySummary(item: GridPoolItem, use: boolean): Promise<void> {
    if (use && item.summary?.status === "edited" && !window.confirm("Replace the hand-edited summary with a new AI summary?")) return;
    setPinMessage(null);
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
        setPinMessage(out.error ?? `Request failed (${res.status})`);
        return;
      }
      setPinMessage(use ? "AI summary created — it appears on the story page after the next sync." : "Back to the default text — applies after the next sync.");
      await loadPool();
    } catch (err) {
      setPinMessage(err instanceof Error ? err.message : String(err));
    }
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
          pool && <SourcesPreview sources={pool.sources} topics={grid.topics ?? []} />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Stories{pool ? ` (${pool.items.length})` : ""}</h3>
        {pinMessage && <p className="text-xs text-amber-500">{pinMessage}</p>}
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
