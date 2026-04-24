# Migration Audit — Current Cloudflare Pages Architecture

**Date:** 2026-04-23
**Status:** Phase 1 complete — audit only, no proposals (see `migration-gap-analysis.md` and `migration-plan.md` for those).
**Scope:** Two deployed sites — `coolnews-atl` (Live, `coolnews.dev`) and `scienceworld` (Staging).
**Related audit log:** `docs/audit-logs/2026-04-23-1530-migration-astro-workers-audit.md`.

---

## 1. Repo topology

Two repos, both cloned side-by-side at `~/Documents/ATL-content-network/`:

| Repo | Role | Contents |
|------|------|----------|
| `atomic-content-platform` | **Code** — Turborepo + pnpm monorepo | `services/dashboard` (Next.js 15 control-plane UI), `services/content-pipeline` (Node HTTP content agent), `packages/site-builder` (Astro static generator — the thing that builds every public-facing site), `packages/shared-types`, `packages/migration` (WP placeholder). Deployed to CloudGrid. |
| `atomic-labs-network` | **Data** — pure YAML + markdown, zero code | `dashboard-index.yaml` (canonical site list), `org.yaml`, `network.yaml`, `groups/*.yaml`, `overrides/**/*.yaml`, `sites/<domain>/` (per-site config + articles), `.github/workflows/deploy.yml`. Deployed as per-site Cloudflare Pages projects (see §3). |

Source: platform `CLAUDE.md:9-16`.

---

## 2. Deployed Pages projects — the two sites in question

From `atomic-labs-network/dashboard-index.yaml:1-59`:

| Site | Status | Pages project | Branches | Custom domain | `zone_id` |
|------|--------|---------------|----------|---------------|-----------|
| `coolnews-atl` | Live | `coolnews-atl` | `main` (prod) + `staging/coolnews-atl` | `coolnews.dev` | `505b529c5928da452abb172f685d97a7` |
| `scienceworld` | Staging | `scienceworld` | `main` + `staging/scienceworld` | — | null (not yet on CF DNS) |
| `atom-dev1.com` | New | `null` | — | — | `fac9291e596911a5c427903b4a77cf4f` |

> `atom-dev1.com` is DNS-reserved only — no Pages project exists yet. Audit focuses on the two active projects.

### Cloudflare Pages project configuration
**There is no `wrangler.toml` / `wrangler.jsonc` in either repo.** Verified with `find ~/Documents/ATL-content-network -name "wrangler*" -not -path "*/node_modules/*" -not -path "*/.git/*"` → no output.

Pages project settings (build command, build output, branch rules, env vars) are therefore defined **in the Cloudflare dashboard**, not as code. CI only passes the project name (`--project-name`) and branch (`--branch`) to `wrangler pages deploy` — see §3.

**Implication for migration:** the Pages project configuration is not in Git; it must be inspected via `wrangler pages project list` / `wrangler pages project get` or via the Cloudflare dashboard before any cutover. This is tracked as an open question in the plan.

---

## 3. Current deployment flow

### 3.1 CI workflow

File: `atomic-labs-network/.github/workflows/deploy.yml`

**Triggers** (`deploy.yml:3-22`):
- `push` to `main` or any `staging/**` branch, filtered to paths: `sites/**`, `groups/**`, `monetization/**`, `overrides/**`, `org.yaml`, `network.yaml`.
- `pull_request` to `main` on the same paths.
- `workflow_dispatch` with optional `force_all: true` input.

**Job 1 — `detect`** (`deploy.yml:29-139`): reads the changed file list and emits a JSON array of site slugs that need rebuilding. Rules (exact logic from `deploy.yml:95-123`):

| Change | Rebuilds |
|--------|----------|
| `sites/<site>/**` | just that site |
| `overrides/<site>/**` | just that site |
| `org.yaml` | **all sites** |
| `network.yaml` | **all sites** |
| `groups/<g>.yaml` | every site listing `<g>` in `site.yaml` `groups:` (or legacy `group:` field) |
| `monetization/<p>.yaml` | every site whose `site.yaml` has `monetization: <p>`, with fallback to `org.yaml` `default_monetization:` |
| First commit / `force_all: true` | all sites |

**Job 2 — `deploy`** (`deploy.yml:141-224`): matrix-fans out over the emitted site list, one runner per site.

Per-site steps:
1. `actions/checkout@v4` with `fetch-depth: 0` (network repo).
2. **Staging-branch overlay** (`deploy.yml:161-171`): when `ref_name` starts with `staging/`, checkout `org.yaml`, `network.yaml`, `groups/`, `overrides/`, `monetization/`, `shared-pages/`, `ads-txt-assignments.json` from `origin/main` into the working tree. **Staging branches only carry `sites/<domain>/` content; everything else comes from main.**
3. Checkout `atomicfuse/atomic-content-platform` into `./platform/` using `secrets.PLATFORM_REPO_TOKEN`.
4. `pnpm install`.
5. `pnpm --filter @atomic-platform/shared-types build`.
6. **Build the site:** `pnpm build` inside `platform/packages/site-builder` with env `SITE_DOMAIN=<site>`, `NETWORK_DATA_PATH=$GITHUB_WORKSPACE`, `STAGING=true|false` (`deploy.yml:204-210`).
7. **Deploy:** `npx wrangler pages deploy dist --project-name="$PROJECT" --branch="$BRANCH"` where `$PROJECT = <site>` with dots→dashes and `$BRANCH = github.head_ref || github.ref_name` (`deploy.yml:212-224`).

**Secrets required:** `PLATFORM_REPO_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. `WRANGLER_SEND_METRICS: "false"`.

### 3.2 What "deploy a new version" looks like today
Every trigger produces a **full re-build + re-upload of the static site** to the matching Pages project. There is no incremental deploy; Pages serves the new deployment after the upload finishes. Old deployments stay reachable via their `<hash>.<project>.pages.dev` URLs for rollback.

---

## 4. The site builder — single shared Astro app

### 4.1 Key facts

| Property | Value | Source |
|----------|-------|--------|
| Package name | `@atomic-platform/site-builder` | `packages/site-builder/package.json:2` |
| Astro version | **`^5.7.0`** (not 6) | `package.json:21` |
| Cloudflare adapter | **None installed** | `package.json` dependencies list — no `@astrojs/cloudflare` |
| Astro `output` mode | **Default (static)** — not explicitly set | `astro.config.mjs:30-52` |
| Integrations | `@astrojs/sitemap`, `@tailwindcss/vite`, custom rehype plugins | `astro.config.mjs:47`, `:35`, `:50` |
| Search | `pagefind` — runs after `astro build` (`astro build && pagefind --site dist`) | `package.json:11` |
| Deployment target today | Cloudflare **Pages** (via `wrangler pages deploy`) | `deploy.yml:222` |

> Note: `CLAUDE.md:264` claims "Astro 6 (static output)". This is a documentation drift — actual pinned version is 5.7. The migration plan upgrades to Astro 6 explicitly (see `migration-plan.md` Phase 1.1).

### 4.2 Site identity comes from env vars, not hostname
`astro.config.mjs:11-18`:
```js
const SITE_DOMAIN = process.env.SITE_DOMAIN || 'coolnews.dev';
const DEFAULT_NETWORK_PATH = join(__dirname, '..', '..', '..', 'atomic-labs-network');
const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH || DEFAULT_NETWORK_PATH;
```

Each CI build passes `SITE_DOMAIN=<site>` (`deploy.yml:207`); Astro builds **one site** per run. There is no multi-tenant runtime; each Pages project ships its own frozen bundle.

### 4.3 Build pipeline — what happens before `astro build`

`packages/site-builder/package.json:7-9` wires `prebuild` and `predev` to `tsx scripts/build-site.ts`. The orchestrator (`scripts/build-site.ts:151-241`) runs these stages:

1. **Read `network.yaml`** — validate `platform_version` (`build-site.ts:160-168`).
2. **Resolve full config** via `scripts/resolve-config.ts` (37 KB) — walks `org.yaml → groups (left-to-right) → overrides/config (by priority) → sites/<domain>/site.yaml` and deep-merges into a single resolved config object (`build-site.ts:170-175`; inheritance spec in platform `CLAUDE.md:154-228`).
3. **Active check** — if `resolvedConfig.active === false`, writes a minimal `MAINTENANCE_HTML` page to `public/index.html` and exits (`build-site.ts:177-186`, `build-site.ts:43-62`).
4. **Generate `public/ads.txt`** — calls `generate-ads-txt.ts`, then appends the resolved ads-txt profile (network repo `shared-pages/ads-txt/` with fallback to bundled) (`build-site.ts:188-217`).
5. **Symlink `public/assets` → `<NETWORK_DATA_PATH>/sites/<site>/assets`** (`build-site.ts:101-138`). Site-specific assets live in the network repo.
6. **Inject shared legal pages** (`injectSharedPages`) — bundled templates first, then network-repo overrides on top, both consulting per-site overrides from `overrides/<site_id>/<page>.yaml` (`build-site.ts:223-233`).
7. Log summary; hand off to `astro build`.

After `astro build` finishes, `pagefind --site dist` crawls the output and writes a search index into `dist/`.

### 4.4 Page structure

`packages/site-builder/src/pages/`:

| Path | Purpose |
|------|---------|
| `index.astro` | Homepage — content collection `articles`, split into "What's New", "Must Reads" carousel, sidebar |
| `[slug]/index.astro` | Article detail page |
| `[slug]/full.astro` | Alternate full-width article layout |
| `category/[topic]/` | Category listing by topic |
| `search.astro` | Pagefind-backed search UI |
| `about.md`, `contact.md`, `privacy.md`, `terms.md`, `dmca.md` | Shared legal pages (may be overridden per site — see `build-site.ts:223-233`) |

Layouts (`src/layouts/`):
- `BaseLayout.astro` (HTML shell + fonts + theme vars + tracking + inline ad config)
- `ArticleLayout.astro`, `ArticlePreviewLayout.astro`, `PageLayout.astro`

Themes (`themes/`):
- Only `modern/` exists. No template router; `BaseLayout` imports `../../themes/modern/styles/theme.css` directly (`BaseLayout.astro:19`). Switching templates today requires code + rebuild.

### 4.5 Config inheritance (5-layer) — resolved at BUILD time

`org.yaml → groups → overrides/config → sites/<domain>/site.yaml`

Full spec: platform `CLAUDE.md:154-228`. The resolver (`scripts/resolve-config.ts`) produces a single `ResolvedConfig` object that every layout/page reads via `getConfig()` (`src/config.ts`, `BaseLayout.astro:18,27`).

**Every layer is a YAML file read from the filesystem at build time.** There is no KV, no API, no runtime config fetch.

---

## 5. Monetization + ads flow

### 5.1 Config side (build time)

Ad configuration is part of the resolved config object:
- `ads_config` — placements, interstitial, layout
- `ad_placeholder_heights` — fixed heights per slot (CLS prevention)
- `ads_txt` — accumulated across layers

Merge modes (`CLAUDE.md:196-206`):

| Field | Default mode | Available |
|-------|--------------|-----------|
| `tracking` | merge | merge, replace |
| `scripts` | merge_by_id | merge_by_id, replace |
| `scripts_vars` | merge | merge, replace |
| `ads_config` | replace | add, merge_placements, replace |
| `ads_txt` | add | add, replace |

### 5.2 HTML side (build time → runtime)

`BaseLayout.astro:38-40`:
```astro
const inlineConfigHtml = inlineAdConfig
  ? JSON.stringify(inlineAdConfig).replace(/</g, '\\u003c')
  : null;
```

`BaseLayout.astro:80-85` injects it:
```astro
{inlineConfigHtml && (
  <script is:inline set:html={`window.__ATL_CONFIG__=${inlineConfigHtml};`} />
)}
```

Page markup writes **inert anchors** per slot — no ad-specific SDK tags in the static HTML. Example from `src/pages/index.astro:55-56, 115, 125`:
```astro
<div data-slot="homepage-top" class="ad-anchor" style="display:none;"></div>
...
<div data-slot="homepage-mid" class="ad-anchor" style="display:none;"></div>
...
<div data-slot="sticky-bottom" class="ad-sticky-bottom" style="display:none;"></div>
```

### 5.3 Runtime — `public/ad-loader.js`

- Vanilla JS, 243 lines, **no build step**. Served statically from `packages/site-builder/public/ad-loader.js`.
- Loaded once per page via `BaseLayout.astro:144`: `<script is:inline async src={adLoaderUrl}></script>`.
- Reads `window.__ATL_CONFIG__` (injected at build time by `BaseLayout`), walks `ad-anchor` elements, and renders ad markup client-side.
- Supports dismissible sticky-bottom via `sessionStorage._atl_sticky_dismissed` (shipped 2026-04-20 — see `docs/sessions/2026-04-20-sticky-ad-close-button.md`).

### 5.4 Tracking (GA4 / GTM)

Inlined at build time via `<InlineTracking config={config} />` (`BaseLayout.astro:78`). Component at `src/components/InlineTracking.astro`. This means changing a GA4 ID or GTM container → rebuild.

### 5.5 How monetization config flows end-to-end today

```
Dashboard UI (Next.js) edits ads config
       │
       ▼
Dashboard commits org.yaml / groups/<g>.yaml / overrides/config/<o>.yaml to network repo `main`
       │
       ▼
GitHub Actions deploy.yml — detect which sites are affected
       │
       ▼
Matrix: build each affected site with `pnpm build` (runs resolve-config.ts → inlines new __ATL_CONFIG__ into every HTML shell)
       │
       ▼
`wrangler pages deploy dist --project-name=<site>` — full static re-upload per site
       │
       ▼
Cloudflare Pages activates new deployment (all pages get new inline config)
```

**Consequence:** moving one ad slot at org level → every article HTML on every site is rebuilt. This is the bottleneck the migration targets.

---

## 6. Content pipeline — where articles come from

### 6.1 Authoring + generation
- **Source format:** markdown with YAML frontmatter at `sites/<site>/articles/<slug>.md` in the network repo on the site's staging branch. Example: `atomic-labs-network/sites/coolnews-atl/articles/*.md` (~20 markdown files on `staging/coolnews-atl`).
- **Generator:** `services/content-pipeline` (Node HTTP, CloudGrid). Endpoints: `GET /health`, `POST /content-generate`, `GET /scheduled-publish` (`CLAUDE.md:107-110`).
- **AI SDKs:** `@cloudgrid-io/ai` in CloudGrid; `@anthropic-ai/sdk` local fallback when `ANTHROPIC_API_KEY` is set (`CLAUDE.md:58`, `CLAUDE.md:110`).
- **Writer invariant:** `writer.ts:shouldWriteLocal(cfg)` — writes to local FS iff `LOCAL_NETWORK_PATH` is set AND no branch is passed. If a branch is passed, Octokit commits via GitHub API (`CLAUDE.md:132-144`).

### 6.2 Publish path
- **Scheduler:** hourly CloudGrid cron `0 * * * *` EST → `GET http://content-pipeline-app/scheduled-publish` (`cloudgrid.yaml:24-28`).
- Gate: `atomic-labs-network/scheduler/config.yaml` `{ enabled, run_at_hours, timezone }` (defaults to `run_at_hours: [14]` EST if missing) — `CLAUDE.md:147-152`.
- Per-site cadence: `sites/<site>/site.yaml` → `brief.schedule.articles_per_day` + `brief.schedule.preferred_days`. Legacy `articles_per_week` supported as fallback.
- Scheduler enumerates active sites from `dashboard-index.yaml` (not by walking `sites/` on `main`, which is incomplete by design — `CLAUDE.md:92`).
- Generated articles are **committed to `staging/<domain>`** — pushing an article triggers `deploy.yml` path filter `sites/**` → that site rebuilds on its staging project.

### 6.3 Publish-to-prod
Not part of this audit — the migration is about **how sites are served**, not how content is authored. The publish-to-prod flow (staging → main merge) remains unchanged after migration; only the build+deploy target changes.

---

## 7. What exactly triggers a full rebuild today

Summary from §3.1 + §5:

| User action | CI consequence | Scope |
|-------------|----------------|-------|
| Write new article / edit article | Commit to `sites/<site>/articles/*.md` on staging branch | That site rebuilds |
| Edit a site's `site.yaml` (via dashboard) | Commit to `sites/<site>/site.yaml` | That site rebuilds |
| Add a per-site shared-page override | Commit to `overrides/<site>/*.yaml` on main | That site rebuilds |
| Edit an ad placement at **org** level | Commit to `org.yaml` on main | **ALL sites rebuild** |
| Edit an ad placement at **group** level | Commit to `groups/<g>.yaml` on main | Every site in group `<g>` rebuilds |
| Edit a **targeted override** (`overrides/config/<o>.yaml`) | Commit to that file | Every site its targeting matches rebuilds |
| Change GA4 / GTM / Facebook pixel (at any layer) | Commit to the affected YAML | All affected sites rebuild (inline tracking) |
| Switch theme for a site | Currently requires **code change** in `packages/site-builder/themes/` + commit on `main` + affected sites rebuild | Theme is not a per-site runtime choice |
| Network-wide kill-switch (`network.yaml`) | Commit to `network.yaml` | **ALL sites rebuild** |
| Touch `.build-trigger` in any site dir | Commit that touches | That site rebuilds (manual forcing mechanism) |

**The bottleneck pattern:** org-level or group-level monetization changes force N full-site rebuilds, where N grows linearly with the network. At 2 sites today, acceptable. At 10+ sites with 10K+ articles each, unacceptable.

### Build-time data we don't have yet
The user plan explicitly asks for baseline measurements ("How long does a current build take, and how many articles are there per site?"). Those numbers are **not in the codebase**; they are runtime-only. Listed as Open Question #1.

Concrete local counts I can provide:
- `coolnews-atl` articles in working tree (`staging/coolnews-atl`): ~20 markdown files in `sites/coolnews-atl/articles/`.
- `muvizz.com` articles: small handful visible.
- `scienceworld`: not on local working copy (lives on its staging branch).

---

## 8. Shared vs duplicated code between the two sites

**There is no duplication.** Both sites use the single shared Astro app at `packages/site-builder/` with identical code paths. The only per-site artefacts are:

1. The contents of `atomic-labs-network/sites/<domain>/` on the matching staging branch (site.yaml + articles + assets).
2. The Cloudflare Pages **project** assigned to each site (separate project = separate cache namespace, separate URL, separate deploy history).
3. DNS / zone config (out of repo).

Both sites share:
- Every layout, component, theme, script in `packages/site-builder/`.
- The same `org.yaml`, `groups/`, `overrides/`, `shared-pages/` on network `main`.
- The same dashboard (`services/dashboard`) and content pipeline (`services/content-pipeline`).
- The same ad-loader (`packages/site-builder/public/ad-loader.js`).

**Implication for migration:** consolidation into one Astro-Workers app is structurally trivial — the code is already unified. What changes is:
- The **target** of the build (Workers, not per-site Pages).
- The **timing** of config resolution (request-time via KV, not build-time via filesystem).
- The **granularity** of rebuilds (only code changes, not config/article changes).

---

## 9. CloudGrid services (untouched by migration)

The migration scope is site-serving, not the control plane. Dashboard and content-pipeline continue to run on CloudGrid as today.

| Service | Type | Local port | Prod URL (internal) |
|---------|------|------------|---------------------|
| `dashboard` | Next.js 15 App Router, `output: "standalone"` | 3001 | `https://atomic-content-platform.apps.cloudgrid.io` |
| `content-pipeline` | Node 20 raw HTTP, TS | 5000 | `http://content-pipeline-app` (internal DNS) |
| `scheduled-publisher` | cron `0 * * * *` EST | N/A | hits `http://content-pipeline-app/scheduled-publish` |

From `cloudgrid.yaml:1-29`. Both services reach the network repo via `GITHUB_TOKEN` + Octokit; neither talks to Cloudflare directly.

**Migration implication:** the dashboard still writes YAML to GitHub — the new CI pipeline in Phase 5 of the plan is what picks those commits up and syncs them to KV. No dashboard code changes required for the migration itself.

---

## 10. Summary — the shape of today's system

- **One shared Astro static-site package** is built once per affected site on every config/article change, then uploaded to a **separate Cloudflare Pages project per site**.
- **Configs and articles are filesystem YAML/markdown in a data-only repo**, resolved at build time.
- **Ad slots are build-time HTML anchors + a build-time `window.__ATL_CONFIG__` JSON blob** plus a runtime vanilla-JS loader.
- **Any org/group-level change triggers a fan-out rebuild** across all matched sites; any article change rebuilds its site.
- **No Cloudflare Workers, no KV, no adapter, no middleware, no Server Islands, no Astro 6** in the current stack.
- **No duplication between the two sites** — consolidation is not required, only re-targeting.

The next document (`migration-gap-analysis.md`) maps each target-architecture component to "exists / needs modification / doesn't exist yet".
