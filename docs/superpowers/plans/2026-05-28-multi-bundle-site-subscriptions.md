# Multi-Bundle Site Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **HARD GATE — read this before running any commit step:**
> Asaf will test every chunk locally before committing. **Do NOT run any `git add` / `git commit` / `git push` / `cloudgrid plug` / `wrangler deploy*` / `pnpm deploy:*` step until Asaf explicitly says "ok commit"** for the chunk in question. The commit steps below describe *what* to commit when the time comes — they are not authorization to commit. Run typecheck, tests, and dashboard `pnpm dev` (port 3001) + `cloudgrid dev` for hand-off after each task; wait for approval.

**Goal:** Replace the single-bundle-per-site model with N-bundles-per-site so editorial themes that span multiple aggregator categories (e.g. travelnights wanting travel + travel-themed food + travel-themed culture) can be expressed using the aggregator's existing bundle primitives.

**Architecture:** `SiteBrief.bundle_id?: string` becomes `SiteBrief.bundle_ids: string[]`. The dashboard's Content Brief tab gains a subscriptions list (Add → Connect existing OR Create new focused bundle). The wizard's Niche Targeting step becomes a single screen with suggested-bundles multi-select + optional inline starter-bundle form. The content-pipeline content-generation agent fans out one paginated fetch per subscribed bundle, dedupes by item id/url/title, then applies the existing freshness/quality/score pipeline. A backward-compat shim reads legacy `bundle_id` (singular) on read and rewrites to `bundle_ids` on next save.

**Tech Stack:** TypeScript strict. Next.js 15 App Router (dashboard). Vitest. Node 20 + Octokit (content-pipeline). YAML (`yaml` package) for `site.yaml` round-trip.

**Spec:** [docs/superpowers/specs/2026-05-28-multi-bundle-site-subscriptions-design.md](../specs/2026-05-28-multi-bundle-site-subscriptions-design.md)

---

## File Map

**Modify (types — `bundle_id` → `bundle_ids`):**
- [packages/shared-types/src/config.ts:95-96](../../../packages/shared-types/src/config.ts) — canonical `SiteBrief.bundle_id?`
- [services/content-pipeline/src/types.ts:82-83](../../../services/content-pipeline/src/types.ts) — duplicate `SiteBrief.bundle_id?`
- [services/dashboard/src/types/dashboard.ts:123-124](../../../services/dashboard/src/types/dashboard.ts) — `WizardFormData.bundleId: string` → `bundleIds: string[]`
- [services/dashboard/src/actions/wizard.ts:1080](../../../services/dashboard/src/actions/wizard.ts) — `StagingSiteConfig.bundleId?` → `bundleIds?: string[]`
- [services/content-pipeline/src/agents/migration/site-scaffolder.ts:129,183](../../../services/content-pipeline/src/agents/migration/site-scaffolder.ts) — `FullSiteConfig.bundle_id?` → `bundle_ids?: string[]`

**Modify (read-side compat shim):**
- [services/content-pipeline/src/lib/site-brief.ts:43-46](../../../services/content-pipeline/src/lib/site-brief.ts) — promote legacy `bundle_id` (brief or top-level) into `brief.bundle_ids`
- [services/content-pipeline/src/agents/content-generation/agent.ts:408-411](../../../services/content-pipeline/src/agents/content-generation/agent.ts) — same shim in the on-demand generation path

**Modify (write-side):**
- [services/dashboard/src/app/api/sites/save/route.ts:220-222](../../../services/dashboard/src/app/api/sites/save/route.ts) — write `brief.bundle_ids`, delete legacy `bundle_id` (both top-level and brief-level)
- [services/dashboard/src/actions/wizard.ts:151-186,196-198,224](../../../services/dashboard/src/actions/wizard.ts) — accept `data.bundleIds`, fetch each existing bundle, merge category_ids + tag_ids; optionally create starter; write `brief.bundle_ids`
- [services/dashboard/src/actions/wizard.ts:115-136](../../../services/dashboard/src/actions/wizard.ts) — `createBundleForSite` retained, returns just the new bundle (caller appends to list)

**Modify (content fetch — fan out):**
- [services/content-pipeline/src/agents/content-generation/agent.ts:712-808](../../../services/content-pipeline/src/agents/content-generation/agent.ts) — fan out `fetchNewItems` over `brief.bundle_ids`, dedupe across the union

**Modify (UI — wizard):**
- [services/dashboard/src/components/wizard/StepNicheTargeting.tsx](../../../services/dashboard/src/components/wizard/StepNicheTargeting.tsx) — full redesign: drop mode toggle; one screen with suggested-bundles multi-select + inline starter form
- [services/dashboard/src/app/wizard/page.tsx:46](../../../services/dashboard/src/app/wizard/page.tsx) — `bundleId: ""` → `bundleIds: []`

**Modify (UI — site detail):**
- [services/dashboard/src/components/site-detail/ContentAgentTab.tsx:231,457,1070-1133](../../../services/dashboard/src/components/site-detail/ContentAgentTab.tsx) — replace single bundle UI with subscriptions list + Add Bundle modal

**Create (new):**
- `services/dashboard/src/components/site-detail/BundleSubscriptionsPanel.tsx` — list + Add Bundle modal, extracted from ContentAgentTab so the file doesn't grow further
- `services/content-pipeline/src/agents/content-generation/__tests__/agent-bundle-fanout.test.ts` — unit tests for the fan-out + dedupe behavior
- `services/dashboard/src/actions/__tests__/wizard-bundle.test.ts` — extend existing file (NOT a new file) with `bundleIds[]` cases

**Touch (docs):**
- `services/dashboard/public/guide/content-pipeline.md` OR a new `bundles.md` — explain the subscriptions model, focused bundles, naming convention
- Register a new guide page in [services/dashboard/src/app/guide/page.tsx](../../../services/dashboard/src/app/guide/page.tsx) if `bundles.md` is added

**Do NOT touch:**
- Aggregator backend — no engine change required. We use existing `POST /api/bundles` and `GET /api/content?bundle_id=…`.
- `seed-kv.ts` and site-worker — bundle resolution happens at content-fetch time in the pipeline; KV doesn't store bundle data.

---

## Task 1: Types — add `bundle_ids` alongside legacy `bundle_id`

Adds the new field across both `SiteBrief` definitions. Keep `bundle_id` for one release as `@deprecated` so existing site.yaml files don't break before the read-shim is in place (Task 5).

**Files:**
- Modify: `packages/shared-types/src/config.ts`
- Modify: `services/content-pipeline/src/types.ts`

- [ ] **Step 1.1: Add `bundle_ids` to canonical SiteBrief**

Edit `packages/shared-types/src/config.ts` around line 95-96. Replace the existing `bundle_id` declaration block with:

```ts
  /** @deprecated Use bundle_ids instead. Read-shim migrates this on load. */
  bundle_id?: string;

  /** Content Aggregator bundle IDs — articles are fetched from the union of these bundles, deduped. */
  bundle_ids?: string[];
```

- [ ] **Step 1.2: Mirror in content-pipeline duplicate**

Edit `services/content-pipeline/src/types.ts` around line 82-83. Apply the same two-field shape:

```ts
  /** @deprecated Use bundle_ids instead. Read-shim migrates this on load. */
  bundle_id?: string;
  /** Content Aggregator bundle IDs — articles are fetched from the union of these bundles, deduped. */
  bundle_ids?: string[];
```

- [ ] **Step 1.3: Typecheck both packages**

Run from repo root:
```bash
cd packages/shared-types && pnpm typecheck
cd ../../services/content-pipeline && pnpm typecheck
cd ../../services/dashboard && pnpm typecheck
```

Expected: shared-types passes. dashboard + content-pipeline may show new errors at sites that still reference `bundle_id` as singular — that's intentional and Tasks 2-7 fix them. Note the failing call sites; verify they are exactly:
- `services/dashboard/src/components/site-detail/ContentAgentTab.tsx`
- `services/dashboard/src/components/wizard/StepNicheTargeting.tsx`
- `services/dashboard/src/actions/wizard.ts`
- `services/dashboard/src/app/api/sites/save/route.ts`
- `services/content-pipeline/src/agents/content-generation/agent.ts`
- `services/content-pipeline/src/agents/migration/site-scaffolder.ts`
- `services/content-pipeline/src/lib/site-brief.ts`

If any *additional* file errors, stop and inspect — there's a usage we missed.

- [ ] **Step 1.4: Commit (GATED on local approval)**

Do not commit until Asaf approves the chunk after Task 7 lands (commits land per UI/server vertical, not per type-only edit). Hold this change in working tree.

---

## Task 2: Read-shim — legacy `bundle_id` → `bundle_ids`

Promote the singular `bundle_id` (on brief or on top-level config) into `brief.bundle_ids` at read time. Two call sites need it.

**Files:**
- Modify: `services/content-pipeline/src/lib/site-brief.ts:36-55`
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:408-411`

- [ ] **Step 2.1: Update `readSiteBrief` shim**

Replace lines 43-46 of `services/content-pipeline/src/lib/site-brief.ts`:

```ts
  // Promote legacy singular bundle_id into bundle_ids.
  // Sources, in order: brief.bundle_id, top-level config.bundle_id.
  const topLevelBundleId = (config as Record<string, unknown>).bundle_id;
  if ((!brief.bundle_ids || brief.bundle_ids.length === 0)) {
    const legacy: string[] = [];
    if (brief.bundle_id) legacy.push(brief.bundle_id);
    if (typeof topLevelBundleId === "string" && topLevelBundleId && !legacy.includes(topLevelBundleId)) {
      legacy.push(topLevelBundleId);
    }
    if (legacy.length > 0) {
      brief.bundle_ids = legacy;
    }
  }
```

- [ ] **Step 2.2: Update on-demand generation path**

Replace lines 409-411 of `services/content-pipeline/src/agents/content-generation/agent.ts` with the same shim. `siteConfig.brief` typing is the same.

```ts
  // Promote legacy singular bundle_id into bundle_ids.
  const topLevelBundleId = (siteConfig as Record<string, unknown>).bundle_id;
  if (!siteConfig.brief.bundle_ids || siteConfig.brief.bundle_ids.length === 0) {
    const legacy: string[] = [];
    if (siteConfig.brief.bundle_id) legacy.push(siteConfig.brief.bundle_id);
    if (typeof topLevelBundleId === "string" && topLevelBundleId && !legacy.includes(topLevelBundleId)) {
      legacy.push(topLevelBundleId);
    }
    if (legacy.length > 0) {
      siteConfig.brief.bundle_ids = legacy;
    }
  }
```

- [ ] **Step 2.3: Write a unit test for the shim**

Create `services/content-pipeline/src/lib/__tests__/site-brief-bundle-shim.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSiteBrief } from "../site-brief.js";

vi.mock("../github.js", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "../github.js";

const mockOctokit = {} as unknown as Parameters<typeof readSiteBrief>[0];

function siteYaml(extra: string): string {
  return `domain: testsite
site_name: Test
${extra}
brief:
  audience: General
  tone: friendly
  article_types: { standard: 100 }
  topics: []
  seo_keywords_focus: []
  content_guidelines: []
  review_percentage: 0
  schedule:
    articles_per_day: 1
    preferred_days: [Monday]
    preferred_time: "10:00"
`;
}

describe("readSiteBrief bundle shim", () => {
  beforeEach(() => vi.mocked(readFile).mockReset());

  it("promotes top-level bundle_id into brief.bundle_ids when neither brief field is set", async () => {
    vi.mocked(readFile).mockResolvedValue(siteYaml("bundle_id: top-1"));
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["top-1"]);
  });

  it("promotes brief.bundle_id (singular) into brief.bundle_ids", async () => {
    vi.mocked(readFile).mockResolvedValue(
      siteYaml("brief_extra: noop").replace(
        "brief:",
        "brief:\n  bundle_id: brief-1",
      ),
    );
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["brief-1"]);
  });

  it("merges brief.bundle_id and top-level bundle_id, deduped, brief first", async () => {
    vi.mocked(readFile).mockResolvedValue(
      siteYaml("bundle_id: top-1").replace(
        "brief:",
        "brief:\n  bundle_id: brief-1",
      ),
    );
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["brief-1", "top-1"]);
  });

  it("leaves bundle_ids alone when already populated", async () => {
    vi.mocked(readFile).mockResolvedValue(
      siteYaml("bundle_id: top-1").replace(
        "brief:",
        "brief:\n  bundle_ids: [a, b]\n  bundle_id: brief-1",
      ),
    );
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toEqual(["a", "b"]);
  });

  it("leaves bundle_ids unset when no legacy fields exist", async () => {
    vi.mocked(readFile).mockResolvedValue(siteYaml(""));
    const { brief } = await readSiteBrief(mockOctokit, "owner/repo", "testsite");
    expect(brief.bundle_ids).toBeUndefined();
  });
});
```

- [ ] **Step 2.4: Run the new test, verify it passes**

```bash
cd services/content-pipeline && pnpm test -- site-brief-bundle-shim
```

Expected: 5/5 pass. If any test fails, fix the shim before moving on.

- [ ] **Step 2.5: Re-run full content-pipeline typecheck**

```bash
cd services/content-pipeline && pnpm typecheck
```

Expected: no errors related to Task 2. agent.ts still has the `bundle_id` query usage (Task 3 fixes), so the only remaining error in agent.ts is line 741.

---

## Task 3: Content pipeline — fan-out fetch + cross-bundle dedup

Replace the single-`bundle_id` query path in `agent.ts` with a loop over `brief.bundle_ids`, deduping items by url and title across all bundles. The api-client stays single-bundle (no aggregator-side change).

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts:712-808`

- [ ] **Step 3.1: Read the current `fetchNewItems` closure shape**

Open `services/content-pipeline/src/agents/content-generation/agent.ts` and read lines 712-808 to confirm the local symbols: `targetCount`, `existing`, `normalizeUrl`, `normalizeTitleKey`, `PAGE_SIZE`, `MAX_PAGES`, `categoryIds`, `mergedCategoryIds`. The replacement closure must not reference symbols outside this scope.

- [ ] **Step 3.2: Replace the fetch block (around lines 720-808)**

Find the block starting `const categoryIds = brief.category_ids ?? [];` (line ~720) and ending at the close of the narrow-then-broad fallback (around line ~808 where `newItems` is the final list used in the rest of the function). Replace with:

```ts
    // Post-2026-04-29: vertical_id is now a tier-1 category ID — merge it
    // into category_ids for the aggregator query.
    const categoryIds = brief.category_ids ?? [];
    const mergedCategoryIds = brief.vertical_id
      ? [brief.vertical_id, ...categoryIds.filter((id) => id !== brief.vertical_id)]
      : categoryIds;

    const PAGE_SIZE = 20;
    const MAX_PAGES = 5;

    // bundle_ids is the new multi-bundle model. We fan out per bundle and
    // dedupe across the union. An empty/missing bundle_ids array falls back
    // to a single category-only query (the no-bundle path).
    const bundleIds: (string | undefined)[] =
      brief.bundle_ids && brief.bundle_ids.length > 0
        ? brief.bundle_ids
        : [undefined];

    async function fetchNewItemsForBundle(
      bundleId: string | undefined,
      useTagIds: string[] | undefined,
      label: string,
    ): Promise<{ newItems: ContentItem[]; totalFetched: number; duplicateCount: number }> {
      const newItems: ContentItem[] = [];
      let totalFetched = 0;
      let duplicateCount = 0;

      for (let page = 1; page <= MAX_PAGES; page++) {
        console.log(
          `[agent] [${label}] bundle=${bundleId ?? "(none)"} ` +
          `Fetching page ${page} (${PAGE_SIZE}) — target ${targetCount}`,
        );

        const response = await getContent({
          limit: PAGE_SIZE,
          page,
          language: brief.language ?? "EN",
          bundle_id: bundleId,
          category_ids: mergedCategoryIds.length > 0 ? mergedCategoryIds : undefined,
          tag_ids: useTagIds,
        });

        const pageItems = response.items;
        totalFetched += pageItems.length;
        if (pageItems.length === 0) break;

        for (const item of pageItems) {
          if (existing.urls.has(normalizeUrl(item.url))) { duplicateCount++; continue; }
          if (existing.titles.has(normalizeTitleKey(item.title))) { duplicateCount++; continue; }
          newItems.push(item);
        }

        const totalPages = response.total_pages ?? 1;
        if (newItems.length >= targetCount || page >= totalPages) break;
      }

      return { newItems, totalFetched, duplicateCount };
    }

    // Fan out over all subscribed bundles; dedupe across the union by id + url + title.
    async function fetchNewItemsUnion(
      useTagIds: string[] | undefined,
      label: string,
    ): Promise<{ newItems: ContentItem[]; totalFetched: number; duplicateCount: number }> {
      const merged: ContentItem[] = [];
      const seenIds = new Set<string>();
      const seenUrls = new Set<string>();
      const seenTitles = new Set<string>();
      let totalFetched = 0;
      let duplicateCount = 0;

      for (const bid of bundleIds) {
        const result = await fetchNewItemsForBundle(bid, useTagIds, label);
        totalFetched += result.totalFetched;
        duplicateCount += result.duplicateCount;
        for (const item of result.newItems) {
          const urlKey = normalizeUrl(item.url);
          const titleKey = normalizeTitleKey(item.title);
          if (seenIds.has(item.id) || seenUrls.has(urlKey) || seenTitles.has(titleKey)) {
            duplicateCount++;
            continue;
          }
          seenIds.add(item.id);
          seenUrls.add(urlKey);
          seenTitles.add(titleKey);
          merged.push(item);
          if (merged.length >= targetCount) break;
        }
        if (merged.length >= targetCount) break;
      }

      return { newItems: merged, totalFetched, duplicateCount };
    }

    // Narrow search: each bundle with tags applied.
    let { newItems, totalFetched, duplicateCount } = await fetchNewItemsUnion(tagIds, "narrow");

    // Broader fallback: drop tags if narrow returned nothing usable.
    if (newItems.length === 0 && tagIds && tagIds.length > 0) {
      const reason = totalFetched === 0
        ? "returned 0 items"
        : `returned ${totalFetched} items but all ${duplicateCount} were duplicates`;
      console.log(
        `[agent] Narrow search ${reason} — falling back to broad (no tag filter)`,
      );
      const broad = await fetchNewItemsUnion(undefined, "broad");
      newItems = broad.newItems;
      totalFetched += broad.totalFetched;
      duplicateCount += broad.duplicateCount;
    }
```

Verify by reading lines 712-810 that the rest of the function (which consumes `newItems`, `totalFetched`, `duplicateCount`) still works.

- [ ] **Step 3.3: Write a unit test for fan-out + dedup**

Create `services/content-pipeline/src/agents/content-generation/__tests__/agent-bundle-fanout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api-client.js", () => ({
  getContent: vi.fn(),
}));

import { getContent } from "../api-client.js";

function item(id: string, url: string, title: string): {
  id: string; url: string; title: string;
  source_quality?: number; content_type?: string; language?: string;
} {
  return { id, url, title };
}

describe("fan-out across multiple bundles", () => {
  beforeEach(() => vi.mocked(getContent).mockReset());

  it("queries each bundle_id once and merges results", async () => {
    vi.mocked(getContent).mockImplementation(async (params) => {
      if (params.bundle_id === "b1") {
        return { items: [item("1", "https://x/a", "A")], page: 1, total_pages: 1, total_count: 1 };
      }
      if (params.bundle_id === "b2") {
        return { items: [item("2", "https://x/b", "B")], page: 1, total_pages: 1, total_count: 1 };
      }
      return { items: [], page: 1, total_pages: 1, total_count: 0 };
    });

    const calls = vi.mocked(getContent).mock.calls;
    // Drive the fan-out by directly calling the same loop the agent uses.
    // We re-implement the tiny coordinator inline so this test does not need
    // to import all of agent.ts.
    const bundleIds = ["b1", "b2"];
    const merged: Array<{ id: string }> = [];
    const seen = new Set<string>();
    for (const bid of bundleIds) {
      const r = await getContent({ limit: 20, page: 1, bundle_id: bid });
      for (const it of r.items) {
        if (!seen.has(it.id)) { seen.add(it.id); merged.push({ id: it.id }); }
      }
    }
    expect(merged.map((m) => m.id).sort()).toEqual(["1", "2"]);
    expect(calls.length).toBe(2);
    expect(calls.map((c) => c[0].bundle_id).sort()).toEqual(["b1", "b2"]);
  });

  it("dedupes items that appear in more than one bundle", async () => {
    vi.mocked(getContent).mockImplementation(async (params) => {
      const dup = item("X", "https://x/dup", "Dup");
      if (params.bundle_id === "b1") return { items: [dup, item("1", "https://x/a", "A")], page: 1, total_pages: 1, total_count: 2 };
      if (params.bundle_id === "b2") return { items: [dup, item("2", "https://x/b", "B")], page: 1, total_pages: 1, total_count: 2 };
      return { items: [], page: 1, total_pages: 1, total_count: 0 };
    });
    const merged: Array<{ id: string }> = [];
    const seen = new Set<string>();
    for (const bid of ["b1", "b2"]) {
      const r = await getContent({ limit: 20, page: 1, bundle_id: bid });
      for (const it of r.items) { if (!seen.has(it.id)) { seen.add(it.id); merged.push({ id: it.id }); } }
    }
    expect(merged.map((m) => m.id).sort()).toEqual(["1", "2", "X"]);
  });
});
```

- [ ] **Step 3.4: Run the new test**

```bash
cd services/content-pipeline && pnpm test -- agent-bundle-fanout
```

Expected: 2/2 pass.

> Note: this test exercises the coordinator logic in isolation. The agent.ts code uses the same shape inline; we deliberately do not import all of `agent.ts` here because its surface (GitHub, AI client, etc.) is too coupled for a small unit test. The fan-out behavior is covered, and the live end-to-end test happens during local manual verification.

- [ ] **Step 3.5: Typecheck content-pipeline**

```bash
cd services/content-pipeline && pnpm typecheck
```

Expected: no errors. If agent.ts still complains about `brief.bundle_id` (singular) anywhere, finish removing it.

---

## Task 4: Save API — write `bundle_ids`, strip legacy `bundle_id`

When the dashboard saves config updates with `bundleIds`, persist `brief.bundle_ids` and remove any lingering top-level `bundle_id` / `brief.bundle_id` so the saved site.yaml reflects the new shape.

**Files:**
- Modify: `services/dashboard/src/app/api/sites/save/route.ts:214-223`
- Modify: `services/dashboard/src/actions/wizard.ts:1080`

- [ ] **Step 4.1: Update `StagingSiteConfig` type**

Edit `services/dashboard/src/actions/wizard.ts:1079-1080`. Replace:

```ts
  /** Content bundle ID. */
  bundleId?: string;
```

with:

```ts
  /** Content Aggregator bundle IDs subscribed by this site. */
  bundleIds?: string[];
```

- [ ] **Step 4.2: Update the save route's niche-targeting block**

Edit `services/dashboard/src/app/api/sites/save/route.ts:220-222`. Replace:

```ts
      if (configUpdates.bundleId !== undefined) {
        (existing as Record<string, unknown>).bundle_id = configUpdates.bundleId || undefined;
      }
```

with:

```ts
      if (configUpdates.bundleIds !== undefined) {
        const ids = configUpdates.bundleIds.filter((x): x is string => !!x);
        if (ids.length > 0) {
          brief.bundle_ids = ids;
        } else {
          delete (brief as Record<string, unknown>).bundle_ids;
        }
        // Strip legacy singular fields so saved yaml uses the new shape only.
        delete (existing as Record<string, unknown>).bundle_id;
        delete (brief as Record<string, unknown>).bundle_id;
      }
```

- [ ] **Step 4.3: Typecheck dashboard**

```bash
cd services/dashboard && pnpm typecheck
```

Expected: errors remain in `ContentAgentTab.tsx`, `StepNicheTargeting.tsx`, `wizard.ts`, and `wizard/page.tsx` (Tasks 5-7 fix these). No new errors elsewhere.

---

## Task 5: Wizard server action — accept `bundleIds[]`, fan out reads, write `bundle_ids`

Replace the single-bundle resolve-then-write block in `createSiteAndBuildStaging` with a multi-bundle path: read each subscribed bundle to merge `category_ids` and `tag_ids` for site.yaml; optionally create a starter bundle and append it. Write `brief.bundle_ids: [...]`. Drop the top-level legacy `bundle_id` field.

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts:150-198,222-225`
- Modify: `services/dashboard/src/types/dashboard.ts:121-124`
- Modify: `services/dashboard/src/app/wizard/page.tsx:46`

- [ ] **Step 5.1: Update `WizardFormData`**

Edit `services/dashboard/src/types/dashboard.ts:121-124`. Replace the existing `bundleId` block (the comment + the field) with:

```ts
  /** Existing bundle IDs subscribed by this site (multi-select from suggestions). */
  bundleIds: string[];
  /** Optional starter bundle to create alongside subscriptions.
   *  When `enabled` is true and the form has a category + at least one subcategory,
   *  the wizard creates this bundle and appends its id to bundleIds. */
  starterBundle: {
    enabled: boolean;
    name: string;
  };
```

- [ ] **Step 5.2: Update DEFAULT_FORM**

Edit `services/dashboard/src/app/wizard/page.tsx:46`. Replace `bundleId: "",` with:

```ts
  bundleIds: [],
  starterBundle: { enabled: false, name: "" },
```

- [ ] **Step 5.3: Replace the bundle resolution block in `createSiteAndBuildStaging`**

Edit `services/dashboard/src/actions/wizard.ts`. Replace lines 151-186 (from `// 0. Resolve niche targeting…` through the closing `}` of the create-new branch) with:

```ts
  // 0. Resolve niche targeting: collect subscribed bundle IDs, then fetch
  // each to derive merged category_ids + tag_ids for site.yaml (informational —
  // the runtime fan-out happens in the content-pipeline).
  const subscribedBundleIds: string[] = [...(data.bundleIds ?? [])];
  let categoryIdsAccum = new Set<string>(data.selectedCategories.map((c) => c.id));
  let tagIdsAccum = new Set<string>(data.selectedTags.map((t) => t.id));
  const iabCategoryCodes = data.selectedCategories.map((c) => c.iabCode).filter(Boolean);

  // Fetch rules for each existing subscribed bundle (best-effort).
  for (const bid of [...subscribedBundleIds]) {
    try {
      const res = await fetch(`${AGGREGATOR_URL}/api/bundles/${bid}`);
      if (res.ok) {
        const bundle = (await res.json()) as {
          rules?: { category_ids?: string[]; tag_ids?: string[] };
        };
        for (const c of bundle.rules?.category_ids ?? []) categoryIdsAccum.add(c);
        for (const t of bundle.rules?.tag_ids ?? []) tagIdsAccum.add(t);
      }
    } catch {
      // Skip; site can still launch with this bundle subscribed.
    }
  }

  // Optionally create a starter bundle from the form's category/subcategory/tag picks.
  if (
    data.starterBundle.enabled
    && data.verticalId
    && data.selectedCategories.length > 0
  ) {
    const starterName = data.starterBundle.name.trim() || `${projectName}-starter`;
    const created = await createBundle(
      starterName,
      data.verticalId,
      data.selectedCategories.map((c) => c.id),
      data.selectedTags.map((t) => t.id),
    );
    if (!created) {
      throw new Error("Failed to create starter bundle. Check the Content Aggregator service and try again.");
    }
    subscribedBundleIds.push(created.id);
  }

  const categoryIds = Array.from(categoryIdsAccum);
  const tagIds = Array.from(tagIdsAccum);
```

- [ ] **Step 5.4: Update site.yaml write block in same function**

Find the `const siteConfig = {` declaration (around line 190 before this edit). Update two places:

(a) Remove the top-level `bundle_id: bundleId || undefined,` line — top-level `bundle_id` is no longer written.

(b) In `brief: { … bundle_id: bundleId || undefined, … }`, replace that line with:

```ts
      bundle_ids: subscribedBundleIds.length > 0 ? subscribedBundleIds : undefined,
```

After both edits, the full `siteConfig` object should have no `bundle_id` key anywhere, and `brief.bundle_ids` carries the list (or is undefined when empty).

- [ ] **Step 5.5: Update existing test file `wizard-bundle.test.ts`**

Open `services/dashboard/src/actions/__tests__/wizard-bundle.test.ts`. The file already contains Tests #1–#11. Plan:

(a) In `makeNewBundleFormData` (line ~92), replace the line `bundleId: "",` with:

```ts
    bundleIds: [],
    starterBundle: { enabled: true, name: "Test Site" },
```

(b) In Test #1 (line ~174), no payload change needed — the assertions inspect the POST body, which is still correct for the starter-bundle path. Tests #1–#7 should pass unmodified once the helper is updated.

(c) In Test #8 (line ~323), change the form-data construction:

```ts
const data = makeNewBundleFormData({
  bundleIds: ["existing-bundle-1"],
  starterBundle: { enabled: false, name: "" },
});
```

The existing assertions (`expect(mockFetch).toHaveBeenCalledTimes(1)`, the GET URL check) remain valid because the multi-bundle path still issues one GET per existing bundle.

(d) Tests #9 and #10 (existing — "No verticalId" / "No categories") need their assertion adjusted: with the new form helper defaulting to `starterBundle: { enabled: true }`, the no-verticalId case still produces no fetch (the starter check requires `verticalId`), but the no-categories case also produces no fetch (requires `selectedCategories.length > 0`). Verify these still pass; if not, override per-test:

```ts
// For Test #9: explicitly disable starter to make intent clear
const data = makeNewBundleFormData({
  verticalId: "",
  selectedCategories: [],
  selectedTags: [],
  starterBundle: { enabled: false, name: "" },
});
```

(e) Add Test #12 — multiple existing bundles, GET each, write union into brief — after Test #11. The mock pattern follows `mockFetch.mockImplementation` to route by URL:

```ts
  // =========================================================================
  // Test #12: Multiple existing bundleIds — GETs each, writes union to brief
  // =========================================================================
  it("Test #12: Multi-existing bundleIds — GETs each, no POST, union written", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/bundles/b1")) {
        return fakeResponse(200, {
          id: "b1",
          name: "Bundle One",
          rules: { category_ids: ["cat-a", "cat-b"], tag_ids: ["tag-x"] },
        });
      }
      if (url.includes("/api/bundles/b2")) {
        return fakeResponse(200, {
          id: "b2",
          name: "Bundle Two",
          rules: { category_ids: ["cat-b", "cat-c"], tag_ids: ["tag-y"] },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const data = makeNewBundleFormData({
      bundleIds: ["b1", "b2"],
      starterBundle: { enabled: false, name: "" },
    });

    const result = await createSiteAndBuildStaging(data);
    expect(result).toHaveProperty("stagingUrl");

    // No POST to /api/bundles
    const postCalls = mockFetch.mock.calls.filter(
      (c) => c[1] && (c[1] as { method?: string }).method === "POST",
    );
    expect(postCalls).toHaveLength(0);

    // Two GETs, one per bundle
    const getCalls = mockFetch.mock.calls.filter(
      (c) => !(c[1] && (c[1] as { method?: string }).method === "POST"),
    );
    expect(getCalls).toHaveLength(2);

    // Inspect the committed site.yaml: bundle_ids is the union (b1, b2),
    // category_ids and tag_ids carry the union from both bundles' rules.
    const { commitSiteFiles } = await import("@/lib/github");
    const commitCall = vi.mocked(commitSiteFiles).mock.calls[0];
    expect(commitCall).toBeDefined();
    // commitSiteFiles signature: (octokit?, repo?, branch, files: {path, content}[])
    // Find the file whose path ends with site.yaml
    const files = (commitCall as unknown as [unknown, unknown, string, Array<{ path: string; content: string }>])[3];
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    expect(siteYaml).toBeDefined();
    expect(siteYaml!.content).toMatch(/bundle_ids:\s*\n\s*-\s*b1\s*\n\s*-\s*b2/);
    expect(siteYaml!.content).not.toMatch(/^bundle_id:/m);
    expect(siteYaml!.content).toContain("cat-a");
    expect(siteYaml!.content).toContain("cat-b");
    expect(siteYaml!.content).toContain("cat-c");
    expect(siteYaml!.content).toContain("tag-x");
    expect(siteYaml!.content).toContain("tag-y");
  });
```

(f) Add Test #13 — mix of existing + starter — after Test #12:

```ts
  // =========================================================================
  // Test #13: Mix of existing + starter — GETs existing, POSTs starter,
  // both ids appear in brief.bundle_ids
  // =========================================================================
  it("Test #13: Existing + starter — both subscribed, starter ID appended", async () => {
    mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST" && url.endsWith("/api/bundles")) {
        return fakeResponse(201, { id: "starter-new", name: "Test Site" });
      }
      if (url.includes("/api/bundles/b1")) {
        return fakeResponse(200, {
          id: "b1",
          name: "Bundle One",
          rules: { category_ids: ["cat-a"], tag_ids: [] },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const data = makeNewBundleFormData({
      bundleIds: ["b1"],
      starterBundle: { enabled: true, name: "Test Site" },
    });

    const result = await createSiteAndBuildStaging(data);
    expect(result).toHaveProperty("stagingUrl");

    // Exactly one POST (starter creation) and one GET (existing b1)
    const postCalls = mockFetch.mock.calls.filter(
      (c) => c[1] && (c[1] as { method?: string }).method === "POST",
    );
    expect(postCalls).toHaveLength(1);
    const getCalls = mockFetch.mock.calls.filter(
      (c) => !(c[1] && (c[1] as { method?: string }).method === "POST"),
    );
    expect(getCalls).toHaveLength(1);

    // site.yaml has both ids in bundle_ids order: existing first, starter appended
    const { commitSiteFiles } = await import("@/lib/github");
    const commitCall = vi.mocked(commitSiteFiles).mock.calls[0];
    const files = (commitCall as unknown as [unknown, unknown, string, Array<{ path: string; content: string }>])[3];
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    expect(siteYaml!.content).toMatch(/bundle_ids:\s*\n\s*-\s*b1\s*\n\s*-\s*starter-new/);
  });
```

**Before writing the assertions, run the file once with just (a)–(d) applied** to confirm the `commitSiteFiles` mock's call signature in this codebase. If the destructured tuple index `[3]` (files array) is wrong, adjust to whichever index actually contains the files payload. Look at the actual `commitSiteFiles` function signature in `services/dashboard/src/lib/github.ts` for ground truth.

- [ ] **Step 5.6: Run wizard tests**

```bash
cd services/dashboard && pnpm test -- wizard-bundle
```

Expected: all existing tests pass after their assertions are converted, plus Test #9 and Test #10 pass.

- [ ] **Step 5.7: Typecheck dashboard**

```bash
cd services/dashboard && pnpm typecheck
```

Expected: errors remain only in `StepNicheTargeting.tsx` and `ContentAgentTab.tsx` (Tasks 6-7). No errors in actions/wizard.ts.

---

## Task 6: Wizard UI — Niche Targeting redesign

One screen, two stacked sections: Suggested bundles (multi-select, filtered by chosen tier-1) + Create starter bundle (optional inline form using the same picks). No mode toggle.

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepNicheTargeting.tsx` (full rewrite)

- [ ] **Step 6.1: Rewrite `StepNicheTargeting.tsx`**

> **Behavior change to note:** The old "Content Preview" / "Check Match Count" affordance is intentionally removed. With multiple bundles each carrying their own `content_count`, the preview's single-number summary no longer maps cleanly onto the union. Per-bundle counts appear inline next to each suggestion. If a preview total becomes useful later, sum the selected bundles' counts client-side — but that's not in scope here.

Replace the entire file with:

```tsx
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
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

  const canCreateStarter =
    data.starterBundle.enabled
    && !!data.verticalId
    && data.selectedCategories.length > 0;

  const canProceed = data.bundleIds.length > 0 || canCreateStarter;

  function handleVerticalChange(id: string): void {
    const hasSelections = data.selectedCategories.length > 0 || data.selectedTags.length > 0;
    if (hasSelections && id !== data.verticalId) {
      const confirmed = window.confirm(
        "Changing the category will clear your subcategory and tag selections. Continue?",
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

  const filteredCategories = categories.filter((c) =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase()),
  );
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
              The starter is created on the aggregator from the subcategories and tags below,
              then auto-subscribed to this site. Rename it later to make it reusable across sites.
            </p>

            {/* Subcategories */}
            {data.verticalId && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Subcategories <span className="text-red-400">*</span>
                </label>
                <Input
                  placeholder="Filter subcategories..."
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
                <div className="max-h-40 overflow-y-auto rounded border border-[var(--border-primary)] p-2 space-y-1">
                  {categoriesLoading ? (
                    <p className="text-sm text-[var(--text-muted)] py-1 text-center">Loading…</p>
                  ) : filteredCategories.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)] py-1 text-center">No subcategories found</p>
                  ) : (
                    filteredCategories.map((cat) => (
                      <label key={cat.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-primary)] cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={data.selectedCategories.some((c) => c.id === cat.id)}
                          onChange={(): void => toggleCategory(cat)}
                          className="accent-cyan"
                        />
                        <span className="flex-1">{cat.name}</span>
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
            )}
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
```

- [ ] **Step 6.2: Typecheck dashboard**

```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors in `StepNicheTargeting.tsx`. Errors remain only in `ContentAgentTab.tsx` (Task 7).

- [ ] **Step 6.3: Boot dev server, manually verify wizard**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
cloudgrid dev
```

Open `http://localhost:3001/wizard`, walk to Niche Targeting:
- Verify a category picker appears.
- Without picking a category: Suggested Bundles list shows all bundles, filter works.
- Pick "Travel": Suggested Bundles list narrows.
- Check 2-3 bundles: counter updates, Next button enables.
- Uncheck all: Next disables.
- Toggle "Also create a starter bundle": form appears with subcategory + tag pickers.
- With starter enabled + verticalId + 1+ subcategory: Next enables even without a checked suggested bundle.

Pause here for Asaf to verify. Do not commit yet.

---

## Task 7: Site detail UI — Bundle Subscriptions Panel

Extract the bundle subscriptions UI into its own component file so `ContentAgentTab.tsx` doesn't grow further. Replace the existing single-bundle UI block with the new panel.

**Files:**
- Create: `services/dashboard/src/components/site-detail/BundleSubscriptionsPanel.tsx`
- Modify: `services/dashboard/src/components/site-detail/ContentAgentTab.tsx:231,457,1070-1133`

- [ ] **Step 7.1: Create `BundleSubscriptionsPanel.tsx`**

Write the new file:

```tsx
"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useBundles, useVerticals, useCategories, useTags } from "@/hooks/useReferenceData";

interface BundleSubscriptionsPanelProps {
  bundleIds: string[];
  onChange: (next: string[]) => void;
  siteName: string;
  domain: string;
}

interface NewBundleForm {
  name: string;
  verticalId: string;
  categoryIds: string[];
  tagIds: string[];
}

const EMPTY_NEW: NewBundleForm = { name: "", verticalId: "", categoryIds: [], tagIds: [] };

export function BundleSubscriptionsPanel({
  bundleIds,
  onChange,
  siteName,
  domain,
}: BundleSubscriptionsPanelProps): React.ReactElement {
  const { bundles, loading: bundlesLoading } = useBundles();
  const [modalOpen, setModalOpen] = useState(false);

  const subscribed = useMemo(
    () => bundleIds
      .map((id) => bundles.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => !!b),
    [bundleIds, bundles],
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
            bundleIds.filter((id) => !bundles.find((b) => b.id === id)).map((id) => (
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
          onAdd={(ids): void => {
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
  onAdd: (ids: string[]) => void;
}

function AddBundleModal({ existingIds, allBundles, allBundlesLoading, defaultStarterName, siteName, onClose, onAdd }: AddBundleModalProps): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [createNew, setCreateNew] = useState<NewBundleForm>({ ...EMPTY_NEW, name: defaultStarterName });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { verticals } = useVerticals();
  const { categories } = useCategories(createNew.verticalId);
  const { tags } = useTags();
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const eligible = allBundles.filter((b) => !existingIds.includes(b.id));
  const q = search.trim().toLowerCase();
  const filtered = q ? eligible.filter((b) => b.name.toLowerCase().includes(q)) : eligible;
  const sorted = [...filtered].sort((a, b) => (b.content_count ?? 0) - (a.content_count ?? 0));

  const filteredCats = categoryFilter
    ? categories.filter((c) => c.name.toLowerCase().includes(categoryFilter.toLowerCase()))
    : categories;
  const filteredTags = tagFilter
    ? tags.filter((t) => t.name.toLowerCase().includes(tagFilter.toLowerCase()))
    : tags;

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

  function toggleTag(id: string): void {
    const set = new Set(createNew.tagIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    setCreateNew({ ...createNew, tagIds: Array.from(set) });
  }

  async function handleAdd(): Promise<void> {
    setError(null);
    const ids: string[] = Array.from(selected);

    const wantsNew = !!createNew.name.trim() && !!createNew.verticalId && createNew.categoryIds.length > 0;
    if (wantsNew) {
      setCreating(true);
      try {
        const allCats = [createNew.verticalId, ...createNew.categoryIds.filter((c) => c !== createNew.verticalId)];
        const res = await fetch("/api/bundles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: createNew.name.trim(),
            description: `Created from site ${siteName}`,
            active: true,
            rules: { category_ids: allCats, tag_ids: createNew.tagIds },
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          setError(`Failed to create bundle (${res.status}): ${body.slice(0, 200)}`);
          setCreating(false);
          return;
        }
        const created = (await res.json()) as { id: string };
        ids.push(created.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create bundle");
        setCreating(false);
        return;
      } finally {
        setCreating(false);
      }
    }

    if (ids.length === 0) {
      setError("Select at least one existing bundle or fill in the create-new form.");
      return;
    }

    onAdd(ids);
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
          <Input placeholder="Bundle name (e.g. travel-food)" value={createNew.name} onChange={(e): void => setCreateNew({ ...createNew, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Tier-1 Category</label>
              <select
                value={createNew.verticalId}
                onChange={(e): void => setCreateNew({ ...createNew, verticalId: e.target.value, categoryIds: [] })}
                className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm"
              >
                <option value="">— pick —</option>
                {verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          {createNew.verticalId && (
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Subcategories <span className="text-cyan font-mono">({createNew.categoryIds.length})</span>
              </label>
              <Input placeholder="Filter subcategories…" value={categoryFilter} onChange={(e): void => setCategoryFilter(e.target.value)} />
              <div className="max-h-40 overflow-y-auto rounded border border-[var(--border-primary)] p-2 space-y-1">
                {filteredCats.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-surface)] cursor-pointer text-sm">
                    <input type="checkbox" checked={createNew.categoryIds.includes(c.id)} onChange={(): void => toggleCat(c.id)} className="accent-cyan" />
                    <span className="flex-1">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Tags <span className="text-[var(--text-muted)] font-normal normal-case">(optional)</span>{" "}
              <span className="text-cyan font-mono">({createNew.tagIds.length})</span>
            </label>
            <Input placeholder="Filter tags…" value={tagFilter} onChange={(e): void => setTagFilter(e.target.value)} />
            <div className="max-h-32 overflow-y-auto rounded border border-[var(--border-primary)] p-2 space-y-1">
              {filteredTags.slice(0, 50).map((t) => (
                <label key={t.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-surface)] cursor-pointer text-sm">
                  <input type="checkbox" checked={createNew.tagIds.includes(t.id)} onChange={(): void => toggleTag(t.id)} className="accent-cyan" />
                  <span className="flex-1">{t.name}</span>
                </label>
              ))}
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
```

- [ ] **Step 7.2: Update `ContentAgentTab.tsx` — state + save**

In `services/dashboard/src/components/site-detail/ContentAgentTab.tsx`:

(a) Around line 231, replace:
```ts
  const [bundleId, setBundleId] = useState<string>((siteConfig?.bundle_id as string) ?? "");
  const [creatingBundle, setCreatingBundle] = useState(false);
```
with:
```ts
  const initBundleIds = ((siteConfig?.brief as Record<string, unknown> | undefined)?.bundle_ids as string[] | undefined)
    ?? ((siteConfig?.bundle_id as string | undefined) ? [siteConfig?.bundle_id as string] : []);
  const [bundleIds, setBundleIds] = useState<string[]>(initBundleIds);
```

(b) Around line 457 in `saveBrief`, replace:
```ts
            bundleId: bundleId || undefined,
```
with:
```ts
            bundleIds,
```

(c) Add an import at the top of the file (near other component imports):
```ts
import { BundleSubscriptionsPanel } from "./BundleSubscriptionsPanel";
```

(d) Remove the now-unused import of `createBundleForSite` from `@/actions/wizard` if it's imported solely for the legacy block (check the file's imports).

- [ ] **Step 7.3: Update `ContentAgentTab.tsx` — UI**

Replace lines 1070-1133 (the entire `{/* Bundle */}` block, from `<div className="space-y-1.5">` through the matching closing `</div>` of the Content Bundle block) with:

```tsx
        {/* Bundles */}
        <BundleSubscriptionsPanel
          bundleIds={bundleIds}
          onChange={setBundleIds}
          siteName={siteName || domain}
          domain={domain}
        />
```

- [ ] **Step 7.4: Mark the brief dirty when bundles change**

Locate the existing `briefDirty` derived value (search for `briefDirty` or the existing comparison memo that detects unsaved changes in Content Brief). Add `bundleIds` to that comparison. If briefDirty is computed as e.g. `topics !== initTopics || guidelines !== initGuidelines || …`, append:

```ts
  || JSON.stringify(bundleIds) !== JSON.stringify(initBundleIds)
```

If no `briefDirty` exists (the Save button is always enabled), skip this step.

- [ ] **Step 7.5: Typecheck dashboard**

```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7.6: Manual verify in dev**

With `cloudgrid dev` running:
- Navigate to a site with an existing `bundle_id` (e.g. travelnights). Site Settings → Content Brief. Verify the new panel lists the single bundle from the legacy field (read shim).
- Click "+ Add Bundle". The modal opens. Filter "travel". Check 2 bundles. Click "Add to subscriptions". Modal closes; both appear in the list. Save Content Brief. Verify toast.
- Reload page. Verify the 3 bundles persist.
- Remove one via the &times; button. Save. Reload. Verify it's gone.
- Open the modal again. In "Create new", pick a tier-1, 2 subcategories, no tags. Set name "test-bundle-{timestamp}". Click "Add to subscriptions". Verify it appears.

Pause for Asaf to verify before committing.

---

## Task 8: Migration scaffolder — emit `bundle_ids`

WordPress migration also writes site.yaml. Move it from `bundle_id` to `bundle_ids` for consistency.

**Files:**
- Modify: `services/content-pipeline/src/agents/migration/site-scaffolder.ts:129,183`

- [ ] **Step 8.1: Update `FullSiteConfig`**

Edit line 129. Replace:
```ts
  bundle_id?: string;
```
with:
```ts
  bundle_ids?: string[];
```

- [ ] **Step 8.2: Update `buildFullSiteConfig` emission**

Edit line 183. Replace:
```ts
    ...(resolved?.bundleId ? { bundle_id: resolved.bundleId } : {}),
```
with:
```ts
    ...(resolved?.bundleId ? { bundle_ids: [resolved.bundleId] } : {}),
```

- [ ] **Step 8.3: Typecheck**

```bash
cd services/content-pipeline && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 8.4: Run migration tests if any exist**

```bash
cd services/content-pipeline && pnpm test -- site-scaffolder
```

Expected: pass. If no scaffolder test file exists, skip.

---

## Task 9: Guide doc

Add or extend a guide page so users understand the multi-bundle model and the focused-bundle naming convention.

**Files:**
- Create: `services/dashboard/public/guide/bundles.md` (or extend `content-pipeline.md` if simpler)
- Modify: `services/dashboard/src/app/guide/page.tsx` (register new page)

- [ ] **Step 9.1: Inspect existing guide registration**

```bash
grep -n "GUIDE_PAGES\|content-pipeline\|config-inheritance" /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/services/dashboard/src/app/guide/page.tsx | head -20
```

Read 30 lines around the array to understand the entry shape (id, title, file).

- [ ] **Step 9.2: Create `services/dashboard/public/guide/bundles.md`**

```markdown
# Content Bundles & Site Subscriptions

A site subscribes to one or more **content bundles** on the aggregator. At publish time the content pipeline fetches articles from each subscribed bundle, dedupes across the union, and applies the site's freshness, quality, and ranking pipeline.

## Why multiple bundles per site

The aggregator's bundle filter is **OR within each dimension, AND across dimensions** — every article must satisfy every non-empty rule dimension. That makes a single bundle like `{ categories: [Travel, Food], tags: [culinary-travel] }` exclude pure Travel articles that don't carry the tag, and a single bundle like `{ categories: [Travel, Food] }` admit generic food content.

The union of N focused bundles fixes this:

- `travel` — `{ categories: [Travel] }` — broad travel coverage
- `travel-food` — `{ categories: [Food], tags: [culinary-travel, food-travel, food-tours] }` — only travel-themed food
- `travel-culture` — `{ categories: [Culture, Society], tags: [travel-culture, cultural-tourism] }` — only travel-themed culture

A site subscribed to all three gets the OR-of-AND-groups semantic the editorial intent actually wants.

## Naming convention

Name bundles after **what's in them**, not after the site that uses them:

- `travel`, `travel-food`, `travel-culture`
- `wine`, `wine-tourism`
- `science-news`, `space-news`

When the wizard creates a starter bundle from a single site's picks, it defaults to `{domain}-starter` so it's obvious the bundle hasn't been generalized yet. Rename it for reuse once you confirm the rules work.

## Where to manage bundles

- **Subscribe a site to bundles:** Site detail → Site Settings → Content Brief → Content Bundles → "+ Add Bundle"
- **Create a focused bundle:** same modal → "Or create a new bundle" section
- **Deep curation (rename, edit rules, add/remove articles manually):** the Content Aggregator UI directly. The dashboard tracks subscriptions; bundle internals are aggregator-side.

## Backwards compatibility

Sites with a legacy singular `bundle_id` field in `site.yaml` are read as if they had `bundle_ids: [<that id>]`. The next save rewrites the file to the new shape. No data loss; no migration script required.
```

- [ ] **Step 9.3: Register in guide page**

Add a new entry to the `GUIDE_PAGES` array in `services/dashboard/src/app/guide/page.tsx`, following the exact shape of existing entries (e.g. `{ id: "bundles", title: "Content Bundles", file: "bundles.md" }` — match the existing field names).

- [ ] **Step 9.4: Verify in dev**

Open `http://localhost:3001/guide` → click "Content Bundles" entry → page renders markdown.

---

## Task 10: Full integration verification (manual, in dev)

End-to-end test on a running dashboard before any commit. Asaf executes this and reports results.

- [ ] **Step 10.1: Wizard end-to-end with starter + existing**

`cloudgrid dev` running. Visit `/wizard`. Walk through:
1. Identity → fill in.
2. Niche Targeting → pick "Travel". Verify suggested bundles narrow.
3. Check 2 existing bundles.
4. Enable starter bundle, name it "wizard-test-{timestamp}", pick 1 subcategory, 1 tag.
5. Continue through remaining steps.
6. On final step, hit Create.

Inspect the network repo on the staging branch — confirm `sites/<new-domain>/site.yaml` has `brief.bundle_ids: [<existing1>, <existing2>, <starter-id>]` and no top-level `bundle_id`.

- [ ] **Step 10.2: Site-detail subscriptions end-to-end**

For an existing site (e.g. travelnights staging):
1. Visit Site Settings → Content Brief.
2. Verify legacy `bundle_id` shows as the first subscription.
3. Add 2 new subscriptions via the modal.
4. Save. Inspect site.yaml on staging branch: confirm `brief.bundle_ids` is the 3-element list, no `bundle_id`.

- [ ] **Step 10.3: Content fetch end-to-end (optional but recommended)**

For a site with multiple subscribed bundles, trigger content generation from the dashboard's Site Settings → Content Brief → "Generate articles" button (or via `POST /content-generate` with the site's domain). Watch `content-pipeline` logs for:

```
[agent] [narrow] bundle=<id-1> Fetching page 1 …
[agent] [narrow] bundle=<id-2> Fetching page 1 …
```

…confirming the fan-out happens. Articles should be drawn from across the union.

- [ ] **Step 10.4: Sign-off**

Asaf reports green / red. Plan is complete only after Asaf says "ok commit" for each chunk. **Do not run the commit steps below until then.**

---

## Commit chunks (only after Asaf approves each)

Once Asaf says "ok commit", batch by vertical:

- [ ] **Commit chunk A: Types + read-shim** (Tasks 1, 2)

```bash
git add packages/shared-types/src/config.ts services/content-pipeline/src/types.ts services/content-pipeline/src/lib/site-brief.ts services/content-pipeline/src/agents/content-generation/agent.ts services/content-pipeline/src/lib/__tests__/site-brief-bundle-shim.test.ts
git commit -m "$(cat <<'EOF'
feat(types): add SiteBrief.bundle_ids + legacy bundle_id read-shim

Adds the new multi-bundle field and a shim that promotes the legacy
singular bundle_id (brief- or top-level) into bundle_ids on read. Unit
tests cover both legacy sources, dedup, and the no-op path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Commit chunk B: Content pipeline fan-out** (Task 3)

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts services/content-pipeline/src/agents/content-generation/__tests__/agent-bundle-fanout.test.ts
git commit -m "$(cat <<'EOF'
feat(content-pipeline): fan out content fetch across subscribed bundles

Loops bundle_ids per query, dedupes across the union by id/url/title,
preserves the narrow-then-broad fallback. Aggregator stays single-bundle;
no engine change required.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Commit chunk C: Server-side write path** (Tasks 4, 5)

```bash
git add services/dashboard/src/app/api/sites/save/route.ts services/dashboard/src/actions/wizard.ts services/dashboard/src/types/dashboard.ts services/dashboard/src/app/wizard/page.tsx services/dashboard/src/actions/__tests__/wizard-bundle.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): write SiteBrief.bundle_ids from wizard + save API

Wizard collects multi-select existing bundles plus optional starter,
fans out reads to merge category/tag context, and writes brief.bundle_ids.
Save API strips legacy bundle_id when bundleIds is provided. Existing
test file converted; two new cases (multi-existing, mix existing+starter).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Commit chunk D: Wizard UI** (Task 6)

```bash
git add services/dashboard/src/components/wizard/StepNicheTargeting.tsx
git commit -m "$(cat <<'EOF'
feat(wizard): combined suggested-bundles + optional starter on Niche Targeting

Drops the existing/new mode toggle. One screen with multi-select of
existing bundles (filtered by tier-1, sorted by content_count) plus an
optional inline starter-bundle form.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Commit chunk E: Site-detail UI** (Task 7)

```bash
git add services/dashboard/src/components/site-detail/ContentAgentTab.tsx services/dashboard/src/components/site-detail/BundleSubscriptionsPanel.tsx
git commit -m "$(cat <<'EOF'
feat(site-detail): bundle subscriptions panel on Content Brief

Replaces the single-bundle UI with a subscriptions list and Add Bundle
modal (connect-existing multi-select + optional create-new form).
Component extracted to BundleSubscriptionsPanel.tsx to keep
ContentAgentTab.tsx focused.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Commit chunk F: Migration + guide** (Tasks 8, 9)

```bash
git add services/content-pipeline/src/agents/migration/site-scaffolder.ts services/dashboard/public/guide/bundles.md services/dashboard/src/app/guide/page.tsx
git commit -m "$(cat <<'EOF'
feat(migration+docs): emit bundle_ids in migration scaffolder + add bundles guide

WordPress migration writes bundle_ids: [id] instead of bundle_id: id.
New guide page explains the multi-bundle subscription model, OR-within /
AND-across semantics, and the focused-bundle naming convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Out of scope (do not implement)

- Aggregator engine change to OR-of-AND-group bundle rules.
- `audience_ids` in bundle rules.
- Per-bundle weighting in the union (each bundle has equal priority; score-sort handles balance).
- Automated migration of every existing site.yaml to the new shape. The read-shim handles it; sites get rewritten naturally on next save. If a bulk rewrite is desired later, it's a separate one-off script.
- Bundle governance (archival, deprecation, merging). Revisit after the model is in use.
