"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useVerticals, useCategories, useTags } from "@/hooks/useReferenceData";
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
  const { verticals } = useVerticals();
  const { categories, loading: categoriesLoading } = useCategories(data.verticalId);
  const { tags, refetch: refetchTags } = useTags(data.verticalId);

  const [categorySearch, setCategorySearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Derive ID arrays from object arrays for API calls
  const categoryIds = data.selectedCategories.map((c) => c.id);
  const tagIds = data.selectedTags.map((t) => t.id);
  const canProceed = data.verticalId && data.selectedCategories.length >= 1;

  // --- Bundle preview (debounced) ---
  const fetchPreview = useCallback(async (): Promise<void> => {
    if (!data.verticalId) {
      setPreviewCount(null);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/bundles/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: {
            vertical_ids: [data.verticalId],
            category_ids: categoryIds,
            tag_ids: tagIds,
          },
        }),
      });
      if (res.ok) {
        const result = (await res.json()) as { count: number };
        setPreviewCount(result.count);
      }
      // Fetch total content count for progress bar (only once)
      if (totalCount === null) {
        const totalRes = await fetch("/api/bundles/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules: { vertical_ids: [], category_ids: [], tag_ids: [] } }),
        });
        if (totalRes.ok) {
          const totalResult = (await totalRes.json()) as { count: number };
          setTotalCount(totalResult.count);
        }
      }
    } catch {
      // Silently fail — preview is informational
    } finally {
      setPreviewLoading(false);
    }
  }, [data.verticalId, categoryIds, tagIds, totalCount]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchPreview(), 300);
    return (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchPreview]);

  // --- Vertical change handler (with confirmation if selections exist) ---
  function handleVerticalChange(id: string): void {
    const hasSelections = data.selectedCategories.length > 0 || data.selectedTags.length > 0;
    if (hasSelections && id !== data.verticalId) {
      const confirmed = window.confirm(
        "Changing the vertical will clear your category and tag selections. Continue?"
      );
      if (!confirmed) return;
    }
    const v = verticals.find((vert) => vert.id === id);
    onChange({
      verticalId: id,
      vertical: v?.name ?? "",
      iabVerticalCode: v?.iab_code ?? "",
      selectedCategories: [],
      selectedTags: [],
    });
    setCategorySearch("");
    setTagSearch("");
  }

  // --- Category toggle (object array — no parallel array desync risk) ---
  function toggleCategory(cat: { id: string; name: string; iab_code: string }): void {
    const isSelected = data.selectedCategories.some((c) => c.id === cat.id);
    if (isSelected) {
      onChange({
        selectedCategories: data.selectedCategories.filter((c) => c.id !== cat.id),
      });
    } else {
      onChange({
        selectedCategories: [
          ...data.selectedCategories,
          { id: cat.id, name: cat.name, iabCode: cat.iab_code },
        ],
      });
    }
  }

  // --- Tag add/remove (object array) ---
  function removeTag(tagId: string): void {
    onChange({
      selectedTags: data.selectedTags.filter((t) => t.id !== tagId),
    });
  }

  function addExistingTag(tagId: string, tagName: string): void {
    if (data.selectedTags.some((t) => t.id === tagId)) return;
    onChange({
      selectedTags: [...data.selectedTags, { id: tagId, name: tagName }],
    });
    setTagSearch("");
  }

  async function createAndAddTag(name: string): Promise<void> {
    setCreatingTag(true);
    try {
      const res = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, vertical_id: data.verticalId }),
      });
      if (res.status === 201) {
        const created = (await res.json()) as { id: string; name: string };
        onChange({
          selectedTags: [...data.selectedTags, { id: created.id, name: created.name }],
        });
        refetchTags();
      } else if (res.status === 409) {
        // Tag exists after normalization — find it in the list
        const existing = tags.find(
          (t) => t.name.toLowerCase() === name.toLowerCase().trim()
        );
        if (existing) addExistingTag(existing.id, existing.name);
      }
    } catch {
      // Silent fail
    } finally {
      setCreatingTag(false);
      setTagSearch("");
    }
  }

  // --- Filtered lists ---
  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase())
  );
  const filteredTags = tags.filter(
    (t) =>
      t.name.toLowerCase().includes(tagSearch.toLowerCase()) &&
      !data.selectedTags.some((st) => st.id === t.id)
  );
  const tagSearchNormalized = tagSearch.toLowerCase().trim();
  const tagExistsAlready =
    tags.some((t) => t.name.toLowerCase() === tagSearchNormalized) ||
    data.selectedTags.some((t) => t.name.toLowerCase() === tagSearchNormalized);
  const showCreateTag = tagSearch.trim().length > 0 && !tagExistsAlready;

  // Progress bar percentage
  const progressPct =
    previewCount !== null && totalCount && totalCount > 0
      ? Math.min(100, Math.round((previewCount / totalCount) * 100))
      : 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Niche Targeting</h2>
      <p className="text-sm text-[var(--text-muted)]">
        Define your site&apos;s content niche. This creates a content bundle that feeds
        precisely targeted content from the aggregator.
      </p>

      {/* Vertical */}
      <div>
        <Select
          label="Vertical"
          options={verticals.map((v) => ({ value: v.id, label: v.name }))}
          value={data.verticalId}
          placeholder="Select a vertical..."
          onChange={(e): void => handleVerticalChange(e.target.value)}
        />
        {data.verticalId && data.iabVerticalCode && (
          <p className="text-xs text-[var(--text-muted)] mt-1">
            IAB: {data.vertical} ({data.iabVerticalCode})
          </p>
        )}
      </div>

      {/* Categories */}
      {data.verticalId && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Categories <span className="text-red-400">*</span>
          </label>
          <Input
            placeholder="Search categories..."
            value={categorySearch}
            onChange={(e): void => setCategorySearch(e.target.value)}
          />
          {data.selectedCategories.length > 0 && (
            <p className="text-xs text-[var(--text-muted)]">
              Selected: {data.selectedCategories.map((c) => c.name).join(", ")}
            </p>
          )}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 space-y-1">
            {categoriesLoading ? (
              <p className="text-sm text-[var(--text-muted)] py-2 text-center">Loading...</p>
            ) : filteredCategories.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-2 text-center">No categories found</p>
            ) : (
              filteredCategories.map((cat) => (
                <label
                  key={cat.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-primary)] cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={data.selectedCategories.some((c) => c.id === cat.id)}
                    onChange={(): void => toggleCategory(cat)}
                    className="rounded border-[var(--border-primary)]"
                  />
                  <span className="flex-1">{cat.name}</span>
                  {cat.iab_code && (
                    <span className="text-[10px] text-[var(--text-muted)] font-mono bg-[var(--bg-primary)] px-1.5 py-0.5 rounded">
                      IAB {cat.iab_code}
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tags */}
      {data.verticalId && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Tags <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>
          </label>
          {data.selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.selectedTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                >
                  {tag.name}
                  <button
                    type="button"
                    onClick={(): void => removeTag(tag.id)}
                    className="hover:text-red-400 transition-colors"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Input
              placeholder="Search or create tags..."
              value={tagSearch}
              onChange={(e): void => setTagSearch(e.target.value)}
            />
            {tagSearch.trim() && (
              <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
                {filteredTags.slice(0, 10).map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={(): void => addExistingTag(tag.id, tag.name)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] flex items-center justify-between"
                  >
                    <span>{tag.name}</span>
                    {tag.usage_count !== undefined && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {tag.usage_count} uses
                      </span>
                    )}
                  </button>
                ))}
                {showCreateTag && (
                  <button
                    type="button"
                    onClick={(): void => void createAndAddTag(tagSearch.trim())}
                    disabled={creatingTag}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] text-cyan font-semibold border-t border-[var(--border-secondary)]"
                  >
                    + Create &quot;{tagSearch.trim()}&quot;
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content Preview */}
      {data.verticalId && (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            Content Preview
            {previewLoading && (
              <span className="text-xs text-[var(--text-muted)]">updating...</span>
            )}
          </h3>
          {previewCount === null ? (
            <p className="text-sm text-[var(--text-muted)]">
              Select categories to see matching content
            </p>
          ) : previewCount === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No matching content yet — content will be matched as it&apos;s ingested and enriched
            </p>
          ) : (
            <>
              <p className="text-sm">
                <span className="text-2xl font-bold text-cyan">{previewCount}</span>
                {" "}article{previewCount !== 1 ? "s" : ""} currently match this niche
              </p>
              {/* Progress bar: niche matches vs total content */}
              {totalCount !== null && totalCount > 0 && (
                <div className="space-y-1">
                  <div className="w-full h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan rounded-full transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    {previewCount.toLocaleString()} / {totalCount.toLocaleString()} total content items
                  </p>
                </div>
              )}
              {previewCount > 500 && (
                <p className="text-xs text-amber-400">
                  High match count — consider adding more specific categories or tags to narrow the niche
                </p>
              )}
              {previewCount < 5 && previewCount > 0 && (
                <p className="text-xs text-amber-400">
                  Low match count — consider broadening with additional categories
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Next &rarr;
        </Button>
      </div>
    </div>
  );
}
