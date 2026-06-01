"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useBundles, useAllCategories, useTags, useTagSearch } from "@/hooks/useReferenceData";
import type { BundleItem } from "@/lib/reference-data";

interface BundleSubscriptionsPanelProps {
  bundleIds: string[];
  onChange: (next: string[]) => void;
  siteName: string;
  domain: string;
}

interface NewBundleForm {
  name: string;
  /** Mix of tier-1s and/or child subcategory IDs, spanning any number of tier-1s.
   *  Post-2026-05-31: dropped the verticalId/tier-1 anchor that previously limited
   *  bundle rules to one tier-1's children. */
  categoryIds: string[];
  tagIds: string[];
}

const EMPTY_NEW: NewBundleForm = { name: "", categoryIds: [], tagIds: [] };

export function BundleSubscriptionsPanel({
  bundleIds,
  onChange,
  siteName,
  domain,
}: BundleSubscriptionsPanelProps): React.ReactElement {
  const { bundles, loading: bundlesLoading } = useBundles();
  const [modalOpen, setModalOpen] = useState(false);

  // Optimistic store for bundles created in this session — the dashboard's
  // /api/bundles route caches list responses, so a newly POSTed bundle is
  // not visible in `bundles` for up to the cache window. We render its
  // metadata from here in the meantime; `bundles.find(...)` takes precedence
  // once the canonical list catches up.
  const [optimisticBundles, setOptimisticBundles] = useState<Map<string, BundleItem>>(new Map());

  function resolveBundle(id: string): BundleItem | undefined {
    return bundles.find((b) => b.id === id) ?? optimisticBundles.get(id);
  }

  const subscribed = useMemo(
    () => bundleIds
      .map((id) => resolveBundle(id))
      .filter((b): b is BundleItem => !!b),
    // resolveBundle reads `bundles` and `optimisticBundles` — both are deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bundleIds, bundles, optimisticBundles],
  );

  function removeSubscription(id: string): void {
    onChange(bundleIds.filter((x) => x !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Content Bundles
          {bundleIds.length > 0 && <span className="ml-1.5 text-cyan font-mono">({bundleIds.length})</span>}
        </label>
        <Button variant="ghost" onClick={(): void => setModalOpen(true)}>+ Add Bundle</Button>
      </div>

      {bundleIds.length === 0 ? (
        <p className="text-xs text-amber-400">
          No bundles subscribed. The site falls back to a category-only query; cross-category themes
          (e.g. travel-food) won&apos;t be matched correctly until you add at least one bundle.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {subscribed.map((b) => (
            <li key={b.id} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{b.name}</span>
                  {b.content_count != null && (
                    <span className="text-[10px] text-[var(--text-muted)] font-mono">{b.content_count} articles</span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {b.rules.category_ids.length} categories
                  {b.rules.tag_ids.length > 0 && `, ${b.rules.tag_ids.length} tags`}
                </p>
              </div>
              <button type="button" onClick={(): void => removeSubscription(b.id)} className="text-[var(--text-muted)] hover:text-red-400">
                &times;
              </button>
            </li>
          ))}
          {/* Show ids that we have but no bundle metadata for (deleted upstream or still loading) */}
          {!bundlesLoading && bundleIds.length > subscribed.length && (
            bundleIds.filter((id) => !resolveBundle(id)).map((id) => (
              <li key={id} className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-[var(--bg-elevated)] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-amber-400">{id}</span>
                  <p className="text-xs text-[var(--text-muted)]">Bundle not found — may have been deleted on the aggregator.</p>
                </div>
                <button type="button" onClick={(): void => removeSubscription(id)} className="text-[var(--text-muted)] hover:text-red-400">
                  &times;
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {modalOpen && (
        <AddBundleModal
          existingIds={bundleIds}
          allBundles={bundles}
          allBundlesLoading={bundlesLoading}
          defaultStarterName={`${domain}-starter`}
          siteName={siteName}
          onClose={(): void => setModalOpen(false)}
          onAdd={(ids, optimistic): void => {
            // Persist any optimistic bundle metadata into local state so the
            // newly subscribed row renders with name/count immediately rather
            // than as an amber "not found" placeholder.
            if (optimistic && optimistic.length > 0) {
              setOptimisticBundles((prev) => {
                const next = new Map(prev);
                for (const b of optimistic) next.set(b.id, b);
                return next;
              });
            }
            const merged = Array.from(new Set([...bundleIds, ...ids]));
            onChange(merged);
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface AddBundleModalProps {
  existingIds: string[];
  allBundles: ReturnType<typeof useBundles>["bundles"];
  allBundlesLoading: boolean;
  defaultStarterName: string;
  siteName: string;
  onClose: () => void;
  /** `optimistic` carries full BundleItem metadata for any bundles created in
   *  this modal invocation — the panel renders them immediately instead of
   *  waiting for the /api/bundles cache to revalidate. */
  onAdd: (ids: string[], optimistic?: BundleItem[]) => void;
}

function AddBundleModal({ existingIds, allBundles, allBundlesLoading, defaultStarterName, siteName, onClose, onAdd }: AddBundleModalProps): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [createNew, setCreateNew] = useState<NewBundleForm>({ ...EMPTY_NEW, name: defaultStarterName });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { categories, loading: categoriesLoading } = useAllCategories();
  // Popular tags only used to resolve names for tags the user already selected
  // in this modal session (so removing a selected tag still shows its name).
  const { tags } = useTags();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const { results: tagSearchResults, loading: tagSearchLoading } = useTagSearch(tagSearch);
  const [creatingTag, setCreatingTag] = useState(false);
  // Persist names of tags we've added in this session so pills render with the
  // tag name even after the search dropdown is cleared.
  const [tagNamesById, setTagNamesById] = useState<Map<string, string>>(new Map());

  const eligible = allBundles.filter((b) => !existingIds.includes(b.id));
  const q = search.trim().toLowerCase();
  const filtered = q ? eligible.filter((b) => b.name.toLowerCase().includes(q)) : eligible;
  const sorted = [...filtered].sort((a, b) => (b.content_count ?? 0) - (a.content_count ?? 0));

  // Tier-1 lookup for rendering parent-name badges on subcategory rows.
  const tier1NameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) if (c.parent_id === null) m.set(c.id, c.name);
    return m;
  }, [categories]);

  // Flat searchable list of all categories (tier-1s + subcats), sorted so each
  // tier-1 sits with its own subcats grouped after it.
  const filteredCats = useMemo(() => {
    const cq = categoryFilter.trim().toLowerCase();
    const matching = cq ? categories.filter((c) => c.name.toLowerCase().includes(cq)) : categories;
    return [...matching].sort((a, b) => {
      const aGroup = a.parent_id === null ? a.name : (tier1NameById.get(a.parent_id ?? "") ?? "");
      const bGroup = b.parent_id === null ? b.name : (tier1NameById.get(b.parent_id ?? "") ?? "");
      if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
      if (a.parent_id === null && b.parent_id !== null) return -1;
      if (a.parent_id !== null && b.parent_id === null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [categories, categoryFilter, tier1NameById]);

  function toggle(id: string): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  function toggleCat(id: string): void {
    const set = new Set(createNew.categoryIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    setCreateNew({ ...createNew, categoryIds: Array.from(set) });
  }

  function addTagToBundle(tagId: string, tagName: string): void {
    if (createNew.tagIds.includes(tagId)) return;
    setCreateNew({ ...createNew, tagIds: [...createNew.tagIds, tagId] });
    setTagNamesById((prev) => new Map(prev).set(tagId, tagName));
    setTagSearch("");
  }

  function removeTagFromBundle(tagId: string): void {
    setCreateNew({ ...createNew, tagIds: createNew.tagIds.filter((t) => t !== tagId) });
  }

  async function createAndAddTagToBundle(name: string): Promise<void> {
    setCreatingTag(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 201) {
        const created = (await res.json()) as { id: string; name: string };
        addTagToBundle(created.id, created.name);
      }
    } catch { /* silent */ }
    finally {
      setCreatingTag(false);
      setTagSearch("");
    }
  }

  async function handleAdd(): Promise<void> {
    setError(null);
    const ids: string[] = Array.from(selected);
    const optimistic: BundleItem[] = [];

    // Post-2026-05-31: only require name + at least one category. Categories may
    // be any mix of tier-1s and/or subcats from any number of tier-1s.
    const wantsNew = !!createNew.name.trim() && createNew.categoryIds.length > 0;
    if (wantsNew) {
      setCreating(true);
      try {
        const baseName = createNew.name.trim();
        const dedupedCategoryIds = Array.from(new Set(createNew.categoryIds.filter(Boolean)));
        const dedupedTagIds = Array.from(new Set(createNew.tagIds.filter(Boolean)));
        const payload = {
          name: baseName,
          description: `Created from site ${siteName}`,
          active: true,
          rules: {
            category_ids: dedupedCategoryIds,
            tag_ids: dedupedTagIds,
          },
        };

        let res = await fetch("/api/bundles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        // 409 duplicate-name — retry once with " (2)" suffix (mirrors wizard's createBundle)
        let actualName = baseName;
        if (res.status === 409) {
          actualName = `${baseName} (2)`;
          const retryPayload = { ...payload, name: actualName };
          res = await fetch("/api/bundles", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(retryPayload),
          });
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          setError(`Failed to create bundle (${res.status}): ${body.slice(0, 200)}`);
          return;
        }
        const created = (await res.json()) as { id: string; name?: string; description?: string; content_count?: number };
        ids.push(created.id);
        // Build an optimistic BundleItem from what we know — the canonical
        // /api/bundles list will replace this once it refetches.
        optimistic.push({
          id: created.id,
          name: created.name ?? actualName,
          description: created.description ?? payload.description,
          content_count: created.content_count ?? 0,
          rules: {
            category_ids: dedupedCategoryIds,
            tag_ids: dedupedTagIds,
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create bundle");
        return;
      } finally {
        setCreating(false);
      }
    }

    if (ids.length === 0) {
      setError("Select at least one existing bundle or fill in the create-new form.");
      return;
    }

    onAdd(ids, optimistic.length > 0 ? optimistic : undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={(e): void => e.stopPropagation()} className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-5 space-y-5">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Add Content Bundles</h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl">&times;</button>
        </header>

        {/* Connect existing */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Connect existing bundles</h3>
            <span className="text-xs text-[var(--text-muted)]">{selected.size} selected</span>
          </div>
          <Input placeholder="Filter bundles by name…" value={search} onChange={(e): void => setSearch(e.target.value)} />
          <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 space-y-1">
            {allBundlesLoading ? (
              <p className="text-sm text-[var(--text-muted)] py-2 text-center">Loading bundles…</p>
            ) : sorted.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-2 text-center">No more bundles to add.</p>
            ) : (
              sorted.map((b) => (
                <label key={b.id} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-primary)] cursor-pointer text-sm">
                  <input type="checkbox" checked={selected.has(b.id)} onChange={(): void => toggle(b.id)} className="mt-0.5 accent-cyan" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      {b.content_count != null && <span className="text-[10px] text-[var(--text-muted)] font-mono">{b.content_count} articles</span>}
                    </div>
                    {b.description && <p className="text-xs text-[var(--text-muted)] truncate">{b.description}</p>}
                  </div>
                </label>
              ))
            )}
          </div>
        </section>

        {/* Create new (optional) */}
        <section className="space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3">
          <h3 className="text-sm font-semibold">Or create a new bundle</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Pick categories across any tier-1s (e.g. <span className="font-mono">Food/Dining-Out</span> + <span className="font-mono">Travel/Day-Trips</span>).
            Add tags for theme refinement (optional).
          </p>
          <Input placeholder="Bundle name (e.g. travel-food)" value={createNew.name} onChange={(e): void => setCreateNew({ ...createNew, name: e.target.value })} />

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Categories <span className="text-red-400">*</span>
              <span className="ml-1.5 text-cyan font-mono normal-case">({createNew.categoryIds.length})</span>
            </label>
            <Input placeholder="Filter across all categories…" value={categoryFilter} onChange={(e): void => setCategoryFilter(e.target.value)} />
            <div className="max-h-52 overflow-y-auto rounded border border-[var(--border-primary)] p-2 space-y-1">
              {categoriesLoading ? (
                <p className="text-sm text-[var(--text-muted)] py-1 text-center">Loading…</p>
              ) : filteredCats.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] py-1 text-center">No categories found</p>
              ) : (
                filteredCats.map((c) => {
                  const isTier1 = c.parent_id === null;
                  const parentName = !isTier1 ? tier1NameById.get(c.parent_id ?? "") : null;
                  return (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-surface)] cursor-pointer text-sm">
                      <input type="checkbox" checked={createNew.categoryIds.includes(c.id)} onChange={(): void => toggleCat(c.id)} className="accent-cyan" />
                      <span className={`flex-1 ${isTier1 ? "font-semibold" : ""}`}>{c.name}</span>
                      {parentName && (
                        <span className="text-[10px] text-[var(--text-muted)] font-mono">{parentName}</span>
                      )}
                      {isTier1 && (
                        <span className="text-[10px] text-cyan font-mono uppercase">tier-1 (all)</span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Tags <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>{" "}
              <span className="text-cyan font-mono">({createNew.tagIds.length})</span>
            </label>
            {/* Selected tags — pills */}
            {createNew.tagIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {createNew.tagIds.map((tid) => {
                  const tagName = tagNamesById.get(tid) ?? tags.find((t) => t.id === tid)?.name ?? tid;
                  return (
                    <span
                      key={tid}
                      className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                    >
                      {tagName}
                      <button type="button" onClick={(): void => removeTagFromBundle(tid)} className="hover:text-red-400">
                        &times;
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {/* Search dropdown */}
            <div className="relative">
              <Input placeholder="Type to search all tags…" value={tagSearch} onChange={(e): void => setTagSearch(e.target.value)} />
              {tagSearch.trim() && (() => {
                const tagSearchNormalized = tagSearch.trim().toLowerCase();
                const matchedNotSelected = tagSearchResults.filter(
                  (t) => !createNew.tagIds.includes(t.id),
                );
                const tagExistsAlready =
                  tagSearchResults.some((t) => t.name.toLowerCase() === tagSearchNormalized) ||
                  createNew.tagIds.some((id) => (tagNamesById.get(id) ?? "").toLowerCase() === tagSearchNormalized);
                const showCreateTag =
                  tagSearch.trim().length > 1 && !tagExistsAlready && !tagSearchLoading;
                return (
                  <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
                    {tagSearchLoading ? (
                      <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Searching…</p>
                    ) : matchedNotSelected.length === 0 && !showCreateTag ? (
                      <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No tags found</p>
                    ) : (
                      <>
                        {matchedNotSelected.slice(0, 20).map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={(): void => addTagToBundle(tag.id, tag.name)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] flex items-center justify-between"
                          >
                            <span>{tag.name}</span>
                            {tag.usage_count !== undefined && (
                              <span className="text-[10px] text-[var(--text-muted)]">{tag.usage_count} uses</span>
                            )}
                          </button>
                        ))}
                        {showCreateTag && (
                          <button
                            type="button"
                            onClick={(): void => void createAndAddTagToBundle(tagSearch.trim())}
                            disabled={creatingTag}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] text-cyan font-semibold border-t border-[var(--border-secondary)]"
                          >
                            {creatingTag ? "Creating…" : `+ Create "${tagSearch.trim()}"`}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </section>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <footer className="flex justify-end gap-2 pt-2 border-t border-[var(--border-primary)]">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={(): void => void handleAdd()} disabled={creating}>
            {creating ? "Adding…" : "Add to subscriptions"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
