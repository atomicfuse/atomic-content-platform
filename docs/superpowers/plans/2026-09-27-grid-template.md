# Grid Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Grid site template. It's a dazzr-style card-grid feed of stories from other Live network sites, chosen by vertical. Story pages show an excerpt or an editable AI summary and link on to the source article.

**Architecture:**
- **Site-worker:** Grid sites (`theme.template: grid`) are rewritten in middleware to separate routes under `src/pages/grid/*`. They read a `network-directory` KV key plus each source site's existing `article-index:*`, merging them through pure functions in `src/lib/grid/*`. A `GET /api/pool` JSON endpoint is the single source of feed truth for the dashboard and pipeline.
- **AI summaries:** stored as markdown in the network repo (`grid-summaries/<site>/<slug>.md`), written only by the content-pipeline and synced to KV by a new `sync-grid.yml` workflow.
- **Existing sites:** existing routes, layouts, CSS, KV keys and `sync-kv.yml` are not modified.

**Tech Stack:**
- Astro 6.1.9 + @astrojs/cloudflare (Workers, KV, Cache API)
- TypeScript strict; vitest 3 everywhere
- Next.js 15 dashboard (vitest + RTL + jsdom)
- Node content-pipeline (Octokit, gray-matter, node-html-parser, CloudGrid AI gateway)
- GitHub Actions + wrangler

**Spec:** `docs/superpowers/specs/2026-09-27-grid-template.md` (v3). Read its "Revision v3" section first.

## Global Constraints

- **Zero impact on existing sites:**
  - Never modify `src/pages/index.astro`, `src/pages/[slug]/index.astro`, `src/pages/category/*`, `src/pages/search.astro`, `src/pages/api/articles.ts`, `src/pages/api/search.ts`, `src/layouts/*`, `src/themes/modern/**`, `src/components/AdSlot.astro` or `public/mock-ad-fill.js`.
  - Existing tests must pass **unmodified**.
- **Allowed edits to shared production files** (and only these):
  - `src/middleware.ts`: one Grid branch.
  - `src/lib/kv-schema.ts`: append key builders.
  - `scripts/seed-kv.ts`: one call to `applyGridResolution`.
  - `scripts/lib/validate-config.ts`: one rule.
  - `packages/shared-types/src/config.ts` + `index.ts`: additive types.
- **Grid switch field:** `theme.template === 'grid'`. Never read `theme.base` for Grid; it holds preset ids such as `classic`.
- **Non-Grid resolved configs stay byte-identical:** `grid` and `theme.card` are deleted from non-Grid configs at seed time.
- **KV:** Grid code only **reads** existing keys. New keys: `network-directory` and `grid-summary:<siteId>:<slug>`, written only by `scripts/seed-grid.ts`.
- **Status filters:** stories use `status === 'published'` strictly, even on staging and preview (**not** `isVisibleArticle`).
- **Dev1 legacy sites** (`financenewsbase`, `muvizzcom`) are never sources.
- **No new runtime dependencies** in any package. `marked` stays a site-worker devDependency (used only in `scripts/`).
- **Local-test gate (Asaf's standing rule):** no `git commit`, `git push`, `cloudgrid plug` or `wrangler deploy` until Asaf has tested locally and approved. Tasks end with a **Checkpoint** (tests green, no commit). The commit happens in Task 28, after approval.
- **Git:**
  - Work on `asaf-dev` in this repo; never commit to `main`; never `git add -A`; never `gh pr create`. Print the compare URL: `https://github.com/atomicfuse/atomic-content-platform/compare/main...asaf-dev`.
  - Network-repo changes go on a separate branch in a **git worktree**. The main checkout there is on `staging/travelswire` with unpushed commits and must not be touched.
- **Conventions:**
  - TypeScript strict, no `any`, explicit return types, React components return `React.ReactElement`, YAML files `.yaml`.
  - Commit messages: conventional, ending with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` (CLAUDE.md wording, which takes precedence).
- **Dashboard mirrors types locally** (it does not depend on `@atomic-platform/shared-types`). Keep `src/types/grid.ts` in sync with `packages/shared-types/src/grid.ts`.
- **After editing shared-types, rebuild it:** `pnpm --filter @atomic-platform/shared-types build`. The site-worker resolves it from `dist/`.
- **Every dashboard → pipeline call** uses the `getAgentUrl()` fallback pattern (CLAUDE.md "Service Communication").
- **Design skills:** UI tasks (9–14, 22–24) MUST load `ui-ux-pro-max`, `design-taste-frontend` and `frontend-design` before writing markup or CSS, and follow their guidance within this plan's structure.

## Review Focus

1. **Paths a Grid site must NOT rewrite:**
   - Server islands (`/_server-islands/*`), `/_astro/*`, static files with an extension (`/mock-ad-fill.js`, `/placeholder.svg`), `/ads.txt`, `/robots.txt`, `/api/v1/*`.
   - Expected: served exactly as today.
   - Test: Task 3 `route.test.ts`.
2. **Source article HTML the excerpt meets in the wild:**
   - Image-only paragraphs, nested lists, embeds/iframes, internal relative links (`/other-article`), single-paragraph articles.
   - Expected: clean excerpt, links absolutised to the source host, never more than half the article.
   - Test: Task 7 `excerpt.test.ts`.
3. **Pins that went bad:**
   - Expired, source excluded or gone non-Live, article unpublished, duplicate pin entries.
   - Expected: silently dropped from the feed, reported as inactive with a reason.
   - Test: Task 5 `feed.test.ts`.
4. **Ad code inside infinite-scroll batches:**
   - Every in-feed ad slot needs a unique `data-ad-id`.
   - `<script>` inside widget code must execute after a fetch-append.
   - No empty ad tiles when no `grid-feed` placement exists.
   - Test: Task 6 `render.test.ts` (ids / empty) + Task 27 manual E2E checklist (script execution).
5. **Missing or empty Grid data in KV:**
   - `network-directory` absent, a source's `article-index` absent, a KV read throwing.
   - Expected: header + empty state (HTTP 200), the other sources still render, no 500.
   - Test: Task 8 `load.test.ts`.

---

## Phase A — Foundations (sequential)

### Task 0: Branch, local fixture network, baseline

**Files:**
- Create: `packages/site-worker/tests/fixtures/grid-network/org.yaml` (copied from network repo `origin/main`)
- Create: `packages/site-worker/tests/fixtures/grid-network/dashboard-index.yaml`
- Create: `packages/site-worker/tests/fixtures/grid-network/sites/{fixture-travel-a,fixture-travel-b,fixture-health-a,fixture-grid}/site.yaml`
- Create: `packages/site-worker/tests/fixtures/grid-network/sites/fixture-{travel-a,travel-b,health-a}/articles/*.md` (6 articles each)
- Create: `packages/site-worker/tests/fixtures/grid-network/kv-extra.json`
- Create: `packages/site-worker/scripts/dev/seed-grid-fixture.sh`
- Create: `packages/site-worker/scripts/dev/capture-parity.sh`
- Create: `docs/test-results/2026-09-27-grid-baseline.txt`

**Interfaces:**
- Produces: a local KV (wrangler `--local`) that holds 3 modern fixture sites plus the extras. Later tasks re-run `seed-grid-fixture.sh` after adding `fixture-grid`. Fixture site ids: `fixture-travel-a` (vertical Travel), `fixture-travel-b` (Travel), `fixture-health-a` (Healthy Living), `fixture-grid` (Grid).

- [ ] **Step 1: Branch**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git branch --show-current
git fetch origin
git checkout asaf-dev
git merge --ff-only origin/main   # if this fails (diverged), STOP and ask Asaf
git branch --show-current          # expect: asaf-dev
```

- [ ] **Step 2: Baseline test counts (all packages)**

```bash
mkdir -p docs/test-results
{ echo "## site-worker"; (cd packages/site-worker && pnpm test 2>&1 | tail -8);
  echo "## content-pipeline"; (cd services/content-pipeline && pnpm test 2>&1 | tail -8);
  echo "## dashboard"; (cd services/dashboard && pnpm test 2>&1 | tail -8); } | tee docs/test-results/2026-09-27-grid-baseline.txt
```
Expected: record the pass/fail counts. Any pre-existing failure is noted as pre-existing in the file.

- [ ] **Step 3: Fixture network data**

Copy the real org config: `git -C ../atomic-labs-network show origin/main:org.yaml > packages/site-worker/tests/fixtures/grid-network/org.yaml`.

`dashboard-index.yaml`:
```yaml
sites:
  - domain: fixture-travel-a
    vertical: Travel
    status: Live
    custom_domain: travel-a.example.com
    staging_branch: staging/fixture-travel-a
  - domain: fixture-travel-b
    vertical: Travel
    status: Live
    custom_domain: travel-b.example.com
    staging_branch: staging/fixture-travel-b
  - domain: fixture-health-a
    vertical: Healthy Living
    status: Live
    custom_domain: health-a.example.com
    staging_branch: staging/fixture-health-a
  - domain: fixture-grid
    vertical: ""
    status: Staging
    custom_domain: null
    staging_branch: staging/fixture-grid
```

`sites/fixture-travel-a/site.yaml` (repeat for `travel-b` and `health-a`, changing `domain`, `site_name` and topic):
```yaml
domain: travel-a.example.com
site_name: Travel A
groups: []
theme:
  base: classic
brief:
  audience: Travellers
  tone: Friendly
  topics: [Destinations]
  schedule:
    articles_per_day: 0
```

`sites/fixture-grid/site.yaml` (seeded only from Task 2 on):
```yaml
domain: fixture-grid.example.com
site_name: Grid Fixture
groups: []
theme:
  template: grid
  base: classic
grid:
  topics:
    - label: Travel
      verticals: [Travel]
    - label: Health
      verticals: [Healthy Living]
  per_site_limit: 4
  page_size: 6
  feed_ad_every: 3
brief:
  audience: Everyone
  tone: Neutral
  topics: [News]
  schedule:
    articles_per_day: 0
```

Article template: 6 per site. Vary `slug` and `publishDate` (2026-09-01 … 2026-09-26). Make article 1 in `travel-a` a single-paragraph article, and article 2 include `<iframe>` + an image-only paragraph + a nested list + an internal link `/other-article`.
```markdown
---
title: "Best Beaches in Portugal"
slug: best-beaches-in-portugal
description: "A quick tour of Portugal's best beaches."
author: Editorial Team
publishDate: 2026-09-20T09:00:00Z
featuredImage: /placeholder.svg
status: published
type: standard
tags: [beaches]
topics: [Destinations]
---
Intro paragraph one.

## Section heading

Paragraph two with an [internal link](/other-article).

Paragraph three.

Paragraph four.
```
Also add one `status: review` article to `fixture-travel-b` (it must never appear in the Grid feed).

`kv-extra.json` (a hand-written `network-directory` until Task 15 replaces it):
```json
[
  { "key": "network-directory", "value": "{\"generatedAt\":\"2026-09-27T00:00:00Z\",\"sites\":[{\"siteId\":\"fixture-travel-a\",\"hostname\":\"travel-a.example.com\",\"name\":\"Travel A\",\"favicon\":null,\"vertical\":\"Travel\",\"status\":\"Live\",\"isGrid\":false,\"account\":\"assets\"},{\"siteId\":\"fixture-travel-b\",\"hostname\":\"travel-b.example.com\",\"name\":\"Travel B\",\"favicon\":null,\"vertical\":\"Travel\",\"status\":\"Live\",\"isGrid\":false,\"account\":\"assets\"},{\"siteId\":\"fixture-health-a\",\"hostname\":\"health-a.example.com\",\"name\":\"Health A\",\"favicon\":null,\"vertical\":\"Healthy Living\",\"status\":\"Live\",\"isGrid\":false,\"account\":\"assets\"},{\"siteId\":\"fixture-grid\",\"hostname\":\"fixture-grid.example.com\",\"name\":\"Grid Fixture\",\"favicon\":null,\"vertical\":\"\",\"status\":\"Staging\",\"isGrid\":true,\"account\":\"assets\"}]}" }
]
```

- [ ] **Step 4: Seed script**

`scripts/dev/seed-grid-fixture.sh`:
```bash
#!/usr/bin/env bash
# Seeds the LOCAL wrangler KV/R2 with the Grid fixture network. Never touches remote.
set -euo pipefail
cd "$(dirname "$0")/../.."
export NETWORK_DATA_PATH="$PWD/tests/fixtures/grid-network"
export KV_REMOTE=false R2_REMOTE=false
export KV_NAMESPACE_ID=f6c35e1fa8c841b8b193509a3a237f7f
SITES="${SITES:-fixture-travel-a fixture-travel-b fixture-health-a}"
for s in $SITES; do pnpm seed:kv "$s" "$s"; done
wrangler kv bulk put tests/fixtures/grid-network/kv-extra.json --namespace-id="$KV_NAMESPACE_ID" --local
```
Run: `chmod +x scripts/dev/seed-grid-fixture.sh && packages/site-worker/scripts/dev/seed-grid-fixture.sh`.
Expected: three `[seed-kv] entries=` lines and a successful bulk put.
If `wrangler dev` later can't see the keys, add `--persist-to .wrangler/state` to both the bulk put and the `seed-kv` wrangler calls via `WRANGLER_PERSIST`. Verify with `wrangler kv key list --namespace-id=... --local`.

- [ ] **Step 5: Modern parity baseline**

`scripts/dev/capture-parity.sh`:
```bash
#!/usr/bin/env bash
# Captures modern-site HTML from a running `pnpm dev:worker` (port 8788) into $1.
set -euo pipefail
OUT="$1"; mkdir -p "$OUT"
BASE=http://localhost:8788
for path in "/" "/best-beaches-in-portugal" "/category/destinations" "/search" "/about"; do
  name=$(echo "$path" | tr '/' '_'); [ "$name" = "_" ] && name=_home
  curl -s "$BASE$path?_atl_site=fixture-travel-a" > "$OUT/$name.html"
done
curl -s "$BASE/api/articles?page=2&_atl_site=fixture-travel-a" > "$OUT/_api_articles.html"
for f in $(grep -oh '/_astro/[^"]*\.css' "$OUT"/*.html | sort -u); do curl -s "$BASE$f" > "$OUT/$(basename "$f")"; done
```
Run (terminal 1): `cd packages/site-worker && pnpm dev:worker`.
Run (terminal 2): `packages/site-worker/scripts/dev/capture-parity.sh docs/test-results/grid-parity/baseline`.
Expected: 6 HTML files plus the CSS files, all non-empty, with the homepage showing fixture articles.
Note: must-reads use a daily random seed, so capture the "after" snapshot (Task 27) **on the same UTC day** or ignore the must-reads block when diffing.

- [ ] **Checkpoint:** baseline file written, fixture seeded, parity snapshot captured. No commit.

### Task 1: Shared types and defaults

**Files:**
- Create: `packages/shared-types/src/grid.ts`
- Modify: `packages/shared-types/src/config.ts`: `ThemeConfig` (~L177), `ResolvedThemeConfig` (~L224), the site/group/org layer interfaces (add `grid?: GridConfig`), `ResolvedConfig` (~L773: add `grid?: ResolvedGridConfig`), `SiteBrief.vertical` (L84) → `vertical?: string;`
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces (exact names used by every later task): `GridStoryMode`, `GridTopic`, `ResolvedGridTopic`, `GridPin`, `GridConfig`, `ResolvedGridConfig`, `GridCardConfig`, `ResolvedGridCardConfig`, `NetworkDirectorySite`, `NetworkDirectory`, `GridSummaryRecord`, `GridSummaryStatus`, `GridPoolItem`, `GridSourceStatus`, `GridExclusionReason`, `GridInactivePin`, `GridPoolResponse`, `GRID_DEFAULTS`, `GRID_CARD_DEFAULTS`, `GRID_CARD_OPTIONS`.

- [ ] **Step 1: Write `packages/shared-types/src/grid.ts`**

```ts
/** Story text mode for a Grid site's story pages. */
export type GridStoryMode = "excerpt" | "ai_summary";

/** A topic pill as written in config. */
export interface GridTopic {
  label: string;
  /** Optional URL slug; derived from label when absent. */
  slug?: string;
  /** Vertical names (dashboard-index `vertical`) whose sites feed this pill. */
  verticals: string[];
}

/** A topic pill after normalisation (slug always present, unique). */
export interface ResolvedGridTopic {
  label: string;
  slug: string;
  verticals: string[];
}

/** A story pinned to the top of a Grid feed. */
export interface GridPin {
  site: string;
  slug: string;
  /** Inclusive expiry date, YYYY-MM-DD. */
  until?: string | null;
}

/** `grid` config section as written in org/group/override/site YAML. */
export interface GridConfig {
  topics?: GridTopic[];
  include_sites?: string[];
  exclude_sites?: string[];
  per_site_limit?: number;
  max_age_days?: number | null;
  story_mode?: GridStoryMode;
  excerpt_paragraphs?: number;
  feed_ad_every?: number;
  page_size?: number;
  show_intro?: boolean;
  outbound_utm?: boolean;
  pinned?: GridPin[];
}

/** Fully-resolved `grid` section (every field present). */
export interface ResolvedGridConfig {
  topics: ResolvedGridTopic[];
  include_sites: string[];
  exclude_sites: string[];
  per_site_limit: number;
  max_age_days: number | null;
  story_mode: GridStoryMode;
  excerpt_paragraphs: number;
  feed_ad_every: number;
  page_size: number;
  show_intro: boolean;
  outbound_utm: boolean;
  pinned: GridPin[];
}

/** Allowed values for each card-look option (single source for validation + dashboard). */
export const GRID_CARD_OPTIONS = {
  style: ["bordered", "shadow", "flat"],
  corners: ["square", "small", "rounded"],
  image_ratio: ["4:3", "16:9", "1:1"],
  image_position: ["top", "left"],
  density: ["comfortable", "compact"],
  source_position: ["below", "badge"],
} as const;

/** `theme.card` as written in YAML. Read only by the Grid template. */
export interface GridCardConfig {
  style?: (typeof GRID_CARD_OPTIONS.style)[number];
  corners?: (typeof GRID_CARD_OPTIONS.corners)[number];
  image_ratio?: (typeof GRID_CARD_OPTIONS.image_ratio)[number];
  image_position?: (typeof GRID_CARD_OPTIONS.image_position)[number];
  density?: (typeof GRID_CARD_OPTIONS.density)[number];
  source_position?: (typeof GRID_CARD_OPTIONS.source_position)[number];
}

/** Fully-resolved card look. */
export type ResolvedGridCardConfig = Required<GridCardConfig>;

/** Seed-time and runtime defaults for `grid`. */
export const GRID_DEFAULTS: ResolvedGridConfig = {
  topics: [],
  include_sites: [],
  exclude_sites: [],
  per_site_limit: 10,
  max_age_days: null,
  story_mode: "excerpt",
  excerpt_paragraphs: 3,
  feed_ad_every: 3,
  page_size: 20,
  show_intro: false,
  outbound_utm: true,
  pinned: [],
};

/** Seed-time and runtime defaults for `theme.card` (dazzr-like). */
export const GRID_CARD_DEFAULTS: ResolvedGridCardConfig = {
  style: "bordered",
  corners: "rounded",
  image_ratio: "4:3",
  image_position: "top",
  density: "comfortable",
  source_position: "below",
};

/** One site in the `network-directory` KV key. */
export interface NetworkDirectorySite {
  siteId: string;
  hostname: string;
  name: string;
  favicon: string | null;
  vertical: string;
  status: string;
  isGrid: boolean;
  account: "assets" | "dev1";
}

/** Value of the `network-directory` KV key (written by scripts/seed-grid.ts). */
export interface NetworkDirectory {
  generatedAt: string;
  sites: NetworkDirectorySite[];
}

/** Value of `grid-summary:<siteId>:<slug>` (written by scripts/seed-grid.ts). */
export interface GridSummaryRecord {
  /** Sanitised HTML rendered from the summary markdown at sync time. */
  html: string;
  bodyHash: string;
  generatedAt: string;
  model: string;
  edited: boolean;
  sourceChanged: boolean;
}

/** Summary state shown in the dashboard Stories tab. */
export type GridSummaryStatus = "none" | "generated" | "edited" | "stale";

/** Why a directory site is not a source. */
export type GridExclusionReason =
  | "self"
  | "grid_site"
  | "not_live"
  | "dev1_account"
  | "excluded"
  | "no_matching_vertical"
  | "missing_index";

/** One row of source resolution, returned by GET /api/pool. */
export interface GridSourceStatus {
  siteId: string;
  included: boolean;
  reason?: GridExclusionReason;
  /** Pill slugs this site feeds (empty = "All" only). */
  pills: string[];
}

/** One story in a Grid pool. */
export interface GridPoolItem {
  site: string;
  slug: string;
  title: string;
  publishDate: string;
  featuredImage?: string;
  description?: string;
  pills: string[];
  pinned: boolean;
  /** Present only when /api/pool is called with `summaries=1`. */
  summary?: { status: GridSummaryStatus; generatedAt?: string };
}

/** A configured pin that is not currently shown. */
export interface GridInactivePin extends GridPin {
  reason: "expired" | "not_source" | "not_published";
}

/** Response of GET /api/pool on a Grid site. */
export interface GridPoolResponse {
  siteId: string;
  generatedAt: string;
  storyMode: GridStoryMode;
  perSiteLimit: number;
  directoryGeneratedAt: string | null;
  sources: GridSourceStatus[];
  items: GridPoolItem[];
  inactivePins: GridInactivePin[];
}
```

- [ ] **Step 2: Wire into `config.ts` (additive only)**

In `ThemeConfig` add:
```ts
  /** Site template. Absent or "modern" → the default template. NOT `base` (that holds preset ids). */
  template?: "modern" | "grid";
  /** Card look — read only by the Grid template. */
  card?: GridCardConfig;
```
In `ResolvedThemeConfig` add the same two fields as optional (`template?: "modern" | "grid"; card?: ResolvedGridCardConfig;`).
In the org, group and site config layer interfaces, and in the override config type if it holds a `theme`, add `grid?: GridConfig;`.
In `ResolvedConfig` add `grid?: ResolvedGridConfig;`.
Change `SiteBrief.vertical` to `vertical?: string;` (the union is stale; type-only).
Add `import type { GridConfig, ResolvedGridConfig, GridCardConfig, ResolvedGridCardConfig } from "./grid.js";` at the top of `config.ts`.

- [ ] **Step 3: Export from `index.ts`**

```ts
export type {
  GridStoryMode, GridTopic, ResolvedGridTopic, GridPin, GridConfig, ResolvedGridConfig,
  GridCardConfig, ResolvedGridCardConfig, NetworkDirectorySite, NetworkDirectory,
  GridSummaryRecord, GridSummaryStatus, GridExclusionReason, GridSourceStatus,
  GridPoolItem, GridInactivePin, GridPoolResponse,
} from "./grid.js";
export { GRID_DEFAULTS, GRID_CARD_DEFAULTS, GRID_CARD_OPTIONS } from "./grid.js";
```

- [ ] **Step 4: Build and typecheck everything that consumes shared-types**

Run: `pnpm --filter @atomic-platform/shared-types build && (cd packages/site-worker && pnpm typecheck)`
Expected: both succeed. The `SiteBrief.vertical` loosening must not produce errors. If a consumer narrowed on the old union, fix it in that consumer by treating the value as `string`.

- [ ] **Checkpoint:** typecheck green, site-worker `pnpm test` counts equal to the baseline. No commit.

### Task 2: Seed-time Grid resolution (non-Grid configs byte-identical)

**Files:**
- Create: `packages/site-worker/src/lib/grid/normalize.ts`
- Create: `packages/site-worker/scripts/lib/resolve-grid.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/normalize.test.ts`
- Create test: `packages/site-worker/scripts/__tests__/resolve-grid.test.ts`
- Modify: `packages/site-worker/scripts/seed-kv.ts`: one line in `resolveSiteConfig`, just before its `return` (~L680)
- Modify: `packages/site-worker/scripts/lib/validate-config.ts`: one rule in `validateResolvedConfig`

**Interfaces:**
- Consumes: `GRID_DEFAULTS`, `GRID_CARD_DEFAULTS`, `GRID_CARD_OPTIONS`, `GridConfig`, `ResolvedGridConfig`, `GridCardConfig`, `ResolvedGridCardConfig` (Task 1).
- Produces:
  - `normalizeGridConfig(input: GridConfig | undefined): ResolvedGridConfig`
  - `normalizeGridCard(input: GridCardConfig | undefined): ResolvedGridCardConfig`
  - `slugifyTopic(label: string): string`
  - `mergeGridLayers(layers: ReadonlyArray<GridConfig | undefined>): GridConfig`
  - `applyGridResolution(config: Record<string, unknown>, layers: ReadonlyArray<Record<string, unknown>>): void`

- [ ] **Step 1: Write failing tests `src/lib/grid/__tests__/normalize.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GRID_DEFAULTS, GRID_CARD_DEFAULTS } from '@atomic-platform/shared-types';
import { normalizeGridConfig, normalizeGridCard, slugifyTopic } from '../normalize';

describe('normalizeGridConfig', () => {
  it('returns defaults for undefined', () => {
    expect(normalizeGridConfig(undefined)).toEqual(GRID_DEFAULTS);
  });
  it('derives unique slugs and drops label-less topics', () => {
    const out = normalizeGridConfig({ topics: [
      { label: 'Food & Drink', verticals: ['Food & Drink'] },
      { label: 'Food & Drink', verticals: [] },
      { label: '  ', verticals: ['X'] },
      { label: 'Health', slug: 'Wellness Now', verticals: [' Healthy Living ', ''] },
    ] });
    expect(out.topics).toEqual([
      { label: 'Food & Drink', slug: 'food-and-drink', verticals: ['Food & Drink'] },
      { label: 'Food & Drink', slug: 'food-and-drink-2', verticals: [] },
      { label: 'Health', slug: 'wellness-now', verticals: ['Healthy Living'] },
    ]);
  });
  it('clamps numbers and maps feed_ad_every 1 to 2', () => {
    const out = normalizeGridConfig({ per_site_limit: 500, page_size: 2, excerpt_paragraphs: 0, feed_ad_every: 1, max_age_days: -4 });
    expect(out.per_site_limit).toBe(100);
    expect(out.page_size).toBe(6);
    expect(out.excerpt_paragraphs).toBe(1);
    expect(out.feed_ad_every).toBe(2);
    expect(out.max_age_days).toBe(1);
  });
  it('keeps feed_ad_every 0 (no in-feed ads) and null max_age_days', () => {
    const out = normalizeGridConfig({ feed_ad_every: 0, max_age_days: null });
    expect(out.feed_ad_every).toBe(0);
    expect(out.max_age_days).toBeNull();
  });
  it('rejects unknown story_mode and malformed pins', () => {
    const out = normalizeGridConfig({
      story_mode: 'magic' as never,
      pinned: [{ site: 'a', slug: 'b', until: '2026-10-31' }, { site: 'a', slug: 'c', until: 'soon' }, { site: '', slug: 'x' } as never],
    });
    expect(out.story_mode).toBe('excerpt');
    expect(out.pinned).toEqual([{ site: 'a', slug: 'b', until: '2026-10-31' }, { site: 'a', slug: 'c', until: null }]);
  });
  it('is idempotent (safe to run at seed time and again at runtime)', () => {
    const once = normalizeGridConfig({ topics: [{ label: 'Travel', verticals: ['Travel'] }], per_site_limit: 7 });
    expect(normalizeGridConfig(once)).toEqual(once);
  });
});

describe('normalizeGridCard', () => {
  it('fills defaults and rejects unknown values', () => {
    expect(normalizeGridCard(undefined)).toEqual(GRID_CARD_DEFAULTS);
    expect(normalizeGridCard({ style: 'shadow', corners: 'huge' as never })).toEqual({ ...GRID_CARD_DEFAULTS, style: 'shadow' });
  });
});

describe('slugifyTopic', () => {
  it('handles accents, symbols and edges', () => {
    expect(slugifyTopic('  Café & Crème!  ')).toBe('cafe-and-creme');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd packages/site-worker && pnpm test -- src/lib/grid/__tests__/normalize.test.ts`
Expected: FAIL, `Cannot find module '../normalize'`.

- [ ] **Step 3: Implement `src/lib/grid/normalize.ts`**

```ts
import {
  GRID_CARD_DEFAULTS, GRID_CARD_OPTIONS, GRID_DEFAULTS,
  type GridCardConfig, type GridConfig, type GridPin, type ResolvedGridCardConfig,
  type ResolvedGridConfig, type ResolvedGridTopic,
} from '@atomic-platform/shared-types';

const UNTIL_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

/** Kebab-case slug for a topic label or explicit slug. */
export function slugifyTopic(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTopics(value: unknown): ResolvedGridTopic[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const topics: ResolvedGridTopic[] = [];
  for (const raw of value) {
    const t = (raw ?? {}) as { label?: unknown; slug?: unknown; verticals?: unknown };
    const label = typeof t.label === 'string' ? t.label.trim() : '';
    if (!label) continue;
    const source = typeof t.slug === 'string' && t.slug.trim() ? t.slug : label;
    const base = slugifyTopic(source) || 'topic';
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    topics.push({ label, slug, verticals: stringList(t.verticals) });
  }
  return topics;
}

function normalizePins(value: unknown): GridPin[] {
  if (!Array.isArray(value)) return [];
  const pins: GridPin[] = [];
  for (const raw of value) {
    const p = (raw ?? {}) as { site?: unknown; slug?: unknown; until?: unknown };
    if (typeof p.site !== 'string' || !p.site.trim() || typeof p.slug !== 'string' || !p.slug.trim()) continue;
    const until = typeof p.until === 'string' && UNTIL_RE.test(p.until) ? p.until : null;
    pins.push({ site: p.site.trim(), slug: p.slug.trim(), until });
  }
  return pins;
}

/**
 * Resolves a `grid` section to a fully-populated config, clamping out-of-range values.
 * Idempotent: used at seed time and again at runtime (the `??=` KV-evolution safety net).
 */
export function normalizeGridConfig(input: GridConfig | undefined): ResolvedGridConfig {
  const g = (input ?? {}) as GridConfig;
  const every = clampInt(g.feed_ad_every, 0, 50, GRID_DEFAULTS.feed_ad_every);
  return {
    topics: normalizeTopics(g.topics),
    include_sites: stringList(g.include_sites),
    exclude_sites: stringList(g.exclude_sites),
    per_site_limit: clampInt(g.per_site_limit, 1, 100, GRID_DEFAULTS.per_site_limit),
    max_age_days: g.max_age_days === null || g.max_age_days === undefined
      ? null
      : clampInt(g.max_age_days, 1, 3650, 30),
    story_mode: g.story_mode === 'ai_summary' ? 'ai_summary' : 'excerpt',
    excerpt_paragraphs: clampInt(g.excerpt_paragraphs, 1, 10, GRID_DEFAULTS.excerpt_paragraphs),
    // Note: 1 would make every tile an ad — minimum cadence is 2.
    feed_ad_every: every === 1 ? 2 : every,
    page_size: clampInt(g.page_size, 6, 60, GRID_DEFAULTS.page_size),
    show_intro: g.show_intro === true,
    outbound_utm: g.outbound_utm !== false,
    pinned: normalizePins(g.pinned),
  };
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Resolves `theme.card` to a fully-populated card look. */
export function normalizeGridCard(input: GridCardConfig | undefined): ResolvedGridCardConfig {
  const c = (input ?? {}) as GridCardConfig;
  return {
    style: pick(c.style, GRID_CARD_OPTIONS.style, GRID_CARD_DEFAULTS.style),
    corners: pick(c.corners, GRID_CARD_OPTIONS.corners, GRID_CARD_DEFAULTS.corners),
    image_ratio: pick(c.image_ratio, GRID_CARD_OPTIONS.image_ratio, GRID_CARD_DEFAULTS.image_ratio),
    image_position: pick(c.image_position, GRID_CARD_OPTIONS.image_position, GRID_CARD_DEFAULTS.image_position),
    density: pick(c.density, GRID_CARD_OPTIONS.density, GRID_CARD_DEFAULTS.density),
    source_position: pick(c.source_position, GRID_CARD_OPTIONS.source_position, GRID_CARD_DEFAULTS.source_position),
  };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `pnpm test -- src/lib/grid/__tests__/normalize.test.ts`. Expected: PASS (7 tests).

- [ ] **Step 5: Failing tests `scripts/__tests__/resolve-grid.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS, GRID_DEFAULTS } from '@atomic-platform/shared-types';
import { applyGridResolution, mergeGridLayers } from '../lib/resolve-grid';

describe('mergeGridLayers', () => {
  it('scalars: later defined wins; arrays: last non-empty wins', () => {
    const merged = mergeGridLayers([
      { per_site_limit: 5, topics: [{ label: 'A', verticals: ['Travel'] }], exclude_sites: ['x'] },
      undefined,
      { per_site_limit: 8, topics: [], exclude_sites: ['y'] },
    ]);
    expect(merged.per_site_limit).toBe(8);
    expect(merged.topics).toEqual([{ label: 'A', verticals: ['Travel'] }]);
    expect(merged.exclude_sites).toEqual(['y']);
  });
  it('null max_age_days in a later layer removes an earlier limit', () => {
    expect(mergeGridLayers([{ max_age_days: 30 }, { max_age_days: null }]).max_age_days).toBeNull();
  });
});

describe('applyGridResolution', () => {
  it('strips grid + theme.card from non-Grid configs (byte-identical guard)', () => {
    const config: Record<string, unknown> = { theme: { base: 'classic', card: { style: 'flat' } }, grid: { per_site_limit: 3 } };
    applyGridResolution(config, [{ grid: { per_site_limit: 3 } }]);
    expect(config).toEqual({ theme: { base: 'classic' } });
  });
  it('leaves a non-Grid config with no grid fields untouched', () => {
    const config: Record<string, unknown> = { theme: { base: 'modern' }, layout: {} };
    const before = JSON.stringify(config);
    applyGridResolution(config, [{}]);
    expect(JSON.stringify(config)).toBe(before);
  });
  it('resolves grid + card for Grid configs from raw layers', () => {
    const config: Record<string, unknown> = { theme: { template: 'grid', card: { style: 'shadow' } } };
    applyGridResolution(config, [{ grid: { per_site_limit: 5 } }, { grid: { page_size: 12 } }]);
    expect(config.grid).toEqual({ ...GRID_DEFAULTS, per_site_limit: 5, page_size: 12 });
    expect((config.theme as Record<string, unknown>).card).toEqual({ ...GRID_CARD_DEFAULTS, style: 'shadow' });
  });
});
```

- [ ] **Step 6: Run to confirm failure**, then implement `scripts/lib/resolve-grid.ts`:

```ts
import type { GridCardConfig, GridConfig } from '@atomic-platform/shared-types';
import { normalizeGridCard, normalizeGridConfig } from '../../src/lib/grid/normalize';

const ARRAY_KEYS = new Set(['topics', 'include_sites', 'exclude_sites', 'pinned']);

/**
 * Merges raw `grid` layers (org → groups → overrides → site).
 * Scalars: last defined value wins (`null` counts for max_age_days).
 * Arrays: last NON-EMPTY wins — unlike deepMerge, an empty array never wipes an inherited list.
 */
export function mergeGridLayers(layers: ReadonlyArray<GridConfig | undefined>): GridConfig {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      if (ARRAY_KEYS.has(key)) {
        if (Array.isArray(value) && value.length > 0) out[key] = value;
        continue;
      }
      if (value === null && key !== 'max_age_days') continue;
      out[key] = value;
    }
  }
  return out as GridConfig;
}

/**
 * Seed-time Grid step, called once at the end of resolveSiteConfig.
 * Non-Grid sites: removes `grid` and `theme.card` so their KV config is byte-identical to today.
 * Grid sites: replaces the deepMerge'd `grid` with Grid merge semantics + normalisation.
 */
export function applyGridResolution(
  config: Record<string, unknown>,
  layers: ReadonlyArray<Record<string, unknown>>,
): void {
  const theme = (config.theme ?? {}) as Record<string, unknown>;
  if (theme.template !== 'grid') {
    delete config.grid;
    delete theme.card;
    return;
  }
  config.grid = normalizeGridConfig(mergeGridLayers(layers.map((l) => l.grid as GridConfig | undefined)));
  theme.card = normalizeGridCard(theme.card as GridCardConfig | undefined);
  config.theme = theme;
}
```
Run: `pnpm test -- scripts/__tests__/resolve-grid.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 7: Hook into seed-kv (one line + import)**

In `scripts/seed-kv.ts`, find the `layers` array that `resolveSiteConfig` builds and reduces with `deepMerge` (~L505-549; org, then groups, then overrides, then site). Immediately before the function's final `return`, after the support_email fixup (~L670-680), add:
```ts
  applyGridResolution(config as unknown as Record<string, unknown>, layers as ReadonlyArray<Record<string, unknown>>);
```
Add the import: `import { applyGridResolution } from './lib/resolve-grid';`.
If the variable holding the layers has a different name, use that variable. Do not restructure anything else.

- [ ] **Step 8: Validation rule**

In `scripts/lib/validate-config.ts`, inside `validateResolvedConfig`, next to the existing rules:
```ts
  const theme = config.theme as { template?: unknown } | undefined;
  const grid = config.grid as { topics?: unknown[]; include_sites?: unknown[] } | undefined;
  if (theme?.template === 'grid' && (grid?.topics?.length ?? 0) === 0 && (grid?.include_sites?.length ?? 0) === 0) {
    warnings.push(`[${siteId}] Grid site has no grid.topics and no grid.include_sites — its feed will be empty.`);
  }
```
Add a test case to the existing `scripts/__tests__/validate-config.test.ts`: a Grid config with no topics produces that warning, and a modern config does not. These are new test cases only; existing ones stay unchanged.

- [ ] **Step 9: Seed the Grid fixture and prove modern configs are unchanged**

```bash
cd packages/site-worker
for s in fixture-travel-a; do wrangler kv key get "site-config:$s" --namespace-id=f6c35e1fa8c841b8b193509a3a237f7f --local > /tmp/before-$s.json; done
SITES="fixture-travel-a fixture-grid" scripts/dev/seed-grid-fixture.sh
wrangler kv key get "site-config:fixture-travel-a" --namespace-id=f6c35e1fa8c841b8b193509a3a237f7f --local | diff - /tmp/before-fixture-travel-a.json && echo IDENTICAL
wrangler kv key get "site-config:fixture-grid" --namespace-id=f6c35e1fa8c841b8b193509a3a237f7f --local | grep -o '"grid":{[^}]*' | head -c 300
```
Expected: `IDENTICAL`, and the Grid config contains a resolved `grid` object with `per_site_limit: 4`.
The only acceptable difference in the modern config is `sync-status` timestamps (a different key). If the diff shows anything else, STOP.
Change the default `SITES` in `seed-grid-fixture.sh` to include `fixture-grid` from now on.

- [ ] **Checkpoint:** `pnpm test` (all site-worker) green; counts are baseline + new tests. No commit.

### Task 3: Middleware rewrite to `/grid/*` + Grid context guard

**Files:**
- Create: `packages/site-worker/src/lib/grid/route.ts`
- Create: `packages/site-worker/src/lib/grid/context.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/route.test.ts`
- Create: `packages/site-worker/src/pages/grid/index.astro` (temporary placeholder body, replaced in Task 11)
- Modify: `packages/site-worker/src/middleware.ts`: the single `const response = await next();` at ~L184

**Interfaces:**
- Produces:
  - `toGridPath(pathname: string): string | null`
  - `publicPath(pathname: string): string`
  - `isGridConfig(config: ResolvedConfig): boolean`
  - `interface GridContext { config: ResolvedConfig; grid: ResolvedGridConfig; card: ResolvedGridCardConfig; siteId: string; staging: boolean; canonicalHost: string }`
  - `getGridContext(astro: APIContext | AstroGlobal): GridContext | null`
  - `notFound(): Response`

- [ ] **Step 1: Failing tests `route.test.ts`** (Review Focus #1)

```ts
import { describe, expect, it } from 'vitest';
import { publicPath, toGridPath } from '../route';

describe('toGridPath', () => {
  it.each([
    ['/', '/grid'],
    ['/topic/travel', '/grid/topic/travel'],
    ['/story/scienceworld/best-telescopes', '/grid/story/scienceworld/best-telescopes'],
    ['/about', '/grid/about'],
    ['/search', '/grid/search'],
    ['/api/feed', '/grid/api/feed'],
    ['/api/pool', '/grid/api/pool'],
  ])('rewrites %s → %s', (input, expected) => {
    expect(toGridPath(input)).toBe(expected);
  });
  it.each([
    '/_server-islands/AdSlot', '/_astro/index.abc123.css', '/_ping',
    '/ads.txt', '/robots.txt', '/sitemap.xml', '/sitemap-index.xml',
    '/mock-ad-fill.js', '/placeholder.svg', '/favicon.ico',
    '/api/v1/articles/latest-by-domain',
    '/grid', '/grid/topic/x',
  ])('passes through %s', (input) => {
    expect(toGridPath(input)).toBeNull();
  });
});

describe('publicPath', () => {
  it('strips the internal /grid prefix', () => {
    expect(publicPath('/grid')).toBe('/');
    expect(publicPath('/grid/topic/travel')).toBe('/topic/travel');
    expect(publicPath('/about')).toBe('/about');
  });
});
```

- [ ] **Step 2: Run to confirm failure**, then implement `route.ts`:

```ts
const PASSTHROUGH_EXACT = new Set(['/ads.txt', '/robots.txt', '/sitemap.xml', '/sitemap-index.xml']);
const HAS_FILE_EXTENSION = /\/[^/]+\.[a-z0-9]+$/i;

/**
 * Maps a public Grid-site path to its internal `/grid/*` route, or null when the request
 * must be served by the existing shared routes (server islands, static files, ads.txt, v1 API).
 */
export function toGridPath(pathname: string): string | null {
  if (pathname.startsWith('/_') || pathname.startsWith('/api/v1/')) return null;
  if (PASSTHROUGH_EXACT.has(pathname) || HAS_FILE_EXTENSION.test(pathname)) return null;
  // Note: already-internal paths are served directly by src/pages/grid/* — never double-prefix.
  if (pathname === '/grid' || pathname.startsWith('/grid/')) return null;
  return pathname === '/' ? '/grid' : `/grid${pathname}`;
}

/** Inverse of toGridPath — the path the visitor actually sees (for active pills, links). */
export function publicPath(pathname: string): string {
  if (pathname === '/grid' || pathname === '/grid/') return '/';
  return pathname.startsWith('/grid/') ? pathname.slice('/grid'.length) : pathname;
}
```
Run the test. Expected: PASS.

- [ ] **Step 3: `context.ts`**

```ts
import type { APIContext, AstroGlobal } from 'astro';
import type { ResolvedConfig, ResolvedGridCardConfig, ResolvedGridConfig } from '@atomic-platform/shared-types';
import { getCanonicalDomain, getConfig, getSiteId, isStagingEnv } from '../config';
import { normalizeGridCard, normalizeGridConfig } from './normalize';

/** Everything a Grid page needs, with runtime defaults applied. */
export interface GridContext {
  config: ResolvedConfig;
  grid: ResolvedGridConfig;
  card: ResolvedGridCardConfig;
  siteId: string;
  staging: boolean;
  canonicalHost: string;
}

/** True when this site renders the Grid template. */
export function isGridConfig(config: ResolvedConfig): boolean {
  return config.theme?.template === 'grid';
}

/**
 * Grid pages call this first; null means "not a Grid site" → 404.
 * normalizeGridConfig/normalizeGridCard act as the runtime `??=` defaults required by
 * CLAUDE.md "KV Schema Evolution" step 1.
 */
export function getGridContext(astro: APIContext | AstroGlobal): GridContext | null {
  const config = getConfig(astro);
  if (!isGridConfig(config)) return null;
  return {
    config,
    grid: normalizeGridConfig(config.grid),
    card: normalizeGridCard(config.theme.card),
    siteId: getSiteId(astro),
    staging: isStagingEnv(astro),
    canonicalHost: getCanonicalDomain(astro),
  };
}

/** Same 404 shape as the existing routes. */
export function notFound(): Response {
  return new Response('Not found', { status: 404 });
}
```
If `getConfig` / `getSiteId` / `isStagingEnv` / `getCanonicalDomain` are typed to take `APIContext | { locals: App.Locals }`, `AstroGlobal` satisfies that; keep the union.

- [ ] **Step 4: Middleware branch**

In `src/middleware.ts` replace the single line `const response = await next();` (right after `context.locals.site = …`) with:
```ts
  // Grid template: serve from src/pages/grid/* (separate routes → separate CSS bundles).
  // Every other site takes the unchanged `next()` path.
  const gridPath = config.theme?.template === 'grid' ? toGridPath(context.url.pathname) : null;
  const response = await (gridPath
    ? next(new URL(`${gridPath}${context.url.search}`, context.url))
    : next());
```
Add `import { toGridPath } from './lib/grid/route';`. Use the same `config` variable that was assigned into `context.locals.site`.

- [ ] **Step 5: Placeholder route `src/pages/grid/index.astro`**

```astro
---
import { getGridContext, notFound } from '../../lib/grid/context';
export const prerender = false;
const ctx = getGridContext(Astro);
if (!ctx) return notFound();
---
<html><body><h1 data-grid-placeholder>Grid: {ctx.siteId}</h1></body></html>
```

- [ ] **Step 6: Spike verification in workerd (architecture gate)**

```bash
cd packages/site-worker && pnpm dev:worker   # terminal 1
# terminal 2:
curl -s "http://localhost:8788/?_atl_site=fixture-grid" | grep -c data-grid-placeholder        # expect 1
curl -s "http://localhost:8788/?_atl_site=fixture-travel-a" | grep -c data-grid-placeholder    # expect 0
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8788/ads.txt?_atl_site=fixture-grid"      # expect 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8788/mock-ad-fill.js?_atl_site=fixture-grid" # expect 200
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:8788/grid?_atl_site=fixture-travel-a"    # expect 404
```
Also confirm the modern homepage's `/_astro/*.css` list is unchanged against the baseline:
`grep -oh '/_astro/[^"]*\.css' docs/test-results/grid-parity/baseline/_home.html | sort` must equal the same grep on a fresh curl.
**If `next(URL)` doesn't rewrite on the Cloudflare adapter** (the placeholder isn't served, or middleware re-runs in a loop), STOP and report to Asaf. Do not switch approaches without approval; this is the architecture decision in spec v3 #2.

- [ ] **Checkpoint:** route tests pass; spike results pasted into `docs/test-results/2026-09-27-grid-spike.txt`. No commit.

---

## Phase B — Grid logic (pure functions, fully unit-tested)

### Task 4: Source resolution

**Files:**
- Create: `packages/site-worker/src/lib/grid/sources.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/sources.test.ts`

**Interfaces:**
- Consumes: `NetworkDirectory`, `NetworkDirectorySite`, `ResolvedGridConfig`, `GridSourceStatus`, `GridExclusionReason`.
- Produces: `interface ResolvedSources { sources: NetworkDirectorySite[]; statuses: GridSourceStatus[]; pillsBySite: Map<string, string[]> }`, `resolveSources(dir: NetworkDirectory, grid: ResolvedGridConfig, selfSiteId: string): ResolvedSources`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { GRID_DEFAULTS, type NetworkDirectorySite, type ResolvedGridConfig } from '@atomic-platform/shared-types';
import { resolveSources } from '../sources';

const site = (over: Partial<NetworkDirectorySite>): NetworkDirectorySite => ({
  siteId: 'x', hostname: 'x.com', name: 'X', favicon: null, vertical: 'Travel',
  status: 'Live', isGrid: false, account: 'assets', ...over,
});
const grid = (over: Partial<ResolvedGridConfig> = {}): ResolvedGridConfig => ({
  ...GRID_DEFAULTS,
  topics: [
    { label: 'Travel', slug: 'travel', verticals: ['Travel'] },
    { label: 'Health', slug: 'health', verticals: ['Healthy Living', 'Medical Health'] },
  ],
  ...over,
});
const dir = (sites: NetworkDirectorySite[]) => ({ generatedAt: 't', sites });

describe('resolveSources', () => {
  it('includes sites whose vertical matches a pill (case/space-insensitive) and records pills', () => {
    const r = resolveSources(dir([site({ siteId: 'a', vertical: ' travel ' }), site({ siteId: 'b', vertical: 'Medical Health' })]), grid(), 'me');
    expect(r.sources.map((s) => s.siteId)).toEqual(['a', 'b']);
    expect(r.pillsBySite.get('a')).toEqual(['travel']);
    expect(r.pillsBySite.get('b')).toEqual(['health']);
  });
  it('a vertical listed in two pills feeds both', () => {
    const g = grid({ topics: [
      { label: 'Travel', slug: 'travel', verticals: ['Travel'] },
      { label: 'Trips', slug: 'trips', verticals: ['Travel'] },
    ] });
    expect(resolveSources(dir([site({ siteId: 'a' })]), g, 'me').pillsBySite.get('a')).toEqual(['travel', 'trips']);
  });
  it.each([
    [site({ siteId: 'me' }), 'self'],
    [site({ siteId: 'g', isGrid: true }), 'grid_site'],
    [site({ siteId: 's', status: 'Staging' }), 'not_live'],
    [site({ siteId: 'muvizzcom', account: 'dev1' }), 'dev1_account'],
    [site({ siteId: 'ex' }), 'excluded'],
    [site({ siteId: 'nv', vertical: 'Pets' }), 'no_matching_vertical'],
    [site({ siteId: 'empty', vertical: '' }), 'no_matching_vertical'],
  ])('excludes %o with reason %s', (s, reason) => {
    const r = resolveSources(dir([s]), grid({ exclude_sites: ['ex'] }), 'me');
    expect(r.sources).toEqual([]);
    expect(r.statuses[0]).toMatchObject({ siteId: s.siteId, included: false, reason });
  });
  it('include_sites adds a non-matching site to "All" only (no pills)', () => {
    const r = resolveSources(dir([site({ siteId: 'hiddenstorydaily', vertical: '' })]), grid({ include_sites: ['hiddenstorydaily'] }), 'me');
    expect(r.sources.map((s) => s.siteId)).toEqual(['hiddenstorydaily']);
    expect(r.pillsBySite.get('hiddenstorydaily')).toEqual([]);
  });
  it('a Grid site in include_sites is still excluded', () => {
    const r = resolveSources(dir([site({ siteId: 'g2', isGrid: true })]), grid({ include_sites: ['g2'] }), 'me');
    expect(r.statuses[0]?.reason).toBe('grid_site');
  });
  it('exclude wins over include', () => {
    const r = resolveSources(dir([site({ siteId: 'a' })]), grid({ include_sites: ['a'], exclude_sites: ['a'] }), 'me');
    expect(r.statuses[0]?.reason).toBe('excluded');
  });
});
```

- [ ] **Step 2: Run to confirm failure**, then implement `sources.ts`:

```ts
import type {
  GridExclusionReason, GridSourceStatus, NetworkDirectory, NetworkDirectorySite, ResolvedGridConfig,
} from '@atomic-platform/shared-types';

/** Result of resolving which network sites feed a Grid site. */
export interface ResolvedSources {
  sources: NetworkDirectorySite[];
  statuses: GridSourceStatus[];
  pillsBySite: Map<string, string[]>;
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

function exclusionReason(
  site: NetworkDirectorySite, selfId: string, pills: string[], include: Set<string>, exclude: Set<string>,
): GridExclusionReason | null {
  const id = norm(site.siteId);
  if (id === selfId) return 'self';
  if (site.isGrid) return 'grid_site';
  if (norm(site.status) !== 'live') return 'not_live';
  if (site.account === 'dev1') return 'dev1_account';
  if (exclude.has(id)) return 'excluded';
  if (pills.length === 0 && !include.has(id)) return 'no_matching_vertical';
  return null;
}

/** Applies the spec's source rules 1–5 to every directory site. */
export function resolveSources(dir: NetworkDirectory, grid: ResolvedGridConfig, selfSiteId: string): ResolvedSources {
  const include = new Set(grid.include_sites.map(norm));
  const exclude = new Set(grid.exclude_sites.map(norm));
  const selfId = norm(selfSiteId);
  const result: ResolvedSources = { sources: [], statuses: [], pillsBySite: new Map() };
  for (const site of dir.sites) {
    const vertical = norm(site.vertical);
    const pills = vertical
      ? grid.topics.filter((t) => t.verticals.some((v) => norm(v) === vertical)).map((t) => t.slug)
      : [];
    const reason = exclusionReason(site, selfId, pills, include, exclude);
    result.statuses.push(reason ? { siteId: site.siteId, included: false, reason, pills } : { siteId: site.siteId, included: true, pills });
    if (!reason) {
      result.sources.push(site);
      result.pillsBySite.set(site.siteId, pills);
    }
  }
  return result;
}
```
Run the tests. Expected: PASS.

- [ ] **Checkpoint:** tests green. No commit.

### Task 5: Pool building, pins, topic filter, pagination

**Files:**
- Create: `packages/site-worker/src/lib/grid/feed.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/feed.test.ts`

**Interfaces:**
- Consumes: `ArticleIndexEntry` (`src/lib/kv-schema.ts`), `GridPoolItem`, `GridInactivePin`, `ResolvedGridConfig`.
- Produces:
  - `interface SourceArticles { siteId: string; pills: string[]; articles: readonly ArticleIndexEntry[] }`
  - `interface BuiltPool { items: GridPoolItem[]; inactivePins: GridInactivePin[] }`
  - `buildPool(sources: readonly SourceArticles[], grid: ResolvedGridConfig, now: Date): BuiltPool`
  - `filterByTopic(items: readonly GridPoolItem[], topicSlug: string | null): GridPoolItem[]`
  - `pageSlice<T>(items: readonly T[], page: number, pageSize: number): { slice: T[]; startIndex: number; hasMore: boolean }`

- [ ] **Step 1: Failing tests** (Review Focus #3)

```ts
import { describe, expect, it } from 'vitest';
import { GRID_DEFAULTS, type ResolvedGridConfig } from '@atomic-platform/shared-types';
import type { ArticleIndexEntry } from '../../kv-schema';
import { buildPool, filterByTopic, pageSlice } from '../feed';

const NOW = new Date('2026-09-27T12:00:00Z');
const art = (slug: string, date: string, status: ArticleIndexEntry['status'] = 'published'): ArticleIndexEntry => ({
  slug, title: slug.toUpperCase(), author: 'E', publishDate: date, tags: [], type: 'standard', status,
});
const g = (over: Partial<ResolvedGridConfig> = {}): ResolvedGridConfig => ({ ...GRID_DEFAULTS, ...over });
const srcA = { siteId: 'a', pills: ['travel'], articles: [art('a1', '2026-09-26T00:00:00Z'), art('a2', '2026-09-20T00:00:00Z'), art('a3', '2026-09-10T00:00:00Z'), art('ar', '2026-09-27T00:00:00Z', 'review')] };
const srcB = { siteId: 'b', pills: ['health'], articles: [art('b1', '2026-09-25T00:00:00Z'), art('bad', 'not-a-date')] };

describe('buildPool', () => {
  it('published only, newest first across sources, per_site_limit per source', () => {
    const { items } = buildPool([srcA, srcB], g({ per_site_limit: 2 }), NOW);
    expect(items.map((i) => i.slug)).toEqual(['a1', 'b1', 'a2']);
  });
  it('drops unparseable dates and applies max_age_days', () => {
    const { items } = buildPool([srcA, srcB], g({ max_age_days: 10 }), NOW);
    expect(items.map((i) => i.slug)).toEqual(['a1', 'b1', 'a2']);
  });
  it('pins go first in config order, deduped from natural, even beyond limits', () => {
    const { items } = buildPool([srcA, srcB], g({ per_site_limit: 1, pinned: [
      { site: 'a', slug: 'a3', until: null }, { site: 'b', slug: 'b1' }, { site: 'a', slug: 'a3' },
    ] }), NOW);
    expect(items.map((i) => `${i.slug}:${i.pinned}`)).toEqual(['a3:true', 'b1:true', 'a1:false']);
  });
  it('reports inactive pins with reasons', () => {
    const { inactivePins, items } = buildPool([srcA], g({ pinned: [
      { site: 'a', slug: 'a1', until: '2026-09-26' },
      { site: 'a', slug: 'a1', until: '2026-09-27' },
      { site: 'zz', slug: 'x' },
      { site: 'a', slug: 'ar' },
    ] }), NOW);
    expect(inactivePins.map((p) => p.reason)).toEqual(['expired', 'not_source', 'not_published']);
    expect(items[0]).toMatchObject({ slug: 'a1', pinned: true });
  });
  it('carries source pills onto items', () => {
    expect(buildPool([srcB], g(), NOW).items[0]?.pills).toEqual(['health']);
  });
});

describe('filterByTopic / pageSlice', () => {
  it('filters by pill; null = All', () => {
    const { items } = buildPool([srcA, srcB], g(), NOW);
    expect(filterByTopic(items, 'health').map((i) => i.slug)).toEqual(['b1']);
    expect(filterByTopic(items, null)).toHaveLength(items.length);
  });
  it('paginates with hasMore and startIndex; page < 1 behaves as 1', () => {
    const list = [1, 2, 3, 4, 5];
    expect(pageSlice(list, 1, 2)).toEqual({ slice: [1, 2], startIndex: 0, hasMore: true });
    expect(pageSlice(list, 3, 2)).toEqual({ slice: [5], startIndex: 4, hasMore: false });
    expect(pageSlice(list, 0, 2).startIndex).toBe(0);
    expect(pageSlice(list, 9, 2)).toEqual({ slice: [], startIndex: 16, hasMore: false });
  });
});
```

- [ ] **Step 2: Run to confirm failure**, then implement `feed.ts`:

```ts
import type { GridInactivePin, GridPoolItem, ResolvedGridConfig } from '@atomic-platform/shared-types';
import type { ArticleIndexEntry } from '../kv-schema';

/** One source site's article index, tagged with the pills it feeds. */
export interface SourceArticles {
  siteId: string;
  pills: string[];
  articles: readonly ArticleIndexEntry[];
}

/** Merged, limited, pinned pool for a Grid site. */
export interface BuiltPool {
  items: GridPoolItem[];
  inactivePins: GridInactivePin[];
}

const DAY_MS = 86_400_000;
const time = (iso: string): number => Date.parse(iso);

function toItem(src: SourceArticles, a: ArticleIndexEntry, pinned: boolean): GridPoolItem {
  return {
    site: src.siteId, slug: a.slug, title: a.title, publishDate: a.publishDate,
    ...(a.featuredImage ? { featuredImage: a.featuredImage } : {}),
    ...(a.description ? { description: a.description } : {}),
    pills: src.pills, pinned,
  };
}

/** Rolling window per source + pins (spec "Feed building"). Pure — no KV. */
export function buildPool(sources: readonly SourceArticles[], grid: ResolvedGridConfig, now: Date): BuiltPool {
  const minTime = grid.max_age_days === null ? -Infinity : now.getTime() - grid.max_age_days * DAY_MS;
  const natural: GridPoolItem[] = [];
  for (const src of sources) {
    src.articles
      .filter((a) => a.status === 'published' && time(a.publishDate) >= minTime) // NaN dates fail both checks
      .sort((x, y) => time(y.publishDate) - time(x.publishDate))
      .slice(0, grid.per_site_limit)
      .forEach((a) => natural.push(toItem(src, a, false)));
  }
  natural.sort((x, y) => time(y.publishDate) - time(x.publishDate) || x.site.localeCompare(y.site) || x.slug.localeCompare(y.slug));

  const bySite = new Map(sources.map((s) => [s.siteId, s]));
  const today = now.toISOString().slice(0, 10);
  const pinnedItems: GridPoolItem[] = [];
  const inactivePins: GridInactivePin[] = [];
  const pinnedKeys = new Set<string>();
  for (const pin of grid.pinned) {
    const key = `${pin.site}:${pin.slug}`;
    if (pinnedKeys.has(key)) continue;
    if (pin.until && pin.until < today) { inactivePins.push({ ...pin, reason: 'expired' }); continue; }
    const src = bySite.get(pin.site);
    if (!src) { inactivePins.push({ ...pin, reason: 'not_source' }); continue; }
    const article = src.articles.find((a) => a.slug === pin.slug && a.status === 'published');
    if (!article) { inactivePins.push({ ...pin, reason: 'not_published' }); continue; }
    pinnedKeys.add(key);
    pinnedItems.push(toItem(src, article, true));
  }
  return { items: [...pinnedItems, ...natural.filter((i) => !pinnedKeys.has(`${i.site}:${i.slug}`))], inactivePins };
}

/** Pill feed; null = "All". */
export function filterByTopic(items: readonly GridPoolItem[], topicSlug: string | null): GridPoolItem[] {
  return topicSlug === null ? [...items] : items.filter((i) => i.pills.includes(topicSlug));
}

/** 1-based page slice. `startIndex` keeps the ad cadence continuous across pages. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): { slice: T[]; startIndex: number; hasMore: boolean } {
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const startIndex = (p - 1) * pageSize;
  return { slice: items.slice(startIndex, startIndex + pageSize), startIndex, hasMore: startIndex + pageSize < items.length };
}
```
Note: the second pin in the "inactive" test (`until: '2026-09-27'`, i.e. today) is **active** (inclusive), so `items[0]` is `a1` pinned. That matches the test.
Run the tests. Expected: PASS.

- [ ] **Checkpoint:** tests green. No commit.

### Task 6: Tiles, ad cadence and HTML renderers

**Files:**
- Create: `packages/site-worker/src/lib/grid/tiles.ts`
- Create: `packages/site-worker/src/lib/grid/format.ts`
- Create: `packages/site-worker/src/lib/grid/render.ts`
- Create tests: `packages/site-worker/src/lib/grid/__tests__/tiles.test.ts`, `format.test.ts`, `render.test.ts`

**Interfaces:**
- Consumes: `GridPoolItem`, `NetworkDirectorySite`, `ResolvedGridCardConfig`.
- Produces:
  - `type Tile = { kind: 'story'; item: GridPoolItem; index: number } | { kind: 'ad'; adIndex: number }`
  - `buildTiles(slice: readonly GridPoolItem[], startIndex: number, every: number): Tile[]`
  - `formatAge(iso: string, now: Date): string`
  - `buildOutboundUrl(hostname: string, slug: string, gridHost: string, utm: boolean): string`
  - `escapeHtml(s: string): string`
  - `interface AdPlacementLike { id?: string; position?: string; device?: string; sizes?: { desktop?: number[][]; mobile?: number[][] }; pages?: string[]; code?: string; page_types?: string[]; exclude_pages?: string[] }`
  - `type GridPageType = 'homepage' | 'category' | 'article'`
  - `selectPlacements(placements: readonly AdPlacementLike[], position: string, pageType: GridPageType): AdPlacementLike[]`
  - `interface TileRenderContext { now: Date; card: ResolvedGridCardConfig; showIntro: boolean; sites: ReadonlyMap<string, NetworkDirectorySite>; placements: readonly AdPlacementLike[]; pageType: GridPageType; staging: boolean; reservedHeight: number }`
  - `renderTilesHtml(tiles: readonly Tile[], ctx: TileRenderContext): string`
  - `renderSourceLineHtml(item: GridPoolItem, ctx: TileRenderContext): string`

- [ ] **Step 1: Failing tests `tiles.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { GridPoolItem } from '@atomic-platform/shared-types';
import { buildTiles } from '../tiles';

const items = (n: number): GridPoolItem[] => Array.from({ length: n }, (_, i) => ({
  site: 's', slug: `a${i}`, title: 't', publishDate: '2026-01-01', pills: [], pinned: false,
}));
const shape = (tiles: ReturnType<typeof buildTiles>): string => tiles.map((t) => (t.kind === 'ad' ? 'A' : 'S')).join('');

describe('buildTiles', () => {
  it('every=3 → story, story, ad (dazzr cadence)', () => {
    expect(shape(buildTiles(items(4), 0, 3))).toBe('SSASSA');
    expect(shape(buildTiles(items(6), 0, 3))).toBe('SSASSASSA');
  });
  it('cadence continues across pages via startIndex', () => {
    expect(shape(buildTiles(items(3), 1, 3))).toBe('SASSA');
  });
  it('every=0 → no ads', () => {
    expect(shape(buildTiles(items(4), 0, 0))).toBe('SSSS');
  });
  it('ad indexes are global and increasing', () => {
    const tiles = buildTiles(items(4), 4, 3);
    expect(tiles.filter((t) => t.kind === 'ad').map((t) => (t.kind === 'ad' ? t.adIndex : -1))).toEqual([3, 4]);
  });
});
```

- [ ] **Step 2: Implement `tiles.ts`** and run:

```ts
import type { GridPoolItem } from '@atomic-platform/shared-types';

/** One grid cell. */
export type Tile = { kind: 'story'; item: GridPoolItem; index: number } | { kind: 'ad'; adIndex: number };

/**
 * Interleaves ads so every `every`-th tile is an ad: (every-1) stories, then 1 ad.
 * `startIndex` is the global index of slice[0], so page 2 continues page 1's count.
 */
export function buildTiles(slice: readonly GridPoolItem[], startIndex: number, every: number): Tile[] {
  const tiles: Tile[] = [];
  const run = every >= 2 ? every - 1 : 0;
  slice.forEach((item, i) => {
    const index = startIndex + i;
    tiles.push({ kind: 'story', item, index });
    if (run > 0 && (index + 1) % run === 0) tiles.push({ kind: 'ad', adIndex: (index + 1) / run });
  });
  return tiles;
}
```
Expected: PASS (with `startIndex` 1: story 1 closes run 2 → ad; then 2, 3 → ad — matches `SASSA`).

- [ ] **Step 3: Failing tests `format.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildOutboundUrl, escapeHtml, formatAge } from '../format';

const NOW = new Date('2026-09-27T12:00:00Z');
describe('formatAge', () => {
  it.each([
    ['2026-09-27T11:59:50Z', '1m'], ['2026-09-27T11:15:00Z', '45m'], ['2026-09-27T07:00:00Z', '5h'],
    ['2026-09-22T12:00:00Z', '5d'], ['2026-09-06T12:00:00Z', '3w'], ['2026-05-27T12:00:00Z', '4mo'],
    ['2024-09-27T12:00:00Z', '2y'], ['2026-09-28T12:00:00Z', '1m'], ['garbage', ''],
  ])('%s → %s', (iso, out) => expect(formatAge(iso, NOW)).toBe(out));
});
describe('buildOutboundUrl', () => {
  it('adds UTM when enabled', () => {
    expect(buildOutboundUrl('scienceworld.com', 'best-telescopes', 'grid.example.com', true))
      .toBe('https://scienceworld.com/best-telescopes?utm_source=grid.example.com&utm_medium=grid');
  });
  it('plain URL when disabled', () => {
    expect(buildOutboundUrl('scienceworld.com', 'a', 'g', false)).toBe('https://scienceworld.com/a');
  });
});
describe('escapeHtml', () => {
  it('escapes the five specials', () => expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'));
});
```

- [ ] **Step 4: Implement `format.ts`** and run:

```ts
/** HTML-escapes text for attribute or element content. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** dazzr-style relative age: 1m, 5h, 5d, 3w, 4mo, 2y. Future dates clamp to 1m; invalid → ''. */
export function formatAge(iso: string, now: Date): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const minutes = Math.max(1, Math.floor((now.getTime() - t) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** "Read full story" target on the source site's production host. */
export function buildOutboundUrl(hostname: string, slug: string, gridHost: string, utm: boolean): string {
  const url = new URL(`https://${hostname}/${encodeURIComponent(slug)}`);
  if (utm) {
    url.searchParams.set('utm_source', gridHost);
    url.searchParams.set('utm_medium', 'grid');
  }
  return url.toString();
}
```

- [ ] **Step 5: Failing tests `render.test.ts`** (Review Focus #4)

```ts
import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS, type GridPoolItem, type NetworkDirectorySite } from '@atomic-platform/shared-types';
import { renderTilesHtml, selectPlacements, type TileRenderContext } from '../render';
import { buildTiles } from '../tiles';

const item = (slug: string, over: Partial<GridPoolItem> = {}): GridPoolItem => ({
  site: 'sw', slug, title: `T <${slug}>`, publishDate: '2026-09-26T12:00:00Z', pills: [], pinned: false, ...over,
});
const sites = new Map<string, NetworkDirectorySite>([['sw', {
  siteId: 'sw', hostname: 'scienceworld.com', name: 'Science World', favicon: '/sw/assets/fav.png',
  vertical: 'Science', status: 'Live', isGrid: false, account: 'assets',
}]]);
const ctx = (over: Partial<TileRenderContext> = {}): TileRenderContext => ({
  now: new Date('2026-09-27T12:00:00Z'), card: GRID_CARD_DEFAULTS, showIntro: false, sites,
  placements: [{ id: 'gf', position: 'grid-feed', code: '<script>window.x=1</script>', sizes: { desktop: [[300, 250]] } }],
  pageType: 'homepage', staging: false, reservedHeight: 250, ...over,
});

describe('renderTilesHtml', () => {
  it('renders cards with escaped text, story link, source line and age', () => {
    const html = renderTilesHtml(buildTiles([item('a')], 0, 0), ctx());
    expect(html).toContain('href="/story/sw/a"');
    expect(html).toContain('T &lt;a&gt;');
    expect(html).toContain('Science World');
    expect(html).toContain('>1d<');
    expect(html).toContain('src="/sw/assets/fav.png"');
  });
  it('ad slot ids are unique per tile and carry the AdSlot data contract', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b'), item('c'), item('d')], 0, 3), ctx());
    expect(html.match(/data-ad-id="gf-\d+"/g)).toEqual(['data-ad-id="gf-1"', 'data-ad-id="gf-2"']);
    expect(html).toContain('data-ad-position="grid-feed"');
    expect(html).toContain('class="atl-ad-slot atl-ad-grid-feed"');
    expect(html).toContain('<script>window.x=1</script>');
  });
  it('no grid-feed placement → no ad tile markup at all', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b')], 0, 3), ctx({ placements: [] }));
    expect(html).not.toContain('g-tile--ad');
  });
  it('staging strips widget code but keeps the slot', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b')], 0, 3), ctx({ staging: true }));
    expect(html).toContain('data-ad-id="gf-1"');
    expect(html).not.toContain('<script>');
  });
  it('badge mode puts the source line inside the media block; intro only when enabled', () => {
    const html = renderTilesHtml(buildTiles([item('a', { description: 'Desc' })], 0, 0),
      ctx({ card: { ...GRID_CARD_DEFAULTS, source_position: 'badge' }, showIntro: true }));
    expect(html.indexOf('g-card__source')).toBeLessThan(html.indexOf('g-card__body'));
    expect(html).toContain('<p class="g-card__intro">Desc</p>');
  });
  it('missing favicon → letter avatar; missing image → placeholder', () => {
    const noFav = new Map(sites); noFav.set('sw', { ...sites.get('sw')!, favicon: null });
    const html = renderTilesHtml(buildTiles([item('a')], 0, 0), ctx({ sites: noFav }));
    expect(html).toContain('g-card__favicon--letter');
    expect(html).toContain('src="/placeholder.svg"');
  });
});

describe('selectPlacements', () => {
  it('mirrors AdSlot filtering (page_types, exclude_pages, legacy pages)', () => {
    const p = [
      { id: '1', position: 'grid-feed' },
      { id: '2', position: 'grid-feed', page_types: ['category'] },
      { id: '3', position: 'grid-feed', exclude_pages: ['homepage'] },
      { id: '4', position: 'grid-feed', pages: ['article'] },
      { id: '5', position: 'sidebar' },
    ];
    expect(selectPlacements(p, 'grid-feed', 'homepage').map((x) => x.id)).toEqual(['1']);
    expect(selectPlacements(p, 'grid-feed', 'category').map((x) => x.id)).toEqual(['1', '2', '3']);
  });
});
```

- [ ] **Step 6: Implement `render.ts`** and run:

```ts
import type { GridPoolItem, NetworkDirectorySite, ResolvedGridCardConfig } from '@atomic-platform/shared-types';
import { escapeHtml, formatAge } from './format';
import type { Tile } from './tiles';

/** Structural subset of AdPlacement used by the Grid renderers. */
export interface AdPlacementLike {
  id?: string; position?: string; device?: string;
  sizes?: { desktop?: number[][]; mobile?: number[][] };
  pages?: string[]; code?: string; page_types?: string[]; exclude_pages?: string[];
}

/** Page types as understood by ad placement filters. */
export type GridPageType = 'homepage' | 'category' | 'article';

const EXCLUDE_MAP: Record<GridPageType, string> = { homepage: 'homepage', article: 'articles', category: 'categories' };

/** Same filter semantics as src/components/AdSlot.astro (kept in sync by render.test.ts). */
export function selectPlacements(placements: readonly AdPlacementLike[], position: string, pageType: GridPageType): AdPlacementLike[] {
  return placements.filter((p) => {
    if (p.position !== position) return false;
    if (p.pages && !p.pages.includes(pageType)) return false;
    const pt = p.page_types ?? ['all'];
    if (!pt.includes('all') && !pt.includes(pageType)) return false;
    return !p.exclude_pages?.includes(EXCLUDE_MAP[pageType]);
  });
}

/** Everything the tile renderer needs; built once per request. */
export interface TileRenderContext {
  now: Date;
  card: ResolvedGridCardConfig;
  showIntro: boolean;
  sites: ReadonlyMap<string, NetworkDirectorySite>;
  placements: readonly AdPlacementLike[];
  pageType: GridPageType;
  staging: boolean;
  reservedHeight: number;
}

function faviconHtml(site: NetworkDirectorySite | undefined, fallbackName: string): string {
  if (site?.favicon) {
    return `<img class="g-card__favicon" src="${escapeHtml(site.favicon)}" width="16" height="16" alt="" loading="lazy" decoding="async" />`;
  }
  const letter = escapeHtml((site?.name ?? fallbackName).trim().charAt(0).toUpperCase() || '•');
  return `<span class="g-card__favicon g-card__favicon--letter" aria-hidden="true">${letter}</span>`;
}

/** "[favicon] Site Name · 5d" — shared by cards and the story header. */
export function renderSourceLineHtml(item: GridPoolItem, ctx: TileRenderContext): string {
  const site = ctx.sites.get(item.site);
  const name = escapeHtml(site?.name ?? item.site);
  return `<p class="g-card__source">${faviconHtml(site, item.site)}<span class="g-card__site">${name}</span>`
    + `<span class="g-card__dot" aria-hidden="true">·</span><time datetime="${escapeHtml(item.publishDate)}">${escapeHtml(formatAge(item.publishDate, ctx.now))}</time></p>`;
}

function renderCardHtml(item: GridPoolItem, index: number, ctx: TileRenderContext): string {
  const href = `/story/${encodeURIComponent(item.site)}/${encodeURIComponent(item.slug)}`;
  const img = escapeHtml(item.featuredImage || '/placeholder.svg');
  const source = renderSourceLineHtml(item, ctx);
  const badge = ctx.card.source_position === 'badge';
  const intro = ctx.showIntro && item.description ? `<p class="g-card__intro">${escapeHtml(item.description)}</p>` : '';
  return `<article class="g-tile g-card" style="--g-i:${index % 20}"${item.pinned ? ' data-pinned="true"' : ''}>`
    + `<a class="g-card__link" href="${href}">`
    + `<div class="g-card__media"><img src="${img}" alt="" loading="lazy" decoding="async" />${badge ? source : ''}</div>`
    + `<div class="g-card__body">${badge ? '' : source}<h3 class="g-card__title">${escapeHtml(item.title)}</h3>${intro}</div>`
    + `</a></article>`;
}

function renderAdHtml(adIndex: number, ctx: TileRenderContext): string {
  const placements = selectPlacements(ctx.placements, 'grid-feed', ctx.pageType);
  if (placements.length === 0) return '';
  const minHeight = ctx.reservedHeight ? ` style="min-height:${ctx.reservedHeight}px"` : '';
  const slots = placements.map((p) => {
    const id = `${p.id ?? 'grid-feed'}-${adIndex}`;
    const code = ctx.staging ? '' : (p.code ?? '');
    return `<div data-ad-id="${escapeHtml(id)}" data-ad-position="grid-feed" data-ad-page-type="${ctx.pageType}"`
      + ` data-ad-device="${escapeHtml(p.device ?? 'all')}" data-sizes-desktop="${escapeHtml(JSON.stringify(p.sizes?.desktop ?? []))}"`
      + ` data-sizes-mobile="${escapeHtml(JSON.stringify(p.sizes?.mobile ?? []))}" class="atl-ad-slot atl-ad-grid-feed"${minHeight}>${code}</div>`;
  }).join('');
  return `<div class="g-tile g-tile--ad">${slots}</div>`;
}

/** Server-side and /api/feed share this renderer so both produce identical markup. */
export function renderTilesHtml(tiles: readonly Tile[], ctx: TileRenderContext): string {
  return tiles.map((t) => (t.kind === 'story' ? renderCardHtml(t.item, t.index, ctx) : renderAdHtml(t.adIndex, ctx))).join('\n');
}
```

- [ ] **Checkpoint:** all three test files green. No commit.

### Task 7: Excerpt builder + link absolutising

**Files:**
- Create: `packages/site-worker/src/lib/grid/excerpt.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/excerpt.test.ts`

**Interfaces:**
- Produces:
  - `stripUnsafe(html: string): string`
  - `splitTopLevelBlocks(html: string): Array<{ tag: string; html: string }>`
  - `buildExcerpt(html: string, paragraphs: number): string`
  - `absolutizeLinks(html: string, hostname: string): string`

- [ ] **Step 1: Failing tests** (Review Focus #2)

```ts
import { describe, expect, it } from 'vitest';
import { absolutizeLinks, buildExcerpt, splitTopLevelBlocks, stripUnsafe } from '../excerpt';

const P = (n: number): string => Array.from({ length: n }, (_, i) => `<p>P${i + 1}</p>`).join('\n');

describe('buildExcerpt', () => {
  it('takes N paragraphs, keeping headings in between', () => {
    const html = `<p>P1</p><h2>H</h2><p>P2</p><p>P3</p><p>P4</p><p>P5</p><p>P6</p><p>P7</p>`;
    expect(buildExcerpt(html, 3)).toBe('<p>P1</p>\n<h2>H</h2>\n<p>P2</p>\n<p>P3</p>');
  });
  it('caps at half the article (never most of it)', () => {
    expect(buildExcerpt(P(4), 3)).toBe('<p>P1</p>\n<p>P2</p>');
    expect(buildExcerpt(P(3), 3)).toBe('<p>P1</p>');
  });
  it('single-paragraph article shows that paragraph; none → empty', () => {
    expect(buildExcerpt('<p>Only</p>', 3)).toBe('<p>Only</p>');
    expect(buildExcerpt('<h2>No paragraphs</h2>', 3)).toBe('');
  });
  it('takes lists whole, never splitting nested lists', () => {
    const html = '<p>P1</p><ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><p>P2</p><p>P3</p><p>P4</p><p>P5</p><p>P6</p>';
    expect(buildExcerpt(html, 2)).toBe('<p>P1</p>\n<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>\n<p>P2</p>');
  });
  it('drops iframes, scripts, figures, images and the image-only paragraphs they leave behind', () => {
    const html = '<p><img src="x.jpg"></p><iframe src="y"></iframe><script>bad()</script><figure><img src="z"/></figure><p>Real 1</p><p>Real 2</p><p>Real 3</p>';
    expect(buildExcerpt(html, 3)).toBe('<p>Real 1</p>');
  });
  it('drops top-level divs and h1', () => {
    expect(buildExcerpt('<h1>T</h1><div class="embed">x</div><p>A</p><p>B</p>', 3)).toBe('<p>A</p>');
  });
});

describe('absolutizeLinks', () => {
  it('rewrites root-relative hrefs to the source host, leaves others alone', () => {
    const html = '<a href="/other-article">x</a><a href="https://ext.com/a">y</a><a href="//cdn.com/z">z</a><a href="#top">t</a>';
    expect(absolutizeLinks(html, 'travel-a.com')).toBe(
      '<a href="https://travel-a.com/other-article">x</a><a href="https://ext.com/a">y</a><a href="//cdn.com/z">z</a><a href="#top">t</a>',
    );
  });
});

describe('helpers', () => {
  it('stripUnsafe removes comments and paired unsafe tags', () => {
    expect(stripUnsafe('<!-- c --><p>a</p><style>p{}</style><video><source src="v"></video>')).toBe('<p>a</p>');
  });
  it('splitTopLevelBlocks ignores void tags when tracking depth', () => {
    expect(splitTopLevelBlocks('<p>a<br>b</p><hr><p>c</p>').map((b) => b.tag)).toEqual(['p', 'p']);
  });
});
```

- [ ] **Step 2: Run to confirm failure**, then implement `excerpt.ts`:

```ts
const STRIP_PAIRED = ['script', 'style', 'iframe', 'video', 'audio', 'figure', 'noscript', 'object', 'svg', 'picture'];
const STRIP_VOID = /<(img|embed|source|input)\b[^>]*>/gi;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ALLOWED_BLOCKS = new Set(['p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'table', 'pre']);

/** Removes comments, embeds, media and scripts from article HTML. */
export function stripUnsafe(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of STRIP_PAIRED) out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  return out.replace(STRIP_VOID, '');
}

/** Splits well-formed HTML (marked output) into its top-level elements. */
export function splitTopLevelBlocks(html: string): Array<{ tag: string; html: string }> {
  const blocks: Array<{ tag: string; html: string }> = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = -1;
  let tag = '';
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const name = (m[2] ?? '').toLowerCase();
    if (!closing && (m[3] === '/' || VOID.has(name))) continue;
    if (!closing) {
      if (depth === 0) { start = m.index; tag = name; }
      depth += 1;
    } else {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        blocks.push({ tag, html: html.slice(start, m.index + m[0].length) });
        start = -1;
      }
    }
  }
  return blocks;
}

const textOf = (html: string): string => html.replace(/<[^>]+>/g, '').trim();

/**
 * Opening of an article for a Grid story page: whole top-level blocks until `paragraphs`
 * <p> blocks are included, capped at half the article's paragraphs (min 1).
 */
export function buildExcerpt(html: string, paragraphs: number): string {
  const blocks = splitTopLevelBlocks(stripUnsafe(html))
    .filter((b) => ALLOWED_BLOCKS.has(b.tag) && !(b.tag === 'p' && textOf(b.html) === ''));
  const total = blocks.filter((b) => b.tag === 'p').length;
  if (total === 0) return '';
  const limit = Math.min(paragraphs, Math.max(1, Math.floor(total / 2)));
  const out: string[] = [];
  let count = 0;
  for (const b of blocks) {
    out.push(b.html);
    if (b.tag === 'p' && ++count >= limit) break;
  }
  return out.join('\n');
}

/** Root-relative links in a source article point at the source site, not the Grid site. */
export function absolutizeLinks(html: string, hostname: string): string {
  return html.replace(/href="\/(?!\/)/g, `href="https://${hostname}/`);
}
```
Run the tests. Expected: PASS.

- [ ] **Checkpoint:** tests green. No commit.

### Task 8: KV loaders, edge cache and `GET /api/pool` (the contract for dashboard + pipeline)

**Files:**
- Modify: `packages/site-worker/src/lib/kv-schema.ts`: append two key builders
- Create: `packages/site-worker/src/lib/grid/load.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/load.test.ts`
- Create: `packages/site-worker/src/pages/grid/api/pool.ts`

**Interfaces:**
- Consumes: `resolveSources` (Task 4), `buildPool` / `SourceArticles` / `BuiltPool` (Task 5), `getGridContext` (Task 3).
- Produces:
  - `networkDirectoryKey(): string`, `gridSummaryKey(siteId: string, slug: string): string`
  - `interface KvReader { get<T>(key: string, type: 'json'): Promise<T | null> }`
  - `interface JsonCache { get(key: string): Promise<unknown>; put(key: string, value: unknown, ttlSeconds: number): Promise<void> }`
  - `NO_CACHE: JsonCache`, `edgeCache(): JsonCache`, `hashString(s: string): string`
  - `interface GridPoolData { directory: NetworkDirectory | null; resolved: ResolvedSources; pool: BuiltPool; missingIndexes: string[] }`
  - `loadGridPool(kv: KvReader, cache: JsonCache, siteId: string, grid: ResolvedGridConfig, now: Date): Promise<GridPoolData>`
  - `toPoolResponse(data: GridPoolData, siteId: string, grid: ResolvedGridConfig, now: Date): GridPoolResponse`
  - HTTP `GET /api/pool[?summaries=1]` → `GridPoolResponse` JSON, `cache-control: private, no-store`

- [ ] **Step 1: Append to `kv-schema.ts`**

```ts
/** Grid template: network-wide site directory (written by scripts/seed-grid.ts). */
export const networkDirectoryKey = (): string => 'network-directory';
/** Grid template: rendered AI summary for one source article (written by scripts/seed-grid.ts). */
export const gridSummaryKey = (siteId: string, slug: string): string => `grid-summary:${siteId}:${slug}`;
```
Add a case to the existing `src/lib/__tests__/kv-schema.test.ts` asserting both key formats. This adds cases only; existing assertions stay unchanged.

- [ ] **Step 2: Failing tests `load.test.ts`** (Review Focus #5)

```ts
import { describe, expect, it, vi } from 'vitest';
import { GRID_DEFAULTS, type NetworkDirectory, type ResolvedGridConfig } from '@atomic-platform/shared-types';
import { hashString, loadGridPool, NO_CACHE, toPoolResponse, type JsonCache, type KvReader } from '../load';

const NOW = new Date('2026-09-27T12:00:00Z');
const grid: ResolvedGridConfig = { ...GRID_DEFAULTS, topics: [{ label: 'Travel', slug: 'travel', verticals: ['Travel'] }] };
const directory: NetworkDirectory = { generatedAt: 'g1', sites: [
  { siteId: 'a', hostname: 'a.com', name: 'A', favicon: null, vertical: 'Travel', status: 'Live', isGrid: false, account: 'assets' },
  { siteId: 'b', hostname: 'b.com', name: 'B', favicon: null, vertical: 'Travel', status: 'Live', isGrid: false, account: 'assets' },
] };
const article = { slug: 'a1', title: 'A1', author: 'E', publishDate: '2026-09-26T00:00:00Z', tags: [], type: 'standard', status: 'published' };
function fakeKv(data: Record<string, unknown>, throwKeys: string[] = []): KvReader {
  return { get: async <T,>(key: string): Promise<T | null> => { if (throwKeys.includes(key)) throw new Error('kv down'); return (data[key] as T) ?? null; } };
}

describe('loadGridPool', () => {
  it('missing directory → empty result, no throw', async () => {
    const r = await loadGridPool(fakeKv({}), NO_CACHE, 'me', grid, NOW);
    expect(r.directory).toBeNull();
    expect(r.pool.items).toEqual([]);
  });
  it('missing or throwing source index → that source skipped and reported, others render', async () => {
    const r = await loadGridPool(fakeKv({ 'network-directory': directory, 'article-index:a': [article] }, ['article-index:b']), NO_CACHE, 'me', grid, NOW);
    expect(r.pool.items.map((i) => i.slug)).toEqual(['a1']);
    expect(r.missingIndexes).toEqual(['b']);
  });
  it('uses the cache on the second call (keyed by site, directory version and config hash)', async () => {
    const store = new Map<string, unknown>();
    const cache: JsonCache = { get: async (k) => store.get(k) ?? null, put: vi.fn(async (k, v) => { store.set(k, v); }) };
    const kv = fakeKv({ 'network-directory': directory, 'article-index:a': [article], 'article-index:b': [] });
    const spy = vi.spyOn(kv, 'get');
    await loadGridPool(kv, cache, 'me', grid, NOW);
    const callsAfterFirst = spy.mock.calls.length;
    await loadGridPool(kv, cache, 'me', grid, NOW);
    expect(spy.mock.calls.length).toBe(callsAfterFirst + 1);
    expect([...store.keys()][0]).toBe(`pool:me:g1:${hashString(JSON.stringify(grid))}`);
  });
});

describe('toPoolResponse', () => {
  it('marks missing-index sources as excluded with reason missing_index', async () => {
    const data = await loadGridPool(fakeKv({ 'network-directory': directory, 'article-index:a': [article] }), NO_CACHE, 'me', grid, NOW);
    const res = toPoolResponse(data, 'me', grid, NOW);
    expect(res.sources.find((s) => s.siteId === 'b')).toMatchObject({ included: false, reason: 'missing_index' });
    expect(res).toMatchObject({ siteId: 'me', storyMode: 'excerpt', perSiteLimit: 10, directoryGeneratedAt: 'g1' });
  });
});
```

- [ ] **Step 3: Implement `load.ts`**

```ts
import type { GridPoolResponse, NetworkDirectory, ResolvedGridConfig } from '@atomic-platform/shared-types';
import { articleIndexKey, networkDirectoryKey, type ArticleIndexEntry } from '../kv-schema';
import { buildPool, type BuiltPool, type SourceArticles } from './feed';
import { resolveSources, type ResolvedSources } from './sources';

/** Minimal KV surface (lets unit tests use a Map-backed fake). */
export interface KvReader {
  get<T>(key: string, type: 'json'): Promise<T | null>;
}

/** Minimal JSON cache surface over the Workers Cache API. */
export interface JsonCache {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

/** Cache that never hits — used on staging so Asaf sees changes immediately. */
export const NO_CACHE: JsonCache = { get: async () => null, put: async () => undefined };

/** Workers Cache API adapter; falls back to NO_CACHE outside workerd. */
export function edgeCache(): JsonCache {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return NO_CACHE;
  const req = (key: string): Request => new Request(`https://grid-cache.internal/${encodeURIComponent(key)}`);
  return {
    async get(key) {
      const res = await cache.match(req(key));
      return res ? res.json() : null;
    },
    async put(key, value, ttlSeconds) {
      await cache.put(req(key), new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
      }));
    },
  };
}

/** FNV-1a — stable short hash for cache keys. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Directory + resolution + pool for one Grid site. */
export interface GridPoolData {
  directory: NetworkDirectory | null;
  resolved: ResolvedSources;
  pool: BuiltPool;
  missingIndexes: string[];
}

const EMPTY: Omit<GridPoolData, 'directory'> = {
  resolved: { sources: [], statuses: [], pillsBySite: new Map() },
  pool: { items: [], inactivePins: [] },
  missingIndexes: [],
};

async function safeGet<T>(kv: KvReader, key: string): Promise<T | null> {
  try {
    return await kv.get<T>(key, 'json');
  } catch (error) {
    console.error(`[grid] KV read failed for ${key}`, error);
    return null;
  }
}

/** Loads everything a Grid page needs. Never throws on missing data (empty state instead). */
export async function loadGridPool(kv: KvReader, cache: JsonCache, siteId: string, grid: ResolvedGridConfig, now: Date): Promise<GridPoolData> {
  const directory = await safeGet<NetworkDirectory>(kv, networkDirectoryKey());
  if (!directory) {
    console.error(`[grid] ${networkDirectoryKey()} missing — rendering empty state for ${siteId}`);
    return { directory: null, ...EMPTY };
  }
  const resolved = resolveSources(directory, grid, siteId);
  const cacheKey = `pool:${siteId}:${directory.generatedAt}:${hashString(JSON.stringify(grid))}`;
  const cached = (await cache.get(cacheKey)) as { pool: BuiltPool; missingIndexes: string[] } | null;
  if (cached) return { directory, resolved, ...cached };

  const indexes = await Promise.all(resolved.sources.map(async (s) => ({
    siteId: s.siteId, index: await safeGet<ArticleIndexEntry[]>(kv, articleIndexKey(s.siteId)),
  })));
  const missingIndexes = indexes.filter((r) => !r.index).map((r) => r.siteId);
  const sourceArticles: SourceArticles[] = indexes
    .filter((r): r is { siteId: string; index: ArticleIndexEntry[] } => Array.isArray(r.index))
    .map((r) => ({ siteId: r.siteId, pills: resolved.pillsBySite.get(r.siteId) ?? [], articles: r.index }));
  const pool = buildPool(sourceArticles, grid, now);
  await cache.put(cacheKey, { pool, missingIndexes }, 300);
  return { directory, resolved, pool, missingIndexes };
}

/** Shapes GridPoolData into the public /api/pool contract. */
export function toPoolResponse(data: GridPoolData, siteId: string, grid: ResolvedGridConfig, now: Date): GridPoolResponse {
  const missing = new Set(data.missingIndexes);
  return {
    siteId,
    generatedAt: now.toISOString(),
    storyMode: grid.story_mode,
    perSiteLimit: grid.per_site_limit,
    directoryGeneratedAt: data.directory?.generatedAt ?? null,
    sources: data.resolved.statuses.map((s) => (missing.has(s.siteId) ? { ...s, included: false, reason: 'missing_index' as const } : s)),
    items: data.pool.items,
    inactivePins: data.pool.inactivePins,
  };
}
```
Run: `pnpm test -- src/lib/grid/__tests__/load.test.ts`. Expected: PASS.
In the cache test, the second call makes exactly one KV read (the directory), then serves from cache.

- [ ] **Step 4: `src/pages/grid/api/pool.ts`**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { GridSummaryRecord, GridSummaryStatus } from '@atomic-platform/shared-types';
import { getGridContext, notFound } from '../../../lib/grid/context';
import { edgeCache, loadGridPool, NO_CACHE, toPoolResponse } from '../../../lib/grid/load';
import { gridSummaryKey } from '../../../lib/kv-schema';

export const prerender = false;

function statusOf(rec: GridSummaryRecord | null): GridSummaryStatus {
  if (!rec) return 'none';
  if (rec.edited && rec.sourceChanged) return 'stale';
  return rec.edited ? 'edited' : 'generated';
}

/** JSON pool for the dashboard Stories tab and the content-pipeline (spec: /api/pool). */
export const GET: APIRoute = async (ctx) => {
  const g = getGridContext(ctx);
  if (!g) return notFound();
  const now = new Date();
  const data = await loadGridPool(env.CONFIG_KV, g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
  const body = toPoolResponse(data, g.siteId, g.grid, now);
  if (ctx.url.searchParams.get('summaries') === '1') {
    body.items = await Promise.all(body.items.map(async (item) => {
      const rec = await env.CONFIG_KV.get<GridSummaryRecord>(gridSummaryKey(item.site, item.slug), 'json');
      return { ...item, summary: rec ? { status: statusOf(rec), generatedAt: rec.generatedAt } : { status: 'none' as const } };
    }));
  }
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
};
```

Typing note: if TypeScript rejects passing `env.CONFIG_KV` (overloaded `get`) where a `KvReader` is expected, add this to `load.ts` and use `kvReader(env.CONFIG_KV)` in every Grid page:
```ts
/** Adapts the Workers KV binding to KvReader. */
export function kvReader(ns: { get(key: string, type: 'json'): Promise<unknown> }): KvReader {
  return { get: async <T,>(key: string): Promise<T | null> => (await ns.get(key, 'json')) as T | null };
}
```

- [ ] **Step 5: Verify in workerd**

With `pnpm dev:worker` running:
`curl -s "http://localhost:8788/api/pool?_atl_site=fixture-grid" | jq '{n:(.items|length), src:[.sources[]|{siteId,included,reason}]}'`
Expected:
- The 3 fixture sources are included.
- `fixture-grid` itself shows `reason: "self"`.
- 12 items (3 sources × `per_site_limit: 4`), with no `review` article.

- [ ] **Checkpoint:** tests green; curl output saved to `docs/test-results/2026-09-27-grid-pool.txt`. No commit.

> **Parallelism note:** after Task 8, Phases C (worker UI), D (sync), E (pipeline) and F (dashboard) touch disjoint files and can run in parallel. Their only shared contract is the `GridPoolResponse` from Task 8.

---

## Phase C — Worker UI (design skills required)

### Task 9: Design direction, GridLayout shell, base stylesheet

**Files:**
- Create: `docs/superpowers/specs/2026-09-27-grid-design-direction.md`
- Create: `packages/site-worker/src/themes/grid/GridLayout.astro`
- Create: `packages/site-worker/src/themes/grid/styles/grid.css`
- Create: `packages/site-worker/src/lib/grid/head.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/head.test.ts`

**Interfaces:**
- Consumes: `GridContext` (Task 3).
- Produces:
  - `GridLayout.astro` props: `{ title: string; description: string; pageType: 'homepage' | 'article' | 'category'; image?: string; noindex?: boolean }`. Slots: default + `head`.
  - `<body class="g-body">` data attributes: `data-card-style`, `data-card-corners`, `data-card-ratio`, `data-card-image`, `data-card-density`, `data-card-source`.
  - `cardBodyAttributes(card: ResolvedGridCardConfig): Record<string, string>`.

- [ ] **Step 1: Load the design skills and write the direction doc**

Invoke the `ui-ux-pro-max`, `design-taste-frontend` and `frontend-design` skills.
Study https://dazzr.com/topic/news at 1440px and 390px widths (WebFetch/curl the HTML + CSS as in the brainstorm).
Write `docs/superpowers/specs/2026-09-27-grid-design-direction.md` (≤ 1 page) covering:
- **Type scale:** headline sizes for card, story H1 and summary H2/H3, using `clamp()`.
- **Spacing scale** and grid gap.
- **Card anatomy:** measurements for media inset, body padding, the source line (16px favicon, 0.85rem meta) and a 3-line headline clamp.
- **Header anatomy:** logo row, full-width search, pill row with horizontal scroll on mobile, 44px min touch targets.
- **Motion:** 0.8s `cubic-bezier(.22,1,.36,1)` fade-in-up, 60ms stagger via `--g-i`, disabled under `prefers-reduced-motion`.
- **Focus and a11y:** a visible 2px accent focus ring; WCAG AA contrast of text on `--g-card-bg`.
- **Constraints:** the design MUST use only the CSS variables defined in Step 3, and every selector MUST be `.g-*` or `body.g-body *` scoped. No new fonts beyond `theme.fonts`.

- [ ] **Step 2: Failing test `head.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS } from '@atomic-platform/shared-types';
import { cardBodyAttributes } from '../head';

describe('cardBodyAttributes', () => {
  it('maps the card look to body data attributes', () => {
    expect(cardBodyAttributes({ ...GRID_CARD_DEFAULTS, style: 'shadow', image_ratio: '16:9' })).toEqual({
      'data-card-style': 'shadow', 'data-card-corners': 'rounded', 'data-card-ratio': '16-9',
      'data-card-image': 'top', 'data-card-density': 'comfortable', 'data-card-source': 'below',
    });
  });
});
```
Implement `head.ts`:
```ts
import type { ResolvedGridCardConfig } from '@atomic-platform/shared-types';

/** Card look → <body> data attributes consumed by grid.css (ratio "4:3" → "4-3" for valid selectors). */
export function cardBodyAttributes(card: ResolvedGridCardConfig): Record<string, string> {
  return {
    'data-card-style': card.style,
    'data-card-corners': card.corners,
    'data-card-ratio': card.image_ratio.replace(':', '-'),
    'data-card-image': card.image_position,
    'data-card-density': card.density,
    'data-card-source': card.source_position,
  };
}
```
Run: `pnpm test -- src/lib/grid/__tests__/head.test.ts`. Expected: PASS.

- [ ] **Step 3: `GridLayout.astro`: copy `src/layouts/BaseLayout.astro`, then apply exactly these changes**

1. Replace `import '../themes/modern/styles/theme.css';` with `import './styles/grid.css';`. Fix the other relative imports for the new location: `../../lib/config`, `../../lib/contrast`, `../../components/PixelLoader.astro`, `../../components/InterstitialLoader.astro`.
2. Props become:
```ts
interface Props {
  title: string;
  description: string;
  pageType: 'homepage' | 'article' | 'category';
  /** Absolute or root-relative share image. */
  image?: string;
  noindex?: boolean;
}
const { title, description, pageType, image, noindex = false } = Astro.props;
```
3. Add after the `cssVars` block:
```ts
import { getGridContext } from '../../lib/grid/context';
import { cardBodyAttributes } from '../../lib/grid/head';
const gridCtx = getGridContext(Astro);
const bodyAttrs = gridCtx ? cardBodyAttributes(gridCtx.card) : {};
```
(Hoist the two imports to the top of the frontmatter with the others.)
4. In `<head>`, directly after `<meta name="description" …/>`, add:
```astro
    {noindex && <meta name="robots" content="noindex" />}
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:site_name" content={config.site_name} />
    {image && <meta property="og:image" content={image} />}
    <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
```
(Deliberately no `<link rel="canonical">`, per the spec decision.)
5. Change `<body>` to `<body class="g-body" {...bodyAttrs}>`.
6. Delete the newsletter-form `<script is:inline>` block (Grid has no newsletter form).

Leave everything else identical: fonts, `cssVars` including `--color-*` for every key in `theme.colors` (which is how the Grid-only colour keys arrive), script injection and staging filtering, PixelLoader, InterstitialLoader.

- [ ] **Step 4: `styles/grid.css`: tokens, reset and base layout**

```css
/* Grid template stylesheet. Loaded only by GridLayout → only on /grid/* routes.
   Every rule is scoped to .g-* classes or body.g-body so it can never touch modern pages. */
@layer grid-defaults {
  :root {
    --g-page-bg: var(--color-background, #f1f4f8);
    --g-surface: var(--color-surface, #ffffff);
    --g-card-bg: var(--color-card_bg, var(--g-surface));
    --g-border: var(--color-border, #e3e6ee);
    --g-card-border: var(--color-card_border, var(--g-border));
    --g-text: var(--color-text, #281848);
    --g-muted: var(--color-muted, #6b6680);
    --g-heading: var(--color-heading, var(--g-text));
    --g-accent: var(--color-accent, #6c35bb);
    --g-accent-fg: var(--color-accent-fg, #ffffff);
    --g-link: var(--color-link, var(--g-accent));
    --g-link-hover: var(--color-link_hover, var(--g-heading));
    --g-pill-text: var(--color-nav_link, var(--g-text));
    --g-pill-hover: var(--color-nav_link_hover, var(--g-accent));
    --g-pill-border: var(--color-pill_border, var(--g-border));
    --g-pill-active-bg: var(--color-pill_active_bg, transparent);
    --g-pill-active-text: var(--color-pill_active_text, var(--g-accent));
    --g-search-bg: var(--color-search_bg, var(--g-surface));
    --g-prose-heading: var(--color-prose_heading, var(--g-heading));
    --g-prose-body: var(--color-prose_body, var(--g-text));
    --g-footer-bg: var(--color-footer_bg, transparent);
    --g-footer-text: var(--color-footer_text, var(--g-muted));
    --g-footer-link: var(--color-footer_link, var(--g-muted));
    --g-footer-link-hover: var(--color-footer_link_hover, var(--g-accent));
    --g-radius: 12px;
    --g-radius-img: 9px;
    --g-radius-pill: 999px;
    --g-gap: 12px;
    --g-page-max: 1630px;
    --g-gutter: clamp(12px, 2vw, 24px);
    --g-card-min: 280px;
    --g-img-ratio: 4 / 3;
    --g-ease: cubic-bezier(.22, 1, .36, 1);
  }
}

body.g-body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; background: var(--g-page-bg); color: var(--g-text); -webkit-font-smoothing: antialiased; }
body.g-body *, body.g-body *::before, body.g-body *::after { box-sizing: border-box; }
body.g-body img { max-width: 100%; display: block; }
body.g-body a { color: inherit; text-decoration: none; }
body.g-body :focus-visible { outline: 2px solid var(--g-accent); outline-offset: 2px; border-radius: 4px; }

.g-main { flex: 1 0 auto; width: 100%; max-width: var(--g-page-max); margin: 0 auto; padding: 16px var(--g-gutter) 48px; }
.g-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--g-card-min), 100%), 1fr)); gap: var(--g-gap); }
.g-empty { padding: 64px 16px; text-align: center; color: var(--g-muted); }

/* Cards */
.g-card { background: var(--g-card-bg); border: 1px solid var(--g-card-border); border-radius: var(--g-radius); overflow: hidden; min-width: 0; height: 100%;
  opacity: 0; animation: g-rise .8s var(--g-ease) forwards; animation-delay: calc(var(--g-i, 0) * 60ms); transition: box-shadow .3s ease-out; }
.g-card:hover { box-shadow: 0 6px 24px rgb(0 0 0 / .08); }
.g-card__link { display: flex; flex-direction: column; height: 100%; }
.g-card__media { position: relative; margin: 8px 8px 0; }
.g-card__media img { width: 100%; aspect-ratio: var(--g-img-ratio); object-fit: cover; border-radius: var(--g-radius-img); background: var(--g-border); }
.g-card__body { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px 14px; flex: 1 1 auto; }
.g-card__source { display: flex; align-items: center; gap: 6px; margin: 0; font-size: .85rem; color: var(--g-muted); min-width: 0; }
.g-card__favicon { width: 16px; height: 16px; border-radius: 3px; flex: 0 0 16px; }
.g-card__favicon--letter { display: inline-grid; place-items: center; background: var(--g-accent); color: var(--g-accent-fg); font-size: 10px; font-weight: 700; }
.g-card__site { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-card__title { margin: 0; color: var(--g-heading); font-size: 1.1rem; font-weight: 700; line-height: 1.25;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.g-card__intro { margin: 0; font-size: 1rem; line-height: 1.4; opacity: .6;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.g-card[data-pinned="true"] { border-color: var(--g-accent); }
.g-tile--ad { max-height: 300px; overflow: hidden; border-radius: var(--g-radius); min-width: 0; }

.g-feed-status { text-align: center; color: var(--g-muted); padding: 16px; min-height: 1em; }
.g-sentinel { height: 1px; }

@keyframes g-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .g-card { animation: none; opacity: 1; } }
```
Header, footer and story styles are appended by Tasks 10–13. Card-look variants are added by Task 14.

- [ ] **Step 5: Verify the shell renders in workerd**

Temporarily change `src/pages/grid/index.astro` to wrap its placeholder in `<GridLayout title="t" description="d" pageType="homepage">`. Then check:
- `curl -s "http://localhost:8788/?_atl_site=fixture-grid" | grep -c 'class="g-body"'` → 1
- The page's `/_astro/*.css` links contain Grid rules (`g-card`) and no modern selectors (e.g. `grep -c "must-reads"` on that CSS returns 0).
- The modern homepage CSS list still equals the baseline (Task 3 Step 6 check).

- [ ] **Checkpoint:** head test green; CSS isolation verified. No commit.

### Task 10: Header, topic pills, mobile drawer, footer

**Files:**
- Create: `packages/site-worker/src/themes/grid/components/GridHeader.astro`
- Create: `packages/site-worker/src/themes/grid/components/GridFooter.astro`
- Create: `packages/site-worker/src/lib/grid/nav.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/nav.test.ts`
- Modify: `packages/site-worker/src/themes/grid/styles/grid.css` (append header/footer rules)

**Interfaces:**
- Consumes: `ResolvedGridTopic[]`, `ResolvedConfig`.
- Produces:
  - `interface NavPill { label: string; href: string; active: boolean }`
  - `buildPills(topics: readonly ResolvedGridTopic[], activeTopic: string | null): NavPill[]`
  - `GridHeader` props: `{ config: ResolvedConfig; topics: ResolvedGridTopic[]; activeTopic: string | null; query?: string }`
  - `GridFooter` props: `{ config: ResolvedConfig }`

- [ ] **Step 1: Failing test `nav.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildPills } from '../nav';

describe('buildPills', () => {
  const topics = [{ label: 'Travel', slug: 'travel', verticals: [] }, { label: 'Health', slug: 'health', verticals: [] }];
  it('prepends All and marks the active pill', () => {
    expect(buildPills(topics, 'health')).toEqual([
      { label: 'All', href: '/', active: false },
      { label: 'Travel', href: '/topic/travel', active: false },
      { label: 'Health', href: '/topic/health', active: true },
    ]);
  });
  it('All is active on the homepage (null topic)', () => {
    expect(buildPills(topics, null)[0]?.active).toBe(true);
  });
});
```
Implement `nav.ts`:
```ts
import type { ResolvedGridTopic } from '@atomic-platform/shared-types';

/** One header pill. */
export interface NavPill { label: string; href: string; active: boolean }

/** "All" + one pill per configured topic, in config order. */
export function buildPills(topics: readonly ResolvedGridTopic[], activeTopic: string | null): NavPill[] {
  return [
    { label: 'All', href: '/', active: activeTopic === null },
    ...topics.map((t) => ({ label: t.label, href: `/topic/${t.slug}`, active: t.slug === activeTopic })),
  ];
}
```
Run the test. Expected: PASS.

- [ ] **Step 2: `GridHeader.astro`** (apply the design direction from Task 9; the structure and behaviour below are required)

```astro
---
import type { ResolvedConfig, ResolvedGridTopic } from '@atomic-platform/shared-types';
import { buildPills } from '../../../lib/grid/nav';
interface Props { config: ResolvedConfig; topics: ResolvedGridTopic[]; activeTopic: string | null; query?: string }
const { config, topics, activeTopic, query = '' } = Astro.props;
const pills = buildPills(topics, activeTopic);
const logo = config.theme.logo;
---
<header class="g-header">
  <div class="g-header__row">
    <a class="g-header__logo" href="/" aria-label={`${config.site_name} home`}>
      {logo ? <img src={logo} alt={config.site_name} /> : <span class="g-header__name">{config.site_name}</span>}
    </a>
    <button class="g-header__burger" type="button" aria-expanded="false" aria-controls="g-drawer" data-g-burger>
      <span class="g-sr">Topics</span><span></span><span></span><span></span>
    </button>
  </div>
  <form class="g-search" action="/search" method="get" role="search">
    <input class="g-search__input" type="search" name="q" value={query} placeholder={`Search ${config.site_name}…`} aria-label="Search stories" />
  </form>
  <nav class="g-pills" aria-label="Topics">
    {pills.map((p) => <a class:list={['g-pill', { 'is-active': p.active }]} href={p.href} aria-current={p.active ? 'page' : undefined}>{p.label}</a>)}
  </nav>
  <div class="g-drawer" id="g-drawer" hidden>
    <p class="g-drawer__title">Topics</p>
    {pills.map((p) => <a class:list={['g-pill', 'g-pill--block', { 'is-active': p.active }]} href={p.href}>{p.label}</a>)}
  </div>
</header>
<script is:inline>
  (function () {
    var btn = document.querySelector('[data-g-burger]');
    var drawer = document.getElementById('g-drawer');
    if (!btn || !drawer) return;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      drawer.hidden = open;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !drawer.hidden) { drawer.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
    });
  })();
</script>
```

- [ ] **Step 3: `GridFooter.astro`**

```astro
---
import type { ResolvedConfig } from '@atomic-platform/shared-types';
interface Props { config: ResolvedConfig }
const { config } = Astro.props;
const year = new Date().getUTCFullYear();
const links = [['About', '/about'], ['Contact', '/contact'], ['Privacy Policy', '/privacy'], ['Terms of Service', '/terms']] as const;
---
<footer class="g-footer">
  <div class="g-footer__inner">
    <p class="g-footer__text">© {year} {config.site_name}. All rights reserved.</p>
    <nav class="g-footer__links" aria-label="Legal">
      {links.map(([label, href]) => <a class="g-footer__link" href={href}>{label}</a>)}
    </nav>
  </div>
</footer>
```

- [ ] **Step 4: Append the header/footer CSS to `grid.css`**

```css
.g-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.g-header { background: var(--g-surface); border-bottom: 1px solid var(--g-border); }
.g-header__row, .g-search, .g-pills { max-width: var(--g-page-max); margin: 0 auto; padding-inline: var(--g-gutter); }
.g-header__row { display: flex; align-items: center; justify-content: space-between; min-height: var(--nav-height, 64px); }
.g-header__logo img { height: var(--logo-height, 52px); width: auto; }
.g-header__name { font-size: 1.4rem; font-weight: 800; color: var(--g-heading); }
.g-header__burger { display: none; width: 44px; height: 44px; border: 0; background: transparent; cursor: pointer; flex-direction: column; justify-content: center; gap: 5px; align-items: center; }
.g-header__burger span:not(.g-sr) { display: block; width: 22px; height: 2px; background: var(--g-text); border-radius: 2px; }
.g-search { padding-block: 8px; }
.g-search__input { width: 100%; height: 44px; padding: 0 16px; border: 1.5px solid var(--g-border); border-radius: var(--g-radius-pill); background: var(--g-search-bg); color: var(--g-text); font: inherit; }
.g-search__input:focus { outline: none; border-color: var(--g-accent); }
.g-pills { display: flex; gap: 8px; overflow-x: auto; padding-block: 8px 12px; scrollbar-width: none; }
.g-pills::-webkit-scrollbar { display: none; }
.g-pill { flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 36px; padding: 0 16px; border: 1.5px solid var(--g-pill-border); border-radius: var(--g-radius-pill);
  color: var(--g-pill-text); background: transparent; font-size: var(--menu-item-font-size, 14px); font-weight: 600; transition: color .2s, border-color .2s; }
.g-pill:hover { color: var(--g-pill-hover); border-color: var(--g-pill-hover); }
.g-pill.is-active { color: var(--g-pill-active-text); border-color: var(--g-accent); background: var(--g-pill-active-bg); }
.g-drawer { max-width: var(--g-page-max); margin: 0 auto; padding: 8px var(--g-gutter) 16px; display: grid; gap: 8px; }
.g-drawer[hidden] { display: none; }
.g-drawer__title { margin: 0; font-weight: 700; }
.g-pill--block { justify-content: flex-start; }
@media (max-width: 600px) {
  .g-header__burger { display: flex; }
  .g-pills { display: none; }
}
.g-footer { background: var(--g-footer-bg); color: var(--g-footer-text); border-top: 1px solid var(--g-border); }
.g-footer__inner { max-width: var(--g-page-max); margin: 0 auto; padding: 24px var(--g-gutter); display: flex; flex-wrap: wrap; gap: 12px 24px; justify-content: space-between; align-items: center; font-size: .9rem; }
.g-footer__text { margin: 0; }
.g-footer__links { display: flex; flex-wrap: wrap; gap: 16px; }
.g-footer__link { color: var(--g-footer-link); }
.g-footer__link:hover { color: var(--g-footer-link-hover); }
```

- [ ] **Checkpoint:** nav test green. The header and footer render when dropped into the placeholder page (curl shows `g-pill` ×3 on desktop markup). No commit.

### Task 11: Listing pages, `/api/feed`, infinite scroll

**Files:**
- Create: `packages/site-worker/src/lib/grid/listing.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/listing.test.ts`
- Create: `packages/site-worker/src/themes/grid/components/CardGrid.astro`
- Rewrite: `packages/site-worker/src/pages/grid/index.astro`
- Create: `packages/site-worker/src/pages/grid/topic/[slug].astro`
- Create: `packages/site-worker/src/pages/grid/api/feed.ts`

**Interfaces:**
- Consumes: `GridContext`, `GridPoolData`, `loadGridPool`, `edgeCache`, `NO_CACHE`, `filterByTopic`, `pageSlice`, `buildTiles`, `renderTilesHtml`, `AdPlacementLike`, `GridPageType`.
- Produces:
  - `interface ListingResult { html: string; hasMore: boolean; nextPage: number; total: number }`
  - `renderListing(data: GridPoolData, g: GridContext, topic: string | null, page: number, now: Date, pageType: GridPageType): ListingResult`
  - `CardGrid` props `{ html: string; hasMore: boolean; nextPage: number; topic: string | null; empty: boolean }`
  - HTTP `GET /api/feed?page=&topic=` → HTML fragment + header `x-grid-has-more: true|false`

- [ ] **Step 1: Failing test `listing.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS, GRID_DEFAULTS, type GridPoolItem } from '@atomic-platform/shared-types';
import type { GridContext } from '../context';
import type { GridPoolData } from '../load';
import { renderListing } from '../listing';

const items: GridPoolItem[] = Array.from({ length: 5 }, (_, i) => ({
  site: 'a', slug: `s${i}`, title: `T${i}`, publishDate: '2026-09-26T00:00:00Z', pills: i % 2 ? ['travel'] : [], pinned: false,
}));
const data: GridPoolData = {
  directory: { generatedAt: 'g', sites: [] },
  resolved: { sources: [], statuses: [], pillsBySite: new Map() },
  pool: { items, inactivePins: [] }, missingIndexes: [],
};
const g = {
  config: { ads_config: { ad_placements: [{ id: 'gf', position: 'grid-feed' }] }, ad_placeholder_heights: { 'grid-feed': 250 } },
  grid: { ...GRID_DEFAULTS, page_size: 2, feed_ad_every: 3 }, card: GRID_CARD_DEFAULTS, siteId: 'me', staging: false, canonicalHost: 'me.com',
} as unknown as GridContext;

describe('renderListing', () => {
  it('page 1: two stories + ad; hasMore', () => {
    const r = renderListing(data, g, null, 1, new Date('2026-09-27T00:00:00Z'), 'homepage');
    expect(r.html.match(/g-card"/g)).toHaveLength(2);
    expect(r.html).toContain('data-ad-id="gf-1"');
    expect(r).toMatchObject({ hasMore: true, nextPage: 2, total: 5 });
  });
  it('topic filter + last page', () => {
    const r = renderListing(data, g, 'travel', 1, new Date('2026-09-27T00:00:00Z'), 'category');
    expect(r.total).toBe(2);
    expect(r.hasMore).toBe(false);
  });
});
```
Implement `listing.ts`:
```ts
import type { GridContext } from './context';
import type { GridPoolData } from './load';
import { filterByTopic, pageSlice } from './feed';
import { renderTilesHtml, type AdPlacementLike, type GridPageType } from './render';
import { buildTiles } from './tiles';

/** One rendered page of a Grid feed. */
export interface ListingResult { html: string; hasMore: boolean; nextPage: number; total: number }

/** Shared by the listing pages (page 1, SSR) and /api/feed (page ≥ 2) so markup never diverges. */
export function renderListing(data: GridPoolData, g: GridContext, topic: string | null, page: number, now: Date, pageType: GridPageType): ListingResult {
  const items = filterByTopic(data.pool.items, topic);
  const { slice, startIndex, hasMore } = pageSlice(items, page, g.grid.page_size);
  const heights = g.config.ad_placeholder_heights as unknown as Record<string, number> | undefined;
  const html = renderTilesHtml(buildTiles(slice, startIndex, g.grid.feed_ad_every), {
    now, card: g.card, showIntro: g.grid.show_intro,
    sites: new Map((data.directory?.sites ?? []).map((s) => [s.siteId, s])),
    placements: (g.config.ads_config?.ad_placements ?? []) as AdPlacementLike[],
    pageType, staging: g.staging, reservedHeight: heights?.['grid-feed'] ?? 0,
  });
  return { html, hasMore, nextPage: Math.max(1, Math.floor(page)) + 1, total: items.length };
}
```
Run the test. Expected: PASS.

- [ ] **Step 2: `CardGrid.astro`** (grid, sentinel and infinite-scroll client; Review Focus #4 script re-execution)

```astro
---
interface Props { html: string; hasMore: boolean; nextPage: number; topic: string | null; empty: boolean }
const { html, hasMore, nextPage, topic, empty } = Astro.props;
---
{empty
  ? <p class="g-empty">No stories yet — check back soon.</p>
  : <>
      <div class="g-grid" id="g-grid" data-next-page={nextPage} data-has-more={String(hasMore)} data-topic={topic ?? ''} set:html={html} />
      <div class="g-sentinel" id="g-sentinel" aria-hidden="true"></div>
      <p class="g-feed-status" id="g-feed-status" aria-live="polite"></p>
    </>}
<script is:inline>
  (function () {
    var grid = document.getElementById('g-grid');
    var sentinel = document.getElementById('g-sentinel');
    var status = document.getElementById('g-feed-status');
    if (!grid || !sentinel) return;
    var page = Number(grid.dataset.nextPage);
    var hasMore = grid.dataset.hasMore === 'true';
    var loading = false;
    var observer;
    function runScripts(root) {
      // Scripts inserted via innerHTML/template never execute — re-create them (ad widget code).
      root.querySelectorAll('script').forEach(function (old) {
        var s = document.createElement('script');
        for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
        s.text = old.textContent || '';
        old.replaceWith(s);
      });
    }
    function nearBottom() { return sentinel.getBoundingClientRect().top < window.innerHeight + 800; }
    async function load() {
      if (loading || !hasMore) return;
      loading = true;
      try {
        var params = new URLSearchParams({ page: String(page) });
        if (grid.dataset.topic) params.set('topic', grid.dataset.topic);
        var preview = new URLSearchParams(location.search).get('_atl_site');
        if (preview) params.set('_atl_site', preview);
        var res = await fetch('/api/feed?' + params.toString());
        if (!res.ok) throw new Error(String(res.status));
        hasMore = res.headers.get('x-grid-has-more') === 'true';
        var tpl = document.createElement('template');
        tpl.innerHTML = (await res.text()).trim();
        var nodes = Array.prototype.slice.call(tpl.content.children);
        grid.append(tpl.content);
        nodes.forEach(runScripts);
        page += 1;
        if (!hasMore) { observer.disconnect(); sentinel.remove(); }
      } catch (e) {
        if (status) status.textContent = 'Could not load more stories.';
        observer.disconnect();
        hasMore = false;
      } finally {
        loading = false;
      }
      // IntersectionObserver won't re-fire if the sentinel stays in view after a short batch.
      if (hasMore && nearBottom()) load();
    }
    observer = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) load();
    }, { rootMargin: '800px 0px' });
    if (hasMore) observer.observe(sentinel);
  })();
</script>
```

- [ ] **Step 3: `src/pages/grid/index.astro`** (replace the placeholder)

```astro
---
import { env } from 'cloudflare:workers';
import GridLayout from '../../themes/grid/GridLayout.astro';
import GridHeader from '../../themes/grid/components/GridHeader.astro';
import GridFooter from '../../themes/grid/components/GridFooter.astro';
import CardGrid from '../../themes/grid/components/CardGrid.astro';
import AdSlot from '../../components/AdSlot.astro';
import { getGridContext, notFound } from '../../lib/grid/context';
import { edgeCache, loadGridPool, NO_CACHE } from '../../lib/grid/load';
import { renderListing } from '../../lib/grid/listing';
export const prerender = false;

const g = getGridContext(Astro);
if (!g) return notFound();
const now = new Date();
const data = await loadGridPool(env.CONFIG_KV, g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
const listing = renderListing(data, g, null, 1, now, 'homepage');
Astro.response.headers.set('cache-control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=600');
const description = g.config.site_tagline || `Latest stories from ${g.config.site_name}`;
---
<GridLayout title={g.config.site_name} description={description} pageType="homepage" image={g.config.theme.logo ?? undefined}>
  <GridHeader config={g.config} topics={g.grid.topics} activeTopic={null} />
  <main class="g-main">
    <AdSlot position="homepage-top" pageType="homepage" server:defer />
    <CardGrid html={listing.html} hasMore={listing.hasMore} nextPage={listing.nextPage} topic={null} empty={listing.total === 0} />
  </main>
  <GridFooter config={g.config} />
  <AdSlot position="sticky-bottom" pageType="homepage" server:defer />
</GridLayout>
```
If `site_tagline` isn't on `ResolvedConfig`, drop it and use the fallback string only.

- [ ] **Step 4: `src/pages/grid/topic/[slug].astro`**

Same as Step 3, with these changes:
```astro
---
import { env } from 'cloudflare:workers';
import GridLayout from '../../../themes/grid/GridLayout.astro';
import GridHeader from '../../../themes/grid/components/GridHeader.astro';
import GridFooter from '../../../themes/grid/components/GridFooter.astro';
import CardGrid from '../../../themes/grid/components/CardGrid.astro';
import AdSlot from '../../../components/AdSlot.astro';
import { getGridContext, notFound } from '../../../lib/grid/context';
import { edgeCache, loadGridPool, NO_CACHE } from '../../../lib/grid/load';
import { renderListing } from '../../../lib/grid/listing';
export const prerender = false;

const g = getGridContext(Astro);
if (!g) return notFound();
const topic = g.grid.topics.find((t) => t.slug === Astro.params.slug);
if (!topic) return notFound();
const now = new Date();
const data = await loadGridPool(env.CONFIG_KV, g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
const listing = renderListing(data, g, topic.slug, 1, now, 'category');
Astro.response.headers.set('cache-control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=600');
---
<GridLayout title={`${topic.label} | ${g.config.site_name}`} description={`Latest ${topic.label} stories from ${g.config.site_name}`} pageType="category">
  <GridHeader config={g.config} topics={g.grid.topics} activeTopic={topic.slug} />
  <main class="g-main">
    <AdSlot position="category-top" pageType="category" server:defer />
    <CardGrid html={listing.html} hasMore={listing.hasMore} nextPage={listing.nextPage} topic={topic.slug} empty={listing.total === 0} />
  </main>
  <GridFooter config={g.config} />
  <AdSlot position="sticky-bottom" pageType="category" server:defer />
</GridLayout>
```

- [ ] **Step 5: `src/pages/grid/api/feed.ts`**

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getGridContext, notFound } from '../../../lib/grid/context';
import { edgeCache, loadGridPool, NO_CACHE } from '../../../lib/grid/load';
import { renderListing } from '../../../lib/grid/listing';

export const prerender = false;

/** Infinite-scroll batches (page ≥ 2). Unknown topic → 404. */
export const GET: APIRoute = async (ctx) => {
  const g = getGridContext(ctx);
  if (!g) return notFound();
  const topicParam = ctx.url.searchParams.get('topic');
  const topic = topicParam ? g.grid.topics.find((t) => t.slug === topicParam)?.slug ?? null : null;
  if (topicParam && !topic) return notFound();
  const page = Math.max(2, parseInt(ctx.url.searchParams.get('page') ?? '2', 10) || 2);
  const now = new Date();
  const data = await loadGridPool(env.CONFIG_KV, g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
  const r = renderListing(data, g, topic, page, now, topic ? 'category' : 'homepage');
  return new Response(r.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-grid-has-more': String(r.hasMore),
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
```

- [ ] **Step 6: Verify + design checkpoint**

- `curl -s "http://localhost:8788/?_atl_site=fixture-grid" | grep -c 'class="g-tile g-card"'` → 6 (`page_size` 6)
- `curl -sI "http://localhost:8788/api/feed?page=2&_atl_site=fixture-grid" | grep -i x-grid-has-more` → `true`
- `curl -s -o /dev/null -w "%{http_code}" "http://localhost:8788/topic/nope?_atl_site=fixture-grid"` → 404
- In a browser (Chrome), scroll to the bottom and confirm batches load until exhausted. Mock ads fill in-feed slots (mock-ad-fill.js observes mutations).
- **Design checkpoint:** take screenshots at 1440px and 390px of `/` and `/topic/travel`. Save them to `docs/test-results/screenshots/grid/` and send them to Asaf for a look-and-feel review. **Continue with Tasks 12–13 and the Phase D/E/F tasks while waiting.** Apply his feedback in Task 14.

- [ ] **Checkpoint:** listing test green; checks pass. No commit.

### Task 12: Story page

**Files:**
- Create: `packages/site-worker/src/lib/grid/story.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/story.test.ts`
- Create: `packages/site-worker/src/pages/grid/story/[sourceSiteId]/[slug].astro`
- Create: `packages/site-worker/src/themes/grid/components/RelatedStories.astro`
- Modify: `packages/site-worker/src/themes/grid/styles/grid.css` (append story rules)

**Interfaces:**
- Consumes: `ArticleRecord` (kv-schema), `GridSummaryRecord`, `buildExcerpt`, `absolutizeLinks`, `injectInlineAds` (existing `src/lib/inline-ads.ts`, import only), `buildOutboundUrl`, `formatAge`.
- Produces:
  - `storyText(input: { body: string; summary: GridSummaryRecord | null; mode: GridStoryMode; paragraphs: number; hostname: string }): { html: string; source: 'summary' | 'excerpt' }`
  - `relatedItems(items: readonly GridPoolItem[], current: { site: string; slug: string }, pills: readonly string[], n: number): GridPoolItem[]`
  - `RelatedStories` props `{ items: GridPoolItem[]; sites: ReadonlyMap<string, NetworkDirectorySite>; now: Date; heading?: string }`

- [ ] **Step 1: Failing test `story.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { GridPoolItem, GridSummaryRecord } from '@atomic-platform/shared-types';
import { relatedItems, storyText } from '../story';

const body = '<p>One <a href="/x">x</a></p><p>Two</p><p>Three</p><p>Four</p><p>Five</p><p>Six</p>';
const summary: GridSummaryRecord = { html: '<h2>S</h2><p>Sum</p>', bodyHash: 'h', generatedAt: 't', model: 'm', edited: false, sourceChanged: false };

describe('storyText', () => {
  it('excerpt mode ignores any summary and absolutises links', () => {
    const r = storyText({ body, summary, mode: 'excerpt', paragraphs: 2, hostname: 'a.com' });
    expect(r).toEqual({ source: 'excerpt', html: '<p>One <a href="https://a.com/x">x</a></p>\n<p>Two</p>' });
  });
  it('ai_summary mode uses the summary when present', () => {
    expect(storyText({ body, summary, mode: 'ai_summary', paragraphs: 2, hostname: 'a.com' })).toEqual({ source: 'summary', html: summary.html });
  });
  it('ai_summary mode falls back to the excerpt when no summary exists yet', () => {
    expect(storyText({ body, summary: null, mode: 'ai_summary', paragraphs: 2, hostname: 'a.com' }).source).toBe('excerpt');
  });
});

describe('relatedItems', () => {
  const it0 = (slug: string, pills: string[]): GridPoolItem => ({ site: 'a', slug, title: slug, publishDate: 'x', pills, pinned: false });
  const pool = [it0('cur', ['t']), it0('r1', ['t']), it0('r2', ['h']), it0('r3', ['t']), it0('r4', ['t'])];
  it('same pill, excludes current, max n', () => {
    expect(relatedItems(pool, { site: 'a', slug: 'cur' }, ['t'], 2).map((i) => i.slug)).toEqual(['r1', 'r3']);
  });
  it('no pills (include_sites source) → newest from All', () => {
    expect(relatedItems(pool, { site: 'a', slug: 'cur' }, [], 3).map((i) => i.slug)).toEqual(['r1', 'r2', 'r3']);
  });
});
```
Implement `story.ts`:
```ts
import type { GridPoolItem, GridStoryMode, GridSummaryRecord } from '@atomic-platform/shared-types';
import { absolutizeLinks, buildExcerpt } from './excerpt';

/** Story body for the Grid story page: AI summary when configured and available, else excerpt. */
export function storyText(input: { body: string; summary: GridSummaryRecord | null; mode: GridStoryMode; paragraphs: number; hostname: string }): { html: string; source: 'summary' | 'excerpt' } {
  if (input.mode === 'ai_summary' && input.summary?.html) return { html: input.summary.html, source: 'summary' };
  return { html: buildExcerpt(absolutizeLinks(input.body, input.hostname), input.paragraphs), source: 'excerpt' };
}

/** "Related stories": newest pool items sharing a pill (or from All when the source has none). */
export function relatedItems(items: readonly GridPoolItem[], current: { site: string; slug: string }, pills: readonly string[], n: number): GridPoolItem[] {
  return items
    .filter((i) => !(i.site === current.site && i.slug === current.slug))
    .filter((i) => pills.length === 0 || i.pills.some((p) => pills.includes(p)))
    .slice(0, n);
}
```
Run the test. Expected: PASS.

- [ ] **Step 2: `RelatedStories.astro`**

```astro
---
import type { GridPoolItem, NetworkDirectorySite } from '@atomic-platform/shared-types';
import { formatAge } from '../../../lib/grid/format';
interface Props { items: GridPoolItem[]; sites: ReadonlyMap<string, NetworkDirectorySite>; now: Date; heading?: string }
const { items, sites, now, heading = 'Related stories' } = Astro.props;
---
{items.length > 0 && (
  <section class="g-related" aria-label={heading}>
    <h2 class="g-related__heading">{heading}</h2>
    <ul class="g-related__list">
      {items.map((i) => (
        <li>
          <a class="g-related__item" href={`/story/${encodeURIComponent(i.site)}/${encodeURIComponent(i.slug)}`}>
            <small class="g-related__source">{sites.get(i.site)?.name ?? i.site} · {formatAge(i.publishDate, now)}</small>
            <span class="g-related__title">{i.title}</span>
            <img src={i.featuredImage || '/placeholder.svg'} alt="" width="96" height="72" loading="lazy" decoding="async" />
          </a>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Story page `src/pages/grid/story/[sourceSiteId]/[slug].astro`**

```astro
---
import { env } from 'cloudflare:workers';
import type { GridSummaryRecord } from '@atomic-platform/shared-types';
import GridLayout from '../../../../themes/grid/GridLayout.astro';
import GridHeader from '../../../../themes/grid/components/GridHeader.astro';
import GridFooter from '../../../../themes/grid/components/GridFooter.astro';
import RelatedStories from '../../../../themes/grid/components/RelatedStories.astro';
import AdSlot from '../../../../components/AdSlot.astro';
import { getGridContext, notFound } from '../../../../lib/grid/context';
import { edgeCache, loadGridPool, NO_CACHE } from '../../../../lib/grid/load';
import { relatedItems, storyText } from '../../../../lib/grid/story';
import { buildOutboundUrl } from '../../../../lib/grid/format';
import { renderSourceLineHtml } from '../../../../lib/grid/render';
import { injectInlineAds } from '../../../../lib/inline-ads';
import { articleKey, gridSummaryKey, type ArticleRecord } from '../../../../lib/kv-schema';
import { GRID_CARD_DEFAULTS } from '@atomic-platform/shared-types';
export const prerender = false;

const g = getGridContext(Astro);
if (!g) return notFound();
const sourceSiteId = Astro.params.sourceSiteId ?? '';
const slug = Astro.params.slug ?? '';
const now = new Date();
const data = await loadGridPool(env.CONFIG_KV, g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
const source = data.resolved.sources.find((s) => s.siteId === sourceSiteId);
if (!source) return notFound();
const record = await env.CONFIG_KV.get<ArticleRecord>(articleKey(sourceSiteId, slug), 'json');
if (!record || record.frontmatter.status !== 'published') return notFound();
const summary = g.grid.story_mode === 'ai_summary'
  ? await env.CONFIG_KV.get<GridSummaryRecord>(gridSummaryKey(sourceSiteId, slug), 'json')
  : null;
const text = storyText({ body: record.body, summary, mode: g.grid.story_mode, paragraphs: g.grid.excerpt_paragraphs, hostname: source.hostname });
const placements = (g.config.ads_config?.ad_placements ?? []) as Parameters<typeof injectInlineAds>[1];
const bodyHtml = injectInlineAds(text.html, placements, { staging: g.staging });
const pills = data.resolved.pillsBySite.get(sourceSiteId) ?? [];
const pillLabel = g.grid.topics.find((t) => t.slug === pills[0])?.label;
const related = relatedItems(data.pool.items, { site: sourceSiteId, slug }, pills, 3);
const sites = new Map((data.directory?.sites ?? []).map((s) => [s.siteId, s]));
const outbound = buildOutboundUrl(source.hostname, slug, g.canonicalHost, g.grid.outbound_utm);
const fm = record.frontmatter;
const sourceLine = renderSourceLineHtml(
  { site: sourceSiteId, slug, title: fm.title, publishDate: fm.publishDate, pills, pinned: false },
  { now, card: GRID_CARD_DEFAULTS, showIntro: false, sites, placements: [], pageType: 'article', staging: g.staging, reservedHeight: 0 },
);
const published = new Date(fm.publishDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
Astro.response.headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
---
<GridLayout title={`${fm.title} | ${g.config.site_name}`} description={fm.description ?? fm.title} pageType="article" image={fm.featuredImage}>
  <GridHeader config={g.config} topics={g.grid.topics} activeTopic={pills[0] ?? null} />
  <div class="g-story">
    <main class="g-story__main">
      <AdSlot position="above-content" pageType="article" server:defer />
      <article class="g-story__article">
        {pillLabel && <p class="g-story__topic">{pillLabel}</p>}
        <h1 class="g-story__title">{fm.title}</h1>
        <div class="g-story__byline"><span class="g-story__by">Original story by</span> <Fragment set:html={sourceLine} /> <span class="g-story__date">{published}</span></div>
        {fm.featuredImage && <img class="g-story__hero" src={fm.featuredImage} alt={fm.title} />}
        <div class="g-story__prose" set:html={bodyHtml} />
        <a class="g-story__cta" href={outbound} target="_blank" rel="noopener">Read full story</a>
      </article>
      <AdSlot position="below-content" pageType="article" server:defer />
    </main>
    <aside class="g-story__side">
      <AdSlot position="sidebar" pageType="article" server:defer />
      <RelatedStories items={related} sites={sites} now={now} />
    </aside>
  </div>
  <div class="g-story__bottom"><RelatedStories items={related} sites={sites} now={now} /></div>
  <GridFooter config={g.config} />
  <AdSlot position="sticky-bottom" pageType="article" server:defer />
</GridLayout>
```
If `injectInlineAds`'s placement parameter type isn't exported under that shape, cast via the existing exported `InlinePlacement` type from `src/lib/inline-ads.ts` instead of `Parameters<…>`.

- [ ] **Step 4: Append story CSS**

```css
.g-story { max-width: 1200px; margin: 0 auto; padding: 16px var(--g-gutter) 32px; display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 32px; width: 100%; }
.g-story__article { background: var(--g-surface); border-radius: var(--g-radius); padding: clamp(16px, 3vw, 40px); }
.g-story__topic { margin: 0 0 8px; color: var(--g-accent); font-weight: 700; font-size: .85rem; text-transform: uppercase; letter-spacing: .06em; }
.g-story__title { margin: 0 0 12px; color: var(--g-heading); font-size: clamp(1.6rem, 3.2vw, 2.6rem); line-height: 1.15; }
.g-story__byline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--g-muted); font-size: .9rem; margin-bottom: 16px; }
.g-story__byline .g-card__source { font-size: .9rem; }
.g-story__hero { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--g-radius-img); margin-bottom: 24px; }
.g-story__prose { color: var(--g-prose-body); font-size: 1.1rem; line-height: 1.7; }
.g-story__prose h2, .g-story__prose h3 { color: var(--g-prose-heading); line-height: 1.25; margin: 1.4em 0 .5em; }
.g-story__prose a { color: var(--g-link); text-decoration: underline; }
.g-story__prose a:hover { color: var(--g-link-hover); }
.g-story__cta { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 28px; margin-top: 24px; border-radius: var(--g-radius-pill); background: var(--g-accent); color: var(--g-accent-fg); font-weight: 700; }
.g-story__cta:hover { filter: brightness(1.08); }
.g-story__side { display: flex; flex-direction: column; gap: 24px; }
.g-story__bottom { display: none; max-width: 1200px; margin: 0 auto; padding: 0 var(--g-gutter) 32px; width: 100%; }
.g-related__heading { font-size: 1.1rem; margin: 0 0 12px; color: var(--g-heading); }
.g-related__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.g-related__item { display: grid; grid-template-columns: 1fr 96px; grid-template-rows: auto 1fr; column-gap: 12px; background: var(--g-surface); border-radius: var(--g-radius); padding: 10px; }
.g-related__source { grid-column: 1; color: var(--g-muted); }
.g-related__title { grid-column: 1; font-weight: 700; color: var(--g-heading); line-height: 1.3; }
.g-related__item img { grid-column: 2; grid-row: 1 / span 2; width: 96px; height: 72px; object-fit: cover; border-radius: 6px; }
@media (max-width: 960px) {
  .g-story { grid-template-columns: 1fr; }
  .g-story__side .g-related { display: none; }
  .g-story__bottom { display: block; }
}
```

- [ ] **Step 5: Verify**

- `curl -s "http://localhost:8788/story/fixture-travel-a/best-beaches-in-portugal?_atl_site=fixture-grid"`:
  - contains `Original story by`
  - contains `href="https://travel-a.example.com/best-beaches-in-portugal?utm_source=`
  - contains `target="_blank"`
  - has no `rel="canonical"`
- The review article, an unknown site, and a staging site each return 404.
- The article with an iframe shows no iframe, and internal links point to `https://travel-a.example.com/other-article`.

- [ ] **Checkpoint:** story test green; checks pass. No commit.

### Task 13: Search and shared pages on Grid sites

**Files:**
- Create: `packages/site-worker/src/lib/grid/search.ts`
- Create test: `packages/site-worker/src/lib/grid/__tests__/search.test.ts`
- Create: `packages/site-worker/src/pages/grid/search.astro`
- Create: `packages/site-worker/src/pages/grid/[slug].astro`
- Modify: `grid.css` (append shared-page rules)

**Interfaces:**
- Produces: `searchItems(items: readonly GridPoolItem[], query: string, limit: number): GridPoolItem[]`.

- [ ] **Step 1: Failing test + implementation**

```ts
import { describe, expect, it } from 'vitest';
import type { GridPoolItem } from '@atomic-platform/shared-types';
import { searchItems } from '../search';

const it0 = (title: string, description?: string): GridPoolItem => ({ site: 'a', slug: title, title, publishDate: 'x', pills: [], pinned: false, ...(description ? { description } : {}) });
describe('searchItems', () => {
  const pool = [it0('Best beaches in Portugal'), it0('Mountain hikes', 'Beaches nearby too'), it0('Tokyo food')];
  it('every term must match title or description, case-insensitive', () => {
    expect(searchItems(pool, 'BEACHES', 10).map((i) => i.title)).toEqual(['Best beaches in Portugal', 'Mountain hikes']);
    expect(searchItems(pool, 'beaches portugal', 10)).toHaveLength(1);
  });
  it('blank query → no results; limit applies', () => {
    expect(searchItems(pool, '   ', 10)).toEqual([]);
    expect(searchItems(pool, 'o', 1)).toHaveLength(1);
  });
});
```
```ts
import type { GridPoolItem } from '@atomic-platform/shared-types';

/** Title/description search over the "All" pool (same matching rule as the modern /api/search). */
export function searchItems(items: readonly GridPoolItem[], query: string, limit: number): GridPoolItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return items
    .filter((i) => {
      const hay = `${i.title} ${i.description ?? ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    })
    .slice(0, limit);
}
```

- [ ] **Step 2: `src/pages/grid/search.astro`** (server-rendered results, no infinite scroll, noindex)

```astro
---
import { env } from 'cloudflare:workers';
import GridLayout from '../../themes/grid/GridLayout.astro';
import GridHeader from '../../themes/grid/components/GridHeader.astro';
import GridFooter from '../../themes/grid/components/GridFooter.astro';
import { getGridContext, notFound } from '../../lib/grid/context';
import { edgeCache, loadGridPool, NO_CACHE } from '../../lib/grid/load';
import { searchItems } from '../../lib/grid/search';
import { buildTiles } from '../../lib/grid/tiles';
import { renderTilesHtml } from '../../lib/grid/render';
export const prerender = false;

const g = getGridContext(Astro);
if (!g) return notFound();
const q = (Astro.url.searchParams.get('q') ?? '').slice(0, 100);
const now = new Date();
const data = await loadGridPool(env.CONFIG_KV, g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
const results = searchItems(data.pool.items, q, 60);
const html = renderTilesHtml(buildTiles(results, 0, 0), {
  now, card: g.card, showIntro: true, sites: new Map((data.directory?.sites ?? []).map((s) => [s.siteId, s])),
  placements: [], pageType: 'homepage', staging: g.staging, reservedHeight: 0,
});
Astro.response.headers.set('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
---
<GridLayout title={`Search | ${g.config.site_name}`} description={`Search ${g.config.site_name}`} pageType="homepage" noindex>
  <GridHeader config={g.config} topics={g.grid.topics} activeTopic={null} query={q} />
  <main class="g-main">
    {q && <p class="g-feed-status">{results.length} result{results.length === 1 ? '' : 's'} for “{q}”</p>}
    {results.length > 0 ? <div class="g-grid" set:html={html} /> : q && <p class="g-empty">No stories match your search.</p>}
  </main>
  <GridFooter config={g.config} />
</GridLayout>
```

- [ ] **Step 3: `src/pages/grid/[slug].astro`** (shared pages only; everything else 404)

```astro
---
import { env } from 'cloudflare:workers';
import GridLayout from '../../themes/grid/GridLayout.astro';
import GridHeader from '../../themes/grid/components/GridHeader.astro';
import GridFooter from '../../themes/grid/components/GridFooter.astro';
import { getGridContext, notFound } from '../../lib/grid/context';
import { sharedPageKey, type SharedPage } from '../../lib/kv-schema';
export const prerender = false;

// Same set as src/pages/[slug]/index.astro.
const SHARED_PAGES = new Set(['about', 'contact', 'privacy', 'terms', 'dmca', 'amazon']);
const g = getGridContext(Astro);
if (!g) return notFound();
const slug = Astro.params.slug ?? '';
if (!SHARED_PAGES.has(slug)) return notFound();
const page = await env.CONFIG_KV.get<SharedPage>(sharedPageKey(g.siteId, slug), 'json');
if (!page) return notFound();
Astro.response.headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
---
<GridLayout title={`${page.title} | ${g.config.site_name}`} description={page.title} pageType="article">
  <GridHeader config={g.config} topics={g.grid.topics} activeTopic={null} />
  <main class="g-main"><article class="g-page"><h1>{page.title}</h1><div class="g-story__prose" set:html={page.html} /></article></main>
  <GridFooter config={g.config} />
</GridLayout>
```
Append CSS: `.g-page { max-width: 820px; margin: 0 auto; background: var(--g-surface); border-radius: var(--g-radius); padding: clamp(16px, 3vw, 40px); } .g-page h1 { color: var(--g-heading); }`.

- [ ] **Step 4: Verify**

- `/search?q=beaches&_atl_site=fixture-grid` shows results.
- `/about?_atl_site=fixture-grid` renders in Grid chrome.
- `/best-beaches-in-portugal?_atl_site=fixture-grid` returns 404. On a Grid site, article URLs are `/story/…`.

- [ ] **Checkpoint:** search test green. No commit.

### Task 14: Theming: card-look variants, colour mapping, preset matrix

**Files:**
- Modify: `packages/site-worker/src/themes/grid/styles/grid.css` (append variants)
- Modify: `packages/site-worker/tests/fixtures/grid-network/sites/fixture-grid/site.yaml` (manual matrix runs only; revert after)

**Interfaces:**
- Consumes: the `data-card-*` body attributes (Task 9) and the `--color-*` vars emitted by GridLayout.

- [ ] **Step 1: Load the design skills again**

Load `ui-ux-pro-max`, `design-taste-frontend` and `frontend-design`. Apply Asaf's design-checkpoint feedback from Task 11 to the base CSS.

- [ ] **Step 2: Append the variant CSS**

```css
/* Card style */
body.g-body[data-card-style="shadow"] .g-card { border-color: transparent; box-shadow: 0 1px 3px rgb(0 0 0 / .06), 0 8px 24px rgb(0 0 0 / .06); }
body.g-body[data-card-style="shadow"] .g-card:hover { box-shadow: 0 2px 6px rgb(0 0 0 / .08), 0 16px 40px rgb(0 0 0 / .10); }
body.g-body[data-card-style="flat"] .g-card { border-color: transparent; box-shadow: none; }
body.g-body[data-card-style="flat"] .g-card:hover { box-shadow: none; }
/* Corners */
body.g-body[data-card-corners="square"] { --g-radius: 0px; --g-radius-img: 0px; }
body.g-body[data-card-corners="small"] { --g-radius: 6px; --g-radius-img: 4px; }
/* Image ratio */
body.g-body[data-card-ratio="16-9"] { --g-img-ratio: 16 / 9; }
body.g-body[data-card-ratio="1-1"] { --g-img-ratio: 1 / 1; }
/* Density */
body.g-body[data-card-density="compact"] { --g-card-min: 210px; --g-gap: 10px; }
body.g-body[data-card-density="compact"] .g-card__title { font-size: 1rem; }
body.g-body[data-card-density="compact"] .g-card__body { padding: 8px 10px 12px; gap: 6px; }
/* Image position: left thumbnail list */
body.g-body[data-card-image="left"] { --g-card-min: 340px; }
body.g-body[data-card-image="left"] .g-card__link { flex-direction: row; align-items: stretch; }
body.g-body[data-card-image="left"] .g-card__media { flex: 0 0 120px; margin: 8px 0 8px 8px; }
body.g-body[data-card-image="left"] .g-card__media img { height: 100%; aspect-ratio: 1 / 1; }
/* Source as a badge on the image */
body.g-body[data-card-source="badge"] .g-card__media .g-card__source { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px);
  padding: 4px 8px; border-radius: var(--g-radius-pill); background: rgb(0 0 0 / .62); color: #fff; font-size: .78rem; }
```

- [ ] **Step 3: Preset × card-look screenshot matrix**

For each of three existing presets (a light one such as "Classic News", a dark one such as "Tokyo Night", and a warm one such as "Warm Magazine"):
1. Copy the preset's `colors` from `services/dashboard/src/components/wizard/themePresets.ts` into `fixture-grid/site.yaml` → `theme.colors`.
2. Run it with `theme.card` = defaults, and again with `{ style: shadow, corners: small, image_ratio: "16:9", density: compact, source_position: badge }`.
3. Re-seed (`SITES=fixture-grid scripts/dev/seed-grid-fixture.sh`) and take screenshots of `/` at 1440px and 390px.

Save them to `docs/test-results/screenshots/grid/theming/<preset>-<look>-<width>.png`. Check every text/background pair for legibility (AA) in all 12 shots. Fix it with token fallbacks, never per-preset CSS.
Revert `fixture-grid/site.yaml` to its Task 0 content afterwards.

- [ ] **Checkpoint:** 12 screenshots saved, plus a checklist in `docs/test-results/2026-09-27-grid-theming.txt` (preset, look, width, legible y/n). No commit.

---

## Phase D — Sync (network directory + summaries → KV)

### Task 15: `seed-grid.ts`: directory builder, summary renderer, KV writer

**Files:**
- Create: `packages/site-worker/scripts/lib/grid-directory.ts`
- Create: `packages/site-worker/scripts/lib/grid-summary-html.ts`
- Create: `packages/site-worker/scripts/lib/grid-config-readers.ts`
- Create: `packages/site-worker/scripts/lib/kv-bulk.ts`
- Create: `packages/site-worker/scripts/seed-grid.ts`
- Create tests: `packages/site-worker/scripts/__tests__/grid-directory.test.ts`, `grid-summary-html.test.ts`
- Create: `packages/site-worker/tests/fixtures/grid-network/grid-summaries/fixture-travel-a/best-beaches-in-portugal.md`
- Modify: `packages/site-worker/scripts/dev/seed-grid-fixture.sh` (replace the `kv-extra.json` put with `seed-grid --local`)
- Delete: `packages/site-worker/tests/fixtures/grid-network/kv-extra.json`

**Interfaces:**
- Consumes: `NetworkDirectory`, `NetworkDirectorySite`, `GridSummaryRecord`, `splitFrontmatter` (existing, `scripts/lib/resolve.ts`), `networkDirectoryKey`, `gridSummaryKey` (Task 8).
- Produces:
  - `DEV1_SITE_IDS: ReadonlySet<string>`
  - `interface IndexSiteEntry { domain: string; status?: string | null; vertical?: string | null; custom_domain?: string | null; deleted_at?: string | null }`
  - `interface SiteConfigSummary { site_name?: string; domain?: string; theme?: { favicon?: string | null; template?: string } }`
  - `buildNetworkDirectory(entries: readonly IndexSiteEntry[], configs: ReadonlyMap<string, SiteConfigSummary | null>, now: Date): NetworkDirectory`
  - `renderSummaryHtml(markdown: string): string`
  - `parseSummaryFile(path: string, raw: string): { site: string; slug: string; record: GridSummaryRecord } | null`
  - `type ConfigReader = (siteId: string) => Promise<SiteConfigSummary | null>`
  - `restConfigReader(accountId: string, token: string, namespaceId: string): ConfigReader`
  - `localConfigReader(namespaceId: string): ConfigReader`
  - `bulkPut(entries: ReadonlyArray<{ key: string; value: string }>, namespaceId: string, remote: boolean): void`
  - CLI: `pnpm exec tsx scripts/seed-grid.ts [--local] [--all-summaries | --changed-file <file>]`

- [ ] **Step 1: Failing test `grid-directory.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildNetworkDirectory } from '../lib/grid-directory';

const NOW = new Date('2026-09-27T00:00:00Z');
describe('buildNetworkDirectory', () => {
  it('maps index + config; hostname from custom_domain, then config domain, then siteId', () => {
    const dir = buildNetworkDirectory([
      { domain: 'scienceworld', status: 'Live', vertical: 'Science', custom_domain: 'ScienceWorld.com' },
      { domain: 'plain', status: 'Live', vertical: 'Travel', custom_domain: null },
      { domain: 'bare', status: 'Staging', vertical: null },
    ], new Map([
      ['scienceworld', { site_name: 'Science World', theme: { favicon: '/scienceworld/assets/f.png' } }],
      ['plain', { site_name: 'Plain', domain: 'plain.io' }],
    ]), NOW);
    expect(dir.generatedAt).toBe('2026-09-27T00:00:00.000Z');
    expect(dir.sites).toEqual([
      { siteId: 'scienceworld', hostname: 'scienceworld.com', name: 'Science World', favicon: '/scienceworld/assets/f.png', vertical: 'Science', status: 'Live', isGrid: false, account: 'assets' },
      { siteId: 'plain', hostname: 'plain.io', name: 'Plain', favicon: null, vertical: 'Travel', status: 'Live', isGrid: false, account: 'assets' },
      { siteId: 'bare', hostname: 'bare', name: 'bare', favicon: null, vertical: '', status: 'Staging', isGrid: false, account: 'assets' },
    ]);
  });
  it('drops deleted entries, flags Grid and Dev1 sites', () => {
    const dir = buildNetworkDirectory([
      { domain: 'gone', status: 'Live', deleted_at: '2026-01-01' },
      { domain: 'gone2', status: 'deleted' },
      { domain: 'muvizzcom', status: 'Live', vertical: 'Entertainment' },
      { domain: 'mygrid', status: 'Live' },
    ], new Map([['mygrid', { theme: { template: 'grid' } }]]), NOW);
    expect(dir.sites.map((s) => [s.siteId, s.account, s.isGrid])).toEqual([['muvizzcom', 'dev1', false], ['mygrid', 'assets', true]]);
  });
});
```
Implement `grid-directory.ts`:
```ts
import type { NetworkDirectory, NetworkDirectorySite } from '@atomic-platform/shared-types';

/** Legacy sites whose KV lives in the Dev1 account — never Grid sources. */
export const DEV1_SITE_IDS: ReadonlySet<string> = new Set(['financenewsbase', 'muvizzcom']);

/** The dashboard-index.yaml fields the directory needs. */
export interface IndexSiteEntry {
  domain: string;
  status?: string | null;
  vertical?: string | null;
  custom_domain?: string | null;
  deleted_at?: string | null;
}

/** The resolved site-config fields the directory needs. */
export interface SiteConfigSummary {
  site_name?: string;
  domain?: string;
  theme?: { favicon?: string | null; template?: string };
}

/** dashboard-index + resolved configs → network-directory value. Pure. */
export function buildNetworkDirectory(
  entries: readonly IndexSiteEntry[], configs: ReadonlyMap<string, SiteConfigSummary | null>, now: Date,
): NetworkDirectory {
  const sites: NetworkDirectorySite[] = [];
  for (const e of entries) {
    if (!e?.domain || e.deleted_at || (e.status ?? '').toLowerCase() === 'deleted') continue;
    const cfg = configs.get(e.domain) ?? null;
    const cfgDomain = cfg?.domain && cfg.domain.includes('.') ? cfg.domain : null;
    sites.push({
      siteId: e.domain,
      hostname: (e.custom_domain || cfgDomain || e.domain).toLowerCase(),
      name: cfg?.site_name || e.domain,
      favicon: cfg?.theme?.favicon || null,
      vertical: (e.vertical ?? '').trim(),
      status: e.status ?? '',
      isGrid: cfg?.theme?.template === 'grid',
      account: DEV1_SITE_IDS.has(e.domain) ? 'dev1' : 'assets',
    });
  }
  return { generatedAt: now.toISOString(), sites };
}
```
Run: `pnpm test -- scripts/__tests__/grid-directory.test.ts`. Expected: PASS.

- [ ] **Step 2: Failing test `grid-summary-html.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseSummaryFile, renderSummaryHtml } from '../lib/grid-summary-html';

describe('renderSummaryHtml', () => {
  it('renders headings/paragraphs and strips HTML, links and images', () => {
    const html = renderSummaryHtml('## Title\n\nHello <b>x</b> [link](https://e.com) ![i](a.png) https://bare.com\n\n### Part\n\nText');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<h3>Part</h3>');
    expect(html).not.toMatch(/<a\b|<img\b|<b>/);
    expect(html).toContain('link');
  });
});

describe('parseSummaryFile', () => {
  const raw = '---\nsource_site: a\nslug: s\nbody_hash: h1\ngenerated_at: "2026-09-27T00:00:00Z"\nmodel: m\nedited: true\nsource_changed: true\n---\n## H\n\nBody\n';
  it('parses path + frontmatter into a KV record', () => {
    expect(parseSummaryFile('grid-summaries/a/s.md', raw)).toEqual({
      site: 'a', slug: 's',
      record: { html: expect.stringContaining('<h2>H</h2>'), bodyHash: 'h1', generatedAt: '2026-09-27T00:00:00Z', model: 'm', edited: true, sourceChanged: true },
    });
  });
  it('rejects paths outside grid-summaries/<site>/<slug>.md and empty bodies', () => {
    expect(parseSummaryFile('sites/a/s.md', raw)).toBeNull();
    expect(parseSummaryFile('grid-summaries/a/b/c.md', raw)).toBeNull();
    expect(parseSummaryFile('grid-summaries/a/s.md', '---\nslug: s\n---\n  \n')).toBeNull();
  });
});
```
Implement `grid-summary-html.ts`:
```ts
import { marked } from 'marked';
import type { GridSummaryRecord } from '@atomic-platform/shared-types';
import { splitFrontmatter } from './resolve';

const PATH_RE = /^grid-summaries\/([a-z0-9][a-z0-9-]*)\/([^/]+)\.md$/i;

/** Summary markdown → HTML with no raw HTML, links or images (defence in depth; pipeline also sanitises). */
export function renderSummaryHtml(markdown: string): string {
  const clean = markdown
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '');
  const html = marked.parse(clean, { async: false, gfm: true }) as string;
  return html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1').replace(/<img\b[^>]*>/gi, '');
}

/** grid-summaries/<site>/<slug>.md → KV record, or null when the file isn't a valid summary. */
export function parseSummaryFile(path: string, raw: string): { site: string; slug: string; record: GridSummaryRecord } | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const { front, body } = splitFrontmatter(raw);
  if (!body.trim()) return null;
  const f = (front ?? {}) as Record<string, unknown>;
  return {
    site: m[1] as string,
    slug: m[2] as string,
    record: {
      html: renderSummaryHtml(body),
      bodyHash: String(f.body_hash ?? ''),
      generatedAt: String(f.generated_at ?? ''),
      model: String(f.model ?? ''),
      edited: f.edited === true,
      sourceChanged: f.source_changed === true,
    },
  };
}
```
If `splitFrontmatter` returns differently named properties, adapt to its `FrontmatterSplit` interface. `seed-kv.ts` uses `const { front, body } = splitFrontmatter(raw);`.
Note: YAML parses `generated_at: "…"` (quoted) as a string. The pipeline must write it quoted. gray-matter does this for ISO strings, and the Task 18 test asserts it.
Run the test. Expected: PASS.

- [ ] **Step 3: `grid-config-readers.ts` and `kv-bulk.ts`**

```ts
// grid-config-readers.ts
import { execFileSync } from 'node:child_process';
import type { SiteConfigSummary } from './grid-directory';

/** Reads a site's resolved config (only the fields the directory needs). */
export type ConfigReader = (siteId: string) => Promise<SiteConfigSummary | null>;

/** CI: Cloudflare REST API against prod KV. 404 → null; other failures throw (the job must fail loudly). */
export function restConfigReader(accountId: string, token: string, namespaceId: string): ConfigReader {
  return async (siteId) => {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(`site-config:${siteId}`)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`[seed-grid] KV read site-config:${siteId} failed: ${res.status}`);
    return (await res.json()) as SiteConfigSummary;
  };
}

/** Local fixture runs: wrangler --local. Missing key → null. */
export function localConfigReader(namespaceId: string): ConfigReader {
  return async (siteId) => {
    try {
      const out = execFileSync('wrangler', ['kv', 'key', 'get', `site-config:${siteId}`, `--namespace-id=${namespaceId}`, '--local'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.trim() ? (JSON.parse(out) as SiteConfigSummary) : null;
    } catch {
      return null;
    }
  };
}
```
```ts
// kv-bulk.ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHUNK = 5000; // wrangler bulk put accepts up to 10k per call

/** Writes entries with `wrangler kv bulk put` (same mechanism as seed-kv.ts). */
export function bulkPut(entries: ReadonlyArray<{ key: string; value: string }>, namespaceId: string, remote: boolean): void {
  if (entries.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), 'seed-grid-'));
  try {
    for (let i = 0; i < entries.length; i += CHUNK) {
      const file = join(dir, `chunk-${i}.json`);
      writeFileSync(file, JSON.stringify(entries.slice(i, i + CHUNK)));
      execFileSync('wrangler', ['kv', 'bulk', 'put', file, `--namespace-id=${namespaceId}`, remote ? '--remote' : '--local'], { stdio: 'inherit' });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
```
Check how `seed-kv.ts`'s `runWrangler` invokes wrangler (bare `wrangler` vs `pnpm exec wrangler`) and use the same binary resolution.

- [ ] **Step 4: `seed-grid.ts`**

```ts
/**
 * Writes Grid data to KV. Never reads or writes any existing key family.
 *   network-directory              ← dashboard-index.yaml + prod site-config:* (REST) — or local KV with --local
 *   grid-summary:<siteId>:<slug>   ← grid-summaries/<siteId>/<slug>.md (changed files, or all with --all-summaries)
 * Env (CI): NETWORK_DATA_PATH, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID_PROD, KV_NAMESPACE_ID_STAGING
 * Env (--local): NETWORK_DATA_PATH, KV_NAMESPACE_ID (default: staging id — matches `pnpm dev:worker`)
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { gridSummaryKey, networkDirectoryKey } from '../src/lib/kv-schema';
import { buildNetworkDirectory, DEV1_SITE_IDS, type IndexSiteEntry, type SiteConfigSummary } from './lib/grid-directory';
import { localConfigReader, restConfigReader, type ConfigReader } from './lib/grid-config-readers';
import { parseSummaryFile } from './lib/grid-summary-html';
import { bulkPut } from './lib/kv-bulk';

const STAGING_DEFAULT = 'f6c35e1fa8c841b8b193509a3a237f7f';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[seed-grid] missing env ${name}`);
  return v;
}

async function listSummaryFiles(root: string): Promise<string[]> {
  const base = join(root, 'grid-summaries');
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const site of await readdir(base, { withFileTypes: true })) {
    if (!site.isDirectory()) continue;
    for (const f of await readdir(join(base, site.name))) if (f.endsWith('.md')) out.push(`grid-summaries/${site.name}/${f}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const local = args.includes('--local');
  const all = args.includes('--all-summaries');
  const changedIdx = args.indexOf('--changed-file');
  const root = requireEnv('NETWORK_DATA_PATH');

  const index = parseYaml(await readFile(join(root, 'dashboard-index.yaml'), 'utf8')) as { sites?: IndexSiteEntry[] };
  const entries = index.sites ?? [];

  const reader: ConfigReader = local
    ? localConfigReader(process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT)
    : restConfigReader(requireEnv('CLOUDFLARE_ACCOUNT_ID'), requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('KV_NAMESPACE_ID_PROD'));
  const configs = new Map<string, SiteConfigSummary | null>();
  for (const e of entries) {
    // Dev1 configs live in another account; they're never sources, so no read is needed.
    configs.set(e.domain, DEV1_SITE_IDS.has(e.domain) ? null : await reader(e.domain));
  }
  const directory = buildNetworkDirectory(entries, configs, new Date());
  const kvEntries = [{ key: networkDirectoryKey(), value: JSON.stringify(directory) }];

  let summaryPaths: string[] = [];
  if (all) summaryPaths = await listSummaryFiles(root);
  else if (changedIdx >= 0 && args[changedIdx + 1]) {
    summaryPaths = (await readFile(args[changedIdx + 1] as string, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean);
  }
  let skipped = 0;
  for (const p of summaryPaths) {
    const abs = join(root, p);
    if (!existsSync(abs)) { skipped++; continue; } // deleted file — pruning is out of scope
    const parsed = parseSummaryFile(relative(root, abs).split('\\').join('/'), await readFile(abs, 'utf8'));
    if (!parsed) { skipped++; console.warn(`[seed-grid] skipping invalid summary file ${p}`); continue; }
    kvEntries.push({ key: gridSummaryKey(parsed.site, parsed.slug), value: JSON.stringify(parsed.record) });
  }

  const targets = local
    ? [process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT]
    : [requireEnv('KV_NAMESPACE_ID_PROD'), requireEnv('KV_NAMESPACE_ID_STAGING')];
  for (const ns of targets) bulkPut(kvEntries, ns, !local);
  console.log(`[seed-grid] directory: ${directory.sites.length} sites; summaries: ${kvEntries.length - 1} written, ${skipped} skipped; targets: ${targets.length}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Fixture summary + fixture script**

`tests/fixtures/grid-network/grid-summaries/fixture-travel-a/best-beaches-in-portugal.md`:
```markdown
---
source_site: fixture-travel-a
slug: best-beaches-in-portugal
body_hash: fixture
generated_at: "2026-09-27T00:00:00Z"
model: fixture
edited: false
edited_by: null
edited_at: null
source_changed: false
---
## Portugal's Coast, Ranked

A short fixture summary used for local testing of AI-summary mode.

### Why the Algarve leads

Fixture paragraph one.

### Beyond the south

Fixture paragraph two.
```
In `seed-grid-fixture.sh`, replace the `wrangler kv bulk put … kv-extra.json …` line with:
`NETWORK_DATA_PATH="$NETWORK_DATA_PATH" pnpm exec tsx scripts/seed-grid.ts --local --all-summaries`
Then delete `kv-extra.json`.

- [ ] **Step 6: Verify locally**

Run `packages/site-worker/scripts/dev/seed-grid-fixture.sh`.
Expected log: `directory: 4 sites; summaries: 1 written`.
Then `curl -s "http://localhost:8788/api/pool?_atl_site=fixture-grid" | jq '.sources|length'` → 4 (unchanged behaviour, now from real seed-grid output). `fixture-grid` has `isGrid: true` because its local config has `template: grid`.

- [ ] **Checkpoint:** two test files green; local run OK. No commit.

### Task 16: `sync-grid.yml` in the network repo (separate worktree, not pushed)

**Files:**
- Create (in a network-repo worktree): `.github/workflows/sync-grid.yml`

- [ ] **Step 1: Worktree (never touch the main network checkout)**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-labs-network
git fetch origin
git worktree add ../atomic-labs-network-grid -b grid-sync-workflow origin/main
```

- [ ] **Step 2: Workflow**

Open `../atomic-labs-network-grid/.github/workflows/sync-kv.yml`. Copy its steps from "checkout platform" through "build shared-types" **verbatim**: platform checkout (with `PLATFORM_REPO_TOKEN`), setup-node, pnpm, cache, install, shared-types build. They go where marked below.
```yaml
name: Sync Grid data to KV

# Grid template: writes ONLY `network-directory` and `grid-summary:*` keys (prod + staging).
# Independent of sync-kv.yml — never re-syncs a site. Every run rebuilds from latest main,
# so a queued run replacing a pending one loses nothing (unlike per-site sync-kv).
on:
  push:
    branches: [main]
    paths:
      - "grid-summaries/**"
      - "dashboard-index.yaml"
      - "sites/*/site.yaml"
      - "groups/**"
      - "org.yaml"
      - "overrides/config/**"
  schedule:
    - cron: "15 * * * *" # hourly backstop: directory only
  workflow_dispatch:
    inputs:
      all_summaries:
        description: "Re-sync every grid-summaries file"
        type: boolean
        default: false

concurrency:
  group: sync-grid
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # ── Paste the platform checkout + node/pnpm/cache/install/shared-types build steps
      #    from sync-kv.yml here, unchanged. ──

      - name: Select summaries to sync
        id: changed
        env:
          EVENT: ${{ github.event_name }}
          BEFORE: ${{ github.event.before }}
          ALL: ${{ inputs.all_summaries }}
        run: |
          set -euo pipefail
          if [[ "$ALL" == "true" ]]; then
            echo "flag=--all-summaries" >> "$GITHUB_OUTPUT"
          elif [[ "$EVENT" == "push" && -n "$BEFORE" && "$BEFORE" != "0000000000000000000000000000000000000000" ]]; then
            git diff --name-only --diff-filter=AM "$BEFORE" "$GITHUB_SHA" -- 'grid-summaries/' > "$RUNNER_TEMP/changed.txt" || true
            echo "flag=--changed-file $RUNNER_TEMP/changed.txt" >> "$GITHUB_OUTPUT"
          else
            echo "flag=" >> "$GITHUB_OUTPUT"
          fi

      - name: Sync grid data
        working-directory: platform/packages/site-worker
        env:
          NETWORK_DATA_PATH: ${{ github.workspace }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          KV_NAMESPACE_ID_PROD: ${{ secrets.KV_NAMESPACE_ID_PROD }}
          KV_NAMESPACE_ID_STAGING: ${{ secrets.KV_NAMESPACE_ID_STAGING }}
        run: pnpm exec tsx scripts/seed-grid.ts ${{ steps.changed.outputs.flag }}
```
Use the same checkout `path:` for the platform repo that `sync-kv.yml` uses. If it isn't `platform`, change `working-directory` to match.

- [ ] **Step 3: Validate syntax**

`cd packages/site-worker && node -e "const y=require('yaml');y.parse(require('fs').readFileSync('../../../atomic-labs-network-grid/.github/workflows/sync-grid.yml','utf8'));console.log('yaml ok')"`
If `actionlint` is installed, also run `actionlint ../atomic-labs-network-grid/.github/workflows/sync-grid.yml`.

- [ ] **Checkpoint:** file exists in the worktree, YAML valid. **Not committed, not pushed.** It needs the platform code on `main` first (Task 28 rollout order).

---

## Phase E — Content-pipeline

### Task 17: Scheduler never generates for Grid sites

**Files:**
- Modify: `services/content-pipeline/src/lib/site-brief.ts`: `SiteBriefData` + the `return` of `readSiteBrief`
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts`: `checkSiteEligibility` (after the `readSiteBriefWithFallback` call, ~L179) and `processSingleSite` (after `briefData = data;`, ~L232)
- Create test: `services/content-pipeline/src/__tests__/scheduled-publisher-grid.test.ts`

**Interfaces:**
- Produces: `SiteBriefData.themeTemplate?: string`, populated from `site.yaml` `theme.template`.

- [ ] **Step 1: Failing test**

Copy the mock setup block (all `vi.mock(...)` calls and `makeConfig`) from `src/__tests__/scheduled-publisher.test.ts` lines 17-58 into the new file. Then add:
```ts
describe("scheduled publisher — Grid sites", () => {
  it("skips a site whose site.yaml sets theme.template: grid, with reason 'grid template'", async () => {
    mockListActiveSites.mockResolvedValue([{ domain: "mygrid", branch: "staging/mygrid", status: "live" }]);
    mockReadSiteBriefWithFallback.mockResolvedValue({
      data: { domain: "mygrid", siteName: "My Grid", group: "", themeTemplate: "grid",
        brief: { schedule: { articles_per_day: 3, preferred_days: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"] } } },
      branch: "staging/mygrid",
    });
    // Configure the scheduler-config read exactly as the existing "eligible site" test does (enabled, current hour).
    const result = await runScheduledPublish(makeConfig(), true, undefined);
    expect(JSON.stringify(result)).toContain("grid template");
    expect(JSON.stringify(result)).not.toContain('"kind":"triggered"');
  });
});
```
Import `runScheduledPublish` the same way the existing test does. Match the existing test's scheduler-config mocking (the `mockReadFile` return for `scheduler/config.yaml`) so the run isn't gated off. Read the existing "processes an eligible site" case and replicate its arrange block.
Run: `cd services/content-pipeline && npx vitest run src/__tests__/scheduled-publisher-grid.test.ts`. Expected: FAIL (the site gets triggered).

- [ ] **Step 2: Implement**

`site-brief.ts`, in the `SiteBriefData` interface:
```ts
  /** `theme.template` from site.yaml ("grid" → the scheduler must skip this site). */
  themeTemplate?: string;
```
At the end of `readSiteBrief`, extend the returned object:
```ts
    ...(typeof (config as { theme?: { template?: unknown } }).theme?.template === "string"
      ? { themeTemplate: (config as { theme: { template: string } }).theme.template }
      : {}),
```
`scheduled-publisher/index.ts`, in `checkSiteEligibility` directly after the destructuring `const { data, branch: foundBranch } = await readSiteBriefWithFallback(...)`:
```ts
    if (data.themeTemplate === "grid") return { kind: "skipped", reason: "grid template" };
```
In `processSingleSite` directly after `briefData = data; writeBranch = foundBranch;` (still inside the inner `try`, after the assignments):
```ts
      if (data.themeTemplate === "grid") return { kind: "skipped", domain, reason: "grid template" };
```

- [ ] **Step 3: Run the new and the existing scheduler tests**

`npx vitest run src/__tests__/scheduled-publisher-grid.test.ts src/__tests__/scheduled-publisher.test.ts`
Expected: both PASS. The existing file must be unmodified.

- [ ] **Checkpoint:** green. No commit.

### Task 18: Summary core (pure): files, decision matrix, prompt, targets

**Files:**
- Create: `services/content-pipeline/src/agents/grid-summaries/types.ts`
- Create: `services/content-pipeline/src/agents/grid-summaries/files.ts`
- Create: `services/content-pipeline/src/agents/grid-summaries/decide.ts`
- Create: `services/content-pipeline/src/agents/grid-summaries/prompt.ts`
- Create: `services/content-pipeline/src/agents/grid-summaries/targets.ts`
- Create test: `services/content-pipeline/src/__tests__/grid-summaries-core.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`:
    - `interface PoolItemLike { site: string; slug: string; title: string }`
    - `interface PoolLike { siteId: string; storyMode: 'excerpt' | 'ai_summary'; items: PoolItemLike[] }` (a structural subset of the worker's `GridPoolResponse`)
    - `interface ArticleRecordLike { frontmatter: { title?: string; status?: string }; body: string }`
  - `files.ts`:
    - `interface SummaryFrontmatter { source_site: string; slug: string; body_hash: string; generated_at: string; model: string; edited: boolean; edited_by: string | null; edited_at: string | null; source_changed: boolean }`
    - `summaryPath(site: string, slug: string): string`
    - `serializeSummaryFile(fm: SummaryFrontmatter, markdown: string): string`
    - `parseSummaryFile(raw: string): { fm: SummaryFrontmatter; markdown: string } | null`
  - `decide.ts`: `type SummaryAction = 'generate' | 'regenerate' | 'skip' | 'flag_source_changed'`, `decideAction(existing: SummaryFrontmatter | null, bodyHash: string): SummaryAction`, `sha256(text: string): string`
  - `prompt.ts`: `SUMMARY_SYSTEM_PROMPT: string`, `articleText(html: string): string`, `buildUserPrompt(title: string, text: string): string`, `sanitizeSummaryMarkdown(md: string): string`, `isValidSummary(md: string): boolean`
  - `targets.ts`:
    - `interface IndexEntry { domain: string; status: string; custom_domain: string | null; deleted: boolean }`
    - `parseDashboardIndex(yamlText: string): IndexEntry[]`
    - `poolUrlFor(entry: IndexEntry, env: { gridWorkerBaseUrl?: string; stagingWorkerUrl: string }): string`
    - `isAiGridConfig(config: unknown): boolean`
    - `isSafeId(value: unknown): value is string`

- [ ] **Step 1: Failing tests `grid-summaries-core.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { decideAction, sha256 } from "../agents/grid-summaries/decide.js";
import { parseSummaryFile, serializeSummaryFile, summaryPath, type SummaryFrontmatter } from "../agents/grid-summaries/files.js";
import { articleText, isValidSummary, sanitizeSummaryMarkdown } from "../agents/grid-summaries/prompt.js";
import { isAiGridConfig, isSafeId, parseDashboardIndex, poolUrlFor } from "../agents/grid-summaries/targets.js";

const fm = (over: Partial<SummaryFrontmatter> = {}): SummaryFrontmatter => ({
  source_site: "a", slug: "s", body_hash: "h1", generated_at: "2026-09-27T00:00:00.000Z", model: "m",
  edited: false, edited_by: null, edited_at: null, source_changed: false, ...over,
});

describe("decideAction", () => {
  it.each([
    [null, "h1", "generate"],
    [fm(), "h1", "skip"],
    [fm(), "h2", "regenerate"],
    [fm({ edited: true }), "h2", "flag_source_changed"],
    [fm({ edited: true, source_changed: true }), "h2", "skip"],
    [fm({ edited: true }), "h1", "skip"],
  ])("existing=%o hash=%s → %s", (existing, hash, action) => {
    expect(decideAction(existing as SummaryFrontmatter | null, hash)).toBe(action);
  });
  it("sha256 is stable hex", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("summary files", () => {
  it("round-trips and quotes generated_at as a string", () => {
    const raw = serializeSummaryFile(fm(), "## H\n\nBody");
    expect(raw).toMatch(/generated_at: ['"]2026-09-27T00:00:00.000Z['"]/);
    expect(parseSummaryFile(raw)).toEqual({ fm: fm(), markdown: "## H\n\nBody" });
  });
  it("path format", () => expect(summaryPath("a", "s")).toBe("grid-summaries/a/s.md"));
  it("invalid file → null", () => expect(parseSummaryFile("no frontmatter")).toBeNull());
});

describe("prompt helpers", () => {
  it("sanitize unwraps fences and strips html, links, images, urls", () => {
    const md = "```markdown\n## T\n\nHi <b>x</b> [l](http://a) ![i](b.png) https://c.com\n```";
    expect(sanitizeSummaryMarkdown(md)).toBe("## T\n\nHi x l");
  });
  it("isValidSummary enforces structure and length", () => {
    const body = Array.from({ length: 30 }, () => "word").join(" ");
    const good = `## H\n\n${body}\n\n### A\n\n${body}\n\n### B\n\n${body}`;
    expect(isValidSummary(good)).toBe(true);
    expect(isValidSummary(`## H\n\nshort`)).toBe(false);
    expect(isValidSummary(`## H\n\n## H2\n\n${body} ${body} ${body}\n\n### A\n\n### B`)).toBe(false);
  });
  it("articleText flattens HTML and truncates", () => {
    const t = articleText(`<h2>Head</h2><p>${"x".repeat(20000)}</p>`);
    expect(t.startsWith("Head")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(12000);
  });
});

describe("targets", () => {
  it("parses dashboard-index entries", () => {
    const entries = parseDashboardIndex("sites:\n  - domain: a\n    status: Live\n    custom_domain: a.com\n  - domain: b\n    status: Staging\n  - domain: c\n    status: Live\n    deleted_at: 2026-01-01\n");
    expect(entries).toEqual([
      { domain: "a", status: "live", custom_domain: "a.com", deleted: false },
      { domain: "b", status: "staging", custom_domain: null, deleted: false },
      { domain: "c", status: "live", custom_domain: null, deleted: true },
    ]);
  });
  it("pool URL: override > live custom domain > staging preview", () => {
    const env = { stagingWorkerUrl: "https://stg.workers.dev" };
    expect(poolUrlFor({ domain: "a", status: "live", custom_domain: "a.com", deleted: false }, env)).toBe("https://a.com/api/pool");
    expect(poolUrlFor({ domain: "b", status: "staging", custom_domain: null, deleted: false }, env)).toBe("https://stg.workers.dev/api/pool?_atl_site=b");
    expect(poolUrlFor({ domain: "a", status: "live", custom_domain: "a.com", deleted: false }, { ...env, gridWorkerBaseUrl: "http://localhost:8788" })).toBe("http://localhost:8788/api/pool?_atl_site=a");
  });
  it("isAiGridConfig / isSafeId", () => {
    expect(isAiGridConfig({ theme: { template: "grid" }, grid: { story_mode: "ai_summary" } })).toBe(true);
    expect(isAiGridConfig({ theme: { template: "grid" }, grid: { story_mode: "excerpt" } })).toBe(false);
    expect(isAiGridConfig({ theme: { base: "grid" } })).toBe(false);
    expect(isSafeId("best-telescopes-2026")).toBe(true);
    expect(isSafeId("../etc")).toBe(false);
  });
});
```
Run: `npx vitest run src/__tests__/grid-summaries-core.test.ts`. Expected: FAIL (modules missing).

- [ ] **Step 2: Implement `types.ts`, `decide.ts`, `files.ts`**

```ts
// types.ts
/** Structural subset of the site-worker's GridPoolResponse (the pipeline does not depend on shared-types). */
export interface PoolItemLike { site: string; slug: string; title: string }
export interface PoolLike { siteId: string; storyMode: "excerpt" | "ai_summary"; items: PoolItemLike[] }
/** Structural subset of the KV ArticleRecord. */
export interface ArticleRecordLike { frontmatter: { title?: string; status?: string }; body: string }
```
```ts
// decide.ts
import { createHash } from "node:crypto";
import type { SummaryFrontmatter } from "./files.js";

/** What to do with one needed article this run. */
export type SummaryAction = "generate" | "regenerate" | "skip" | "flag_source_changed";

/** sha256 hex of the source article body — detects source edits. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Spec matrix: missing → generate; unchanged → skip; changed+auto → regenerate; changed+hand-edited → flag once. */
export function decideAction(existing: SummaryFrontmatter | null, bodyHash: string): SummaryAction {
  if (!existing) return "generate";
  if (existing.body_hash === bodyHash) return "skip";
  if (existing.edited) return existing.source_changed ? "skip" : "flag_source_changed";
  return "regenerate";
}
```
```ts
// files.ts
import matter from "gray-matter";

/** Frontmatter of grid-summaries/<site>/<slug>.md. */
export interface SummaryFrontmatter {
  source_site: string;
  slug: string;
  body_hash: string;
  generated_at: string;
  model: string;
  edited: boolean;
  edited_by: string | null;
  edited_at: string | null;
  source_changed: boolean;
}

/** Repo path of a summary file. */
export function summaryPath(site: string, slug: string): string {
  return `grid-summaries/${site}/${slug}.md`;
}

/** Summary file text. Dates are kept as strings so YAML never turns them into Date objects. */
export function serializeSummaryFile(fm: SummaryFrontmatter, markdown: string): string {
  return matter.stringify(`${markdown.trim()}\n`, { ...fm, generated_at: String(fm.generated_at) });
}

/** Parses a summary file; null when it has no usable frontmatter. */
export function parseSummaryFile(raw: string): { fm: SummaryFrontmatter; markdown: string } | null {
  const parsed = matter(raw);
  const d = parsed.data as Record<string, unknown>;
  if (typeof d.source_site !== "string" || typeof d.slug !== "string") return null;
  const str = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));
  return {
    fm: {
      source_site: d.source_site, slug: d.slug, body_hash: str(d.body_hash), generated_at: str(d.generated_at),
      model: str(d.model), edited: d.edited === true, edited_by: typeof d.edited_by === "string" ? d.edited_by : null,
      edited_at: d.edited_at == null ? null : str(d.edited_at), source_changed: d.source_changed === true,
    },
    markdown: parsed.content.trim(),
  };
}
```
If gray-matter's YAML dumper doesn't quote the ISO string (the round-trip test checks this), pass `{ engines: … }` or post-process: `raw.replace(/^generated_at: (.+)$/m, 'generated_at: "$1"')`. The test decides.

- [ ] **Step 3: Implement `prompt.ts` and `targets.ts`**

```ts
// prompt.ts
import { parse } from "node-html-parser";

/** System prompt for Grid story summaries (spec "Summary file"). */
export const SUMMARY_SYSTEM_PROMPT = [
  "You write short story summaries for a news feed.",
  "Rewrite in your own words; never copy sentences from the article. Use only facts stated in the article; add nothing.",
  "Output GitHub-flavoured markdown only, with exactly this structure:",
  "one line starting with '## ' (a fresh headline, not the original title), then one intro paragraph,",
  "then 3 or 4 sections, each a '### ' heading followed by one paragraph.",
  "About 200 words in total. No links, no URLs, no HTML, no images, no lists, no quotes longer than 10 words.",
].join(" ");

const MAX_ARTICLE_CHARS = 12_000;

/** Article HTML (KV body) → plain text for the prompt. */
export function articleText(html: string): string {
  return parse(html).structuredText.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_ARTICLE_CHARS);
}

/** User turn for one article. */
export function buildUserPrompt(title: string, text: string): string {
  return `Article title: ${title}\n\nArticle text:\n${text}`;
}

/** Strips anything the story page must never render (fences, HTML, links, images, URLs). */
export function sanitizeSummaryMarkdown(md: string): string {
  const unfenced = md.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, "$1");
  return unfenced
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One H2, 2–5 H3s, 80–450 words. Invalid output is treated as a failure and retried next run. */
export function isValidSummary(md: string): boolean {
  const h2 = (md.match(/^## /gm) ?? []).length;
  const h3 = (md.match(/^### /gm) ?? []).length;
  const words = md.replace(/[#*_>`]/g, " ").split(/\s+/).filter(Boolean).length;
  return h2 === 1 && h3 >= 2 && h3 <= 5 && words >= 80 && words <= 450;
}
```
The sanitize test expects `"## T\n\nHi x l"`. After the substitutions the line is `Hi x l  ` (the removed image and URL leave spaces), then trailing-space trimming gives `Hi x l`. Adjust the whitespace rules until the test passes, keeping this behaviour.
```ts
// targets.ts
import { parse as parseYaml } from "yaml";

/** dashboard-index.yaml fields the summary agent needs. */
export interface IndexEntry { domain: string; status: string; custom_domain: string | null; deleted: boolean }

/** Parses dashboard-index.yaml (status lower-cased; deleted = deleted_at set or status "deleted"). */
export function parseDashboardIndex(yamlText: string): IndexEntry[] {
  const doc = (parseYaml(yamlText) ?? {}) as { sites?: Array<Record<string, unknown>> };
  return (doc.sites ?? [])
    .filter((s) => typeof s.domain === "string" && s.domain)
    .map((s) => {
      const status = String(s.status ?? "").toLowerCase();
      return {
        domain: s.domain as string,
        status,
        custom_domain: typeof s.custom_domain === "string" && s.custom_domain ? s.custom_domain : null,
        deleted: !!s.deleted_at || status === "deleted",
      };
    });
}

/** Where to fetch a Grid site's /api/pool (spec: prod host when Live, staging preview otherwise). */
export function poolUrlFor(entry: IndexEntry, env: { gridWorkerBaseUrl?: string; stagingWorkerUrl: string }): string {
  if (env.gridWorkerBaseUrl) return `${env.gridWorkerBaseUrl.replace(/\/$/, "")}/api/pool?_atl_site=${encodeURIComponent(entry.domain)}`;
  if (entry.status === "live" && entry.custom_domain) return `https://${entry.custom_domain}/api/pool`;
  return `${env.stagingWorkerUrl.replace(/\/$/, "")}/api/pool?_atl_site=${encodeURIComponent(entry.domain)}`;
}

/** True for a resolved KV site-config of a Grid site in ai_summary mode. */
export function isAiGridConfig(config: unknown): boolean {
  const c = (config ?? {}) as { theme?: { template?: unknown }; grid?: { story_mode?: unknown } };
  return c.theme?.template === "grid" && c.grid?.story_mode === "ai_summary";
}

/** Site ids and slugs used in repo paths / KV keys: kebab-case, no traversal. */
export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/i.test(value);
}
```

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Checkpoint:** green. No commit.

### Task 19: Orchestration: `runGridSummaries`, `regenerateSummary`, `saveEditedSummary`

**Files:**
- Create: `services/content-pipeline/src/agents/grid-summaries/errors.ts`
- Create: `services/content-pipeline/src/agents/grid-summaries/index.ts`
- Modify: `services/content-pipeline/src/stats/types.ts`: add `"grid-summaries"` to `GenerationSource`
- Create test: `services/content-pipeline/src/__tests__/grid-summaries-run.test.ts`

**Interfaces:**
- Consumes: Task 18 modules; `createOctokit`, `readFile`, `commitBatch`, `clearTreeCache` (`src/lib/github.ts`); `getKVEntry`, `credentialsFor` (`src/lib/kv.ts`); `getKvNamespaces` (`src/lib/cloudflare-accounts.ts`); `generateContent` (`src/lib/ai.ts`); `recordTextUsage` (`src/costs/recorder.ts`); `AgentConfig` (`src/lib/config.ts`).
- Produces:
  - `interface GridSummariesDeps { now: () => Date; fetchPool: (url: string) => Promise<PoolLike>; readKv: (domain: string, key: string, env: 'prod' | 'staging') => Promise<unknown> }`
  - `interface GridSummariesResult { targets: number; needed: number; generated: number; regenerated: number; flagged: number; skipped: number; failed: number; capped: boolean; commits: number }`
  - `runGridSummaries(config: AgentConfig, deps?: GridSummariesDeps): Promise<GridSummariesResult>`
  - `startGridSummariesRun(config: AgentConfig): boolean` (fire-and-forget with an overlap guard)
  - `class GridSummaryError extends Error { status: number }`
  - `regenerateSummary(config: AgentConfig, site: string, slug: string, deps?: GridSummariesDeps): Promise<{ path: string }>`
  - `saveEditedSummary(config: AgentConfig, input: { site: string; slug: string; markdown: string; editedBy: string }, deps?: GridSummariesDeps): Promise<{ path: string }>`

- [ ] **Step 1: Failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockReadFile = vi.fn();
const mockCommitBatch = vi.fn().mockResolvedValue("sha");
vi.mock("../lib/github.js", () => ({
  createOctokit: (): unknown => ({}),
  readFile: (...a: unknown[]): unknown => mockReadFile(...a),
  commitBatch: (...a: unknown[]): unknown => mockCommitBatch(...a),
  clearTreeCache: (): void => undefined,
}));
const mockGenerate = vi.fn();
vi.mock("../lib/ai.js", () => ({ generateContent: (...a: unknown[]): unknown => mockGenerate(...a) }));
const mockRecord = vi.fn().mockResolvedValue(undefined);
vi.mock("../costs/recorder.js", () => ({ recordTextUsage: (...a: unknown[]): unknown => mockRecord(...a) }));

import { runGridSummaries, saveEditedSummary, GridSummaryError, type GridSummariesDeps } from "../agents/grid-summaries/index.js";
import { serializeSummaryFile } from "../agents/grid-summaries/files.js";
import { sha256 } from "../agents/grid-summaries/decide.js";

const W = Array.from({ length: 30 }, () => "word").join(" ");
const GOOD = `## Headline\n\n${W}\n\n### One\n\n${W}\n\n### Two\n\n${W}`;
const INDEX = "sites:\n  - domain: mygrid\n    status: Live\n    custom_domain: mygrid.com\n  - domain: src\n    status: Live\n    custom_domain: src.com\n";
const config = { github: { token: "t", repo: "o/r" }, networkRepo: "o/r" } as never;

function deps(over: Partial<GridSummariesDeps> = {}): GridSummariesDeps {
  return {
    now: () => new Date("2026-09-27T10:00:00Z"),
    fetchPool: async () => ({ siteId: "mygrid", storyMode: "ai_summary", items: [{ site: "src", slug: "a1", title: "A1" }, { site: "src", slug: "a2", title: "A2" }] }),
    readKv: async (_d, key) => {
      if (key === "site-config:mygrid") return { theme: { template: "grid" }, grid: { story_mode: "ai_summary" } };
      if (key === "site-config:src") return { theme: { base: "classic" } };
      if (key.startsWith("article:src:")) return { frontmatter: { title: key, status: "published" }, body: `<p>${key}</p>` };
      return null;
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
    if (path === "dashboard-index.yaml") return INDEX;
    throw new Error("Expected file at x, got nothing");
  });
  mockGenerate.mockResolvedValue({ text: GOOD, usage: { inputTokens: 10, outputTokens: 20, estimated: false } });
});

describe("runGridSummaries", () => {
  it("generates missing summaries and commits once per source site", async () => {
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ targets: 1, needed: 2, generated: 2, failed: 0, commits: 1 });
    const [, , files, , message, branch] = mockCommitBatch.mock.calls[0] as [unknown, unknown, Array<{ path: string; content: string }>, unknown, string, string];
    expect(files.map((f) => f.path)).toEqual(["grid-summaries/src/a1.md", "grid-summaries/src/a2.md"]);
    expect(message).toBe("grid summaries: src (2 files)");
    expect(branch).toBe("main");
    expect(files[0]?.content).toContain(`body_hash: ${sha256("<p>article:src:a1</p>")}`);
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ siteDomain: "src", source: "grid-summaries" }));
  });
  it("never overwrites a hand-edited summary; flags it once when the source changed", async () => {
    const edited = serializeSummaryFile({ source_site: "src", slug: "a1", body_hash: "old", generated_at: "x", model: "m", edited: true, edited_by: "dashboard", edited_at: "y", source_changed: false }, "## Mine\n\nHuman text");
    mockReadFile.mockImplementation(async (_o: unknown, _r: unknown, path: string) => {
      if (path === "dashboard-index.yaml") return INDEX;
      if (path === "grid-summaries/src/a1.md") return edited;
      throw new Error("missing");
    });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ flagged: 1, generated: 1 });
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ path: string; content: string }>;
    const a1 = files.find((f) => f.path.endsWith("a1.md"));
    expect(a1?.content).toContain("source_changed: true");
    expect(a1?.content).toContain("Human text");
  });
  it("an AI failure or invalid output counts as failed and does not stop the run", async () => {
    mockGenerate.mockRejectedValueOnce(new Error("gateway down")).mockResolvedValueOnce({ text: "## too short", usage: { inputTokens: 1, outputTokens: 1, estimated: true } });
    const r = await runGridSummaries(config, deps());
    expect(r).toMatchObject({ generated: 0, failed: 2, commits: 0 });
  });
  it("skips non-AI Grid sites and unreachable pools", async () => {
    const r = await runGridSummaries(config, deps({ fetchPool: async () => { throw new Error("503"); } }));
    expect(r).toMatchObject({ targets: 1, needed: 0 });
  });
  it("respects the per-run cap", async () => {
    process.env.GRID_SUMMARY_RUN_CAP = "1";
    const r = await runGridSummaries(config, deps());
    delete process.env.GRID_SUMMARY_RUN_CAP;
    expect(r).toMatchObject({ generated: 1, capped: true });
  });
});

describe("saveEditedSummary", () => {
  it("writes edited=true with the CURRENT body hash (clears stale)", async () => {
    await saveEditedSummary(config, { site: "src", slug: "a1", markdown: "## Mine\n\nFixed <b>text</b>", editedBy: "dashboard" }, deps());
    const files = mockCommitBatch.mock.calls[0]?.[2] as Array<{ content: string }>;
    expect(files[0]?.content).toContain("edited: true");
    expect(files[0]?.content).toContain(`body_hash: ${sha256("<p>article:src:a1</p>")}`);
    expect(files[0]?.content).toContain("source_changed: false");
    expect(files[0]?.content).not.toContain("<b>");
  });
  it("unknown article → 404 GridSummaryError", async () => {
    await expect(saveEditedSummary(config, { site: "src", slug: "zz", markdown: "## x\n\ny", editedBy: "d" }, deps({ readKv: async () => null })))
      .rejects.toMatchObject({ status: 404 });
    expect(GridSummaryError).toBeDefined();
  });
});
```
Run the tests. Expected: FAIL (module missing).

- [ ] **Step 2: `GenerationSource`**

In `src/stats/types.ts` change the union to `"scheduler" | "dashboard" | "wp-import" | "grid-summaries"`.
Then run `grep -rn "GenerationSource\|source ===\|case \"wp-import\"" src --include=*.ts`. If any `switch` or `Record<GenerationSource, …>` must be exhaustive, add a `"grid-summaries"` entry that mirrors `"scheduler"`. Run `pnpm typecheck` to confirm.

- [ ] **Step 3: Implement `errors.ts` and `index.ts`**

```ts
// errors.ts — dependency-free so http.ts (and its test) never load GitHub/AI/Mongo modules.
/** Typed error carrying the HTTP status for the regenerate/save endpoints. */
export class GridSummaryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
```
```ts
// index.ts
import { GridSummaryError } from "./errors.js";
export { GridSummaryError } from "./errors.js";
import { generateContent } from "../../lib/ai.js";
import type { AgentConfig } from "../../lib/config.js";
import { clearTreeCache, commitBatch, createOctokit, readFile } from "../../lib/github.js";
import { credentialsFor, getKVEntry } from "../../lib/kv.js";
import { getKvNamespaces } from "../../lib/cloudflare-accounts.js";
import { recordTextUsage } from "../../costs/recorder.js";
import { decideAction, sha256 } from "./decide.js";
import { parseSummaryFile, serializeSummaryFile, summaryPath, type SummaryFrontmatter } from "./files.js";
import { SUMMARY_SYSTEM_PROMPT, articleText, buildUserPrompt, isValidSummary, sanitizeSummaryMarkdown } from "./prompt.js";
import { isAiGridConfig, parseDashboardIndex, poolUrlFor } from "./targets.js";
import type { ArticleRecordLike, PoolLike } from "./types.js";

const STAGING_WORKER_URL = process.env.GRID_STAGING_WORKER_URL ?? "https://atomic-site-worker-staging.accounts-4a8.workers.dev";
const DEFAULT_RUN_CAP = 150;
// Note: undefined → the CloudGrid gateway / SDK default model. Set GRID_SUMMARY_MODEL to a cheaper id
// that is valid on BOTH the gateway and the Anthropic SDK (see src/lib/ai.ts fallback).
const COST_MODEL_FALLBACK = "claude-sonnet-4-6";

/** Injectable I/O so tests never hit the network. */
export interface GridSummariesDeps {
  now: () => Date;
  fetchPool: (url: string) => Promise<PoolLike>;
  readKv: (domain: string, key: string, env: "prod" | "staging") => Promise<unknown>;
}

/** Counters for one run (logged and returned). */
export interface GridSummariesResult {
  targets: number; needed: number; generated: number; regenerated: number;
  flagged: number; skipped: number; failed: number; capped: boolean; commits: number;
}

function defaultDeps(): GridSummariesDeps {
  return {
    now: () => new Date(),
    fetchPool: async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`pool ${url} → ${res.status}`);
      return (await res.json()) as PoolLike;
    },
    readKv: (domain, key, env) => getKVEntry(getKvNamespaces(domain)[env], key, credentialsFor(domain)),
  };
}

async function readArticle(deps: GridSummariesDeps, site: string, slug: string): Promise<ArticleRecordLike | null> {
  const key = `article:${site}:${slug}`;
  const rec = ((await deps.readKv(site, key, "prod")) ?? (await deps.readKv(site, key, "staging"))) as ArticleRecordLike | null;
  return rec && typeof rec.body === "string" && rec.frontmatter?.status === "published" ? rec : null;
}

async function readExisting(octokit: ReturnType<typeof createOctokit>, repo: string, site: string, slug: string): Promise<{ fm: SummaryFrontmatter; markdown: string } | null> {
  try {
    return parseSummaryFile(await readFile(octokit, repo, summaryPath(site, slug), "main"));
  } catch {
    return null; // readFile throws on a missing file
  }
}

async function generateSummary(site: string, title: string, body: string): Promise<{ markdown: string; model: string }> {
  const model = process.env.GRID_SUMMARY_MODEL;
  const result = await generateContent({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(title, articleText(body)),
    ...(model ? { model } : {}),
    maxTokens: 900,
  });
  void recordTextUsage({
    siteDomain: site, source: "grid-summaries", model: model ?? COST_MODEL_FALLBACK,
    inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, estimated: result.usage.estimated,
  });
  const markdown = sanitizeSummaryMarkdown(result.text);
  if (!isValidSummary(markdown)) throw new Error("summary failed structure/length validation");
  return { markdown, model: model ?? COST_MODEL_FALLBACK };
}

function freshFrontmatter(site: string, slug: string, bodyHash: string, model: string, now: Date): SummaryFrontmatter {
  return { source_site: site, slug, body_hash: bodyHash, generated_at: now.toISOString(), model, edited: false, edited_by: null, edited_at: null, source_changed: false };
}

/** One hourly run (spec "Summary generation"). Never throws for per-article problems. */
export async function runGridSummaries(config: AgentConfig, deps: GridSummariesDeps = defaultDeps()): Promise<GridSummariesResult> {
  const result: GridSummariesResult = { targets: 0, needed: 0, generated: 0, regenerated: 0, flagged: 0, skipped: 0, failed: 0, capped: false, commits: 0 };
  const cap = Number(process.env.GRID_SUMMARY_RUN_CAP ?? DEFAULT_RUN_CAP) || DEFAULT_RUN_CAP;
  const octokit = createOctokit(config.github);
  clearTreeCache("main");
  const entries = parseDashboardIndex(await readFile(octokit, config.networkRepo, "dashboard-index.yaml", "main")).filter((e) => !e.deleted);

  // 1. AI-mode Grid sites (resolved config from prod KV when Live, staging otherwise).
  const pools: PoolLike[] = [];
  for (const entry of entries) {
    const cfg = await deps.readKv(entry.domain, `site-config:${entry.domain}`, entry.status === "live" ? "prod" : "staging").catch(() => null);
    if (!isAiGridConfig(cfg)) continue;
    result.targets++;
    try {
      pools.push(await deps.fetchPool(poolUrlFor(entry, { gridWorkerBaseUrl: process.env.GRID_WORKER_BASE_URL, stagingWorkerUrl: STAGING_WORKER_URL })));
    } catch (err) {
      console.error(`[grid-summaries] pool fetch failed for ${entry.domain}:`, err instanceof Error ? err.message : err);
    }
  }

  // 2. Needed set: union of every AI-mode pool (already limited by per_site_limit + pins), deduped.
  const needed = new Map<string, { site: string; slug: string; title: string }>();
  for (const pool of pools) for (const i of pool.items) needed.set(`${i.site}:${i.slug}`, i);
  result.needed = needed.size;

  // 3. Decide + generate, grouping files per source site.
  const filesBySite = new Map<string, Array<{ path: string; content: string }>>();
  const push = (site: string, file: { path: string; content: string }): void => {
    filesBySite.set(site, [...(filesBySite.get(site) ?? []), file]);
  };
  let generations = 0;
  for (const { site, slug, title } of needed.values()) {
    try {
      const record = await readArticle(deps, site, slug);
      if (!record) { result.failed++; continue; }
      const hash = sha256(record.body);
      const existing = await readExisting(octokit, config.networkRepo, site, slug);
      const action = decideAction(existing?.fm ?? null, hash);
      if (action === "skip") { result.skipped++; continue; }
      if (action === "flag_source_changed" && existing) {
        push(site, { path: summaryPath(site, slug), content: serializeSummaryFile({ ...existing.fm, source_changed: true }, existing.markdown) });
        result.flagged++;
        continue;
      }
      if (generations >= cap) { result.capped = true; continue; }
      generations++;
      const { markdown, model } = await generateSummary(site, record.frontmatter.title ?? title, record.body);
      push(site, { path: summaryPath(site, slug), content: serializeSummaryFile(freshFrontmatter(site, slug, hash, model, deps.now()), markdown) });
      if (action === "generate") result.generated++; else result.regenerated++;
    } catch (err) {
      result.failed++;
      console.error(`[grid-summaries] ${site}/${slug} failed:`, err instanceof Error ? err.message : err);
    }
  }

  // 4. One commit per source site.
  for (const [site, files] of filesBySite) {
    try {
      await commitBatch(octokit, config.networkRepo, files, [], `grid summaries: ${site} (${files.length} files)`, "main");
      result.commits++;
    } catch (err) {
      result.failed += files.length;
      console.error(`[grid-summaries] commit failed for ${site}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log("[grid-summaries] run complete", result);
  return result;
}

let running = false;

/** Fire-and-forget for the hourly cron. Returns false when a run is already in progress. */
export function startGridSummariesRun(config: AgentConfig): boolean {
  if (running) return false;
  running = true;
  void runGridSummaries(config)
    .catch((err: unknown) => console.error("[grid-summaries] run crashed:", err))
    .finally(() => { running = false; });
  return true;
}

/** Dashboard "Regenerate": always overwrites, including hand-edited summaries (dashboard confirms first). */
export async function regenerateSummary(config: AgentConfig, site: string, slug: string, deps: GridSummariesDeps = defaultDeps()): Promise<{ path: string }> {
  const record = await readArticle(deps, site, slug);
  if (!record) throw new GridSummaryError(`No published article ${site}/${slug}`, 404);
  let generated: { markdown: string; model: string };
  try {
    generated = await generateSummary(site, record.frontmatter.title ?? slug, record.body);
  } catch (err) {
    throw new GridSummaryError(`Generation failed: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
  const path = summaryPath(site, slug);
  const octokit = createOctokit(config.github);
  await commitBatch(octokit, config.networkRepo, [{ path, content: serializeSummaryFile(freshFrontmatter(site, slug, sha256(record.body), generated.model, deps.now()), generated.markdown) }], [], `grid summaries: regenerate ${site}/${slug}`, "main");
  return { path };
}

/** Dashboard "Edit" save: sanitised, marked edited, hash reset to the current source (clears "stale"). */
export async function saveEditedSummary(config: AgentConfig, input: { site: string; slug: string; markdown: string; editedBy: string }, deps: GridSummariesDeps = defaultDeps()): Promise<{ path: string }> {
  const markdown = sanitizeSummaryMarkdown(input.markdown);
  if (!markdown) throw new GridSummaryError("Summary is empty", 400);
  if (markdown.split(/\s+/).length > 1500) throw new GridSummaryError("Summary is too long (max 1500 words)", 400);
  const record = await readArticle(deps, input.site, input.slug);
  if (!record) throw new GridSummaryError(`No published article ${input.site}/${input.slug}`, 404);
  const octokit = createOctokit(config.github);
  const existing = await readExisting(octokit, config.networkRepo, input.site, input.slug);
  const now = deps.now().toISOString();
  const fm: SummaryFrontmatter = {
    source_site: input.site, slug: input.slug, body_hash: sha256(record.body),
    generated_at: existing?.fm.generated_at ?? now, model: existing?.fm.model ?? "human",
    edited: true, edited_by: input.editedBy, edited_at: now, source_changed: false,
  };
  const path = summaryPath(input.site, input.slug);
  await commitBatch(octokit, config.networkRepo, [{ path, content: serializeSummaryFile(fm, markdown) }], [], `grid summaries: edit ${input.site}/${input.slug}`, "main");
  return { path };
}
```
Note: if `getKVEntry` requires the Dev1 credentials split, `credentialsFor(domain)` already handles it. Dev1 sites never appear as Grid sources, but the Grid site's own config lookup still works either way.

- [ ] **Step 4: Run tests.** Expected: PASS (7 tests). Then `pnpm typecheck` in content-pipeline. Expected: clean.

- [ ] **Checkpoint:** green. No commit.

### Task 20: HTTP routes + hourly cron

**Files:**
- Create: `services/content-pipeline/src/agents/grid-summaries/http.ts`
- Create test: `services/content-pipeline/src/__tests__/grid-summaries-http.test.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts`: one block next to `/run-alerts` (~L805) + import
- Modify: `cloudgrid.yaml`: one cron block

**Interfaces:**
- Produces:
  - `parseRegenerateBody(raw: string): { site: string; slug: string }` (throws `GridSummaryError` 400)
  - `parseSaveBody(raw: string): { site: string; slug: string; markdown: string; editedBy: string }` (throws 400)
  - Routes: `GET /grid-summaries` → `{status: "started" | "already_running"}` (always 200); `POST /grid-summaries/regenerate` and `POST /grid-summaries/save` → `{status: "ok", path}` or `{status: "error", message}` with the error's status.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseRegenerateBody, parseSaveBody } from "../agents/grid-summaries/http.js";

describe("grid-summaries http body parsing", () => {
  it("accepts valid regenerate bodies", () => {
    expect(parseRegenerateBody(JSON.stringify({ site: "scienceworld", slug: "best-telescopes-2026" }))).toEqual({ site: "scienceworld", slug: "best-telescopes-2026" });
  });
  it.each(['{"site":"../x","slug":"a"}', '{"site":"a"}', "not json"])("rejects %s with 400", (raw) => {
    expect(() => parseRegenerateBody(raw)).toThrow(expect.objectContaining({ status: 400 }));
  });
  it("save requires markdown ≤ 20k chars and defaults editedBy", () => {
    expect(parseSaveBody(JSON.stringify({ site: "a", slug: "b", markdown: "## x" }))).toEqual({ site: "a", slug: "b", markdown: "## x", editedBy: "dashboard" });
    expect(() => parseSaveBody(JSON.stringify({ site: "a", slug: "b", markdown: "x".repeat(20_001) }))).toThrow(expect.objectContaining({ status: 400 }));
  });
});
```

- [ ] **Step 2: Implement `http.ts`**

```ts
import { GridSummaryError } from "./errors.js";
import { isSafeId } from "./targets.js";

function parseJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new GridSummaryError("Invalid JSON body", 400);
}

/** POST /grid-summaries/regenerate body. */
export function parseRegenerateBody(raw: string): { site: string; slug: string } {
  const b = parseJson(raw);
  if (!isSafeId(b.site) || !isSafeId(b.slug)) throw new GridSummaryError("site and slug are required kebab-case ids", 400);
  return { site: b.site, slug: b.slug };
}

/** POST /grid-summaries/save body. */
export function parseSaveBody(raw: string): { site: string; slug: string; markdown: string; editedBy: string } {
  const { site, slug } = parseRegenerateBody(raw);
  const b = parseJson(raw);
  if (typeof b.markdown !== "string" || b.markdown.length > 20_000) throw new GridSummaryError("markdown is required (max 20000 chars)", 400);
  const editedBy = typeof b.editedBy === "string" && b.editedBy.trim() ? b.editedBy.trim().slice(0, 100) : "dashboard";
  return { site, slug, markdown: b.markdown, editedBy };
}
```

- [ ] **Step 3: Route block in `content-generation/index.ts`**

Add the import at the top with the other agent imports:
`import { regenerateSummary, saveEditedSummary, startGridSummariesRun } from "../grid-summaries/index.js";`
`import { GridSummaryError } from "../grid-summaries/errors.js";`
`import { parseRegenerateBody, parseSaveBody } from "../grid-summaries/http.js";`
Add this block next to the `/run-alerts` block:
```ts
  // Grid template AI summaries. The cron GET always returns 200 (never marks the cron failed).
  {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && pathname === "/grid-summaries") {
      sendJson(res, 200, { status: startGridSummariesRun(config) ? "started" : "already_running" });
      return;
    }
    if (req.method === "POST" && (pathname === "/grid-summaries/regenerate" || pathname === "/grid-summaries/save")) {
      try {
        const raw = await readBody(req);
        const out = pathname.endsWith("/regenerate")
          ? await (async () => { const b = parseRegenerateBody(raw); return regenerateSummary(config, b.site, b.slug); })()
          : await saveEditedSummary(config, parseSaveBody(raw));
        sendJson(res, 200, { status: "ok", path: out.path });
      } catch (err) {
        const status = err instanceof GridSummaryError ? err.status : 500;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[server] ${pathname} error:`, message);
        sendJson(res, status, { status: "error", message });
      }
      return;
    }
  }
```

- [ ] **Step 4: Cron in `cloudgrid.yaml`**

Next to `run-alerts`:
```yaml
  # ---------------------------------------------------------------------------
  # grid-summaries — hourly: AI summaries for Grid sites in ai_summary mode.
  # Fire-and-forget; no-op when no Grid site uses ai_summary.
  # ---------------------------------------------------------------------------
  grid-summaries:
    type: cron
    schedule: "30 * * * *"
    timezone: EST
    run: http://content-pipeline-app/grid-summaries
```

- [ ] **Step 5: Run the http tests + the full pipeline suite + typecheck**

`npx vitest run src/__tests__/grid-summaries-http.test.ts && pnpm test && pnpm typecheck`. Expected: all green.

- [ ] **Step 6: Local smoke test**

Run the pipeline locally with `GRID_WORKER_BASE_URL=http://localhost:8788` (worker running, `fixture-grid` switched to `story_mode: ai_summary` and re-seeded). Use a **scratch copy of the network repo** (`NETWORK_REPO` pointing at a throwaway fork, or `LOCAL_NETWORK_PATH` mode). Never point it at `atomicfuse/atomic-labs-network` during testing.
`curl -s localhost:5000/grid-summaries` → `{"status":"started"}`. Watch the logs for `run complete`.
If no throwaway repo is available, skip this step and rely on the unit tests. Note the skip in the test-results file.

- [ ] **Checkpoint:** green. No commit.

---

## Phase F — Dashboard (design skills required for Tasks 22–24)

### Task 21: Local Grid types + site save mapping

**Files:**
- Create: `services/dashboard/src/types/grid.ts`
- Create: `services/dashboard/src/lib/grid-config.ts`
- Create test: `services/dashboard/src/lib/__tests__/grid-config.test.ts`
- Modify: `services/dashboard/src/actions/wizard.ts`: `StagingSiteConfig` (~L1029), add 3 optional fields
- Modify: `services/dashboard/src/app/api/sites/save/route.ts`: one call after the `configUpdates.layout` block (~L143)

**Interfaces:**
- Produces:
  - `types/grid.ts`: `GridStoryMode`, `GridTopicFields`, `GridPinFields`, `GridFields`, `GRID_CARD_OPTIONS`, `GridCardFields`, `GRID_CARD_DEFAULTS`, `GRID_ONLY_COLOR_KEYS`, `GRID_COLOR_GROUPS`, `GridSummaryStatus`, `GridPoolItem`, `GridSourceStatus`, `GridInactivePin`, `GridPoolResponse`, `SiteOption`
  - `grid-config.ts`: `interface GridConfigUpdates { theme_template?: 'modern' | 'grid'; theme_card?: GridCardFields; grid?: GridFields }`, `applyGridConfigUpdates(existing: Record<string, unknown>, updates: GridConfigUpdates): void`

- [ ] **Step 1: `src/types/grid.ts`** (mirror of shared-types; keep in sync)

```ts
/**
 * Grid template types — mirrors packages/shared-types/src/grid.ts.
 * The dashboard does not depend on @atomic-platform/shared-types; keep both in sync.
 */
export type GridStoryMode = "excerpt" | "ai_summary";
export interface GridTopicFields { label: string; slug?: string; verticals: string[] }
export interface GridPinFields { site: string; slug: string; until?: string | null }
export interface GridFields {
  topics?: GridTopicFields[];
  include_sites?: string[];
  exclude_sites?: string[];
  per_site_limit?: number;
  max_age_days?: number | null;
  story_mode?: GridStoryMode;
  excerpt_paragraphs?: number;
  feed_ad_every?: number;
  page_size?: number;
  show_intro?: boolean;
  outbound_utm?: boolean;
  pinned?: GridPinFields[];
}
export const GRID_CARD_OPTIONS = {
  style: ["bordered", "shadow", "flat"],
  corners: ["square", "small", "rounded"],
  image_ratio: ["4:3", "16:9", "1:1"],
  image_position: ["top", "left"],
  density: ["comfortable", "compact"],
  source_position: ["below", "badge"],
} as const;
export interface GridCardFields {
  style?: (typeof GRID_CARD_OPTIONS.style)[number];
  corners?: (typeof GRID_CARD_OPTIONS.corners)[number];
  image_ratio?: (typeof GRID_CARD_OPTIONS.image_ratio)[number];
  image_position?: (typeof GRID_CARD_OPTIONS.image_position)[number];
  density?: (typeof GRID_CARD_OPTIONS.density)[number];
  source_position?: (typeof GRID_CARD_OPTIONS.source_position)[number];
}
export const GRID_CARD_DEFAULTS: Required<GridCardFields> = {
  style: "bordered", corners: "rounded", image_ratio: "4:3", image_position: "top", density: "comfortable", source_position: "below",
};
/** Colour keys only the Grid template reads (never part of themePresets ColorState). */
export const GRID_ONLY_COLOR_KEYS = ["card_bg", "card_border", "pill_border", "pill_active_bg", "pill_active_text", "search_bg"] as const;
/** Grid colour editor layout: [key, label, inherits-from label | null]. Spec "Theming → Colours". */
export const GRID_COLOR_GROUPS: ReadonlyArray<{ title: string; fields: ReadonlyArray<readonly [string, string, string | null]> }> = [
  { title: "Page & cards", fields: [["background", "Page background", null], ["surface", "Surface", null], ["card_bg", "Card background", "Surface"], ["border", "Borders", null], ["card_border", "Card border", "Borders"]] },
  { title: "Text", fields: [["text", "Body text", null], ["muted", "Meta text (source, age)", null], ["heading", "Headlines", null]] },
  { title: "Accent & links", fields: [["accent", "Accent (active pill, button)", null], ["link", "Links", null], ["link_hover", "Link hover", null]] },
  { title: "Pills & search", fields: [["nav_link", "Pill text", null], ["nav_link_hover", "Pill hover", null], ["pill_border", "Pill border", "Borders"], ["pill_active_bg", "Active pill background", "transparent"], ["pill_active_text", "Active pill text", "Accent"], ["search_bg", "Search bar", "Surface"]] },
  { title: "Story text", fields: [["prose_heading", "Story headings", null], ["prose_body", "Story body", null]] },
  { title: "Footer", fields: [["footer_bg", "Footer background", null], ["footer_text", "Footer text", null], ["footer_link", "Footer links", null], ["footer_link_hover", "Footer link hover", null]] },
];
export type GridSummaryStatus = "none" | "generated" | "edited" | "stale";
export interface GridPoolItem { site: string; slug: string; title: string; publishDate: string; featuredImage?: string; description?: string; pills: string[]; pinned: boolean; summary?: { status: GridSummaryStatus; generatedAt?: string } }
export interface GridSourceStatus { siteId: string; included: boolean; reason?: "self" | "grid_site" | "not_live" | "dev1_account" | "excluded" | "no_matching_vertical" | "missing_index"; pills: string[] }
export interface GridInactivePin extends GridPinFields { reason: "expired" | "not_source" | "not_published" }
export interface GridPoolResponse { siteId: string; generatedAt: string; storyMode: GridStoryMode; perSiteLimit: number; directoryGeneratedAt: string | null; sources: GridSourceStatus[]; items: GridPoolItem[]; inactivePins: GridInactivePin[] }
/** A site option for pickers (from /api/sites/list). */
export interface SiteOption { domain: string; status: string; vertical: string }
```

- [ ] **Step 2: Failing test `grid-config.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { applyGridConfigUpdates } from "../grid-config";

describe("applyGridConfigUpdates", () => {
  it("sets theme.template grid and keeps other theme keys (incl. base preset id)", () => {
    const existing: Record<string, unknown> = { theme: { base: "classic", colors: { accent: "#f00" } } };
    applyGridConfigUpdates(existing, { theme_template: "grid" });
    expect(existing.theme).toEqual({ base: "classic", colors: { accent: "#f00" }, template: "grid" });
  });
  it("switching back to modern removes the key (absent = modern)", () => {
    const existing: Record<string, unknown> = { theme: { template: "grid", base: "classic" } };
    applyGridConfigUpdates(existing, { theme_template: "modern" });
    expect(existing.theme).toEqual({ base: "classic" });
  });
  it("replaces theme.card and grid wholesale; untouched when absent", () => {
    const existing: Record<string, unknown> = { theme: {}, grid: { per_site_limit: 5 } };
    applyGridConfigUpdates(existing, { theme_card: { style: "shadow" } });
    expect(existing).toEqual({ theme: { card: { style: "shadow" } }, grid: { per_site_limit: 5 } });
    applyGridConfigUpdates(existing, { grid: { topics: [{ label: "T", verticals: ["Travel"] }] } });
    expect(existing.grid).toEqual({ topics: [{ label: "T", verticals: ["Travel"] }] });
  });
  it("no-op for an update with no Grid fields", () => {
    const existing: Record<string, unknown> = { theme: { base: "x" } };
    applyGridConfigUpdates(existing, {});
    expect(existing).toEqual({ theme: { base: "x" } });
  });
});
```
Implement `grid-config.ts`:
```ts
import type { GridCardFields, GridFields } from "@/types/grid";

/** Grid fields accepted by /api/sites/save `configUpdates`. */
export interface GridConfigUpdates {
  theme_template?: "modern" | "grid";
  theme_card?: GridCardFields;
  grid?: GridFields;
}

/** Applies Grid updates to a site.yaml object in place (same mutation style as the save route). */
export function applyGridConfigUpdates(existing: Record<string, unknown>, updates: GridConfigUpdates): void {
  if (updates.theme_template === undefined && updates.theme_card === undefined && updates.grid === undefined) return;
  const theme = (existing.theme ?? {}) as Record<string, unknown>;
  if (updates.theme_template === "grid") theme.template = "grid";
  if (updates.theme_template === "modern") delete theme.template;
  if (updates.theme_card !== undefined) theme.card = updates.theme_card;
  existing.theme = theme;
  if (updates.grid !== undefined) existing.grid = updates.grid;
}
```
Run: `cd services/dashboard && npx vitest run src/lib/__tests__/grid-config.test.ts`. Expected: PASS.

- [ ] **Step 3: Wire into save**

In `actions/wizard.ts` `StagingSiteConfig`, add:
```ts
  /** Grid template switch → site.yaml theme.template ("modern" removes the key). */
  theme_template?: "modern" | "grid";
  /** Grid card look → site.yaml theme.card. */
  theme_card?: import("@/types/grid").GridCardFields;
  /** Grid feed settings → site.yaml grid (replaced wholesale). */
  grid?: import("@/types/grid").GridFields;
```
In `app/api/sites/save/route.ts`, directly after `if (configUpdates.layout !== undefined) { existing.layout = configUpdates.layout; }`:
```ts
      applyGridConfigUpdates(existing, configUpdates);
```
Add `import { applyGridConfigUpdates } from "@/lib/grid-config";`.
The route already commits to the staging branch, triggers sync, dual-writes Mongo (`upsertSiteConfig(domain, existing)`) and revalidates. No other change is needed.

- [ ] **Step 4:** `pnpm typecheck` in dashboard. Expected: clean. Run the full dashboard suite and confirm existing tests are unchanged and green.

- [ ] **Checkpoint:** green. No commit.

### Task 22: Theme tab: template switch, Grid colours, card look

**Files:**
- Create: `services/dashboard/src/components/site-detail/grid/GridThemeFields.tsx`
- Create: `services/dashboard/src/components/site-detail/grid/GridCardLookFields.tsx`
- Create tests: `services/dashboard/src/components/site-detail/grid/__tests__/GridThemeFields.test.tsx`, `GridCardLookFields.test.tsx`
- Create test: `services/dashboard/src/components/wizard/__tests__/grid-preset-compat.test.ts`
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`: state, load, render switch, save payload

**Interfaces:**
- Consumes: `GRID_COLOR_GROUPS`, `GRID_ONLY_COLOR_KEYS`, `GRID_CARD_OPTIONS`, `GRID_CARD_DEFAULTS`, `GridCardFields`; `ColorPickerField` (`@/components/wizard/ColorPickerField`, props `{ label; value; onChange; helperText? }`).
- Produces:
  - `GridThemeFields` props `{ colors: Record<string, string>; onChange: (key: string, value: string | null) => void }`
  - `GridCardLookFields` props `{ value: GridCardFields; onChange: (next: GridCardFields) => void }`

- [ ] **Step 1: Load the design skills** (`ui-ux-pro-max`, `design-taste-frontend`, `frontend-design`) and follow the dashboard's existing visual language: the CSS variables `--bg-elevated`, `--border-primary`, the `Button` and `Input` components.

- [ ] **Step 2: Failing tests**

```tsx
// GridThemeFields.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridThemeFields } from "../GridThemeFields";
afterEach(cleanup);

describe("GridThemeFields", () => {
  it("renders every Grid colour, with inherit hints for Grid-only keys", () => {
    render(<GridThemeFields colors={{ accent: "#6c35bb" }} onChange={vi.fn()} />);
    expect(screen.getByText("Card background")).toBeInTheDocument();
    expect(screen.getAllByText(/Inherits Surface/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Must Reads/)).not.toBeInTheDocument();
  });
  it("'Use default' clears a Grid-only key (onChange with null)", async () => {
    const onChange = vi.fn();
    render(<GridThemeFields colors={{ card_bg: "#ffffff" }} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Use default for Card background" }));
    expect(onChange).toHaveBeenCalledWith("card_bg", null);
  });
});
```
```tsx
// GridCardLookFields.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridCardLookFields } from "../GridCardLookFields";
afterEach(cleanup);

describe("GridCardLookFields", () => {
  it("shows defaults and emits a merged value on change", async () => {
    const onChange = vi.fn();
    render(<GridCardLookFields value={{ corners: "small" }} onChange={onChange} />);
    expect(screen.getByLabelText("Card style")).toHaveValue("bordered");
    await userEvent.selectOptions(screen.getByLabelText("Card style"), "shadow");
    expect(onChange).toHaveBeenCalledWith({ corners: "small", style: "shadow" });
  });
});
```
```ts
// grid-preset-compat.test.ts — proves Grid-only colour keys can't change preset detection.
import { describe, expect, it } from "vitest";
import { detectPreset, presetToColors } from "../themePresets";

describe("Grid colour keys vs preset detection", () => {
  it("extra Grid-only keys do not change the detected preset", () => {
    const base = presetToColors("classic");
    expect(detectPreset({ ...base, card_bg: "#ffffff", pill_border: "#000000" })).toBe(detectPreset(base));
  });
});
```
If the compat test fails (`detectPreset` compares every key), do **not** modify `themePresets.ts`. Instead, in SiteThemeTab strip `GRID_ONLY_COLOR_KEYS` before calling `detectPreset` (Step 4). Change the test to assert that helper, `withoutGridKeys(colors)`.

- [ ] **Step 3: Implement both components**

```tsx
// GridThemeFields.tsx
"use client";
import { ColorPickerField } from "@/components/wizard/ColorPickerField";
import { GRID_COLOR_GROUPS } from "@/types/grid";

interface GridThemeFieldsProps {
  colors: Record<string, string>;
  /** null = remove the key (inherit). */
  onChange: (key: string, value: string | null) => void;
}

/** Colour editor for Grid-template sites: only the keys Grid renders (spec "Theming → Colours"). */
export function GridThemeFields({ colors, onChange }: GridThemeFieldsProps): React.ReactElement {
  return (
    <div className="space-y-6">
      {GRID_COLOR_GROUPS.map((group) => (
        <section key={group.title}>
          <h4 className="mb-2 text-sm font-semibold">{group.title}</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.fields.map(([key, label, inherits]) => (
              <div key={key} className="space-y-1">
                <ColorPickerField
                  label={label}
                  value={colors[key] ?? ""}
                  onChange={(v): void => onChange(key, v)}
                  helperText={inherits ? `Inherits ${inherits} when empty` : undefined}
                />
                {inherits && colors[key] && (
                  <button type="button" className="text-xs underline" aria-label={`Use default for ${label}`} onClick={(): void => onChange(key, null)}>
                    Use default
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```
Note: `GridThemeFields` itself is loaded with `next/dynamic` from SiteThemeTab (Step 4), so importing `ColorPickerField` statically here keeps it out of the initial bundle, consistent with CLAUDE.md.
```tsx
// GridCardLookFields.tsx
"use client";
import { GRID_CARD_DEFAULTS, GRID_CARD_OPTIONS, type GridCardFields } from "@/types/grid";

interface GridCardLookFieldsProps { value: GridCardFields; onChange: (next: GridCardFields) => void }

const LABELS: Record<keyof GridCardFields, string> = {
  style: "Card style", corners: "Corners", image_ratio: "Image ratio",
  image_position: "Image position", density: "Density", source_position: "Source line",
};

/** Six card-look dropdowns + a live mini preview. */
export function GridCardLookFields({ value, onChange }: GridCardLookFieldsProps): React.ReactElement {
  const v = { ...GRID_CARD_DEFAULTS, ...value };
  const keys = Object.keys(GRID_CARD_OPTIONS) as Array<keyof GridCardFields>;
  const radius = v.corners === "square" ? 0 : v.corners === "small" ? 6 : 12;
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_220px]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {keys.map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm">
            <span>{LABELS[k]}</span>
            <select
              aria-label={LABELS[k]}
              className="rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2 py-1.5"
              value={v[k]}
              onChange={(e): void => onChange({ ...value, [k]: e.target.value })}
            >
              {GRID_CARD_OPTIONS[k].map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div aria-hidden="true" className="self-start overflow-hidden bg-white p-2 text-black"
        style={{ borderRadius: radius, border: v.style === "bordered" ? "1px solid #e3e6ee" : "none", boxShadow: v.style === "shadow" ? "0 8px 24px rgb(0 0 0 / .1)" : "none",
          display: v.image_position === "left" ? "flex" : "block", gap: 8 }}>
        <div style={{ background: "#cfd6e4", borderRadius: Math.max(0, radius - 3), aspectRatio: v.image_position === "left" ? "1 / 1" : v.image_ratio.replace(":", " / "), width: v.image_position === "left" ? 64 : "100%", position: "relative" }}>
          {v.source_position === "badge" && <span style={{ position: "absolute", left: 6, bottom: 6, fontSize: 10, background: "rgb(0 0 0 / .6)", color: "#fff", borderRadius: 99, padding: "1px 6px" }}>site.com · 5d</span>}
        </div>
        <div style={{ padding: v.density === "compact" ? 4 : 8 }}>
          {v.source_position === "below" && <p style={{ fontSize: 10, opacity: .6, margin: 0 }}>site.com · 5d</p>}
          <p style={{ fontWeight: 700, fontSize: v.density === "compact" ? 12 : 14, margin: "4px 0 0" }}>Headline preview for the card</p>
        </div>
      </div>
    </div>
  );
}
```
Run both component tests. Expected: PASS.

- [ ] **Step 4: SiteThemeTab changes** (modern-mode UI must render exactly as before)

1. At the top, with the other dynamic imports:
```tsx
const GridThemeFields = dynamic(() => import("./grid/GridThemeFields").then((m) => m.GridThemeFields), { ssr: false });
const GridCardLookFields = dynamic(() => import("./grid/GridCardLookFields").then((m) => m.GridCardLookFields), { ssr: false });
```
Plus `import { GRID_ONLY_COLOR_KEYS, type GridCardFields } from "@/types/grid";`.
2. `ThemeState` gets `template: "modern" | "grid"; card: GridCardFields;`, and the initial state gets `template: "modern", card: {}`.
3. In the load effect, where colours are overlaid from `data.config.theme.colors` using `ALL_COLOR_KEYS`, also overlay `GRID_ONLY_COLOR_KEYS` when present. Set:
   `template: data.config.theme?.template === "grid" ? "grid" : "modern"`
   `card: (data.config.theme?.card ?? {}) as GridCardFields`
4. Add a handler:
```tsx
  function setGridColor(key: string, value: string | null): void {
    setState((s) => {
      const colors = { ...s.colors };
      if (value === null) delete colors[key]; else colors[key] = value;
      return { ...s, colors, preset: detectPreset(colors) };
    });
  }
```
(Use the existing state setter name.)
5. Directly above `<ThemePresetPicker …/>`, add a template selector: an accessible radio group of two cards.
   - **Modern:** "Magazine layout: hero, must-reads, sections."
   - **Grid:** "Card-grid news feed of stories from other network sites."

   Selecting one sets `state.template`. When switching to Grid for the first time, show an inline note: "This site will stop showing its own articles and show network stories instead. Configure topics in the Grid tab after saving."
6. Render switch:
   - When `state.template === "grid"`: render `<GridThemeFields colors={state.colors} onChange={setGridColor} />` and `<GridCardLookFields value={state.card} onChange={(card): void => setState((s) => ({ ...s, card }))} />`, each inside the same section wrapper style used by the other sections. **Do not** render the Brand / Section Backgrounds / Text / Advanced colour sections or the Layout section.
   - When `modern`: render exactly the current JSX.
   - The preset picker, Typography and Logo sections render in both modes.
7. Save payload: add `theme_template: state.template` and `...(state.template === "grid" ? { theme_card: state.card } : {})` to `configUpdates`. Make sure the dirty check includes the two new fields: it compares serialised state, so they're included automatically if they live in `state`.

- [ ] **Step 5: SiteThemeTab behaviour test**

Create `services/dashboard/src/components/site-detail/__tests__/SiteThemeTab.grid.test.tsx`:
- Mock `global.fetch`. For `/api/sites/site-config` return `{ config: { theme: { template: "grid", base: "classic", colors: {} } }, inheritance: { org: null, groups: [] } }`; for `/api/sites/save` return `{ status: "ok" }`.
- Mock `next/dynamic` to resolve synchronously: `vi.mock("next/dynamic", () => ({ default: (loader) => { const C = (p) => { const [M, setM] = React.useState(null); React.useEffect(() => { loader().then((m) => setM(() => m)); }, []); return M ? <M {...p} /> : null; }; return C; } }))`, following the pattern used by other dashboard tests if one exists (grep `vi.mock("next/dynamic"`).
- Assert:
  - `await screen.findByText("Card background")` is present.
  - `screen.queryByText("Must Reads background")` is null.
  - Selecting a card style and clicking "Save Theme" sends a body containing `"theme_template":"grid"` and `"theme_card"`.
- Add a second case with a modern config: "Must Reads background" is present and "Card background" is absent.

- [ ] **Step 6:** Run the new tests, the full dashboard suite, and typecheck. Expected: green, with `themePresets.test.ts` untouched.

- [ ] **Checkpoint:** screenshots of the Theme tab in modern and Grid modes saved to `docs/test-results/screenshots/grid/dashboard/`. No commit.

### Task 23: Grid settings form (site + group level)

**Files:**
- Create: `services/dashboard/src/components/config/grid/TopicsEditor.tsx`
- Create: `services/dashboard/src/components/config/grid/SiteMultiPicker.tsx`
- Create: `services/dashboard/src/components/config/grid/GridSettingsForm.tsx`
- Create: `services/dashboard/src/components/config/grid/GridSettingsSection.tsx` (fetches sites + verticals, renders the form)
- Create tests: `services/dashboard/src/components/config/grid/__tests__/TopicsEditor.test.tsx`, `GridSettingsForm.test.tsx`
- Modify: `services/dashboard/src/components/config/UnifiedConfigForm.tsx`: `UnifiedConfigFields` gets `grid?: GridFields`; one `<section>` shown when `mode === "group"`
- Modify: `services/dashboard/src/app/groups/[groupId]/page.tsx`: `formConfig` gets `grid: config.grid as GridFields | undefined`

**Interfaces:**
- Consumes: `useVerticals()` (`@/hooks/useReferenceData`, returns `{ verticals: Array<{ id: string; name: string }>; loading: boolean }`); `GET /api/sites/list` (returns `Array<{ domain; status; vertical; company; custom_domain }>`).
- Produces:
  - `TopicsEditor` props `{ value: GridTopicFields[]; onChange: (next: GridTopicFields[]) => void; verticals: string[] }`
  - `SiteMultiPicker` props `{ label: string; value: string[]; onChange: (next: string[]) => void; options: SiteOption[] }`
  - `GridSettingsForm` props `{ value: GridFields; onChange: (next: GridFields) => void; sites: SiteOption[]; verticals: string[] }`
  - `GridSettingsSection` props `{ value: GridFields; onChange: (next: GridFields) => void }`

- [ ] **Step 1: Load the design skills.**

- [ ] **Step 2: Failing tests**

```tsx
// TopicsEditor.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopicsEditor } from "../TopicsEditor";
afterEach(cleanup);

describe("TopicsEditor", () => {
  const verticals = ["Travel", "Healthy Living", "Medical Health"];
  it("adds a topic", async () => {
    const onChange = vi.fn();
    render(<TopicsEditor value={[]} onChange={onChange} verticals={verticals} />);
    await userEvent.click(screen.getByRole("button", { name: "Add topic" }));
    expect(onChange).toHaveBeenCalledWith([{ label: "", verticals: [] }]);
  });
  it("toggles a vertical on a topic", async () => {
    const onChange = vi.fn();
    render(<TopicsEditor value={[{ label: "Health", verticals: ["Healthy Living"] }]} onChange={onChange} verticals={verticals} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Medical Health" }));
    expect(onChange).toHaveBeenCalledWith([{ label: "Health", verticals: ["Healthy Living", "Medical Health"] }]);
  });
  it("moves and removes topics", async () => {
    const onChange = vi.fn();
    render(<TopicsEditor value={[{ label: "A", verticals: [] }, { label: "B", verticals: [] }]} onChange={onChange} verticals={verticals} />);
    await userEvent.click(screen.getByRole("button", { name: "Move B up" }));
    expect(onChange).toHaveBeenLastCalledWith([{ label: "B", verticals: [] }, { label: "A", verticals: [] }]);
    await userEvent.click(screen.getByRole("button", { name: "Remove A" }));
    expect(onChange).toHaveBeenLastCalledWith([{ label: "B", verticals: [] }]);
  });
});
```
```tsx
// GridSettingsForm.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GridSettingsForm } from "../GridSettingsForm";
afterEach(cleanup);

describe("GridSettingsForm", () => {
  it("clearing a number removes the key (inherit), typing sets it", () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{ per_site_limit: 10 }} onChange={onChange} sites={[]} verticals={[]} />);
    fireEvent.change(screen.getByLabelText("Articles per source site"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.change(screen.getByLabelText("Articles per source site"), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith({ per_site_limit: 7 });
  });
  it("story mode select writes story_mode", () => {
    const onChange = vi.fn();
    render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} />);
    fireEvent.change(screen.getByLabelText("Story page text"), { target: { value: "ai_summary" } });
    expect(onChange).toHaveBeenLastCalledWith({ story_mode: "ai_summary" });
  });
  it("preserves pinned (managed in the Stories tab) when editing other fields", () => {
    const onChange = vi.fn();
    const pinned = [{ site: "a", slug: "b" }];
    render(<GridSettingsForm value={{ pinned }} onChange={onChange} sites={[]} verticals={[]} />);
    fireEvent.change(screen.getByLabelText("Cards per page"), { target: { value: "24" } });
    expect(onChange).toHaveBeenLastCalledWith({ pinned, page_size: 24 });
  });
});
```

- [ ] **Step 3: Implement**

```tsx
// TopicsEditor.tsx
"use client";
import type { GridTopicFields } from "@/types/grid";

interface TopicsEditorProps { value: GridTopicFields[]; onChange: (next: GridTopicFields[]) => void; verticals: string[] }

/** Ordered pill editor: label, optional slug, verticals that feed the pill. */
export function TopicsEditor({ value, onChange, verticals }: TopicsEditorProps): React.ReactElement {
  const update = (i: number, patch: Partial<GridTopicFields>): void => onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const move = (i: number, dir: -1 | 1): void => {
    const next = [...value];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + dir, 0, item);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {value.map((t, i) => {
        const name = t.label || `topic ${i + 1}`;
        return (
          <fieldset key={i} className="rounded-lg border border-[var(--border-primary)] p-3">
            <legend className="sr-only">{name}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col text-sm">Label
                <input className="rounded border px-2 py-1" value={t.label} onChange={(e): void => update(i, { label: e.target.value })} />
              </label>
              <label className="flex flex-col text-sm">Slug (optional)
                <input className="rounded border px-2 py-1" value={t.slug ?? ""} placeholder="auto from label"
                  onChange={(e): void => update(i, e.target.value ? { slug: e.target.value } : { slug: undefined })} />
              </label>
              <div className="ml-auto flex gap-1">
                <button type="button" aria-label={`Move ${name} up`} disabled={i === 0} onClick={(): void => move(i, -1)}>↑</button>
                <button type="button" aria-label={`Move ${name} down`} disabled={i === value.length - 1} onClick={(): void => move(i, 1)}>↓</button>
                <button type="button" aria-label={`Remove ${name}`} onClick={(): void => onChange(value.filter((_, j) => j !== i))}>✕</button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Verticals for ${name}`}>
              {verticals.map((v) => (
                <label key={v} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={t.verticals.includes(v)}
                    onChange={(e): void => update(i, { verticals: e.target.checked ? [...t.verticals, v] : t.verticals.filter((x) => x !== v) })} />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <button type="button" className="text-sm underline" onClick={(): void => onChange([...value, { label: "", verticals: [] }])}>Add topic</button>
    </div>
  );
}
```
Note: `update(i, { slug: undefined })` leaves `slug: undefined` in the object; `JSON.stringify` drops it on save, which is fine. The first test expects exactly `{ label: "", verticals: [] }`.
```tsx
// SiteMultiPicker.tsx
"use client";
import type { SiteOption } from "@/types/grid";

interface SiteMultiPickerProps { label: string; value: string[]; onChange: (next: string[]) => void; options: SiteOption[] }

/** Chip list + "add a site" dropdown. */
export function SiteMultiPicker({ label, value, onChange, options }: SiteMultiPickerProps): React.ReactElement {
  const remaining = options.filter((o) => !value.includes(o.domain));
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {value.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            {d}
            <button type="button" aria-label={`Remove ${d} from ${label}`} onClick={(): void => onChange(value.filter((x) => x !== d))}>✕</button>
          </span>
        ))}
      </div>
      <select aria-label={`Add site to ${label}`} className="rounded border px-2 py-1 text-sm" value=""
        onChange={(e): void => { if (e.target.value) onChange([...value, e.target.value]); }}>
        <option value="">Add a site…</option>
        {remaining.map((o) => <option key={o.domain} value={o.domain}>{o.domain} ({o.vertical || "no vertical"}, {o.status})</option>)}
      </select>
    </div>
  );
}
```
```tsx
// GridSettingsForm.tsx
"use client";
import type { GridFields, SiteOption } from "@/types/grid";
import { TopicsEditor } from "./TopicsEditor";
import { SiteMultiPicker } from "./SiteMultiPicker";

interface GridSettingsFormProps { value: GridFields; onChange: (next: GridFields) => void; sites: SiteOption[]; verticals: string[] }

type NumberKey = "per_site_limit" | "max_age_days" | "excerpt_paragraphs" | "feed_ad_every" | "page_size";
const NUMBER_FIELDS: ReadonlyArray<{ key: NumberKey; label: string; min: number; max: number; hint: string }> = [
  { key: "per_site_limit", label: "Articles per source site", min: 1, max: 100, hint: "Newest N published articles from each source (default 10)" },
  { key: "max_age_days", label: "Maximum age (days)", min: 1, max: 3650, hint: "Empty = no age limit" },
  { key: "page_size", label: "Cards per page", min: 6, max: 60, hint: "Also the infinite-scroll batch size (default 20)" },
  { key: "feed_ad_every", label: "Ad every Nth tile", min: 0, max: 50, hint: "0 = no in-feed ads; 1 is treated as 2 (default 3)" },
  { key: "excerpt_paragraphs", label: "Excerpt paragraphs", min: 1, max: 10, hint: "Also used as the AI-summary fallback (default 3)" },
];

/** Grid feed settings. Empty inputs remove the key so the value inherits from group/org. */
export function GridSettingsForm({ value, onChange, sites, verticals }: GridSettingsFormProps): React.ReactElement {
  const set = <K extends keyof GridFields>(key: K, v: GridFields[K] | undefined): void => {
    const next = { ...value };
    if (v === undefined) delete next[key]; else next[key] = v;
    onChange(next);
  };
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Topic pills</h4>
        <p className="text-xs opacity-70">Each pill shows stories from Live network sites in the selected verticals.</p>
        <TopicsEditor value={value.topics ?? []} onChange={(t): void => set("topics", t)} verticals={verticals} />
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <SiteMultiPicker label="Also include sites" value={value.include_sites ?? []} onChange={(v): void => set("include_sites", v)} options={sites} />
        <SiteMultiPicker label="Never include sites" value={value.exclude_sites ?? []} onChange={(v): void => set("exclude_sites", v)} options={sites} />
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">Story page text
          <select aria-label="Story page text" className="rounded border px-2 py-1" value={value.story_mode ?? ""}
            onChange={(e): void => set("story_mode", e.target.value ? (e.target.value as GridFields["story_mode"]) : undefined)}>
            <option value="">Inherit (default: excerpt)</option>
            <option value="excerpt">Excerpt of the source article</option>
            <option value="ai_summary">AI summary (editable)</option>
          </select>
        </label>
        {NUMBER_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">{f.label}
            <input aria-label={f.label} type="number" min={f.min} max={f.max} className="rounded border px-2 py-1"
              value={value[f.key] ?? ""}
              onChange={(e): void => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />
            <span className="text-xs opacity-60">{f.hint}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.show_intro === true} onChange={(e): void => set("show_intro", e.target.checked)} /> Show description under card headlines
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.outbound_utm !== false} onChange={(e): void => set("outbound_utm", e.target.checked)} /> Add UTM tags to “Read full story” links
        </label>
      </section>
    </div>
  );
}
```
```tsx
// GridSettingsSection.tsx
"use client";
import { useEffect, useState } from "react";
import { useVerticals } from "@/hooks/useReferenceData";
import type { GridFields, SiteOption } from "@/types/grid";
import { GridSettingsForm } from "./GridSettingsForm";

interface GridSettingsSectionProps { value: GridFields; onChange: (next: GridFields) => void }

/** GridSettingsForm with its reference data (sites + verticals) loaded. */
export function GridSettingsSection({ value, onChange }: GridSettingsSectionProps): React.ReactElement {
  const { verticals } = useVerticals();
  const [sites, setSites] = useState<SiteOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sites/list")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ domain: string; status: string; vertical: string | null }>) => {
        if (!cancelled) setSites(rows.map((r) => ({ domain: r.domain, status: r.status, vertical: r.vertical ?? "" })));
      })
      .catch((err: unknown) => console.error("[grid] failed to load sites", err));
    return (): void => { cancelled = true; };
  }, []);
  return <GridSettingsForm value={value} onChange={onChange} sites={sites} verticals={verticals.map((v) => v.name)} />;
}
```
Run the two tests. Expected: PASS.

- [ ] **Step 4: Group level**

In `UnifiedConfigForm.tsx`:
- Add `grid?: GridFields;` to `UnifiedConfigFields`.
- Add `const GridSettingsSection = dynamic(() => import("./grid/GridSettingsSection").then((m) => m.GridSettingsSection), { ssr: false });`, using the file's existing `dynamic` import (add `import dynamic from "next/dynamic";` if absent).
- After the Theme `<section>`, add:
```tsx
      {mode === "group" && (
        <section>
          <SectionHeader title="Grid template" />
          <p className="mb-3 text-xs opacity-70">Applies only to sites in this group that use the Grid template. Site-level settings override these.</p>
          <GridSettingsSection value={config.grid ?? {}} onChange={(v): void => updateField("grid", v)} />
        </section>
      )}
```
In `app/groups/[groupId]/page.tsx`, add to `formConfig`: `grid: (config.grid ?? undefined) as GridFields | undefined,`. The existing `onChange={(updated) => setConfig({ ...config, ...updated })}` plus the whole-body PUT already persist it through Git and `upsertGroupConfig`.
Add an RTL test `components/config/__tests__/UnifiedConfigForm.grid.test.tsx`: mock `./grid/GridSettingsSection` to render `<div>grid-section</div>`; `mode="group"` shows "Grid template" and `mode="site"` doesn't.

- [ ] **Checkpoint:** tests + typecheck green. No commit.

### Task 24: Grid tab on the site page: settings, sources, stories, pins

**Files:**
- Create: `services/dashboard/src/lib/grid-urls.ts`
- Create test: `services/dashboard/src/lib/__tests__/grid-urls.test.ts`
- Create: `services/dashboard/src/app/api/grid/pool/route.ts`
- Create: `services/dashboard/src/components/site-detail/grid/GridSiteTab.tsx`
- Create: `services/dashboard/src/components/site-detail/grid/SourcesPreview.tsx`
- Create: `services/dashboard/src/components/site-detail/grid/StoriesTable.tsx`
- Create tests: `services/dashboard/src/components/site-detail/grid/__tests__/StoriesTable.test.tsx`, `SourcesPreview.test.tsx`
- Modify: `services/dashboard/src/components/site-detail/ContentAgentTab.tsx`: one conditional tab entry + dynamic import

**Interfaces:**
- Consumes: `getDashboardEntry(domain)` (`@/lib/db/dashboard-index`), `GridPoolResponse`, `GridSettingsSection`, `SummaryEditor` (Task 25; the Edit button stays disabled until Task 25 lands).
- Produces:
  - `gridPoolUrl(entry: { domain: string; status?: string | null; custom_domain?: string | null; preview_url?: string | null }, override?: string): string`
  - `GET /api/grid/pool?domain=` → `GridPoolResponse`
  - `StoriesTable` props `{ pool: GridPoolResponse; onTogglePin: (item: GridPoolItem) => void; onEdit: (item: GridPoolItem) => void }`
  - `SourcesPreview` props `{ sources: GridSourceStatus[]; topics: GridTopicFields[] }`

- [ ] **Step 1: Failing test `grid-urls.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { gridPoolUrl } from "../grid-urls";

describe("gridPoolUrl", () => {
  it("Live with custom domain → production host", () => {
    expect(gridPoolUrl({ domain: "g", status: "Live", custom_domain: "grid.com" })).toBe("https://grid.com/api/pool?summaries=1");
  });
  it("otherwise → preview_url host keeping _atl_site", () => {
    expect(gridPoolUrl({ domain: "g", status: "Staging", preview_url: "https://w.workers.dev/?_atl_site=g" })).toBe("https://w.workers.dev/api/pool?_atl_site=g&summaries=1");
  });
  it("override (local dev) wins", () => {
    expect(gridPoolUrl({ domain: "g", status: "Live", custom_domain: "grid.com" }, "http://localhost:8788")).toBe("http://localhost:8788/api/pool?_atl_site=g&summaries=1");
  });
  it("no preview_url → default staging worker", () => {
    expect(gridPoolUrl({ domain: "g", status: "Staging" })).toBe("https://atomic-site-worker-staging.accounts-4a8.workers.dev/api/pool?_atl_site=g&summaries=1");
  });
});
```
Implement `grid-urls.ts`:
```ts
const DEFAULT_STAGING_WORKER = "https://atomic-site-worker-staging.accounts-4a8.workers.dev";

/** Where a Grid site's /api/pool lives: prod host when Live, staging preview otherwise, or a local override. */
export function gridPoolUrl(
  entry: { domain: string; status?: string | null; custom_domain?: string | null; preview_url?: string | null },
  override?: string,
): string {
  if (override) return `${override.replace(/\/$/, "")}/api/pool?_atl_site=${encodeURIComponent(entry.domain)}&summaries=1`;
  if ((entry.status ?? "").toLowerCase() === "live" && entry.custom_domain) return `https://${entry.custom_domain}/api/pool?summaries=1`;
  const url = new URL(entry.preview_url || `${DEFAULT_STAGING_WORKER}/?_atl_site=${encodeURIComponent(entry.domain)}`);
  url.pathname = "/api/pool";
  url.searchParams.set("summaries", "1");
  return url.toString();
}
```
Run the test. Expected: PASS.

- [ ] **Step 2: `app/api/grid/pool/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDashboardEntry } from "@/lib/db/dashboard-index";
import { gridPoolUrl } from "@/lib/grid-urls";

/** Proxies the Grid site's own /api/pool so the Stories tab shows exactly what the site serves. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain || !/^[a-z0-9][a-z0-9-]*$/i.test(domain)) {
    return NextResponse.json({ error: "Missing or invalid domain" }, { status: 400 });
  }
  const entry = await getDashboardEntry(domain);
  if (!entry) return NextResponse.json({ error: `Unknown site ${domain}` }, { status: 404 });
  const url = gridPoolUrl(entry as { domain: string; status?: string; custom_domain?: string | null; preview_url?: string | null }, process.env.GRID_WORKER_BASE_URL);
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return NextResponse.json({ error: `Grid site returned ${res.status}` }, { status: 502 });
    return NextResponse.json(await res.json(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    console.error("[api/grid/pool]", err);
    return NextResponse.json({ error: "Could not reach the Grid site" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Failing tests for StoriesTable / SourcesPreview**

```tsx
// StoriesTable.test.tsx
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GridPoolResponse } from "@/types/grid";
import { StoriesTable } from "../StoriesTable";
afterEach(cleanup);

const pool = (storyMode: GridPoolResponse["storyMode"]): GridPoolResponse => ({
  siteId: "g", generatedAt: "t", storyMode, perSiteLimit: 10, directoryGeneratedAt: "d", sources: [], inactivePins: [{ site: "a", slug: "old", reason: "expired" }],
  items: [
    { site: "a", slug: "s1", title: "Story one", publishDate: "2026-09-26T00:00:00Z", pills: [], pinned: true, summary: { status: "stale" } },
    { site: "b", slug: "s2", title: "Story two", publishDate: "2026-09-25T00:00:00Z", pills: [], pinned: false, summary: { status: "none" } },
  ],
});

describe("StoriesTable", () => {
  it("pin toggle calls back with the item", async () => {
    const onTogglePin = vi.fn();
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={onTogglePin} onEdit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Pin Story two" }));
    expect(onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ slug: "s2" }));
    expect(screen.getByRole("button", { name: "Unpin Story one" })).toBeInTheDocument();
  });
  it("excerpt mode hides summary status and Edit", () => {
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit summary/ })).not.toBeInTheDocument();
  });
  it("AI mode shows status labels and Edit", async () => {
    const onEdit = vi.fn();
    render(<StoriesTable pool={pool("ai_summary")} onTogglePin={vi.fn()} onEdit={onEdit} />);
    const row = screen.getByText("Story one").closest("tr") as HTMLElement;
    expect(within(row).getByText("Stale — source changed after edit")).toBeInTheDocument();
    expect(screen.getByText("Excerpt fallback")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Edit summary for Story one" }));
    expect(onEdit).toHaveBeenCalled();
  });
  it("lists inactive pins with reasons", () => {
    render(<StoriesTable pool={pool("excerpt")} onTogglePin={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByText(/a\/old — expired/)).toBeInTheDocument();
  });
});
```
```tsx
// SourcesPreview.test.tsx
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SourcesPreview } from "../SourcesPreview";
afterEach(cleanup);

describe("SourcesPreview", () => {
  it("groups included sites by pill and explains exclusions", () => {
    render(<SourcesPreview topics={[{ label: "Travel", slug: "travel", verticals: ["Travel"] }]} sources={[
      { siteId: "a", included: true, pills: ["travel"] },
      { siteId: "x", included: true, pills: [] },
      { siteId: "hiddenstorydaily", included: false, reason: "no_matching_vertical", pills: [] },
      { siteId: "muvizzcom", included: false, reason: "dev1_account", pills: [] },
    ]} />);
    expect(screen.getByText("Travel (1)")).toBeInTheDocument();
    expect(screen.getByText("All only (1)")).toBeInTheDocument();
    expect(screen.getByText(/hiddenstorydaily — no vertical matches a pill/)).toBeInTheDocument();
    expect(screen.getByText(/muvizzcom — legacy account \(unavailable\)/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Implement StoriesTable, SourcesPreview, GridSiteTab** (load the design skills first)

```tsx
// StoriesTable.tsx
"use client";
import type { GridPoolItem, GridPoolResponse, GridSummaryStatus } from "@/types/grid";

interface StoriesTableProps { pool: GridPoolResponse; onTogglePin: (item: GridPoolItem) => void; onEdit: (item: GridPoolItem) => void }

const STATUS_LABEL: Record<GridSummaryStatus, string> = {
  none: "Excerpt fallback", generated: "AI summary", edited: "Edited", stale: "Stale — source changed after edit",
};

function age(iso: string): string {
  const d = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  return Number.isNaN(d) ? "" : d === 0 ? "today" : `${d}d`;
}

/** The Grid site's current feed with pin / summary actions. */
export function StoriesTable({ pool, onTogglePin, onEdit }: StoriesTableProps): React.ReactElement {
  const ai = pool.storyMode === "ai_summary";
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead><tr className="text-left opacity-70"><th>Story</th><th>Source</th><th>Age</th>{ai && <th>Summary</th>}<th /></tr></thead>
        <tbody>
          {pool.items.map((i) => (
            <tr key={`${i.site}:${i.slug}`} className="border-t border-[var(--border-primary)]">
              <td className="py-2 pr-2">{i.pinned && <span aria-hidden="true">📌 </span>}{i.title}</td>
              <td className="pr-2">{i.site}</td>
              <td className="pr-2">{age(i.publishDate)}</td>
              {ai && <td className="pr-2">{STATUS_LABEL[i.summary?.status ?? "none"]}</td>}
              <td className="flex justify-end gap-2 py-2">
                <button type="button" className="underline" aria-label={`${i.pinned ? "Unpin" : "Pin"} ${i.title}`} onClick={(): void => onTogglePin(i)}>
                  {i.pinned ? "Unpin" : "Pin"}
                </button>
                {ai && <button type="button" className="underline" aria-label={`Edit summary for ${i.title}`} onClick={(): void => onEdit(i)}>Edit</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pool.inactivePins.length > 0 && (
        <div className="text-xs opacity-80">
          <p className="font-semibold">Inactive pins</p>
          <ul>{pool.inactivePins.map((p) => <li key={`${p.site}:${p.slug}`}>{p.site}/{p.slug} — {p.reason.replace("_", " ")}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
```
```tsx
// SourcesPreview.tsx
"use client";
import type { GridSourceStatus, GridTopicFields } from "@/types/grid";

interface SourcesPreviewProps { sources: GridSourceStatus[]; topics: Array<GridTopicFields & { slug?: string }> }

const REASON: Record<NonNullable<GridSourceStatus["reason"]>, string> = {
  self: "this site", grid_site: "another Grid site", not_live: "not Live", dev1_account: "legacy account (unavailable)",
  excluded: "excluded in settings", no_matching_vertical: "no vertical matches a pill", missing_index: "no articles synced yet",
};

/** Which sites feed which pill, and why the others don't. */
export function SourcesPreview({ sources, topics }: SourcesPreviewProps): React.ReactElement {
  const included = sources.filter((s) => s.included);
  const excluded = sources.filter((s) => !s.included && s.reason !== "self");
  const slugOf = (t: GridTopicFields & { slug?: string }): string => t.slug ?? t.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const allOnly = included.filter((s) => s.pills.length === 0);
  return (
    <div className="grid gap-4 md:grid-cols-2 text-sm">
      <div className="space-y-2">
        {topics.map((t) => {
          const sites = included.filter((s) => s.pills.includes(slugOf(t)));
          return <div key={t.label}><p className="font-semibold">{t.label} ({sites.length})</p><p className="opacity-80">{sites.map((s) => s.siteId).join(", ") || "—"}</p></div>;
        })}
        {allOnly.length > 0 && <div><p className="font-semibold">All only ({allOnly.length})</p><p className="opacity-80">{allOnly.map((s) => s.siteId).join(", ")}</p></div>}
      </div>
      <div>
        <p className="font-semibold">Not included</p>
        <ul className="opacity-80">{excluded.map((s) => <li key={s.siteId}>{s.siteId} — {s.reason ? REASON[s.reason] : "unknown"}</li>)}</ul>
      </div>
    </div>
  );
}
```
Note: the topic slugs in the pool come from the worker's normaliser. The Sources panel uses the pool's own `sources[].pills` values, so a site-level slug mismatch only affects the grouping label. The worker's slugs are authoritative. The simple `slugOf` above matches `slugifyTopic` for plain labels. For labels with `&` or accents, pass the worker's resolved topics if exposed later (out of scope).
```tsx
// GridSiteTab.tsx
"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { GridFields, GridPoolItem, GridPoolResponse } from "@/types/grid";
import { SourcesPreview } from "./SourcesPreview";
import { StoriesTable } from "./StoriesTable";

const GridSettingsSection = dynamic(() => import("@/components/config/grid/GridSettingsSection").then((m) => m.GridSettingsSection), { ssr: false });
const SummaryEditor = dynamic(() => import("./SummaryEditor").then((m) => m.SummaryEditor), { ssr: false });

interface GridSiteTabProps { domain: string }

/** Grid tab: feed settings, source preview, and the live Stories list (pin / edit / regenerate). */
export function GridSiteTab({ domain }: GridSiteTabProps): React.ReactElement {
  const [grid, setGrid] = useState<GridFields>({});
  const [savedGrid, setSavedGrid] = useState<string>("{}");
  const [pool, setPool] = useState<GridPoolResponse | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<GridPoolItem | null>(null);

  const loadPool = useCallback(async (): Promise<void> => {
    setPoolError(null);
    const res = await fetch(`/api/grid/pool?domain=${encodeURIComponent(domain)}`);
    if (res.ok) setPool((await res.json()) as GridPoolResponse);
    else setPoolError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not load stories");
  }, [domain]);

  useEffect(() => {
    void (async (): Promise<void> => {
      const res = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`);
      if (res.ok) {
        const data = (await res.json()) as { config?: { grid?: GridFields } };
        const g = data.config?.grid ?? {};
        setGrid(g);
        setSavedGrid(JSON.stringify(g));
      }
      await loadPool();
    })();
  }, [domain, loadPool]);

  async function save(next: GridFields): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
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

  function togglePin(item: GridPoolItem): void {
    const pins = grid.pinned ?? [];
    const exists = pins.some((p) => p.site === item.site && p.slug === item.slug);
    const next = { ...grid, pinned: exists ? pins.filter((p) => !(p.site === item.site && p.slug === item.slug)) : [...pins, { site: item.site, slug: item.slug, until: null }] };
    setGrid(next);
    void save(next);
  }

  const dirty = JSON.stringify(grid) !== savedGrid;
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-base font-semibold">Feed settings</h3>
        <GridSettingsSection value={grid} onChange={setGrid} />
        <div className="flex items-center gap-3">
          <Button onClick={(): void => void save(grid)} loading={saving} disabled={!dirty || saving}>Save Grid settings</Button>
          {message && <span className="text-xs">{message}</span>}
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h3 className="text-base font-semibold">Sources</h3>
          <button type="button" className="text-xs underline" onClick={(): void => void loadPool()}>Refresh</button></div>
        {poolError ? <p className="text-sm text-amber-500">{poolError}</p> : pool && <SourcesPreview sources={pool.sources} topics={grid.topics ?? []} />}
      </section>
      <section className="space-y-3">
        <h3 className="text-base font-semibold">Stories ({pool?.items.length ?? 0})</h3>
        {pool && <StoriesTable pool={pool} onTogglePin={togglePin} onEdit={setEditing} />}
      </section>
      {editing && <SummaryEditor site={editing.site} slug={editing.slug} title={editing.title} status={editing.summary?.status ?? "none"} onClose={(): void => setEditing(null)} onSaved={(): void => void loadPool()} />}
    </div>
  );
}
```
If `@/components/ui/Button` has a different path or props, use the same import SiteThemeTab uses for its "Save Theme" button.
In `ContentAgentTab.tsx`:
- Add `const GridSiteTab = dynamic(() => import("./grid/GridSiteTab").then((m) => m.GridSiteTab), { ssr: false });`.
- In the `tabs` array, right after the `theme` entry, add:
```tsx
    ...(((siteConfig?.theme as Record<string, unknown> | undefined)?.template === "grid")
      ? [{ id: "grid", label: "Grid", content: <GridSiteTab domain={domain} /> }]
      : []),
```
Run the StoriesTable/SourcesPreview tests. Expected: PASS.

- [ ] **Checkpoint:** tests + typecheck green. Screenshot of the Grid tab against the local worker: dashboard `GRID_WORKER_BASE_URL=http://localhost:8788`, with `fixture-grid` present in the dashboard's index; if not, skip the screenshot and note it. No commit.

### Task 25: Summary view / edit / regenerate

**Files:**
- Create: `services/dashboard/src/lib/grid-summary-file.ts`
- Create: `services/dashboard/src/lib/grid-agent-url.ts`
- Create test: `services/dashboard/src/lib/__tests__/grid-summary-file.test.ts`
- Create: `services/dashboard/src/app/api/grid/summary/route.ts` (GET, PUT)
- Create: `services/dashboard/src/app/api/grid/regenerate/route.ts` (POST)
- Create: `services/dashboard/src/components/site-detail/grid/SummaryEditor.tsx`
- Create test: `services/dashboard/src/components/site-detail/grid/__tests__/SummaryEditor.test.tsx`

**Interfaces:**
- Consumes: `readFileContent(path, branch)` (`@/lib/github`); pipeline `POST /grid-summaries/save` and `/grid-summaries/regenerate` (Task 20).
- Produces:
  - `isSafeId(v: unknown): v is string`
  - `parseSummaryFileText(raw: string): { markdown: string; edited: boolean; sourceChanged: boolean; generatedAt: string | null } | null`
  - `getAgentUrl(): string`
  - `GET /api/grid/summary?site&slug` → `{ exists: boolean; markdown?: string; edited?: boolean; sourceChanged?: boolean; generatedAt?: string | null }`
  - `PUT /api/grid/summary` `{ site, slug, markdown }` → `{ ok: true }`
  - `POST /api/grid/regenerate` `{ site, slug }` → `{ ok: true }`
  - `SummaryEditor` props `{ site: string; slug: string; title: string; status: GridSummaryStatus; onClose: () => void; onSaved: () => void }`

- [ ] **Step 1: Failing tests**

```ts
// grid-summary-file.test.ts
import { describe, expect, it } from "vitest";
import { isSafeId, parseSummaryFileText } from "../grid-summary-file";

describe("parseSummaryFileText", () => {
  it("reads flags and markdown", () => {
    expect(parseSummaryFileText("---\nedited: true\nsource_changed: false\ngenerated_at: '2026-09-27T00:00:00Z'\n---\n## H\n\nBody\n"))
      .toEqual({ markdown: "## H\n\nBody", edited: true, sourceChanged: false, generatedAt: "2026-09-27T00:00:00Z" });
  });
  it("no frontmatter → null", () => expect(parseSummaryFileText("## H")).toBeNull());
});
describe("isSafeId", () => {
  it("accepts kebab ids only", () => {
    expect(isSafeId("best-telescopes-2026")).toBe(true);
    expect(isSafeId("../x")).toBe(false);
    expect(isSafeId(3)).toBe(false);
  });
});
```
```tsx
// SummaryEditor.test.tsx
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SummaryEditor } from "../SummaryEditor";
afterEach(cleanup);
beforeEach(() => {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).startsWith("/api/grid/summary?")) return new Response(JSON.stringify({ exists: true, markdown: "## H\n\nBody", edited: true, sourceChanged: true }));
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
});

describe("SummaryEditor", () => {
  it("regenerating a hand-edited summary asks first; cancelling sends nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SummaryEditor site="a" slug="s" title="T" status="stale" onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByDisplayValue(/Body/);
    await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(window.confirm).toHaveBeenCalled();
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u) === "/api/grid/regenerate")).toBe(false);
  });
  it("saving PUTs the edited markdown", async () => {
    const onSaved = vi.fn();
    render(<SummaryEditor site="a" slug="s" title="T" status="edited" onClose={vi.fn()} onSaved={onSaved} />);
    const box = await screen.findByDisplayValue(/Body/);
    await userEvent.type(box, " more");
    await userEvent.click(screen.getByRole("button", { name: "Save summary" }));
    const put = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toMatchObject({ site: "a", slug: "s", markdown: expect.stringContaining("more") });
    expect(onSaved).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// grid-summary-file.ts
import { parse as parseYaml } from "yaml";

/** Kebab-case id guard for site ids and slugs (repo paths, pipeline calls). */
export function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/i.test(v);
}

/** grid-summaries/<site>/<slug>.md → editor fields. */
export function parseSummaryFileText(raw: string): { markdown: string; edited: boolean; sourceChanged: boolean; generatedAt: string | null } | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const fm = (parseYaml(m[1] ?? "") ?? {}) as Record<string, unknown>;
  return {
    markdown: (m[2] ?? "").trim(),
    edited: fm.edited === true,
    sourceChanged: fm.source_changed === true,
    generatedAt: fm.generated_at == null ? null : String(fm.generated_at),
  };
}
```
```ts
// grid-agent-url.ts — CLAUDE.md "Service Communication — URL Fallback".
const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

/** content-pipeline base URL with the local-dev DNS fallback. */
export function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) return LOCAL_FALLBACK;
  return CONTENT_AGENT_URL;
}
```
```ts
// app/api/grid/summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readFileContent } from "@/lib/github";
import { getAgentUrl } from "@/lib/grid-agent-url";
import { isSafeId, parseSummaryFileText } from "@/lib/grid-summary-file";

/** Read one summary file from network-repo main. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const site = req.nextUrl.searchParams.get("site");
  const slug = req.nextUrl.searchParams.get("slug");
  if (!isSafeId(site) || !isSafeId(slug)) return NextResponse.json({ error: "Invalid site or slug" }, { status: 400 });
  const raw = await readFileContent(`grid-summaries/${site}/${slug}.md`, "main");
  if (raw === null) return NextResponse.json({ exists: false });
  const parsed = parseSummaryFileText(raw);
  return parsed ? NextResponse.json({ exists: true, ...parsed }) : NextResponse.json({ exists: false });
}

/** Save a hand edit — the pipeline is the only writer of summary files (it hashes the current source). */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { site?: unknown; slug?: unknown; markdown?: unknown };
  if (!isSafeId(body.site) || !isSafeId(body.slug) || typeof body.markdown !== "string") {
    return NextResponse.json({ ok: false, error: "site, slug and markdown are required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${getAgentUrl()}/grid-summaries/save`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: body.site, slug: body.slug, markdown: body.markdown, editedBy: "dashboard" }),
      signal: AbortSignal.timeout(60_000),
    });
    const out = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return NextResponse.json({ ok: false, error: out.message ?? `save failed (${res.status})` }, { status: res.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
```
```ts
// app/api/grid/regenerate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getAgentUrl } from "@/lib/grid-agent-url";
import { isSafeId } from "@/lib/grid-summary-file";

/** Regenerate one AI summary now (overwrites hand edits — the UI confirms first). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { site?: unknown; slug?: unknown };
  if (!isSafeId(body.site) || !isSafeId(body.slug)) return NextResponse.json({ ok: false, error: "site and slug are required" }, { status: 400 });
  try {
    const res = await fetch(`${getAgentUrl()}/grid-summaries/regenerate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: body.site, slug: body.slug }), signal: AbortSignal.timeout(120_000),
    });
    const out = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return NextResponse.json({ ok: false, error: out.message ?? `regenerate failed (${res.status})` }, { status: res.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
}
```
```tsx
// SummaryEditor.tsx
"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { GridSummaryStatus } from "@/types/grid";

interface SummaryEditorProps { site: string; slug: string; title: string; status: GridSummaryStatus; onClose: () => void; onSaved: () => void }

/** Modal markdown editor for one AI summary. Changes go live after the next Grid sync (a few minutes). */
export function SummaryEditor({ site, slug, title, status, onClose, onSaved }: SummaryEditorProps): React.ReactElement {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async (): Promise<void> => {
      const res = await fetch(`/api/grid/summary?site=${encodeURIComponent(site)}&slug=${encodeURIComponent(slug)}`);
      const data = (await res.json().catch(() => ({}))) as { exists?: boolean; markdown?: string };
      setMarkdown(data.exists ? data.markdown ?? "" : "");
      setLoading(false);
    })();
  }, [site, slug]);

  async function call(url: string, init: RequestInit): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, init);
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !out.ok) throw new Error(out.error ?? `Request failed (${res.status})`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function regenerate(): void {
    if ((status === "edited" || status === "stale") && !window.confirm("This summary was edited by hand. Regenerating replaces the edit. Continue?")) return;
    void call("/api/grid/regenerate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site, slug }) });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={`Summary for ${title}`} className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-2xl space-y-3 rounded-lg bg-[var(--bg-elevated)] p-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {status === "stale" && <p className="text-xs text-amber-500">The source article changed after this summary was edited.</p>}
        {loading ? <p className="text-sm">Loading…</p> : (
          <textarea aria-label="Summary markdown" className="h-72 w-full rounded border p-2 font-mono text-sm" value={markdown} onChange={(e): void => setMarkdown(e.target.value)} />
        )}
        <p className="text-xs opacity-70">Markdown: one “## ” headline, then “### ” sections. Links and HTML are removed. Changes appear on the site after the next sync (a few minutes).</p>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="secondary" onClick={regenerate} disabled={busy}>Regenerate</Button>
          <Button onClick={(): void => void call("/api/grid/summary", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site, slug, markdown }) })} loading={busy} disabled={busy || loading || !markdown.trim()}>Save summary</Button>
        </div>
      </div>
    </div>
  );
}
```
If `Button` doesn't support `variant="secondary"`, use the variant name the dashboard uses for secondary buttons (grep `variant=` in `components/ui/Button.tsx`).
Run the tests. Expected: PASS.

- [ ] **Checkpoint:** tests + typecheck green. No commit.

### Task 26: Ad position option + in-app guide

**Files:**
- Modify: `services/dashboard/src/components/settings/AdsConfigForm.tsx`: `POSITION_OPTIONS` (~L114-130), add one entry
- Create: `services/dashboard/public/guide/24-grid-template.md`
- Modify: `services/dashboard/src/app/guide/page.tsx`: `GUIDE_PAGES`, add one entry

- [ ] **Step 1:** Add `{ value: "grid-feed", label: "Grid feed — in-grid tile (Grid template only)" }` after `category-top` in `POSITION_OPTIONS`. Run the existing `AdsConfigForm.test.tsx`; it must stay green unmodified.

- [ ] **Step 2: Guide page** (written for the content/ops team, not engineers)

````markdown
# Grid Template

The **Grid** template turns a site into a card-grid news feed (like dazzr.com). It shows stories from other **Live** sites in our network, chosen by **vertical**, instead of the site's own articles.

## Create a Grid site
1. Create the site as usual (wizard).
2. **Site Settings → Theme → Template → Grid**, then **Save Theme**.
3. A **Grid** tab appears. Add **topic pills** and choose the verticals that feed each one. Save.
4. Grid sites never get generated articles; the scheduler skips them.

## How stories are chosen
- A site feeds a pill when its vertical is in that pill's verticals. The homepage (“All”) shows every pill's sites.
- Only **Live** sites. Never the Grid site itself or another Grid site. Never the legacy-account sites (financenewsbase, muvizzcom).
- **Also include / Never include** override the vertical rule for single sites. Sites with no vertical (e.g. hiddenstorydaily) only appear through “Also include”.
- Each source contributes its newest **Articles per source site** (default 10). **Maximum age** can hide older stories.
- **Pinned** stories (Grid tab → Stories → Pin) always show first until their end date.

## Story pages
Clicking a card opens a story page on the Grid site with a **Read full story** button to the original article (new tab, with UTM tags unless turned off).
- **Excerpt** (default): the opening paragraphs of the source article, never more than half of it.
- **AI summary**: a ~200-word rewrite. Until a summary exists, the page shows the excerpt. Summaries are written hourly for sites that Grid sites actually use.
- **Edit** a summary in Grid → Stories → Edit. Hand edits are never overwritten automatically. If the source article later changes, the story shows **Stale** so you can decide.
- **Regenerate** replaces the summary now (asks first if it was edited).

## Look & feel
Theme tab (Grid mode): the same colour presets as Modern, the Grid colours, and **Card look**: style, corners, image ratio, image position, density, source-line position.

## Ads
- In-feed ads: add an ad placement with position **Grid feed** (Ads settings). **Ad every Nth tile** (Grid tab, default 3) sets the cadence; 0 turns in-feed ads off.
- Story pages use the normal article positions (above content, after paragraph N, sidebar, below content, sticky bottom).

## Timing
| Change | Appears on the Grid site |
|---|---|
| Grid settings / pins / theme | after the site re-syncs (≈1 min) |
| New article on a source site | after that site syncs, within ≈5 min |
| A site changes vertical or goes Live | within the hour |
| AI summary created / edited | after the next Grid sync (a few minutes) |
````
Add `{ slug: "24-grid-template", title: "Grid Template" },` to `GUIDE_PAGES` after the `23-topic-rotation` entry.

- [ ] **Checkpoint:** the dashboard suite is green; `/guide` lists "Grid Template" (check with `cloudgrid dev`). No commit.

---

## Phase G — Verification, approval gate, rollout

### Task 27: End-to-end run + modern parity

**Files:**
- Create: `docs/test-results/2026-09-27-grid-e2e.txt`
- Create: `docs/test-results/grid-parity/after/*`
- Create: `docs/test-results/screenshots/grid/e2e/*.png`

- [ ] **Step 1: Fresh seed + worker**

`packages/site-worker/scripts/dev/seed-grid-fixture.sh`, then `cd packages/site-worker && pnpm dev:worker`.

- [ ] **Step 2: Modern parity (the zero-impact proof)**

```bash
packages/site-worker/scripts/dev/capture-parity.sh docs/test-results/grid-parity/after
diff -r docs/test-results/grid-parity/baseline docs/test-results/grid-parity/after && echo "MODERN PARITY: IDENTICAL"
```
Expected: `MODERN PARITY: IDENTICAL`. If run on a different UTC day from the baseline, the only allowed difference is the must-reads block, because of the daily seed. Any other difference (markup, CSS file names or CSS content) is a **blocker**: find the cause before continuing.

- [ ] **Step 3: Grid checklist** (record PASS/FAIL per line in the e2e file; screenshots at 1440px and 390px)

1. `/` (All): header, pills, 6 cards, an ad tile after every 2 cards, no `review` article.
2. `/topic/travel` and `/topic/health`: only matching sources; the active pill is highlighted.
3. Scroll to the end: batches load automatically, then stop; there are no duplicate cards; the mock-ad-fill fills slots in every batch.
4. Story (excerpt mode):
   - "Original story by" + source line.
   - Link to `https://travel-a.example.com/…?utm_source=…&utm_medium=grid` with `target="_blank"`.
   - No `rel="canonical"` in the HTML.
   - The iframe article shows no iframe; internal links are absolutised.
5. Story (AI mode):
   - Set `story_mode: ai_summary` in `fixture-grid/site.yaml` and re-seed.
   - `best-beaches-in-portugal` shows the fixture summary ("Portugal's Coast, Ranked").
   - Another story falls back to the excerpt.
   - Revert the setting afterwards.
6. Related stories: 3 items in the desktop sidebar, and below the article on mobile.
7. `/search?q=beaches` shows results; `/about` renders in Grid chrome.
8. These all return 404: `/topic/nope`; `/story/fixture-travel-b/<review-slug>`; `/story/unknown/x`; `/best-beaches-in-portugal` on the Grid host; `/grid` on a modern host.
9. Keyboard: tab through pills; the burger opens and closes, and Escape returns focus; the focus ring is visible.
10. `prefers-reduced-motion` (DevTools emulation): cards appear without animation.
11. `/api/pool?_atl_site=fixture-grid&summaries=1`: the summary status for `best-beaches-in-portugal` is `generated`.
12. Pipeline smoke (Task 20 Step 6) result, or "skipped: no throwaway repo".

Note on Review Focus #4: local and workers.dev hosts are staging, so ad widget `code` is stripped and in-batch **script execution** can't be observed locally. That check is in the rollout runbook (step 7), on the Grid site's production host before it's announced.

- [ ] **Checkpoint:** e2e file complete, all PASS (or explained). No commit.

### Task 28: Full verification, self-review, hand-off (STOP), then commit

**Files:**
- Create: `docs/test-results/2026-09-27-<HHMM>-grid-template.txt`
- Modify: `CLAUDE.md` (Known Landmines + File Ownership rows)

- [ ] **Step 1: Everything, from clean**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
OUT=docs/test-results/2026-09-27-$(date +%H%M)-grid-template.txt
{ pnpm --filter @atomic-platform/shared-types build
  echo "## site-worker"; (cd packages/site-worker && pnpm typecheck && pnpm test && pnpm build)
  echo "## content-pipeline"; (cd services/content-pipeline && pnpm typecheck && pnpm test)
  echo "## dashboard"; (cd services/dashboard && pnpm typecheck && pnpm test && pnpm build); } 2>&1 | tee "$OUT"
```
Expected: all green. Append to the file a delta line per package against `2026-09-27-grid-baseline.txt`, e.g. `site-worker: before N, after M (+K)`. If the dashboard `pnpm build` needs env vars that aren't available locally, record the exact error and run `pnpm typecheck` + `next lint` instead.

- [ ] **Step 2: Forbidden-files guard**

```bash
git diff --name-only origin/main | grep -E 'packages/site-worker/src/pages/(index|search)\.astro|packages/site-worker/src/pages/\[slug\]|packages/site-worker/src/pages/category/|packages/site-worker/src/pages/api/(articles|search)\.ts|packages/site-worker/src/layouts/|packages/site-worker/src/themes/modern/|AdSlot\.astro|mock-ad-fill\.js|themePresets\.ts' && echo "BLOCKER: forbidden file modified" || echo "guard ok"
git diff origin/main -- packages/site-worker/src/middleware.ts packages/site-worker/scripts/seed-kv.ts | grep -c '^[+-][^+-]'   # expect a small number (≈6 and ≈2)
```
Expected: `guard ok`, and the two diffs contain only the planned lines.

- [ ] **Step 3: Self-review** (Atomic Labs dev standards, Phase 4)

Go through the Correctness / Type Safety / Code Quality / Performance / Security / Consistency checklist against the full diff. Specifically confirm:
- No `any`.
- Every exported function has an explicit return type and JSDoc.
- Every `set:html` input is either our own escaped renderer output, sanitised summary HTML, or existing ad-code handling.
- Every KV key built from user input uses `isSafeId` or a route param validated by a KV lookup.
- No secrets in code.
Record the checklist result in the test-results file.

- [ ] **Step 4: CLAUDE.md**

Add to **Known Landmines**:
```markdown
33. **Grid template switch is `theme.template: grid`, NOT `theme.base`** — `theme.base` holds colour-preset ids (`classic`, `custom`) written by the wizard. Grid sites are rewritten in middleware to `src/pages/grid/*` (separate routes → separate CSS bundles); never add Grid logic to the modern pages.
34. **Grid KV keys** — `network-directory` and `grid-summary:<site>:<slug>` are written ONLY by `scripts/seed-grid.ts` (network repo `sync-grid.yml`). Summary files `grid-summaries/<site>/<slug>.md` are written ONLY by the content-pipeline (`/grid-summaries/*`); the dashboard edits go through the pipeline so the source body hash stays correct.
```
Add to **File Ownership**: `| Grid summaries | Network repo, main, grid-summaries/<site>/<slug>.md (pipeline-written) |`.

- [ ] **Step 5: HAND-OFF: STOP and wait for Asaf**

Send Asaf:
- the test-results file path and the per-package test-count deltas;
- the parity result;
- the e2e checklist;
- the screenshot folders;
- the local testing instructions:
```text
cd packages/site-worker
./scripts/dev/seed-grid-fixture.sh && pnpm dev:worker
open "http://localhost:8788/?_atl_site=fixture-grid"          # Grid
open "http://localhost:8788/?_atl_site=fixture-travel-a"      # a modern site — must look exactly as before
# Dashboard: cloudgrid dev, then any site → Site Settings → Theme → Template
```
**Do not commit, push, deploy or plug** until Asaf explicitly approves after testing.

- [ ] **Step 6: After approval only: commit and branches**

```bash
git branch --show-current     # must be asaf-dev
git status --short            # stage ONLY the files this plan created/modified — never `git add -A`
git add <explicit file list>
git commit -m "feat(grid): Grid site template — network feed, story pages, AI summaries

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
Ask Asaf before `git push origin asaf-dev`. Then print `https://github.com/atomicfuse/atomic-content-platform/compare/main...asaf-dev`.
In the network worktree (`../atomic-labs-network-grid`): commit `sync-grid.yml` on `grid-sync-workflow`. Ask before pushing. Then print `https://github.com/atomicfuse/atomic-labs-network/compare/main...grid-sync-workflow`.
Remove the worktree only after its branch is pushed: `git worktree remove ../atomic-labs-network-grid`.

### Rollout runbook (each step needs Asaf's explicit go; none of it happens during implementation)

1. **Merge** the platform PR to `main`.
2. **Deploy staging:** `cd packages/site-worker && pnpm deploy:staging`. Spot-check 3 existing sites' staging previews: homepage, an article and a category page render as before.
3. **Merge** the network-repo `sync-grid.yml` PR. **Run it manually** with `all_summaries: true`. Verify with `wrangler kv key get network-directory --namespace-id=<prod> --remote` and the same for staging.
4. **Create the first Grid site** on staging with the dashboard: the Theme → Grid template, then the Grid tab → topics. Review it on its preview URL with `story_mode: excerpt`, then try `ai_summary`.
5. **`cloudgrid plug`** (Asaf's permission) for the dashboard + pipeline (adds the `grid-summaries` cron).
6. **Deploy production:** `pnpm deploy:production`. Spot-check 3 existing live sites (same checks as step 2).
7. **Before announcing the Grid site:**
   - Open it on its production domain and scroll through 3 infinite-scroll batches.
   - In DevTools, confirm each in-feed ad slot's widget script ran (Review Focus #4): a network request or DOM change per slot.
   - Confirm the story pages' "Read full story" links carry UTM tags.
8. **Take the Grid site Live** in the dashboard.

---

## Self-review notes (plan author)

- **Spec coverage:** every spec v3 section maps to a task:
  - Configuration → 1, 2
  - Theming → 9, 14, 22
  - Source resolution → 4
  - Feed building → 5, 6, 8
  - Story page text → 7, 12
  - Summary generation → 18–20
  - Sync workflow → 15, 16
  - Pages & routes → 3, 11–13
  - Scheduler → 17
  - Dashboard → 21–26
  - Error handling and edge cases → tests in 4–8, 12, 18–20
  - Test plan → per task + 27
  - Rollout → runbook
  - Out-of-scope items are not implemented.
- **Deliberate deviations from the writing-plans default:**
  1. No per-task commits (Asaf's local-test gate); one commit after approval.
  2. UI markup/CSS is concrete but gets its final visual polish under the design skills (Tasks 9, 14), with a design checkpoint in Task 11.
- **Type names are used consistently across tasks:** `GridPoolResponse`, `GridPoolItem.pills`, `ResolvedGridConfig.feed_ad_every`, `GridSummaryRecord.sourceChanged` ↔ frontmatter `source_changed`, `normalizeGridConfig`, `renderListing`, `loadGridPool`, `toGridPath`.
