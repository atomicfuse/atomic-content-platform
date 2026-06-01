"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  useVerticals,
  useAllCategories,
  useBundles,
  useTagSearch,
} from "@/hooks/useReferenceData";
import type { WizardFormData } from "@/types/dashboard";

interface StepNicheTargetingProps {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepNicheTargeting({
  data,
  onChange,
  onNext,
  onBack,
}: StepNicheTargetingProps): React.ReactElement {
  const { bundles, loading: bundlesLoading } = useBundles();
  const { verticals } = useVerticals();
  // useAllCategories returns tier-1s + every subcat across the taxonomy.
  // Lets the starter form pick categories spanning multiple tier-1s
  // (e.g. travelingfoodie = Food/Dining-Out + Travel/Day-Trips).
  const { categories, loading: categoriesLoading } = useAllCategories();

  const [verticalSearch, setVerticalSearch] = useState("");
  const [verticalOpen, setVerticalOpen] = useState(false);
  const verticalRef = useRef<HTMLDivElement>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [bundleSearch, setBundleSearch] = useState("");

  const { results: tagResults, loading: tagSearchLoading } = useTagSearch(tagSearch);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (verticalRef.current && !verticalRef.current.contains(e.target as Node)) {
        setVerticalOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return (): void => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredVerticals = useMemo(
    () => verticals.filter((v) => v.name.toLowerCase().includes(verticalSearch.toLowerCase())),
    [verticals, verticalSearch],
  );

  // Suggested bundles: bundles whose rules.category_ids contain the chosen tier-1.
  // When no tier-1 is chosen, show all bundles.
  const suggestedBundles = useMemo(() => {
    const tier1 = data.verticalId;
    const filtered = bundles.filter((b) => {
      if (!tier1) return true;
      return b.rules.category_ids.includes(tier1);
    });
    const q = bundleSearch.trim().toLowerCase();
    const searched = q ? filtered.filter((b) => b.name.toLowerCase().includes(q)) : filtered;
    return [...searched].sort(
      (a, b) => (b.content_count ?? 0) - (a.content_count ?? 0),
    );
  }, [bundles, data.verticalId, bundleSearch]);

  // The starter only needs at least one category; tier-1 (Primary Category) is
  // no longer required (the lock that blocked cross-category starters is gone).
  const canCreateStarter =
    data.starterBundle.enabled
    && data.selectedCategories.length > 0;

  // If the starter checkbox is on but no categories are picked, the server
  // action will throw — block Next to surface this before the server call,
  // even if the user has subscribed bundles. The inline amber warning above
  // tells them what to do (pick categories or uncheck starter).
  const starterIncomplete = data.starterBundle.enabled && data.selectedCategories.length === 0;
  const canProceed = !starterIncomplete && (data.bundleIds.length > 0 || canCreateStarter);

  function handleVerticalChange(id: string): void {
    // Primary Category now only drives Suggested Bundles filtering — it doesn't
    // gate the starter's category selection anymore, so no reason to wipe picks.
    const v = verticals.find((vert) => vert.id === id);
    onChange({
      verticalId: id,
      vertical: v?.name ?? "",
      iabVerticalCode: v?.iab_code ?? "",
    });
  }

  function toggleBundle(id: string): void {
    const set = new Set(data.bundleIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    onChange({ bundleIds: Array.from(set) });
  }

  function toggleCategory(cat: { id: string; name: string; iab_code: string }): void {
    const isSelected = data.selectedCategories.some((c) => c.id === cat.id);
    onChange({
      selectedCategories: isSelected
        ? data.selectedCategories.filter((c) => c.id !== cat.id)
        : [...data.selectedCategories, { id: cat.id, name: cat.name, iabCode: cat.iab_code }],
    });
  }

  function addTag(tagId: string, tagName: string): void {
    if (data.selectedTags.some((t) => t.id === tagId)) return;
    onChange({ selectedTags: [...data.selectedTags, { id: tagId, name: tagName }] });
    setTagSearch("");
  }

  function removeTag(tagId: string): void {
    onChange({ selectedTags: data.selectedTags.filter((t) => t.id !== tagId) });
  }

  async function createAndAddTag(name: string): Promise<void> {
    setCreatingTag(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.status === 201) {
        const created = (await res.json()) as { id: string; name: string };
        onChange({ selectedTags: [...data.selectedTags, { id: created.id, name: created.name }] });
      }
    } catch { /* silent */ }
    finally { setCreatingTag(false); setTagSearch(""); }
  }

  // Lookup: tier-1 id → tier-1 name, for rendering "parent" badges on subcat rows.
  const tier1NameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) if (c.parent_id === null) m.set(c.id, c.name);
    return m;
  }, [categories]);

  // Filter all categories (tier-1s + subcats) by search term.
  // Sort: tier-1 first within each group, then alphabetical by name.
  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    const matching = q
      ? categories.filter((c) => c.name.toLowerCase().includes(q))
      : categories;
    // Group by parent: tier-1s sit at the top of their group followed by their subcats.
    // For simplicity we sort flat by (parent group key, parent_id null first, name).
    return [...matching].sort((a, b) => {
      const aGroupKey = a.parent_id === null ? a.id : a.parent_id ?? "";
      const bGroupKey = b.parent_id === null ? b.id : b.parent_id ?? "";
      const aGroupName = a.parent_id === null ? a.name : (tier1NameById.get(a.parent_id ?? "") ?? "");
      const bGroupName = b.parent_id === null ? b.name : (tier1NameById.get(b.parent_id ?? "") ?? "");
      if (aGroupName !== bGroupName) return aGroupName.localeCompare(bGroupName);
      if (aGroupKey !== bGroupKey) return aGroupKey.localeCompare(bGroupKey);
      // Within the same tier-1: tier-1 itself first, then its subcats alphabetically.
      if (a.parent_id === null && b.parent_id !== null) return -1;
      if (a.parent_id !== null && b.parent_id === null) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [categories, categorySearch, tier1NameById]);
  const tagSearchNormalized = tagSearch.toLowerCase().trim();
  const tagExistsAlready =
    tagResults.some((t) => t.name.toLowerCase() === tagSearchNormalized) ||
    data.selectedTags.some((t) => t.name.toLowerCase() === tagSearchNormalized);
  const showCreateTag = tagSearch.trim().length > 1 && !tagExistsAlready && !tagSearchLoading;
  const filteredTagResults = tagResults.filter(
    (t) => !data.selectedTags.some((st) => st.id === t.id),
  );

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Niche Targeting</h2>
      <p className="text-sm text-[var(--text-muted)]">
        Subscribe the site to one or more content bundles. Each bundle is a focused content filter;
        the site fetches articles from the union of its subscribed bundles.
      </p>

      {/* Category (tier-1) — anchors both bundle suggestions and starter creation */}
      <div ref={verticalRef} className="relative">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">
          Primary Category
        </label>
        <div className="relative">
          <input
            type="text"
            placeholder="Search categories..."
            value={verticalOpen ? verticalSearch : (data.vertical || verticalSearch)}
            onFocus={(): void => { setVerticalOpen(true); setVerticalSearch(""); }}
            onChange={(e): void => { setVerticalSearch(e.target.value); setVerticalOpen(true); }}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan/50"
          />
        </div>
        {verticalOpen && (
          <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
            {filteredVerticals.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No categories found</p>
            ) : (
              filteredVerticals.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={(): void => { handleVerticalChange(v.id); setVerticalSearch(""); setVerticalOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] flex items-center justify-between ${
                    v.id === data.verticalId ? "bg-cyan/10 text-cyan" : ""
                  }`}
                >
                  <span>{v.name}</span>
                  {v.iab_code && <span className="text-[10px] text-[var(--text-muted)] font-mono">IAB {v.iab_code}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* === SECTION 1: Suggested bundles (multi-select) === */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Suggested Bundles
            {data.bundleIds.length > 0 && (
              <span className="ml-1.5 text-cyan font-mono">({data.bundleIds.length} selected)</span>
            )}
          </label>
          <Input
            placeholder="Filter bundles..."
            value={bundleSearch}
            onChange={(e): void => setBundleSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 space-y-1">
          {bundlesLoading ? (
            <p className="text-sm text-[var(--text-muted)] py-2 text-center">Loading bundles…</p>
          ) : suggestedBundles.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-2 text-center">
              {data.verticalId
                ? "No bundles found for this category. Create a starter below."
                : "Pick a category above to see suggestions, or filter all bundles by name."}
            </p>
          ) : (
            suggestedBundles.map((b) => (
              <label
                key={b.id}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-primary)] cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  checked={data.bundleIds.includes(b.id)}
                  onChange={(): void => toggleBundle(b.id)}
                  className="mt-0.5 accent-cyan"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{b.name}</span>
                    {b.content_count != null && (
                      <span className="text-[10px] text-[var(--text-muted)] font-mono">
                        {b.content_count} articles
                      </span>
                    )}
                  </div>
                  {b.description && (
                    <p className="text-xs text-[var(--text-muted)] truncate">{b.description}</p>
                  )}
                </div>
              </label>
            ))
          )}
        </div>
      </div>

      {/* === SECTION 2: Create starter bundle (optional) === */}
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={data.starterBundle.enabled}
            onChange={(e): void => onChange({ starterBundle: { ...data.starterBundle, enabled: e.target.checked } })}
            className="accent-cyan"
          />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Also create a starter bundle (optional)
          </span>
        </label>

        {data.starterBundle.enabled && (
          <>
            <Input
              placeholder={`${data.pagesProjectName || "site"}-starter`}
              value={data.starterBundle.name}
              onChange={(e): void => onChange({ starterBundle: { ...data.starterBundle, name: e.target.value } })}
            />
            <p className="text-xs text-[var(--text-muted)]">
              The starter is created on the aggregator from the categories and tags below,
              then auto-subscribed to this site. Pick categories across any tier-1s — e.g. a
              travel-food site combines Food/World-Cuisines + Travel/Day-Trips. Rename it later
              to make it reusable across sites.
            </p>
            {data.selectedCategories.length === 0 && (
              <p className="text-xs text-amber-400">
                Pick at least one category below — a bundle without categories matches nothing.
                Tags alone are not enough.
              </p>
            )}

            {/* Categories — flat searchable list spanning all tier-1s */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Categories <span className="text-red-400">*</span>
                {data.selectedCategories.length > 0 && (
                  <span className="ml-1.5 text-cyan font-mono normal-case">({data.selectedCategories.length})</span>
                )}
              </label>
              <Input
                placeholder="Filter across all categories (e.g. food, travel)..."
                value={categorySearch}
                onChange={(e): void => setCategorySearch(e.target.value)}
              />
              {data.selectedCategories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {data.selectedCategories.map((cat) => (
                    <span key={cat.id} className="inline-flex items-center gap-1 rounded-md bg-violet-500/15 text-violet-400 px-2 py-0.5 text-xs font-semibold">
                      {cat.name}
                      <button type="button" onClick={(): void => toggleCategory({ id: cat.id, name: cat.name, iab_code: cat.iabCode ?? "" })} className="hover:text-red-400">
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-56 overflow-y-auto rounded border border-[var(--border-primary)] p-2 space-y-1">
                {categoriesLoading ? (
                  <p className="text-sm text-[var(--text-muted)] py-1 text-center">Loading…</p>
                ) : filteredCategories.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] py-1 text-center">No categories found</p>
                ) : (
                  filteredCategories.map((cat) => {
                    const isTier1 = cat.parent_id === null;
                    const parentName = !isTier1 ? tier1NameById.get(cat.parent_id ?? "") : null;
                    return (
                      <label key={cat.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-primary)] cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={data.selectedCategories.some((c) => c.id === cat.id)}
                          onChange={(): void => toggleCategory(cat)}
                          className="accent-cyan"
                        />
                        <span className={`flex-1 ${isTier1 ? "font-semibold" : ""}`}>{cat.name}</span>
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

            {/* Tags */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Tags <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>
              </label>
                {data.selectedTags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {data.selectedTags.map((tag) => (
                      <span key={tag.id} className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold">
                        {tag.name}
                        <button type="button" onClick={(): void => removeTag(tag.id)} className="hover:text-red-400">
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative">
                  <Input
                    placeholder="Type to search tags..."
                    value={tagSearch}
                    onChange={(e): void => setTagSearch(e.target.value)}
                  />
                  {tagSearch.trim() && (
                    <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
                      {tagSearchLoading ? (
                        <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Searching…</p>
                      ) : (
                        filteredTagResults.slice(0, 10).map((tag) => (
                          <button key={tag.id} type="button" onClick={(): void => addTag(tag.id, tag.name)} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)]">
                            {tag.name}
                          </button>
                        ))
                      )}
                      {showCreateTag && (
                        <button type="button" onClick={(): void => void createAndAddTag(tagSearch.trim())} disabled={creatingTag} className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] text-cyan font-semibold border-t border-[var(--border-secondary)]">
                          + Create &quot;{tagSearch.trim()}&quot;
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
          </>
        )}
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>&larr; Back</Button>
        <Button onClick={onNext} disabled={!canProceed}>Next &rarr;</Button>
      </div>
    </div>
  );
}
