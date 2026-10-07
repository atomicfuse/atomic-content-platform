# Grid: Content Aggregator bundles as story sources — design

**Status:** design approved in session 2026-10-07 (Asaf). Project **A** of three (A: bundle sources, B: story-page ads, C: endless next-story scroll — separate specs).
**Builds on:** `docs/superpowers/specs/2026-09-27-grid-template.md` (v1 explicitly scoped out external sources).

## Goal
Let a Grid site mix stories from Content Aggregator **bundles** with stories from network sites, with an on-site story page for each external story (What It Covers or a short AI summary) — without changing anything for network stories or existing Grid sites.

## Decisions (from the brainstorm)
| # | Decision |
|---|----------|
| D1 | Bundles attach **inside topic pills** (`topics[].bundles`), next to verticals. A bundle not in any pill is not shown. |
| D2 | Two story-text settings: **Network stories** (existing `story_mode`: excerpt / ai_summary) and **Aggregator stories** (new `external_story_mode`: what_it_covers / ai_summary, default what_it_covers). |
| D3 | **Per-story override**: "Use AI summary" pins a summary so that story always shows it, regardless of the site's mode. "Back to default" unpins. |
| D4 | Images: use the publisher's image URL; **skip items with no image**; placeholder only when an image fails to load in the browser. |
| D5 | **Blocked categories** list per Grid site (aggregator category names, tier-1 or sub; a story is hidden when ANY of its categories is blocked). *Revised 2026-10-07 after testing: replaces the original "blocked sources" — Asaf found category blocking more useful.* |
| D6 | When a bundle item was already rewritten by one of our network sites, show **only the network version**. |
| D7 | Aggregator `expires_at` is a relevance hint, **not** a takedown: stories we picked up are kept; visibility is governed by recency, `per_bundle_limit` and `max_age_days`; story pages never expire. |
| D8 | Data path: **hourly sync into KV** via the existing `seed-grid.ts` / `sync-grid.yml` (sole writer of Grid KV keys, CLAUDE.md #34). No live aggregator calls from the Worker. |
| D9 | Only items with `content_type: article`, an image, and language EN. |

## Architecture

```
Content Aggregator ──(hourly, sync-grid.yml → seed-grid.ts)──► KV
   GET /api/content?bundle_id=…            grid-ext-index:<bundleId>   (feed)
                                           grid-ext-item:<itemId>      (story page, permanent)
                                           grid-summary:aggregator:<itemId>  (AI summary, from git)
network repo grid-summaries/aggregator/<itemId>.md ◄── content-pipeline grid-summaries agent
Grid Worker (pool, /grid/story/aggregator/…) ──reads──► KV
Dashboard (Grid settings, Stories tab) ──► site config (git + Mongo) ; pipeline endpoints for summaries
```

## Data model

### Grid config (`packages/shared-types/src/grid.ts`)
- `GridTopic.bundles?: string[]` → resolved `bundles: string[]` (default `[]`).
- `external_story_mode?: "what_it_covers" | "ai_summary"` (default `"what_it_covers"`).
- `blocked_categories?: string[]` (default `[]`) — aggregator category names, case-insensitive; see D5.
- `per_bundle_limit?: number` (default `20`).
- Every new field follows the KV schema-evolution rule: runtime default (`??=` in the worker's normalizer), seed-time default (`resolve.ts` / `GRID_DEFAULTS`), re-seed of Grid sites before relying on it.

### KV records (written only by `seed-grid.ts`)
- `grid-ext-item:<itemId>` — `ExternalStoryRecord`: `id, slug, title, description, imageUrl, url (publisher), sourceName, author, publishedAt, categories[], tags[], whatItCovers, whyItMatters, syncedAt`. Permanent (no TTL). `slug` = kebab title, ≤ 80 chars.
- `grid-ext-index:<bundleId>` — `{ bundleId, name, updatedAt, items: ExternalIndexEntry[] }`, newest first, capped at **300**. Entry: `id, slug, title, description, imageUrl, sourceName, publishedAt`.
- `grid-summary:aggregator:<itemId>` — existing `GridSummaryRecord` shape plus optional `pinned: boolean` (default `false`).

### Summary files (network repo, written only by the pipeline)
- `grid-summaries/aggregator/<itemId>.md`, same frontmatter as today plus `pinned`.

## Components

### 1. Sync — `packages/site-worker/scripts/seed-grid.ts` (+ `scripts/lib/grid-bundles.ts`)
1. Collect bundle ids from every Grid site's resolved config (`topics[].bundles`), already read for the directory.
2. Collect `source_item_id` from network article frontmatter (repo checkout) → `rewritten` set (D6).
3. Per bundle: `GET {CONTENT_API_BASE_URL}/api/content?bundle_id=…&status=active&enriched=true&page_size=100` (up to 3 pages).
4. Filter: article, has thumbnail URL, language EN, not in `rewritten` (D4, D6, D9).
5. Parse `summary`: "What It Covers" (also accepts "What It Appears To Cover") and "Why It Matters Now" sections only.
6. Merge with the existing index (by id, newest first, cap 300) — never drop items because the aggregator stopped returning them (D7). Write new/changed item records.
7. Aggregator/network failure for a bundle → leave that bundle's KV untouched, log, continue.
- `sync-grid.yml` gains `CONTENT_API_BASE_URL`; schedule stays hourly (`15 * * * *`).

### 2. Worker — `packages/site-worker/src/lib/grid/*`, `src/pages/grid/story/aggregator/[slug].astro`
- `normalize.ts`: defaults for the four new fields.
- `sources.ts`: pills resolve verticals (unchanged) **and** bundles → `bundleSources: { bundleId, pills[] }`.
- `load.ts`: read `grid-ext-index:<id>` for each bundle source (KV reads stay well under the per-invocation limit); cache key includes each index's `updatedAt`.
- `feed.ts` (`buildPool`): bundle items become pool items with `kind: "external"`, `sourceName`, `itemId`; apply `blocked_categories`, `per_bundle_limit`, `max_age_days`; dedupe by item id across bundles (pills unioned); merge with network items newest-first; pins accept `{ site: "aggregator", slug }`.
- `GridPoolItem` gains `kind?: "network" | "external"` and `sourceName?: string` (network items unchanged).
- `render.ts`: external cards show the publisher name + letter badge; `<img>` gets a placeholder fallback on error.
- Story page `/grid/story/aggregator/<title-slug>-<itemId>`: reads `grid-ext-item`; missing → 404; slug mismatch → 301 to canonical slug. Text per D2/D3 (`storyText` extended): pinned summary, else mode, else What It Covers, else description. "Read full story" → publisher URL (+UTM when `outbound_utm`). Same layout, ad slots and related stories as network story pages. Indexable like network story pages.
- `/api/pool` returns external items (with `kind`, `sourceName`) and summary status for the Stories tab.
- Reserved source id `aggregator` (no network site may use it).

### 3. Pipeline — `services/content-pipeline/src/agents/grid-summaries/*`
- Targeting per story: network item → site `story_mode === "ai_summary"`; external item → `external_story_mode === "ai_summary"`.
- External input: `whatItCovers` + `whyItMatters` from `grid-ext-item` (never Content Opportunity / Key Angles); `bodyHash` over that text.
- External prompt: ~120–150 words, fresh headline + 2 short `###` sections, facts only from the input; validator range adjusted for this shape.
- `pinned` frontmatter: set by "Use AI summary" (on-demand generate endpoint, `pin: true`), cleared by "Back to default" (new unpin endpoint). Edit flow unchanged and keeps `pinned` as-is.
- Run cap (150) unchanged.

### 4. Dashboard — `services/dashboard`
- `TopicsEditor`: per-pill **Bundles** multi-select (from `/api/bundles`: name + item count). Pill validity: label + (≥1 vertical or ≥1 bundle) — also `isGridFeedReady` in the wizard.
- `GridSettingsForm`: "Story mode" → **Network stories**; new **Aggregator stories**, **Per-bundle limit**, **Blocked sources** (multi-select from aggregator `/api/sources` names).
- Stories tab (`StoriesTable`): external rows with "External · <source>" badge; actions **Use AI summary** / **Back to default** alongside edit and pin.
- Config save keeps the dual-write pattern (git → Mongo → revalidate); normalizers in `config-normalizers.ts`; seed-time defaults.
- Guide: `public/guide/` Grid page section "Aggregator bundles".

## Error handling
| Situation | Behaviour |
|---|---|
| Aggregator unreachable / non-2xx during sync | Bundle KV untouched; logged; next hourly run retries |
| Bundle deleted in aggregator | Index kept; sync warns; dashboard shows the bundle as missing |
| `grid-ext-item` missing | 404 |
| Image fails in browser | Placeholder tile |
| AI summary generation fails | Page shows What It Covers; next run retries |
| KV read error in the Worker | Source skipped, feed still renders (existing `safeGet` behaviour) |

## Edge cases
- Same item in two bundles → one pool item, pills unioned.
- Item whose "What It Covers" section is missing → description used; if both missing, the item is skipped at sync.
- Title change in the aggregator → record updated; old slug 301s to the new one.
- `per_bundle_limit` applies per bundle, not per pill.
- A Grid site with no bundles → identical behaviour and output to today (regression-tested).

## Test plan
- Sync: filter rules (D4/D6/D9), summary section parsing, merge/never-delete/cap, failure leaves KV untouched.
- Worker: defaults; mixed pool ordering, limits, blocked sources, dedupe, pins; external story route (200 / 404 / 301), text selection matrix (mode × pinned × availability); **no-bundle Grid site renders byte-identical feed HTML** to before.
- Pipeline: targeting matrix, external prompt validation, pin/unpin.
- Dashboard (RTL): pill bundle picker, two story modes, blocked sources, Stories tab badge + actions, normalizers.
- End-to-end on staging: test Grid site with the Scoopella bundle.
- Test results saved under `docs/test-results/`.

## Rollout
1. Worker with defaults → staging → verify existing Grid sites unchanged → production.
2. Sync (`seed-grid.ts` + `sync-grid.yml` on the network repo **main** — needs explicit approval before pushing).
3. Pipeline + dashboard via merge + `cloudgrid plug`.
4. Re-seed Grid sites.

## Out of scope (this spec)
Story-page ad slot changes (project B), endless next-story scroll (project C), copying images to R2, image generation for imageless items, live (request-time) aggregator calls, a global blocklist, per-site model or persona for summaries.
