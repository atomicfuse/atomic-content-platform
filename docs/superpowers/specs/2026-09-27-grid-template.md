# Grid Template — Network News Feed Sites

**Status:** v3. v2 was approved on 2026-09-27; v3 folds in the corrections found while researching the codebase for the plan (see "Revision v3").
**Date:** 2026-09-27
**Reference site:** https://dazzr.com/topic/news

## Revision v3 (codebase research, 2026-09-27)

1. **`theme.template`, not `theme.base`.** `theme.base` already holds colour-preset ids: the wizard writes `classic`, `custom` and so on into it, and `/api/sites/save` overwrites it. The Grid switch is a new field, `theme.template: grid`. Absent, or anything else, means `modern`.
2. **Separate routes, not a theme switch inside existing pages.** Astro bundles the CSS of every component a page imports, so a switch inside `index.astro` would ship Grid CSS to every modern site, and modern CSS to Grid sites. Instead, the middleware rewrites Grid-site requests to `src/pages/grid/*` via `next('/grid' + path)`. Existing page files are untouched.
3. **Feed logic lives in the site-worker only.** The dashboard and pipeline don't consume `shared-types`, so there's no point putting it there. They get pool, source and pin data from the Grid site's own `GET /api/pool` JSON endpoint. `shared-types` gets types only.
4. **The network directory is built from prod KV `site-config:*`**, which already holds each site's resolved config, read through the Cloudflare REST API in `seed-grid.ts`. `seed-kv.ts`'s resolver isn't reusable without refactoring a production-critical script.
5. **Summary markdown is converted to HTML at sync time** in `seed-grid.ts` (with `marked`, as `seed-kv` does for articles). The worker has no markdown library.
6. **`seed-kv` emits `grid` and `theme.card` only when `theme.template === 'grid'`,** so non-Grid site configs stay byte-identical.
7. **Dashboard levels.** Grid settings are editable in the UI at site and group level. The resolver still supports org and override layers via YAML.
8. **The template is chosen per site.** The dashboard writes `theme.template` to the site's own `site.yaml`, and the scheduler skip reads it from there. `readSiteBrief` already parses that file, so no extra GitHub reads are needed. The seed resolver would honour a group- or org-level template, but the UI doesn't offer one, because the scheduler wouldn't see it.

## Goal

Add a second site template, **Grid**: a card-grid news feed whose stories come from the other Live sites in our own network. Each story opens a story page on the Grid site, showing either an **excerpt** of the source article or an **AI summary** (a per-site setting), which links on to the full article on the source site.

## Decisions

| Topic | Decision |
|---|---|
| Content | Network articles only. No external sources, no Grid-site-own articles. |
| Click flow | Card → story page on the Grid site → "Read full story" (new tab, with UTM) → article on the source site (the dazzr model). |
| Story page text | Setting `grid.story_mode`: `excerpt` (opening paragraphs of the source article) or `ai_summary`. Both built in this project. |
| Editing | AI summaries can be edited and regenerated from the dashboard. Hand-edited summaries are never overwritten automatically. |
| Summary storage | Git (network repo, own `grid-summaries/` folder), synced to KV by a new, separate workflow. |
| Card meta line | `[source favicon] source site · 5d`. |
| Topic pills | Configurable; each pill maps to one or more verticals; sites in those verticals feed it. |
| Homepage | "All": every pill's sources in one feed. |
| Feed size | Rolling window: newest `per_site_limit` per source site, optional `max_age_days`, plus pinned stories. |
| Feed loading | Infinite scroll (auto, no button). |
| Ads | Existing ad system. In-feed cadence configurable through the normal inheritance chain. |
| Canonical tag | None on story pages. |
| Sensitive Topics | No special treatment. |
| Name | `grid` (dashboard label "Grid"). |
| Theming | Same colour / font / logo system and the 20 existing presets as `modern`, plus Grid-only colour keys and six card-look options (`theme.card`). |

## Non-negotiable: zero impact on existing sites

All Live sites run `modern` in production. This project must not change their output, their data, or their sync.

- **Article files are never touched.** Summaries live in a separate top-level folder.
- **`sync-kv.yml` is not modified.** Grid data is synced by a new workflow, `sync-grid.yml`, which writes only new KV keys (`network-directory`, `grid-summary:*`). The existing workflow doesn't watch `grid-summaries/`, so summary commits never re-sync a source site.
- **No re-seed of existing sites.** New config fields are optional, have runtime `??=` defaults, and are read only when `theme.template === 'grid'`.
- **`modern` render path unchanged.** Grid sites are rewritten to separate `/grid/*` routes in middleware; existing page files, layouts and CSS bundles are not modified. The existing test suite passes unmodified, and a before/after HTML parity check of modern pages is part of verification.
- **No new Cloudflare credentials.** The pipeline only commits to Git (as today). KV writes happen in GitHub Actions with the secrets `sync-kv.yml` already uses.
- **No `dashboard-index.yaml` data changes.** Verticals are read as they are.

## Architecture

```
content-pipeline (hourly cron, ai_summary mode only)
  reads: network-directory + Grid site configs + source articles (KV, read-only as today)
  writes: grid-summaries/<siteId>/<slug>.md ──commit──► network repo main
                                                             │
dashboard: edit / regenerate summary ──commit──────────────►│
dashboard: pin / grid settings ──(existing config save)──► site.yaml ──► existing sync-kv ──► site-config:<gridSite>
                                                             │
                                  sync-grid.yml (new) ◄──────┘  on push: grid-summaries/**, dashboard-index.yaml,
                                    │                            sites/*/site.yaml, groups/**, org.yaml; hourly; manual
                                    ├──► KV: network-directory             (prod + staging)
                                    └──► KV: grid-summary:<siteId>:<slug>  (prod + staging)

site-worker, request to a Grid site:
  network-directory + grid config ─► resolve sources ─► article-index:<src> for each ─► merge/limit/pin
                                     (Cache API, 5 min) ─► listing
  story page: article:<src>:<slug> + grid-summary:<src>:<slug> (ai mode) ─► excerpt or summary
```

## Configuration

### Theme
`theme.template: grid` (new optional field; absent → `modern`). It inherits like any theme field. `theme.base` keeps its current meaning (the preset id) and is not read by Grid.

### `grid` section (`GridConfig` type in `packages/shared-types`)

```yaml
grid:
  topics:                         # pills, in display order
    - label: Travel
      slug: travel                # optional; derived from label → /topic/travel
      verticals: [Travel]
    - label: Health
      verticals: [Healthy Living, Medical Health]
  include_sites: [somesite]       # extra sources regardless of vertical ("All" feed)
  exclude_sites: [muvizzcom]      # never a source
  per_site_limit: 10              # newest N published articles per source site
  max_age_days: 30                # optional; null = no age limit
  story_mode: excerpt             # excerpt | ai_summary
  excerpt_paragraphs: 3           # excerpt mode (and ai_summary fallback)
  feed_ad_every: 3                # every Nth tile is an ad; 0 = none
  page_size: 20                   # cards per page / per scroll batch
  show_intro: false               # description line under the card headline
  outbound_utm: true              # append utm_source=<grid host>&utm_medium=grid
  pinned:
    - site: scienceworld
      slug: best-telescopes-2026
      until: 2026-10-31           # optional, inclusive
```

**Merge semantics** (seed time, `resolve.ts`):
- Scalars: deep merge, later layer wins.
- Arrays (`topics`, `include_sites`, `exclude_sites`, `pinned`): replacement, last non-empty wins.

**Defaults** (seed time and runtime `??=`): `topics: []`, `include_sites: []`, `exclude_sites: []`, `per_site_limit: 10`, `max_age_days: null`, `story_mode: excerpt`, `excerpt_paragraphs: 3`, `feed_ad_every: 3`, `page_size: 20`, `show_intro: false`, `outbound_utm: true`, `pinned: []`.

**Validation:**
- `per_site_limit` 1–100; `page_size` 6–60; `excerpt_paragraphs` 1–10.
- `feed_ad_every` is 0 or ≥ 2.
- Topic slugs must be unique.
- Warn if there are no topics and no `include_sites`.

`feed_ad_every` is in `grid`, not `ads_config`, on purpose. Changing cadence must never require an `ads_config` override, because an override carrying `ad_placements: []` wipes inherited placements (Known Landmine 31).

## Theming

Grid uses the **same theming system as `modern`**: `theme.colors`, `theme.fonts`, logo, footer logo, logo sizes and favicon, with the same org → group → override → site inheritance and the same dashboard preset picker.

### Colours
- **General keys map onto Grid elements**, so all 20 existing presets in `themePresets.ts` (including the dark ones) work on Grid unchanged:

| Key | Grid element |
|---|---|
| `background` | page background |
| `surface` | card background, search bar, mobile drawer |
| `border` | card border, pill border |
| `text` / `muted` | body text / card meta line, relative age |
| `heading` | card headline, story H1, summary headings |
| `accent` | active pill, "Read full story" button, hover states |
| `link` / `link_hover` | links in story text |
| `nav_link` / `nav_link_hover` | inactive pill text / hover |
| `prose_heading` / `prose_body` | story text headings / paragraphs |
| `footer_bg` / `footer_text` / `footer_link` / `footer_link_hover` | footer |

- **Grid-only optional keys:** `card_bg`, `card_border`, `pill_border`, `pill_active_bg`, `pill_active_text` and `search_bg`. Each falls back to its general key when unset.
- **Grid-only keys are *not* added to `ColorState` in `themePresets.ts`.** Adding keys there would change preset detection (strict equality) for every existing site. Presets never set them; they're edited only in the Grid colour section.
- `modern`-only keys (`must_reads_bg`, `hero_title`, `feed_desc`, etc.) are ignored by Grid.

### Card look: `theme.card` (read only by Grid)

```yaml
theme:
  card:
    style: bordered          # bordered | shadow | flat
    corners: rounded         # square | small | rounded
    image_ratio: "4:3"       # "4:3" | "16:9" | "1:1"
    image_position: top      # top | left (compact thumbnail list)
    density: comfortable     # comfortable | compact (smaller min card width, more per row)
    source_position: below   # below (meta line under image) | badge (on the image)
```

- **Merge:** deep merge per key (same as the rest of `theme`).
- **Defaults** (seed time + runtime `??=`, dazzr-like): `bordered`, `rounded`, `4:3`, `top`, `comfortable`, `below`.
- **Implementation:** each option is a class / CSS variable on the grid container (`data-card-style="shadow"`, etc.) in `themes/grid/styles/theme.css`. There are no separate component variants.

### Dashboard
- **Theme tab:** the same preset picker.
- **Manual colour editor:** for a Grid site it shows only the keys in the table above plus the Grid-only keys.
- **Card look:** six dropdowns, with a small live card preview.

## Source resolution

Implemented once as pure functions in `packages/site-worker/src/lib/grid/`. The dashboard and pipeline consume the results through the Grid site's `GET /api/pool` endpoint.

A site is a source if **all** of these hold:
1. It's in `network-directory`, status `Live`, not deleted.
2. Its vertical is in a pill's `verticals`, **or** it's in `include_sites`.
3. It isn't in `exclude_sites`.
4. It isn't the Grid site itself or any other Grid site.
5. It isn't on the legacy Dev1 Cloudflare account (financenewsbase, muvizzcom). Their data is in a separate KV the Grid worker can't read. They're shown as "unavailable" in the dashboard sources preview.

**Pill feed:** sources whose vertical is in the pill. **"All":** every source, including `include_sites`. Sites with an empty vertical (e.g. hiddenstorydaily) join only via `include_sites`.

## Feed building

For each source:
1. Read `article-index:<siteId>` and keep `status === 'published'` only (even in preview; outbound links go to production).
2. Apply `max_age_days`.
3. Take the newest `per_site_limit`.

Then:
- Merge and sort newest first.
- Valid pinned items (not expired, source still a source, article still published) go first in config order and are deduped.
- Paginate by `page_size`. Every `feed_ad_every`-th tile is an ad slot, and the count runs continuously across pages.

The merged pool per `(gridSiteId, topic)` is cached in the Workers Cache API for 5 minutes, keyed on a hash of the resolved `grid` config.

Every published article is eligible **immediately**. A feed never waits for a summary (see fallback below).

## Story page text

### Excerpt mode
Built at request time from the source's `article:<siteId>:<slug>` body (already HTML in KV):
- **Block-level truncation.** Take top-level blocks in order until `excerpt_paragraphs` `<p>` blocks are included. Headings in between are kept. A list or table is taken whole or not at all, so nothing is ever cut mid-block.
- **Cap:** never more than 50% of the article's paragraphs, so the Grid page never reproduces most of an article.
- **Strip** `<script>`, `<iframe>`, `<img>`, `<figure>`, embed and ad markers. The hero image is shown separately.
- Followed by the "Read full story" button.

### AI summary mode
- The story page reads `grid-summary:<siteId>:<slug>` and renders its markdown (raw HTML stripped).
- **Fallback:** if no summary exists yet (a new article, or generation failed), the page renders the **excerpt** instead. Once the summary syncs, the page switches to it automatically.

### Summary file (network repo `main`)
`grid-summaries/<sourceSiteId>/<slug>.md`

```markdown
---
source_site: scienceworld
slug: best-telescopes-2026
body_hash: 9f2c…            # sha256 of the source article body when generated
generated_at: 2026-09-27T10:00:00Z
model: <model id>
edited: false               # true once a person saves an edit
edited_by: null
edited_at: null
---
## Headline-style H2
Intro paragraph…
### Section
Paragraph…
```

Format: one H2 and 3–4 H3 sections with a paragraph each, about 200 words. The prompt says: rewrite, don't copy; no new facts; no links; no HTML.

## Summary generation (content-pipeline)

New agent `grid-summaries`, exposed as `POST /grid-summaries/run` and run by a new hourly CloudGrid cron.

1. **Find Grid sites in `ai_summary` mode.** Read the sites from `dashboard-index.yaml` and their resolved config from KV: prod for Live, staging for Staging, so a Grid site can be previewed before it goes live.
2. **Work out what's needed.** For each such Grid site, resolve its sources (the shared function) and take each source's newest `per_site_limit` published articles, plus its valid pins. The result is the de-duplicated set of `(sourceSite, slug)` that any AI-mode Grid site can show. **Nothing is generated for sites no AI-mode Grid site uses.**
3. **For each needed article:**
   - Read the body from prod KV and compute its hash.
   - Read the existing summary file (if any) from Git.
   - **Missing:** generate.
   - **Hash differs and `edited: false`:** regenerate.
   - **Hash differs and `edited: true`:** don't touch. The dashboard shows it as stale.
   - **Hash same:** skip.
4. **Commit** once per source site per run (one commit with all that site's new or updated files) to `main` via the existing GitHub writer, with the branch passed explicitly (Writer Invariant).
5. A per-run cap (default 300 generations) spreads out any large first run. Cost is recorded through `src/costs/recorder.ts`.

`POST /grid-summaries/regenerate { site, slug }` is used by the dashboard. It generates now, overwrites the file, and resets `edited: false`.

Summary files for articles that are later unpublished are left in place. The worker never shows them, because story pages require a published article. Pruning is out of scope.

## Sync workflow (network repo, new `sync-grid.yml`)

- **Triggers:**
  - Push to `main` touching `grid-summaries/**`, `dashboard-index.yaml`, `sites/*/site.yaml`, `groups/**`, `org.yaml` or `overrides/config/**`.
  - Hourly schedule (backstop).
  - Manual dispatch.
- **Setup:** checks out the platform repo the same way `sync-kv.yml` does and runs a new script, `packages/site-worker/scripts/seed-grid.ts`.
- **`network-directory`:**
  - Read `dashboard-index.yaml`.
  - For every non-deleted site, read its resolved `site-config:<siteId>` from prod KV (Cloudflare REST API) to get `site_name`, `theme.favicon` and `theme.template`. A missing prod config (a Staging site) gives `name = siteId`, no favicon, `isGrid` false. Staging sites are never sources anyway.
  - Write one key to **prod and staging** KV:

```ts
interface NetworkDirectory {
  generatedAt: string;
  sites: Array<{
    siteId: string;          // domain folder name
    hostname: string;        // production hostname (custom_domain / canonical)
    name: string;
    favicon: string | null;
    vertical: string;        // "" if unset
    status: string;
    isGrid: boolean;
    account: 'assets' | 'dev1';
  }>;
}
```
- **Summaries:** write `grid-summary:<siteId>:<slug>` for the summary files changed in the push (all of them on manual dispatch), to prod and staging KV.
- **Concurrency:** a single concurrency group. Every run rebuilds from the latest `main`, so a queued run replacing a pending one loses nothing (unlike the per-site situation described in `sync-kv.yml`).
- Uses the existing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `KV_NAMESPACE_ID_*` secrets.

## Pages & routes (site-worker)

| Route | Content |
|---|---|
| `/` | Header, "All" feed |
| `/topic/<slug>` | Pill feed; 404 for unknown slug |
| `/story/<sourceSiteId>/<slug>` | Story page. 404 if the site isn't a current source or the article isn't published. |
| `/api/feed?topic=&page=` | HTML fragment (cards + ad slots) for infinite scroll |
| `/api/pool` | JSON: resolved sources (with exclusion reasons), the full pool, active and inactive pins. Used by the dashboard Stories tab and the pipeline. `private, no-store`. |
| `/search?q=` | Title search over the "All" pool |
| Shared pages | Existing mechanism |

An article that has dropped out of the feed **keeps its story page** while it's still published and its site is still a source.

### Listing layout (dazzr-style)
- **Header:**
  - Logo + burger (mobile).
  - Full-width search bar.
  - Outlined topic pills; the active one in the accent colour.
  - Mobile: a slide-out "Topics" drawer.
- **Grid:** `repeat(auto-fill, minmax(280px, 1fr))`, 12px gap, max ~1630px.
- **Card:**
  - Rounded, bordered card with a 12:9 image.
  - Meta line: favicon · source site name · relative age.
  - Bold headline, clamped to 3 lines.
  - Optional intro.
  - Staggered fade-in-up animation (respects `prefers-reduced-motion`).
- **Ad tile:** the card footprint, existing `AdSlot` markup, new position `grid-feed`, max-height 300px.
- **Infinite scroll:**
  - An `IntersectionObserver` sentinel fetches `/api/feed`.
  - Stops when the pool is exhausted.
  - Ad-slot `<script>` tags in fetched HTML are re-created so they execute.
- **Footer:** © line + shared-page links.
- **Colours and fonts** come from `theme.colors` / `theme.fonts`, with Grid defaults for any keys that aren't set.

### Story page layout
- **Main column:**
  - `above-content` ad.
  - Pill label, then the H1.
  - "Original story by [favicon] <source> · <date>".
  - Hero image.
  - Excerpt or summary (`after-paragraph-N` ads supported).
  - **"Read full story"** → `https://<source hostname>/<slug>`, `target="_blank" rel="noopener"`, with UTM when `outbound_utm`.
  - `below-content` ad.
- **Sidebar (desktop):** `sidebar` ad, then "Related stories": the 3 newest from the same pill, excluding the current one.
- **Below the article:** related stories repeated for mobile; `sticky-bottom` supported.
- **Head:** `<title>` = `<article title> | <Grid site name>`; meta description = source description; no canonical.

**Images:** source images (`/<sourceSiteId>/assets/...`) are served by the existing host-agnostic asset route. No rewriting needed.

### Ad positions
- **New:** `grid-feed`.
- **Reused on story pages** (`pageType: 'article'`): `above-content`, `after-paragraph-N`, `sidebar`, `below-content`, `sticky-bottom`.
- **Reused on listings:** `homepage-top`, `sticky-bottom`.

## Content-pipeline scheduler

`scheduled-publisher` skips any site whose `site.yaml` has `theme.template: grid`, so Grid sites never get generated articles.

## Dashboard

- **Theme picker** (org / group / override / site): Grid enabled.
- **"Grid" section in `UnifiedConfigForm`** (shown when the effective theme is Grid):
  - Topics editor: label, optional slug, vertical multi-select from `/api/verticals`, reorder.
  - Include / exclude site pickers.
  - `story_mode`, `excerpt_paragraphs`, `per_site_limit`, `max_age_days`, `feed_ad_every`, `page_size`, `show_intro`, `outbound_utm`.
  - Normalisers in `config-normalizers.ts`.
  - Saves use the existing paths (Git + Mongo dual-write); a Grid config change reaches KV through the existing `sync-kv` for the Grid site only.
- **Sources preview:** per pill, the sites feeding it, with warnings for sites with no vertical, non-Live, Dev1-unavailable, and Grid sites (excluded).
- **"Stories" tab on a Grid site:**
  - Lists the current feed (filterable by pill). It's fetched server-side from the Grid site's own `/api/pool` (production hostname when Live, staging preview URL otherwise), so it shows exactly what the site serves.
  - Per row: source, title, age, pinned state, and in AI mode the summary status (`excerpt fallback` / `generated` / `edited` / `stale: source changed after edit`).
  - Actions:
    - **Pin / unpin** (with optional expiry), which writes `grid.pinned` through the normal config save.
    - **View** the story text.
    - **AI mode only:** **Edit** (a markdown editor; commits the summary file with `edited: true`, `edited_by`, `edited_at`) and **Regenerate** (calls the pipeline's regenerate endpoint; asks for confirmation if the summary is `edited`).
  - Summary files are read from Git via `github.ts`. Summaries aren't part of the Mongo read layer.
- **Ad placement editor:** `grid-feed` added to the position list.
- **Guide page:** `public/guide/<nn>-grid-template.md`, registered in `GUIDE_PAGES`.

## Components (files)

**shared-types**
- `src/config.ts`: add `'grid'` to the theme `base` unions; add `GridConfig`, `ResolvedGridConfig` and `grid` on the layers + `ResolvedConfig`; add optional `card` (`GridCardConfig`) to `ThemeConfig` / `ResolvedThemeConfig`; loosen the stale `SiteBrief.vertical` union to `string` (type-only).
- Types only: `NetworkDirectory`, `GridSummaryRecord`, `GridPoolResponse`.

**site-worker**
- `src/middleware.ts`: one branch after `locals.site` is set: if `config.theme.template === 'grid'` and `toGridPath(pathname)` is non-null, then `next(gridPath)`.
- `src/lib/config.ts` (runtime defaults); `src/lib/kv-schema.ts` (new keys).
- `src/lib/grid/load.ts` (KV + Cache API); `src/lib/grid/excerpt.ts` (block truncation + strip).
- `src/themes/grid/components/*` + `styles/theme.css` (colour mapping with Grid-only fallbacks; `theme.card` option classes).
- Pages (all new, under `src/pages/grid/`): `index.astro`, `topic/[slug].astro`, `story/[sourceSiteId]/[slug].astro`, `search.astro`, `[slug].astro` (shared pages), `api/feed.ts`, `api/pool.ts`. Search is server-rendered in `search.astro` (no extra API). Existing page files are untouched.
- `scripts/lib/resolve-grid.ts` (new), a small hook in `scripts/seed-kv.ts` (grid-only), `scripts/lib/validate-config.ts` (grid rules); `scripts/seed-grid.ts` + `scripts/lib/grid-directory.ts` (new).

**content-pipeline**
- `src/agents/grid-summaries/{index,needed,generate,prompt,commit}.ts` (new).
- `src/index.ts`: `/grid-summaries/run` and `/grid-summaries/regenerate`.
- `src/agents/scheduled-publisher/index.ts`: skip Grid sites.

**dashboard**
- `UnifiedConfigForm.tsx` Grid section.
- `src/components/config/grid/*` (TopicsEditor, SitePicker, SourcesPreview).
- `src/components/site-detail/GridStoriesTab.tsx` (+ SummaryEditor).
- API routes for summary read / save / regenerate (the regenerate proxy uses the `getAgentUrl()` fallback pattern).
- Theme picker option, ad-position list, `config-normalizers.ts`, guide page.
- `src/components/site-detail/SiteThemeTab.tsx`: Grid mode shows the Grid colour set + Grid-only keys, and a new `GridCardLookFields` (six dropdowns + preview). `themePresets.ts` `ColorState` is unchanged.

**deploy / network repo**
- `cloudgrid.yaml`: `grid-summaries` hourly cron.
- Network repo `.github/workflows/sync-grid.yml` (new). `sync-kv.yml` untouched.

## Error handling

| Failure | Behaviour |
|---|---|
| `network-directory` missing | Grid pages render the header + empty state (HTTP 200, short cache); error logged. |
| A source's `article-index` missing | Source skipped, logged; the rest render. |
| Story for an unknown, unpublished or non-source article | 404. |
| AI mode, no summary | Excerpt fallback. |
| AI generation fails for one article | Logged; retried next run; other articles and sites continue; the page keeps showing the excerpt. |
| Git commit fails for a site | Logged; that site's batch retried next run. |
| `sync-grid` write fails | Job fails and is visible in Actions; the next trigger or hourly run rebuilds. Existing keys are never touched. |
| Summary contains HTML or links | Stripped before commit and again at render. |
| Excerpt source has fewer paragraphs than configured | Use what's available, still capped at 50%. Articles with a single paragraph show it. |
| Pinned article expired or unpublished | Dropped from the feed; shown as "inactive" in the Stories tab. |
| Person regenerates an edited summary | Dashboard confirmation required; the edit is overwritten and `edited` is reset. |

## Edge cases

- The same slug on two sources is kept distinct by the `/story/<sourceSiteId>/<slug>` URL.
- A source changes vertical, goes non-Live or is deleted: this is reflected once `sync-grid` runs (on the `dashboard-index.yaml` push, or hourly).
- A Grid site listed in `include_sites` is still excluded (rule 4).
- A Grid site switches from `excerpt` to `ai_summary`: pages show excerpts until the first summaries sync, then switch automatically.
- Two AI-mode Grid sites share a source article: one summary file, shared by both.
- A Staging Grid site previews with staging KV, published articles only, the same as production.
- Source article edited: excerpt mode reflects it immediately. AI mode regenerates it next run, unless the summary was hand-edited (then flagged as stale).

## Test plan

**site-worker grid logic (vitest; shared-types has no test runner)**
- `grid/sources.test.ts`:
  - Vertical match, multi-vertical pill, include / exclude.
  - Excluding self, other Grid sites, non-Live, deleted and Dev1 sites.
  - Empty vertical.
- `grid/feed.test.ts`: published-only, `max_age_days`, `per_site_limit`, sort, pinned first / dedupe / expiry / dropped-when-unpublished.
- `grid/interleave.test.ts`: cadence 3, cadence 0, continuity across pages, short last page.

**site-worker (vitest)**
- `grid/excerpt.test.ts`: N paragraphs, headings kept, lists never split, 50% cap, stripping scripts / iframes / images, single-paragraph article.
- `theme.test.ts`: `grid` → grid; `modern` / undefined / unknown → modern (regression guard).
- `config.test.ts`: runtime defaults on a KV config with no `grid` field and no `theme.card` (the shape existing sites have today).
- Theming: Grid-only colour keys fall back to their general keys; every `theme.card` option emits the expected attribute; E2E screenshots of 3 presets (a light, a dark, a warm) × 2 card configurations.
- `resolve.test.ts` / `validate-config.test.ts`: grid inheritance and validation bounds.
- `seed-grid.test.ts`: directory built from a fixture index + configs; changed-files-only summary writes.
- The existing suite passes unmodified.
- E2E (`pnpm dev:worker` + fixture KV): `/`, `/topic/x`, story in excerpt mode, story in AI mode with and without a summary, search, `/api/feed` pages 1–3, `/api/pool`, 404s. Screenshots at desktop and mobile widths.

**content-pipeline (vitest)**
- `grid-summaries/needed.test.ts`: only AI-mode Grid sites' sources; `per_site_limit` + pins; de-duplication across Grid sites.
- `grid-summaries/index.test.ts`:
  - The missing / changed / edited / unchanged matrix.
  - Per-run cap.
  - One AI failure doesn't stop the run.
  - One commit per site.
  - Cost recorded.
- `scheduled-publisher`: Grid sites skipped.

**dashboard**
- RTL tests: TopicsEditor, SourcesPreview warnings, GridStoriesTab actions (pin, edit, regenerate-with-confirm), Grid colour set shown in Grid mode only, card-look fields; normaliser unit tests.
- Existing `themePresets.test.ts` passes unmodified (proves preset detection is unaffected).
- Screenshots of the Grid section (site and group mode) and the Stories tab.

Output is saved to `docs/test-results/` per our dev standards.

## Rollout (each step independently safe)

1. Merge the code. Deploy the site-worker to **staging** and verify existing sites' previews are unchanged.
2. Add `sync-grid.yml` to the network repo; run it manually and verify `network-directory` in staging and prod KV. No existing keys change.
3. Create the first Grid site on staging (new site, `theme.template: grid`, `story_mode: excerpt`), configure pills, review. Then try `ai_summary` and watch the first summaries arrive.
4. Deploy the pipeline (`cloudgrid plug`, with permission) with the `grid-summaries` cron.
5. Deploy the site-worker to **production**. Existing sites are unchanged; no re-seed.
6. Take the Grid site Live.

## Out of scope (v1)

- External (non-network) sources; Grid-site-own articles.
- "Mix sources" interleaving.
- A dedicated wizard flow. v1: create a site normally, then set the theme to Grid.
- Pruning summary files for unpublished articles.
- Sitemap entries for story pages.
- Outbound click analytics beyond UTM + the existing tracking config.
- Grid sources from the Dev1 account.
- The `editorial` / `bold` / `classic` placeholders.
- Grid layout variants (featured large card, masonry, listing sidebar). Theming covers colours, fonts and card look only.
- Grid-specific colour presets (existing presets are reused).
- Real-time freshness. New articles appear after the source site's KV sync, and AI summaries after the next hourly run.

## Estimate

About 9–11.5 hours of agent implementation time (including ~1–1.5 h for theming), or 5–7 hours wall-clock with parallel sub-agents (worker, pipeline and dashboard run in parallel after the shared types and the `/api/pool` contract land). The pace to Live is set by approval gates (spec, plan, Asaf's local testing), design feedback rounds, and rollout steps (staging deploy, first `sync-grid` run, first hourly summary run, `cloudgrid plug` with permission, production deploy).
