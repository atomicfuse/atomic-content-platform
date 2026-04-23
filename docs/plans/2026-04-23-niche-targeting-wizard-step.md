# Niche Targeting Wizard Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Niche Targeting" step (step 2) to the site creation wizard that captures vertical, IAB categories, tags, shows a live bundle preview, and auto-creates a content bundle on wizard submit.

**Architecture:** New wizard step between "Create Site" and "Groups". Three new API proxy routes forward to the Content Aggregator (`/api/categories`, `/api/tags`, `/api/bundles`). The step component manages vertical→category→tag cascade with debounced preview. Bundle creation happens in `wizard.ts` server action on final submit — not during the step — to avoid orphaned bundles.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4. Content Aggregator REST API for taxonomy data.

**Specs:**
- `docs/specs/site-builder-v2-plan.md` — Full feature spec
- `services/content-pipeline/content-aggr-API.md` — Content Aggregator API reference

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `services/dashboard/src/components/wizard/StepNicheTargeting.tsx` | The new wizard step UI: vertical dropdown, category multi-select, tag multi-select + create, bundle preview |
| `services/dashboard/src/app/api/categories/route.ts` | Proxy → aggregator `GET /api/categories?vertical_id=X&active=true&page_size=100` |
| `services/dashboard/src/app/api/tags/route.ts` | Proxy → aggregator `GET /api/tags` and `POST /api/tags` |
| `services/dashboard/src/app/api/bundles/route.ts` | Proxy → aggregator `POST /api/bundles` and `POST /api/bundles/preview` |

### Modified files

| File | Changes |
|------|---------|
| `services/dashboard/src/types/dashboard.ts` | Add niche fields to `WizardFormData`: `categoryIds`, `tagIds`, `iabVerticalCode`, `iabCategoryCodes` (no `bundleId` — created server-side only) |
| `services/dashboard/src/components/wizard/WizardShell.tsx` | Insert "Niche Targeting" into STEPS array at index 1 (8 steps total) |
| `services/dashboard/src/app/wizard/page.tsx` | Add `StepNicheTargeting` at case 1, shift all subsequent cases +1, update DEFAULT_FORM |
| `services/dashboard/src/components/wizard/StepIdentity.tsx` | Remove the Vertical dropdown (it moves to Niche Targeting step) |
| `services/dashboard/src/actions/wizard.ts` | Add bundle creation logic in `createSiteAndBuildStaging()`: resolve tags → POST /api/bundles → store `bundle_id` on site.yaml. Also store `category_ids`, `tag_ids`, `iab_vertical_code`, `iab_category_codes` |
| `services/dashboard/src/lib/reference-data.ts` | Add `getCategories(verticalId)` and `getTags(verticalId)` functions |
| `services/dashboard/src/hooks/useReferenceData.ts` | Add `useCategories(verticalId)` and `useTags(verticalId)` hooks |

---

## Task 1: Extend WizardFormData types

**Files:**
- Modify: `services/dashboard/src/types/dashboard.ts:77-105`

- [ ] **Step 1: Add niche targeting fields to WizardFormData**

Add these fields to the `WizardFormData` interface:

```typescript
// After audienceIds:
/** Selected categories: { id, name, iabCode } from Niche Targeting step. */
selectedCategories: Array<{ id: string; name: string; iabCode: string }>;
/** Selected tags: { id, name } from Niche Targeting step. */
selectedTags: Array<{ id: string; name: string }>;
/** IAB vertical code (denormalized from vertical object). */
iabVerticalCode: string;
```

**Design note:** We use `Array<{ id, name, ... }>` instead of parallel arrays (`categoryIds[]` + `iabCategoryCodes[]`) to avoid desync bugs. Derived values (`categoryIds`, `iabCategoryCodes`, `tagIds`) are computed at submit time from these arrays.

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: Errors in files that reference `WizardFormData` without the new fields (wizard/page.tsx DEFAULT_FORM). This is expected — we fix it in Task 3.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/types/dashboard.ts
git commit -m "feat(wizard): add niche targeting fields to WizardFormData"
```

---

## Task 2: Create API proxy routes

**Files:**
- Create: `services/dashboard/src/app/api/categories/route.ts`
- Create: `services/dashboard/src/app/api/tags/route.ts`
- Create: `services/dashboard/src/app/api/bundles/route.ts`

These follow the exact same pattern as existing `/api/verticals/route.ts` and `/api/audiences/route.ts`.

- [ ] **Step 1: Create categories proxy route**

```typescript
// services/dashboard/src/app/api/categories/route.ts
import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const verticalId = searchParams.get("vertical_id") ?? "";
    const qs = verticalId
      ? `?vertical_id=${verticalId}&active=true&page_size=100`
      : "?active=true&page_size=100";
    const res = await fetch(`${AGGREGATOR_URL}/api/categories${qs}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data: unknown = await res.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("[categories] error:", error);
    return NextResponse.json([], { status: 500 });
  }
}
```

- [ ] **Step 2: Create tags proxy route (GET + POST)**

```typescript
// services/dashboard/src/app/api/tags/route.ts
import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = request.nextUrl;
    const verticalId = searchParams.get("vertical_id") ?? "";
    const qs = new URLSearchParams({ page_size: "100", include_usage: "true" });
    if (verticalId) qs.set("vertical_id", verticalId);
    const res = await fetch(`${AGGREGATOR_URL}/api/tags?${qs.toString()}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    const data: unknown = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("[tags] GET error:", error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const res = await fetch(`${AGGREGATOR_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("[tags] POST error:", error);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Create bundles proxy route (POST for create + preview)**

```typescript
// services/dashboard/src/app/api/bundles/route.ts
import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const res = await fetch(`${AGGREGATOR_URL}/api/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("[bundles] POST error:", error);
    return NextResponse.json({ error: "Failed to create bundle" }, { status: 500 });
  }
}
```

Note: We need a separate route for `/api/bundles/preview` since it's a different path.

- [ ] **Step 4: Create bundles/preview proxy route**

```typescript
// services/dashboard/src/app/api/bundles/preview/route.ts
import { NextRequest, NextResponse } from "next/server";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const res = await fetch(`${AGGREGATOR_URL}/api/bundles/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data: unknown = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("[bundles/preview] error:", error);
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
```

- [ ] **Step 5: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS for the new route files (existing errors from Task 1 still present)

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/app/api/categories/route.ts \
       services/dashboard/src/app/api/tags/route.ts \
       services/dashboard/src/app/api/bundles/route.ts \
       services/dashboard/src/app/api/bundles/preview/route.ts
git commit -m "feat(wizard): add API proxy routes for categories, tags, bundles"
```

---

## Task 3: Add reference data hooks for categories and tags

**Files:**
- Modify: `services/dashboard/src/lib/reference-data.ts`
- Modify: `services/dashboard/src/hooks/useReferenceData.ts`

- [ ] **Step 1: Add getCategories and getTags to reference-data.ts**

Append to `services/dashboard/src/lib/reference-data.ts`:

```typescript
export interface CategoryItem {
  id: string;
  name: string;
  iab_code: string;
  vertical_id: string;
}

export interface TagItem {
  id: string;
  name: string;
  vertical_id?: string;
  usage_count?: number;
}

/** Fetch categories for a vertical. No localStorage cache — depends on verticalId param. */
export async function getCategories(verticalId: string): Promise<CategoryItem[]> {
  if (!verticalId) return [];
  const res = await fetch(`/api/categories?vertical_id=${verticalId}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string; iab_code?: string; vertical_id?: string };
      if (obj.id && obj.name) {
        return { id: obj.id, name: obj.name, iab_code: obj.iab_code ?? "", vertical_id: obj.vertical_id ?? "" };
      }
      return null;
    })
    .filter((x): x is CategoryItem => x !== null);
}

/** Fetch tags for a vertical. Includes usage_count. */
export async function getTags(verticalId: string): Promise<TagItem[]> {
  if (!verticalId) return [];
  const res = await fetch(`/api/tags?vertical_id=${verticalId}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: unknown[] };
  if (!Array.isArray(data.items)) return [];
  return data.items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string; vertical_id?: string; usage_count?: number };
      if (obj.id && obj.name) {
        return { id: obj.id, name: obj.name, vertical_id: obj.vertical_id, usage_count: obj.usage_count };
      }
      return null;
    })
    .filter((x): x is TagItem => x !== null);
}
```

- [ ] **Step 2: Add useCategories and useTags hooks to useReferenceData.ts**

Append to `services/dashboard/src/hooks/useReferenceData.ts`:

```typescript
import { getCategories, getTags, type CategoryItem, type TagItem } from "@/lib/reference-data";

export function useCategories(verticalId: string): { categories: CategoryItem[]; loading: boolean } {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!verticalId) {
      setCategories([]);
      return;
    }
    setLoading(true);
    getCategories(verticalId)
      .then(setCategories)
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [verticalId]);

  return { categories, loading };
}

export function useTags(verticalId: string): { tags: TagItem[]; loading: boolean; refetch: () => void } {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!verticalId) {
      setTags([]);
      return;
    }
    setLoading(true);
    getTags(verticalId)
      .then(setTags)
      .catch(() => setTags([]))
      .finally(() => setLoading(false));
  }, [verticalId, tick]);

  function refetch(): void {
    setTick((t) => t + 1);
  }

  return { tags, loading, refetch };
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/lib/reference-data.ts \
       services/dashboard/src/hooks/useReferenceData.ts
git commit -m "feat(wizard): add categories/tags reference data hooks"
```

---

## Task 4: Build StepNicheTargeting component

**Files:**
- Create: `services/dashboard/src/components/wizard/StepNicheTargeting.tsx`

This is the largest task. The component has four sections: Vertical dropdown, Category multi-select, Tag multi-select with create, and Content Preview.

- [ ] **Step 1: Create the component file**

Key behaviors:
- **Vertical dropdown**: Uses `useVerticals()` (extended in Task 7 to return `iab_code`). Selecting a vertical shows confirmation if categories are already selected, then clears categories and tags. Stores `verticalId`, `vertical` (name), `iabVerticalCode` on formData.
- **Category multi-select**: Uses `useCategories(formData.verticalId)`. Searchable checkbox list (client-side filter). Each shows IAB code badge. Stores `selectedCategories: Array<{ id, name, iabCode }>`.
- **Tag multi-select + create**: Uses `useTags(formData.verticalId)`. Chip input with search. "Create new" option when typing non-existing name. `POST /api/tags` to create inline. Stores `selectedTags: Array<{ id, name }>`.
- **Content Preview**: `POST /api/bundles/preview` debounced 300ms on any selection change. Shows count, progress bar (ratio vs total), hints.
- **Validation**: Vertical required, at least 1 category. Tags optional. Preview is informational only.

```typescript
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
      // Fetch niche match count
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
      // Fetch total content count for progress bar (vertical-only, no category/tag filter)
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
    const v = verticals.find((v) => v.id === id);
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
        Define your site's content niche. This creates a content bundle that feeds
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
                    + Create "{tagSearch.trim()}"
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
              No matching content yet — content will be matched as it's ingested and enriched
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
```

**Implementation notes:**
- Uses `selectedCategories: Array<{ id, name, iabCode }>` and `selectedTags: Array<{ id, name }>` instead of parallel arrays — eliminates desync bugs.
- IAB vertical code is resolved client-side from extended `useVerticals()` hook (Task 7 extends it to return `iab_code`).
- Vertical change shows `window.confirm()` per spec when categories/tags are already selected.
- Progress bar fetches total content count via an empty-rules preview call (cached — only fetched once).
- "Top sources" from the spec mockup is NOT available from `POST /api/bundles/preview` (it returns `{ count }` only). Deferred to a future API enhancement.

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/wizard/StepNicheTargeting.tsx
git commit -m "feat(wizard): add StepNicheTargeting component with category/tag/preview UI"
```

---

## Task 5: Wire into wizard flow

**Files:**
- Modify: `services/dashboard/src/components/wizard/WizardShell.tsx:5`
- Modify: `services/dashboard/src/app/wizard/page.tsx`
- Modify: `services/dashboard/src/components/wizard/StepIdentity.tsx`

- [ ] **Step 1: Update STEPS array in WizardShell.tsx**

Change line 5:

```typescript
// Before:
const STEPS = ["Create Site", "Groups", "Theme", "Content Brief", "Script Vars", "Preview", "Review"] as const;

// After:
const STEPS = ["Create Site", "Niche Targeting", "Groups", "Theme", "Content Brief", "Script Vars", "Preview", "Review"] as const;
```

- [ ] **Step 2: Update wizard/page.tsx**

Add import for `StepNicheTargeting`, add default values for new fields in `DEFAULT_FORM`, insert case 1 for `StepNicheTargeting`, shift all subsequent cases by +1:

```typescript
// Add import:
import { StepNicheTargeting } from "@/components/wizard/StepNicheTargeting";

// Update DEFAULT_FORM — add after existing fields:
selectedCategories: [],
selectedTags: [],
iabVerticalCode: "",

// In the switch statement:
// case 0: StepIdentity (unchanged)
// case 1: StepNicheTargeting (NEW)
// case 2: StepGroups (was case 1)
// case 3: StepTheme (was case 2)
// case 4: StepContentBrief (was case 3)
// case 5: StepScriptVars (was case 4)
// case 6: StepPreview (was case 5)
// case 7: StepGoLive (was case 6)
```

- [ ] **Step 3: Remove Vertical dropdown from StepIdentity.tsx**

Remove the `useVerticals` import and the Vertical `<Select>` component. The "Company" field should take the full width (change from `grid-cols-2` to single column or keep the grid with company alone).

Specifically:
- Remove: `import { useVerticals } from "@/hooks/useReferenceData";`
- Remove: `const { verticals } = useVerticals();`
- Remove: The Vertical `<Select>` block (lines ~137-145)
- Keep: The Company `<Select>` — change its container from `grid grid-cols-2 gap-4` to just a single column

- [ ] **Step 4: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/components/wizard/WizardShell.tsx \
       services/dashboard/src/app/wizard/page.tsx \
       services/dashboard/src/components/wizard/StepIdentity.tsx
git commit -m "feat(wizard): wire NicheTargeting step into wizard flow at position 2"
```

---

## Task 6: Add bundle auto-creation to wizard submit

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts`

This is the critical backend change. On wizard submit, after creating the site, we auto-create a bundle via the Content Aggregator API.

- [ ] **Step 1: Add bundle creation logic to createSiteAndBuildStaging**

Add at the top of `wizard.ts`:

```typescript
const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";
```

Add a new helper function:

```typescript
/** Create a content bundle on the aggregator. Handles 409 duplicate by appending " (2)". */
async function createBundle(
  name: string,
  verticalId: string,
  categoryIds: string[],
  tagIds: string[],
): Promise<{ id: string; name: string } | null> {
  const payload = {
    name,
    description: `Auto-created content bundle for ${name}`,
    active: true,
    rules: {
      vertical_ids: [verticalId],
      category_ids: categoryIds,
      tag_ids: tagIds,
    },
  };

  try {
    let res = await fetch(`${AGGREGATOR_URL}/api/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Handle 409 (duplicate name) — retry with " (2)" suffix
    if (res.status === 409) {
      payload.name = `${name} (2)`;
      res = await fetch(`${AGGREGATOR_URL}/api/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (res.status === 201) {
      return (await res.json()) as { id: string; name: string };
    }
    console.error("[wizard] Bundle creation failed:", res.status);
    return null;
  } catch (err) {
    console.error("[wizard] Bundle creation error:", err);
    return null;
  }
}
```

**Restructured approach** — to avoid a double-commit to the staging branch (which would trigger two CF Pages builds), we create the bundle BEFORE the initial `commitSiteFiles` call and include `bundle_id` in the first commit:

```typescript
// Inside createSiteAndBuildStaging, BEFORE step 4 (prepare files):
// Derive ID arrays from the object arrays on WizardFormData
const categoryIds = data.selectedCategories.map((c) => c.id);
const tagIds = data.selectedTags.map((t) => t.id);
const iabCategoryCodes = data.selectedCategories.map((c) => c.iabCode).filter(Boolean);

// Create bundle BEFORE first commit (so bundle_id can be included in site.yaml)
let bundleId: string | undefined;
if (data.verticalId && categoryIds.length > 0) {
  const bundle = await createBundle(data.siteName, data.verticalId, categoryIds, tagIds);
  if (bundle) bundleId = bundle.id;
}

// Then in the siteConfig object literal, add these fields:
const siteConfig = {
  // ... existing fields ...
  bundle_id: bundleId || undefined,
  iab_vertical_code: data.iabVerticalCode || undefined,
  iab_category_codes: iabCategoryCodes.length > 0 ? iabCategoryCodes : undefined,
  brief: {
    // ... existing brief fields ...
    vertical_id: data.verticalId || undefined,
    category_ids: categoryIds.length > 0 ? categoryIds : undefined,
    tag_ids: tagIds.length > 0 ? tagIds : undefined,
  },
};
```

This way, `bundle_id` is part of the initial site.yaml commit — no second commit needed. If bundle creation fails (aggregator down), `bundle_id` is `undefined` and omitted from YAML.

**Important design decision:** Bundle creation is best-effort. If the aggregator is down, the site still gets created without a `bundle_id`. The bundle can be attached later via the site detail page (future backlog item).

- [ ] **Step 2: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/actions/wizard.ts
git commit -m "feat(wizard): auto-create content bundle on site creation submit"
```

---

## Task 7: Extend verticals API proxy to include iab_code

**Files:**
- Modify: `services/dashboard/src/app/api/verticals/route.ts` (no change needed — already forwards full response)
- Modify: `services/dashboard/src/lib/reference-data.ts` — extend `ReferenceItem` or add `iab_code` to vertical items

Currently `extractItems()` only extracts `{ id, name }`. The verticals response includes `iab_code` but it's discarded. We need it for the Niche Targeting step to pass `iabVerticalCode` to the form.

- [ ] **Step 1: Create VerticalItem type and update getVerticals**

Add to `reference-data.ts`:

```typescript
export interface VerticalItem extends ReferenceItem {
  iab_code: string;
}
```

**Important:** Bump the cache key from `atl:verticals` to `atl:verticals:v2` so browsers with stale cached data (missing `iab_code`) refetch from the API instead of returning objects without `iab_code`.

Update `getVerticals` to return `VerticalItem[]` and preserve `iab_code`:

```typescript
// Change cache key at top of file:
const CACHE_KEY_VERTICALS = "atl:verticals:v2";

export async function getVerticals(): Promise<VerticalItem[]> {
  const cached = getCached(CACHE_KEY_VERTICALS);
  if (cached) return cached as VerticalItem[];
  const res = await fetch("/api/verticals");
  if (!res.ok) return [];
  const data: unknown = await res.json();
  const items = (data as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const list = items
    .map((d: unknown) => {
      const obj = d as { id?: string; name?: string; iab_code?: string };
      if (obj.id && obj.name) {
        return { id: obj.id, name: obj.name, iab_code: obj.iab_code ?? "" };
      }
      return null;
    })
    .filter((x): x is VerticalItem => x !== null);
  if (list.length > 0) setCache(CACHE_KEY_VERTICALS, list);
  return list;
}
```

- [ ] **Step 2: Update useVerticals hook return type**

```typescript
export function useVerticals(): { verticals: VerticalItem[]; loading: boolean } {
  const [verticals, setVerticals] = useState<VerticalItem[]>([]);
  // ... rest stays the same
}
```

- [ ] **Step 3: Update StepNicheTargeting to use iab_code**

In `handleVerticalChange`:

```typescript
function handleVerticalChange(id: string): void {
  const v = verticals.find((v) => v.id === id);
  onChange({
    verticalId: id,
    vertical: v?.name ?? "",
    iabVerticalCode: v?.iab_code ?? "",
    categoryIds: [],
    iabCategoryCodes: [],
    tagIds: [],
    tagNames: [],
  });
}
```

Also update the Vertical `<Select>` to show IAB code as hint text below it:

```tsx
{data.verticalId && data.iabVerticalCode && (
  <p className="text-xs text-[var(--text-muted)] -mt-1">
    IAB: {verticals.find(v => v.id === data.verticalId)?.name} ({data.iabVerticalCode})
  </p>
)}
```

- [ ] **Step 4: Update StepIdentity to use VerticalItem type (if still importing useVerticals)**

After removing the Vertical dropdown in Task 5, StepIdentity no longer uses `useVerticals`, so this should be a no-op. Verify.

- [ ] **Step 5: Verify typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/lib/reference-data.ts \
       services/dashboard/src/hooks/useReferenceData.ts \
       services/dashboard/src/components/wizard/StepNicheTargeting.tsx
git commit -m "feat(wizard): expose iab_code from verticals for niche targeting"
```

---

## Task 8: Final integration verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS across all packages

- [ ] **Step 2: Manual smoke test checklist**

If `cloudgrid dev` is available, verify:
1. Navigate to `/wizard`
2. Fill step 1 (Create Site) — Vertical dropdown should be GONE
3. Click Next → Step 2 "Niche Targeting" appears
4. Select a vertical → categories load
5. Search categories → client-side filter works
6. Select 2+ categories → count badge updates
7. Type in tag search → existing tags appear
8. Type non-existing tag → "Create" option appears
9. Content Preview shows article count (or "no content yet")
10. Click Next → proceeds to Groups (step 3)
11. Complete wizard to Review → submit creates site + bundle

- [ ] **Step 3: Commit any fixes**

---

## Dependency graph

```
Task 1 (types) ──┬── Task 7 (verticals iab) ──┬── Task 4 (StepNicheTargeting)
                  │                             │
Task 2 (API routes) ───────────────────────────┤
                  │                             │
Task 3 (hooks) ──┘─────────────────────────────┘
                                                     │
                                                Task 5 (wire into wizard)
                                                     │
                                                Task 6 (bundle auto-creation)
                                                     │
                                                Task 8 (integration verification)
```

**Execution order:**
- Tasks 1, 2, 3 can run in **parallel** (no dependencies between them).
- Task 7 depends on Tasks 1 + 3 (modifies types and reference-data).
- Task 4 depends on Tasks 2, 3, 7 (needs API routes, hooks, and extended verticals type).
- Task 5 depends on Task 4 (component must exist to wire in).
- Task 6 depends on Task 5 (form data must flow through).
- Task 8 depends on all (integration verification).

---

## Known limitations

- **Category pagination**: We fetch `page_size=100` (API max). Most verticals have well under 100 categories, but some could exceed this. If a vertical has >100 categories, only the first page is shown. Fix: add a "Load more" button or paginate, or request API increase to `page_size=200`. Low priority — 466 total categories across ~36 verticals means ~13 average per vertical.
- **"Top sources" not shown**: The spec mockup shows "Top sources: TechCrunch (12), PetMD (9)" in the preview. The `POST /api/bundles/preview` endpoint only returns `{ count }`. Displaying top sources would require a separate API call or an API enhancement.

## Out of scope (see backlog)

- Bundle lifecycle hooks (deactivate/delete/rename with site) — Phase 2
- Content agent integration (fetch by `bundle_id` instead of `vertical_id`) — Phase 3
- Ad-tech IAB metadata (sellers.json, GPT slots, Prebid) — Phase 4
- Editing niche targeting on existing sites (site detail page) — backlog
- Migration script to create bundles for existing sites — backlog
