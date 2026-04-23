"use client";

import { useState } from "react";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  useVerticals,
  useCategories,
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
  const { categories, loading: categoriesLoading } = useCategories(data.verticalId);

  const [mode, setMode] = useState<"existing" | "new">(data.bundleId ? "existing" : "new");
  const [categorySearch, setCategorySearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Tag search — server-side via API, debounced in the hook
  const { results: tagResults, loading: tagSearchLoading } = useTagSearch(
    data.verticalId,
    tagSearch,
  );
  const filteredTagResults = tagResults.filter(
    (t) => !data.selectedTags.some((st) => st.id === t.id),
  );

  const categoryIds = data.selectedCategories.map((c) => c.id);
  const tagIds = data.selectedTags.map((t) => t.id);
  const canProceed =
    (mode === "existing" && !!data.bundleId) ||
    (mode === "new" && !!data.verticalId && data.selectedCategories.length >= 1);

  // --- Bundle selection ---
  function handleBundleSelect(bundleId: string): void {
    if (!bundleId) {
      onChange({ bundleId: "" });
      return;
    }
    const bundle = bundles.find((b) => b.id === bundleId);
    if (!bundle) return;
    const vId = bundle.rules.vertical_ids[0] ?? "";
    const v = verticals.find((vert) => vert.id === vId);
    onChange({
      bundleId: bundle.id,
      verticalId: vId,
      vertical: v?.name ?? "",
      iabVerticalCode: v?.iab_code ?? "",
      selectedCategories: [],
      selectedTags: [],
    });
  }

  // --- Vertical change (clears selections with confirmation) ---
  function handleVerticalChange(id: string): void {
    const hasSelections = data.selectedCategories.length > 0 || data.selectedTags.length > 0;
    if (hasSelections && id !== data.verticalId) {
      const confirmed = window.confirm(
        "Changing the vertical will clear your category and tag selections. Continue?",
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
      bundleId: "",
    });
    setCategorySearch("");
    setTagSearch("");
    setPreviewCount(null);
  }

  // --- Category toggle ---
  function toggleCategory(cat: { id: string; name: string; iab_code: string }): void {
    const isSelected = data.selectedCategories.some((c) => c.id === cat.id);
    onChange({
      selectedCategories: isSelected
        ? data.selectedCategories.filter((c) => c.id !== cat.id)
        : [...data.selectedCategories, { id: cat.id, name: cat.name, iabCode: cat.iab_code }],
    });
    setPreviewCount(null);
  }

  // --- Tag add/remove ---
  function addTag(tagId: string, tagName: string): void {
    if (data.selectedTags.some((t) => t.id === tagId)) return;
    onChange({ selectedTags: [...data.selectedTags, { id: tagId, name: tagName }] });
    setTagSearch("");
    setPreviewCount(null);
  }

  function removeTag(tagId: string): void {
    onChange({ selectedTags: data.selectedTags.filter((t) => t.id !== tagId) });
    setPreviewCount(null);
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
        onChange({ selectedTags: [...data.selectedTags, { id: created.id, name: created.name }] });
      } else if (res.status === 409) {
        // Tag exists after normalization — search results will include it
      }
    } catch {
      // Silent fail
    } finally {
      setCreatingTag(false);
      setTagSearch("");
    }
  }

  // --- Content preview (on-click, GET) ---
  async function handlePreview(): Promise<void> {
    if (!data.verticalId) return;
    setPreviewLoading(true);
    try {
      const qs = new URLSearchParams({ vertical_id: data.verticalId });
      if (categoryIds.length) qs.set("category_ids", categoryIds.join(","));
      if (tagIds.length) qs.set("tag_ids", tagIds.join(","));
      const res = await fetch(`/api/bundles/preview?${qs.toString()}`);
      if (res.ok) {
        const result = (await res.json()) as { count: number };
        setPreviewCount(result.count);
      }
    } catch {
      // Silent fail
    } finally {
      setPreviewLoading(false);
    }
  }

  // --- Tag search helpers ---
  const tagSearchNormalized = tagSearch.toLowerCase().trim();
  const tagExistsAlready =
    tagResults.some((t) => t.name.toLowerCase() === tagSearchNormalized) ||
    data.selectedTags.some((t) => t.name.toLowerCase() === tagSearchNormalized);
  const showCreateTag = tagSearch.trim().length > 1 && !tagExistsAlready && !tagSearchLoading;

  // --- Category client-side filter ---
  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase()),
  );

  // --- Selected bundle info ---
  const selectedBundle = mode === "existing" ? bundles.find((b) => b.id === data.bundleId) : null;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Niche Targeting</h2>
      <p className="text-sm text-[var(--text-muted)]">
        Choose an existing content bundle or create a new one to feed targeted content to your site.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={(): void => setMode("existing")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === "existing"
              ? "bg-cyan/15 text-cyan border border-cyan/30"
              : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)]"
          }`}
        >
          Use Existing Bundle
        </button>
        <button
          type="button"
          onClick={(): void => {
            setMode("new");
            onChange({ bundleId: "" });
          }}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            mode === "new"
              ? "bg-cyan/15 text-cyan border border-cyan/30"
              : "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--border-secondary)]"
          }`}
        >
          Create New
        </button>
      </div>

      {/* === Existing Bundle Picker === */}
      {mode === "existing" && (
        <div className="space-y-3">
          {bundlesLoading ? (
            <p className="text-sm text-[var(--text-muted)]">Loading bundles...</p>
          ) : bundles.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No bundles found.{" "}
              <button
                type="button"
                onClick={(): void => setMode("new")}
                className="text-cyan hover:underline"
              >
                Create one
              </button>
            </p>
          ) : (
            <Select
              label="Content Bundle"
              options={bundles.map((b) => ({
                value: b.id,
                label: `${b.name}${b.content_count != null ? ` (${b.content_count} articles)` : ""}`,
              }))}
              placeholder="Select a bundle..."
              value={data.bundleId}
              onChange={(e): void => handleBundleSelect(e.target.value)}
            />
          )}
          {selectedBundle && (
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-2">
              <p className="text-sm font-semibold">{selectedBundle.name}</p>
              {selectedBundle.description && (
                <p className="text-xs text-[var(--text-muted)]">{selectedBundle.description}</p>
              )}
              <div className="flex gap-4 text-xs text-[var(--text-muted)]">
                {selectedBundle.content_count != null && (
                  <span>
                    <span className="font-bold text-cyan">{selectedBundle.content_count}</span> articles
                  </span>
                )}
                <span>{selectedBundle.rules.category_ids.length} categories</span>
                <span>{selectedBundle.rules.tag_ids.length} tags</span>
              </div>
              {data.vertical && (
                <p className="text-xs text-[var(--text-muted)]">
                  Vertical: {data.vertical}
                  {data.iabVerticalCode ? ` (IAB ${data.iabVerticalCode})` : ""}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* === Create New Bundle === */}
      {mode === "new" && (
        <>
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
                placeholder="Filter categories..."
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
                  <p className="text-sm text-[var(--text-muted)] py-2 text-center">
                    No categories found
                  </p>
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

          {/* Tags — server-side search */}
          {data.verticalId && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Tags{" "}
                <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>
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
                  placeholder="Type to search tags..."
                  value={tagSearch}
                  onChange={(e): void => setTagSearch(e.target.value)}
                />
                {tagSearch.trim() && (
                  <div className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
                    {tagSearchLoading ? (
                      <p className="px-3 py-2 text-sm text-[var(--text-muted)]">Searching...</p>
                    ) : filteredTagResults.length === 0 && !showCreateTag ? (
                      <p className="px-3 py-2 text-sm text-[var(--text-muted)]">No tags found</p>
                    ) : (
                      filteredTagResults.slice(0, 10).map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={(): void => addTag(tag.id, tag.name)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] flex items-center justify-between"
                        >
                          <span>{tag.name}</span>
                          {tag.usage_count !== undefined && (
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {tag.usage_count} uses
                            </span>
                          )}
                        </button>
                      ))
                    )}
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

          {/* Content Preview — on click only */}
          {data.verticalId && data.selectedCategories.length > 0 && (
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Content Preview</h3>
                <Button
                  variant="ghost"
                  onClick={(): void => void handlePreview()}
                  disabled={previewLoading}
                >
                  {previewLoading ? "Checking..." : previewCount !== null ? "Refresh" : "Check Match Count"}
                </Button>
              </div>
              {previewCount === null ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Click to see how many articles match your niche selection.
                </p>
              ) : previewCount === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No matching content yet — articles will match as content is ingested and enriched.
                </p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="text-2xl font-bold text-cyan">{previewCount.toLocaleString()}</span>
                    {" "}article{previewCount !== 1 ? "s" : ""} currently match this niche
                  </p>
                  {previewCount > 500 && (
                    <p className="text-xs text-amber-400">
                      High match count — consider narrowing with more specific categories or tags.
                    </p>
                  )}
                  {previewCount < 5 && previewCount > 0 && (
                    <p className="text-xs text-amber-400">
                      Low match count — consider broadening with additional categories.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
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
