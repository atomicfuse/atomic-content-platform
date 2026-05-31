# CLAUDE.md

Orientation for Claude Code sessions. Read this before touching code.

## Overview

Atomic Content Network Platform — a multi-tenant content network for managing ad-monetized sites at scale. Turborepo/pnpm monorepo with two CloudGrid services plus a multi-tenant Astro Worker (`site-worker`) that serves all sites from KV + R2. Production traffic flows through `atl-sites-workers-manager` — a thin routing Worker that owns all Custom Domains and delegates to `atomic-site-worker`, `green-dream-b06f`, and `atl-streamed-lander` via Service Bindings. The legacy per-site `site-builder` package was retired in Phase 8 of the Pages → Workers migration (2026-04-26).

## Two-Repo Architecture

| Repo | Contents |
|------|----------|
| **atomic-content-platform** (this repo) | All code: dashboard, content-pipeline, site-worker, shared-types, migration. Deployed to CloudGrid (services) + Cloudflare Workers (site-worker). |
| **atomic-labs-network** (network data) | Pure data: `dashboard-index.yaml`, `sites/<domain>/` configs + articles, `overrides/`, `scheduler/config.yaml`. Zero code. `sync-kv.yml` syncs commits to CONFIG_KV + R2 for the live Worker. |

**Both repos live at `~/Documents/ATL-content-network/`** on the dev machine.

## Layout — Platform Repo

```
services/
  dashboard/                 Next.js 15 App Router UI (the main control surface)
    src/app/
      groups/                Group management (config, site membership, overrides)
      sites/                 Site management, detail pages, wizard
      shared-pages/          Shared page editor + per-site overrides (list redirects to /overrides/shared-pages)
      review/                Article review queue
      trash/                 Deleted sites
      scheduler/             Redirects to /settings/scheduler
      domains/               Redirects to /settings/domains
      email/                 Redirects to /settings/email
      settings/              Settings (Org, Network, Domains, General Scheduler, Email tabs)
      overrides/             Overrides + Shared Pages (tabbed layout)
      wizard/                New-site flow
      import/                WordPress import — CSV bulk site creation + article migration
      guide/                 In-app markdown docs (loads /public/guide/*.md)
      api/                   Server routes (shared-pages, sites, groups, agent proxy, scheduler, ads-txt, n8n image callback proxy, …)
    src/lib/
      github.ts              readFileContent, commitNetworkFiles, updateSiteInIndex, dashboard-index helpers
      scheduler.ts           readSchedulerConfig / writeSchedulerConfig / triggerSchedulerRun
      shared-pages.ts        Shared-page + override primitives
      config-normalizers.ts  Shared normalizers (tracking, scripts, ads) used by group page + SiteConfigTab
    src/components/site-detail/
      SiteConfigTab.tsx      Unified config form for sites (fetches inheritance chain, shows source badges)
      ContentAgentTab.tsx    Site Identity tab container with sub-tabs (Identity, Content Brief, Groups, Config)
      ArticleScriptsPanel.tsx  Per-article script injection CRUD panel
      ArticleVideosPanel.tsx   Per-article YouTube video embed CRUD panel
    src/actions/             Server actions (wizard, agent, sites)
    public/guide/            Markdown guide content (must be in public/ so standalone bundle ships it)

  content-pipeline/          Node/TypeScript service (content-generation + scheduler agents)
    src/agents/
      content-generation/    agent.ts orchestration + HTTP handler
      content-quality/       Claude-based scoring
      article-regeneration/  Low-score rewrite flow
      scheduled-publisher/   Cron-triggered batch publisher (gated by scheduler/config.yaml)
      migration/             WordPress migration: CSV site creation (SSE), article import, category resolver, theme builder
    src/lib/
      github.ts              Octokit wrappers: readFile, listFiles, commitFile, commitBatch
      writer.ts              shouldWriteLocal(cfg) — local FS iff LOCAL_NETWORK_PATH set AND no branch
      site-brief.ts          listActiveSites (via dashboard-index.yaml), readSiteBriefWithFallback
      ai.ts                  @cloudgrid-io/ai → @anthropic-ai/sdk fallback
      config.ts              loadConfig() — env-driven AgentConfig
    src/index.ts             HTTP server: /health, /content-generate, /scheduled-publish

packages/
  shared-types/              TS interfaces: SiteConfig, SiteBrief, PublishSchedule, DashboardIndex, Article (incl. ArticleVideo), Ads, Tracking
  site-worker/               Astro 6 + @astrojs/cloudflare SSR app. `atomic-site-worker` serves all platform sites — config in KV, per-site assets in R2. Multi-tenancy via hostname → KV lookup in middleware.ts. Receives production traffic via Service Binding from `atl-sites-workers-manager` (no Custom Domains of its own). See docs/migration-plan.md for the full Pages → Workers history.
  migration/                 WordPress migration tooling (placeholder)

cloudgrid.yaml               Service + cron definitions
```

## Layout — Network Repo

```
dashboard-index.yaml         Authoritative site list — sites[].domain, status, staging_branch, pages_project, zone_id
sites/<domain>/              Per-site — ONLY exists on main after publish-to-prod; otherwise on staging/<domain> branch
  site.yaml                  Full config: domain, group, brief (vertical, topics, schedule, article_types, …)
  articles/<slug>.md         Markdown articles with YAML frontmatter (quality_score, status, …)
  theme/ assets/ …           Per-site assets
  # (legacy `.build-trigger` removed in Phase 8 — Cloudflare Pages no longer in the path)
overrides/
  <site_id>/<name>.yaml      Shared-page per-site overrides (content only)
  config/<id>.yaml           Config overrides — targeted exceptions with merge modes (see below)
scheduler/config.yaml        Global scheduler gate: { enabled, run_at_hours, timezone }
network.yaml                 Platform manifest (network_id, platform_version, network_name)
org.yaml                     Org-wide defaults: tracking, scripts, ads_config, ads_txt, theme, legal, CLS heights
groups/<group>.yaml          Group-level config overrides (same fields as org, all optional/partial)
```

### Branch conventions in the network repo

- `main` — authoritative for `dashboard-index.yaml`, `scheduler/config.yaml`, `overrides/`, and published sites.
- `staging/<domain>` — where `sites/<domain>/` lives while in development or staging. The dashboard's "Worker Preview" button serves any `staging/*` branch via `?_atl_site=<domain>` against the staging Worker — no per-site Pages deploy needed.
- **Do not enumerate `sites/` on main** — it only contains published sites. Use `dashboard-index.yaml` as the source of truth.

## Services

### dashboard

- Next.js 15 App Router, `output: "standalone"`.
- **Local port:** `3001` (per `cloudgrid dev`). Direct `pnpm dev` default is 3000 but the project uses 3001.
- Standalone output only bundles traced imports — anything read at runtime must live under `public/`. That's why guide markdown is in `services/dashboard/public/guide/` (not `docs/`).
- Env: `GITHUB_TOKEN`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_*`, `CONTENT_AGENT_URL`.
- Auth: NextAuth with Google. `NETWORK_REPO_OWNER`/`NETWORK_REPO_NAME` pinned in `src/lib/constants.ts`.

### content-pipeline

- Plain Node HTTP server, TypeScript.
- **Local port:** `5000` (per `cloudgrid dev` and dashboard's `.env.local`). Default inside `config.ts` is 3001 — the dashboard's `CONTENT_AGENT_URL` wins.
- Endpoints: `GET /health`, `POST /content-generate`, `GET /scheduled-publish` (accepts `?force=true`).
- Env: `GITHUB_TOKEN`, `NETWORK_REPO`, `LOCAL_NETWORK_PATH` (dev only), `GEMINI_API_KEY`, `CONTENT_AGGREGATOR_URL`.
- In CloudGrid it uses `@cloudgrid-io/ai` (zero config). Locally it uses `@anthropic-ai/sdk` via `ANTHROPIC_API_KEY`.

## Service Communication — the URL fallback pattern

Inside CloudGrid, the dashboard reaches the pipeline at `http://content-pipeline-app`. That hostname **does not resolve on the host under `cloudgrid dev`**, so every dashboard call site needs the same fallback:

```ts
const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}
```

Used by `src/app/api/agent/generate/route.ts` and `src/lib/scheduler.ts`. **Every new dashboard → pipeline call must use this pattern** or it will fail under `cloudgrid dev`.

## Writer Invariant

`content-pipeline/src/lib/writer.ts` decides between local FS and GitHub:

```ts
function shouldWriteLocal(config): boolean {
  return !!config.localNetworkPath && !config.branch;
}
```

- If `LOCAL_NETWORK_PATH` is set AND no branch is passed → writes to local disk (useful for manual dev testing).
- If branch is passed → always commits via GitHub API to that branch.

**Any agent that wants committed output must pass a branch.** Scheduler passes `staging/<domain>`. Dashboard's on-demand generate passes whichever branch the UI is on.

## Scheduler (summary — full spec in `public/guide/09-scheduler.md`)

- CloudGrid cron fires hourly (`0 * * * *`, EST) and hits `/scheduled-publish`. Most ticks are ~50ms no-ops.
- Global gate: `scheduler/config.yaml` on network main — `{ enabled, run_at_hours: [0–23], timezone }`. Missing file → defaults (`enabled: true, run_at_hours: [14], timezone: EST`).
- Per-site cadence: `brief.schedule.articles_per_day` + `brief.schedule.preferred_days`. Legacy `articles_per_week` read as `ceil(perWeek / preferred_days.length)` fallback; new saves always write `articles_per_day`.
- Dashboard `/scheduler` page writes the global config; **Run Now** calls `/scheduled-publish?force=true` (bypasses Layer 1 only, per-site `preferred_days` still applies).
- Sites listed from `dashboard-index.yaml`; brief read from `staging/<domain>` with fallback to main.

## Config Inheritance — 5-Layer Resolution

Config is resolved at seed-time by `packages/site-worker/scripts/seed-kv.ts` (which writes the merged result into KV). Same 5-layer chain that `site-builder` used pre-migration; the layer logic moved into `packages/site-worker/scripts/lib/resolve.ts`. The full chain:

```
org.yaml → groups[0].yaml → groups[1].yaml → … → overrides/config (by priority) → site.yaml
```

### Layer 1: `org.yaml` — Org-Wide Defaults

Root of the inheritance chain. Contains: `organization`, `legal_entity`, `support_email_pattern`, `default_theme`, `default_fonts`, `default_groups`, `tracking` (GA4/GTM/Google Ads/Facebook Pixel), `scripts` (head/body_start/body_end injection), `scripts_vars` (placeholder substitution), `ads_config` (placements, interstitial, layout), `ad_placeholder_heights` (CLS prevention), `ads_txt`, `legal`, feature flags (`preview_page`, `categories`, `sidebar`, `search`).

**Dashboard:** Settings → Org tab → `GET/PUT /api/settings/org` → reads/writes `org.yaml` on `main`.

### Layer 2: `groups/<id>.yaml` — Group-Level Config

Same fields as org but all optional/partial. Groups cluster sites sharing config. A site can belong to **multiple groups** (`groups: [id1, id2, ...]` in `site.yaml`), merged left-to-right.

**Dashboard:** `/groups/[groupId]` → three tabs: General (name/ID), Config (`UnifiedConfigForm` in `mode="group"`), Sites (add/remove members). API: `GET/PUT/DELETE /api/groups/[groupId]`. Group membership writes update `site.yaml` on the staging branch.

### Layer 3: `overrides/config/<id>.yaml` — Targeted Config Exceptions

Named exception sets that target specific groups and/or individual sites. Applied **after** groups but **before** the site layer. Sorted by `priority` (lowest first, highest wins).

```yaml
override_id: my-override
name: "My Override"
priority: 10
targets:
  groups: [group-a]       # all sites in these groups
  sites: [domain.com]     # specific sites (UNION with groups, not intersection)
tracking:
  _mode: merge            # per-field merge mode
  ga4: "G-NEWID"
ads_config:
  _mode: replace
  ad_placements: [...]
ads_txt:
  _mode: add
  _values: ["newpartner.com, DIRECT"]
```

**Per-field merge modes** (`_mode` key inside each field):

| Field | Default | Available |
|-------|---------|-----------|
| `tracking` | `merge` | `merge`, `replace` |
| `scripts` | `merge_by_id` | `merge_by_id`, `replace` |
| `scripts_vars` | `merge` | `merge`, `replace` |
| `ads_config` | `replace` | `add`, `merge_placements`, `replace` |
| `ads_txt` | `add` | `add`, `replace` |
| `theme` | `merge` | `merge`, `replace` |
| `legal` | `merge` | `merge`, `replace` |

**Dashboard:** `/overrides` page lists all `overrides/config/*.yaml`. Detail page `/overrides/[id]` has three tabs: General (ID, name, priority), Targeting (group/site selectors), Config (`UnifiedConfigForm` in `mode="override"` — shows `MergeModeSelector` dropdowns). API: `GET/PUT/DELETE /api/overrides/[id]`.

### Layer 3b: Conditional Overrides (query-param-activated)

Overrides with an `activation` field are **not** merged at seed-time. Instead they're stored separately in KV (`cond-overrides:<siteId>`) and applied at request-time by middleware only when the matching query param is present in the URL.

```yaml
# overrides/config/test-sticky.yaml
override_id: test-sticky
activation:
  query_param: stickytest
  query_value: "true"       # optional — omit to match any value
targets:
  sites: [travelswire]
ads_config:
  ad_placements: [...]
```

- `seed-kv.ts` calls `selectConditionalOverrides()` → writes to `cond-overrides:<siteId>` in KV
- Middleware reads `cond-overrides:*` only when URL has query params (zero overhead otherwise)
- Responses with conditional overrides get `cache-control: private, no-store`
- Activation params propagate across navigation via inline script (same pattern as `_atl_site`)

### Template Variables in Widget Code

Ad placement `code` fields support `${paramName}` placeholders resolved from URL query params at request-time. Works on **all requests** (not just conditional overrides) — UTM params flow into widget code automatically.

```
Widget code:  <script src="https://ad.com/w?c=${utm_campaign}">
URL:          travelswire.com/article?utm_campaign=summer
Rendered:     <script src="https://ad.com/w?c=summer">
```

- Values sanitised to `[a-zA-Z0-9_-.:` — no HTML injection risk
- Unresolved `${vars}` (no matching URL param) become empty strings
- Template params propagate across navigation automatically

### Layer 4: `sites/<domain>/site.yaml` — Per-Site Config

The leaf. Site-level values always win. Contains `domain`, `groups`, `active`, `brief` (editorial — never merged), plus optional `tracking`, `scripts_vars`, `ads_config`, `ads_txt`, `theme`, `legal`, feature flags.

**Dashboard:** `/sites/[domain]` → Config sub-tab → `SiteConfigTab` fetches `GET /api/sites/site-config?domain=<domain>` which returns `{ config, inheritance: { org, groups[] } }`. Saves via `POST /api/sites/save` to the staging branch.

### Key merge rules at build time

- **Tracking, theme, legal:** deep merge across layers, later wins per-key.
- **Scripts:** merge-by-id (same `id` replaces, new `id` appends).
- **Ads config:** deep merge for top-level fields; `ad_placements` is **replacement** — last layer with non-empty placements wins.
- **Ads.txt:** additive append from all layers, deduped.
- **Script vars:** shallow merge, then `{{placeholder}}` tokens resolved in all scripts; unresolved tokens throw.
- **CLS heights (`ad_placeholder_heights`):** set at org/group level only, not site-level.

### `UnifiedConfigForm` — shared config UI

Rendered in four modes via `mode` prop: `"org"`, `"group"`, `"override"`, `"site"`. Override mode shows `MergeModeSelector` dropdowns. CLS heights section only shows in org/group modes. `SourceBadge` renders inline badges: org (cyan), group (violet), override (amber), site (emerald).

### Also: `network.yaml` — Platform Manifest

Not a config-inheritance layer. Carries metadata: `network_id`, `platform_version`, `network_name`. Dashboard: Settings → Network tab → `GET/PUT /api/settings/network`.

## Shared Pages Overrides

- Shared pages (about, contact, privacy, tos…) live in the network repo.
- Sites can override content per-site via `overrides/<site_id>/<name>.yaml` (written from dashboard `/shared-pages`).
- Per-site overrides are on `main` of the network repo; `seed-kv.ts` resolves overrides at sync time and writes the merged shared-page bodies into KV.
- **These are content overrides, not config overrides** — distinct from `overrides/config/` above.

## Site Detail Page — Unified Tab Architecture

The site detail page (`/sites/[domain]`) has 3 top-level tabs:

1. **Site Settings** (default tab) — 5 sub-tabs:
   - **Identity** — site name, tagline, audience, tone, Custom Domain panel
   - **Content Brief** — topics, schedule (`articles_per_day`, `preferred_days`), content guidelines, inline Generate Articles section, quality threshold + criteria sliders. Niche Targeting section shows category/subcategories (violet pills with remove buttons) and "Create Bundle" button for sites without one. Subcategory filter has "Select all filtered" button.
   - **Groups** — assign/remove groups, view active overrides with source badges, links to group pages
   - **Overrides** — overrides that apply to this site
   - **Config** — `SiteConfigTab` renders `UnifiedConfigForm` (same component used on Org/Group pages); shows inheritance badges ("From org", "From group: X")
2. **Deployments** — deploy status, staging URL, build trigger
3. **Content** — article list, status filters

Each sub-tab has its own independent Save button. The Config sub-tab fetches from `/api/sites/site-config` which returns the full inheritance chain (`{ config, inheritance: { org, groups[] } }`).

### Article Detail Page (`/sites/[domain]/articles/[slug]`)

Server component that reads article markdown from Git (staging branch → main fallback), parses frontmatter, and renders three panels:

1. **Videos panel** (`ArticleVideosPanel`) — CRUD for YouTube video embeds. Stores `videos: ArticleVideo[]` in frontmatter via `PUT /api/articles/[domain]/[slug]/videos`. Each video has `id`, `url` (YouTube), and `position` (`before-content`, `after-content`, or `after-paragraph-N`).
2. **Scripts panel** (`ArticleScriptsPanel`) — CRUD for per-article script injection. Same position model as videos plus `head`. Saved via `PUT /api/articles/[domain]/[slug]/scripts`.
3. **Article editor** (`ArticleEditor`) — raw markdown editor with save, image upload, and AI image generation.

### Video Embeds — End-to-End

Videos are stored as `ArticleVideo[]` in article frontmatter and rendered at request time by the site-worker:

- **Content pipeline:** When `ContentItem.content_type === "video"`, auto-adds a video entry (`position: after-paragraph-1`) with the source URL to frontmatter.
- **Dashboard:** `ArticleVideosPanel` manages videos manually (add/edit/delete with position picker). API: `PUT /api/articles/[domain]/[slug]/videos`.
- **seed-kv:** Extracts `videos` from frontmatter into `ArticleIndexEntry` in KV.
- **Site worker:** `inject-videos.ts` renders responsive 16:9 YouTube iframes (via `youtube-nocookie.com`) with "Video via YouTube" credit link. Called in the `[slug]/index.astro` rendering pipeline: inline ads → **video embeds** → scripts.
- **Shared types:** `ArticleVideo { id, url, position }` and `ArticleVideoPosition` in `packages/shared-types/src/article.ts`.

### Config inheritance model

See **Config Inheritance — 5-Layer Resolution** above for the full chain (`org → groups → overrides/config → site`). The Config sub-tab shows `SourceBadge` indicating where each value comes from. Normalizer functions in `src/lib/config-normalizers.ts` are shared between org, group, override, and site config pages.

## Tech Stack

- **Monorepo:** Turborepo + pnpm. Package names: `@atomic-platform/<name>`.
- **Dashboard:** Next.js 15 (App Router), React 19, next-themes, NextAuth.
- **Site worker:** Astro 6.1 + `@astrojs/cloudflare` 13.2 (`output: 'server'`), deployed to Cloudflare Workers on the **Assets @ AtomicLabs** account (`4a8cfd85d617b38ce1813a552132bc86`). One deployment serves all sites; per-site config + content lives in CONFIG_KV, per-site assets in the `atl-assets-prod` R2 bucket. The legacy Dev1 account (`953511f6356ff606d84ac89bba3eff50`) still hosts `coolnews.dev` during the migration transition — see **Cloudflare Account Migration** section below.
- **Content pipeline:** Node 20, raw `http.createServer`, Octokit.
- **Styling:** Tailwind CSS v4.
- **Language:** TypeScript strict — no `any`, explicit return types.
- **Testing:** Vitest (site-worker + content-pipeline). 381 tests across 15 test files.

## Common Commands

```bash
pnpm install              # once per clone / after dep changes
pnpm typecheck            # all packages (run per-service for clearer errors)
pnpm build
pnpm test

# Per-service typecheck (preferred while iterating)
cd services/dashboard && pnpm typecheck
cd services/content-pipeline && pnpm typecheck

# Local dev — preferred: single command, auto-ports, env injection
cloudgrid dev             # dashboard → :3001, content-pipeline → :5000

# Manual dev (rarely needed)
cd services/dashboard && pnpm dev
cd services/content-pipeline && pnpm dev

# Site worker — the only site runtime (post-migration)
cd packages/site-worker
pnpm dev                 # astro dev (Vite) — fast iteration, no workerd
pnpm dev:worker          # astro build && wrangler dev --config dist/server/wrangler.staging.json  (workerd parity)
pnpm build               # astro build + emit-env-configs (dist/server/wrangler.{staging,production}.json)
pnpm deploy:staging      # build + wrangler deploy --config dist/server/wrangler.staging.json
pnpm deploy:production   # build + wrangler deploy --config dist/server/wrangler.production.json
                         # Deploys to Assets @ AtomicLabs account. Production worker
                         # has no Custom Domain routes (routes=[]). All production
                         # traffic arrives via Service Binding from
                         # atl-sites-workers-manager.
CLOUDFLARE_ACCOUNT_ID=4a8cfd85d617b38ce1813a552132bc86 pnpm seed:kv <siteId> [hostname ...]
                         # Manual KV seed (defaults to Assets account staging KV).
                         # For production KV, add: KV_NAMESPACE_ID=b258e47065274b8b8af1a0b6d6529c1d
                         # For cross-branch seeding, use `git worktree` and pass
                         # NETWORK_DATA_PATH=<worktree>. seed-kv fails hard if
                         # sites/<siteId>/site.yaml is missing — see Landmines.
                         # CI (atomic-labs-network/.github/workflows/sync-kv.yml)
                         # runs this automatically on commits to network main.
```

## CloudGrid

Deploys to `atomic-content-platform.apps.cloudgrid.io`.

```bash
cloudgrid plug                                         # build + deploy current branch
cloudgrid secrets set atomic-content-platform KEY=val  # sensitive (GITHUB_TOKEN, NEXTAUTH_SECRET, …)
cloudgrid env set atomic-content-platform KEY=val      # runtime config (no rebuild)
```

Service contract (both services satisfy):
1. Listen on `process.env.PORT` (default 8080 in CloudGrid).
2. Expose `GET /health` returning HTTP 200.

## Key Environment Variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `GITHUB_TOKEN` | dashboard, content-pipeline | Needs repo scope. **Does NOT have `pull_requests:write`** in current setup — `gh pr create` fails; open PRs via web. |
| `NETWORK_REPO` | content-pipeline | `atomicfuse/atomic-labs-network`. |
| `LOCAL_NETWORK_PATH` | content-pipeline (dev) | Absolute path to local checkout. Enables local-FS write path **only when no branch is passed**. |
| `CONTENT_AGENT_URL` | dashboard | `http://content-pipeline-app` in CloudGrid / cloudgrid dev; needs NODE_ENV fallback to `http://localhost:5000`. |
| `CONTENT_AGGREGATOR_URL` | content-pipeline | Defaults to `https://content-aggregator-v2-34cd.atomic.cloudgrid.io`. |
| `GEMINI_API_KEY` | content-pipeline | For image generation. |
| `N8N_IMAGE_WEBHOOK_URL` | content-pipeline | n8n webhook for async image generation. If not set, articles are created without triggering image generation. |
| `IMAGE_CALLBACK_URL` | content-pipeline | Override for n8n callback URL. Defaults to `https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback` (dashboard proxy). |
| `NETWORK_DATA_PATH` | site-worker (seed-kv) | Absolute path to network repo checkout. seed-kv resolves config + reads articles + uploads R2 assets from this path. Use `git worktree` for cross-branch seeding. |
| `R2_BUCKET` | site-worker (seed-kv) | R2 bucket name. Defaults to `atl-assets-prod`. There is only one R2 bucket — `atl-assets-staging` was retired (2026-05-13). |
| `R2_ACCESS_KEY_ID` | dashboard | R2 S3-compatible API access key. Required for article image uploads and R2 asset cleanup on site deletion. Skipped with warning if not set. |
| `R2_SECRET_ACCESS_KEY` | dashboard | R2 S3-compatible API secret key. Paired with `R2_ACCESS_KEY_ID`. |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | dashboard | Auth. |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` | dashboard | Google auth + Sheets sync. |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard, site-worker (dev + CI) | `4a8cfd85d617b38ce1813a552132bc86` for Assets @ AtomicLabs (production). Legacy Dev1 account is `953511f6356ff606d84ac89bba3eff50` (still hosts `coolnews.dev` during migration). Required for `wrangler deploy`, `wrangler kv ...`, `pnpm seed:kv`, and dashboard domain management. |
| `CLOUDFLARE_API_TOKEN` | dashboard, CI | Needed by dashboard (domain attach/detach, zone listing) and sync-kv.yml workflow. Required scopes: Zone:Read, DNS:Edit, Workers Scripts:Edit, Workers KV Storage:Edit, R2:Edit. Set in `.env.local` for local dev, CloudGrid secrets for production. |
| `KV_NAMESPACE_ID` | seed-kv.ts | Defaults to CONFIG_KV_STAGING (`f6c35e1fa8c841b8b193509a3a237f7f` on Assets account). Set to `b258e47065274b8b8af1a0b6d6529c1d` for CONFIG_KV (prod). Legacy Dev1 IDs: staging `4673c82cdd7f41d49e93d938fb1c6848`, prod `a69cb2c59507482ca5e6d114babdd098`. |
| `DEV1_CLOUDFLARE_API_TOKEN` | dashboard | API token for Dev1 account. Only accessed when a Dev1 domain is requested (`isDev1Domain()`). Set in `.env.local` + CloudGrid secrets. Temporary — remove after zone transfers. |
| `DEV1_R2_ACCESS_KEY_ID` | dashboard | R2 S3 access key for Dev1 account. Paired with `DEV1_R2_SECRET_ACCESS_KEY`. Temporary. |
| `DEV1_R2_SECRET_ACCESS_KEY` | dashboard | R2 S3 secret for Dev1 account. Temporary. |

## Conventions

- TypeScript strict, no `any`, explicit return types, functional React components return `React.ReactElement`.
- Shared types in `packages/shared-types/`.
- YAML extension `.yaml` (never `.yml`).
- Article slugs: kebab-case, e.g. `best-thriller-movies-2026.md`.
- Config inheritance: `org.yaml → groups → overrides/config → site.yaml` (deep merge, multi-group, targeted overrides with per-field merge modes). Sites list groups in `groups: []` array; legacy `group` string field still supported.
- Commit messages: conventional (`feat(scope):`, `fix(scope):`, `docs:`). Always include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.
- Local vs prod env parity: defaults must match across `.env`, `config.ts`, and CloudGrid; always add local SDK fallbacks.
- **KV schema evolution**: adding a new field to `ResolvedConfig`, `ResolvedLayoutConfig`, or any KV-stored type requires THREE changes: (1) runtime default in `getConfig()`, (2) seed-time default in `resolveLayout()` / `resolve.ts`, (3) re-seed all live sites. See landmine #38.

## Git Workflow (follow without being asked)

- Asaf → `asaf-dev`. Michal → `michal-dev`. **Never commit directly to `main`.**
- Always run `git branch --show-current` before committing.
- "Commit and push" = stage relevant files (never `git add -A` — may include secrets), commit with clear message, push to `origin/<dev-branch>`.
- "Open a PR" = use the compare URL (`gh pr create` fails due to token scope):
  `https://github.com/atomicfuse/atomic-content-platform/compare/main...<dev-branch>`
- Never touch the other developer's branch.
- After merge to main: `cloudgrid plug` (manual — no auto-deploy hook).

## Known Landmines

1. **Next.js standalone bundle only ships traced imports.** Runtime `readFile` outside `public/` fails in production. Guide docs MUST stay in `services/dashboard/public/guide/`.
2. **`sites/` on network-repo main is incomplete** — only published sites. Use `dashboard-index.yaml` to enumerate.
3. **Writer local-FS fallback** — passing no branch with `LOCAL_NETWORK_PATH` set writes to disk, bypassing git. Scheduler/agents must pass `branch`.
4. **`CONTENT_AGENT_URL` internal DNS** — `http://content-pipeline-app` doesn't resolve on the host; use the fallback pattern above.
5. **GITHUB_TOKEN scope** — no `pull_requests:write`. Do not call `gh pr create`; print compare URL instead.
6. **Article count resolution** — scheduler uses `articles_per_day ?? ceil(articles_per_week / preferred_days.length)`. Do not rely on `articles_per_week` being present.
7. **`.DS_Store` exists on network repo main** — don't add it to gitignore surprise-work; it's been living there.
8. **Config normalizers are centralized** — `src/lib/config-normalizers.ts` is the single source for `normalizeTracking`, `normalizeScripts`, `normalizeAdsConfig`, `normalizeAdsTxt`. Do not duplicate these in page components.
9. **`/api/sites/site-config` returns inheritance** — response shape is `{ config, inheritance: { org, groups[] } }`, not just the raw config. Frontend must handle the wrapper.
10. **Site page tabs restructured** — old tab names (Tracking, Scripts & Vars, Ads Config, Content Agent, Quality) no longer exist as separate tabs. Config is unified under Site Settings → Config; generation and quality are in Site Settings → Content Brief. Custom Domain is inside Site Settings → Identity only.
11. **Sidebar restructured** — Domains, Scheduler, Email, Shared Pages no longer have sidebar entries. They live under Settings tabs (Domains, General Scheduler, Email) and Overrides tabs (Shared Pages) respectively. Old routes redirect.
12. **site-worker — Astro 6 runtime env access.** `Astro.locals.runtime.env` was removed. Use `import { env } from 'cloudflare:workers'` for KV / Assets / bindings. Error on this is clear in `wrangler tail` but doesn't appear at build time.
13. **site-worker — middleware MUST run on every request.** `assets = { ..., run_worker_first = true }` in `wrangler.toml` is required. Without it, the CF Assets layer 404s `/` (no static index.html) before middleware runs, and nothing will fix it from inside the Worker.
14. **site-worker — fail closed on unknown hostname.** If `site:<hostname>` isn't in CONFIG_KV, middleware returns 404. Do not add a default-site fallback — that has caused real incidents (serving the wrong config to a new hostname before seeding completed).
15. **site-worker — use `wrangler types`, not `@cloudflare/workers-types`.** The generated `worker-configuration.d.ts` reflects actual bindings; the static `@cloudflare/workers-types` package lies the moment you add a binding that isn't in its interface. Re-run `wrangler types` after any `wrangler.toml` binding change.
16. **site-worker — SESSION KV binding is auto-added by the adapter.** For the unused Astro Sessions feature. Harmless; don't rename it to `CONFIG_KV` or anything else. Confirmed 2026-04-23.
17. **site-worker — KV/R2 are eventually consistent.** A `wrangler kv bulk put` returns success before all edge POPs see the new value (typical: <60s). After Phase 7, *don't expect a freshly-published article to appear instantly* on coolnews.dev — give it ~1 cache window (`s-maxage=300` for articles, `s-maxage=60` for the homepage). Same applies to R2 asset overwrites.
18. **site-worker — seed-kv fails hard if `sites/<siteId>/site.yaml` is missing.** Pre-Phase 8 it would silently fall back to org defaults and write a stub config. Now it errors. For cross-branch seeding, use `git worktree add` and pass `NETWORK_DATA_PATH=<worktree>`.
19. **site-worker — emit-env-configs emits `routes=[]` for production.** `atomic-site-worker` no longer claims any Custom Domains — all Custom Domains are on `atl-sites-workers-manager`. `load-routes.ts` is a stub returning `[]`. `emit-env-configs.ts` still runs at build time but produces empty routes for both envs.
20. **site-worker — `routes = []` on staging is intentional.** Staging is `*.workers.dev` only by design. The "Worker Preview" button in the dashboard hits staging via `?_atl_site=<domain>`; production is the only env that claims custom domains.
21. **KV siteId is the domain folder name, not the numeric `site_id`.** `seed-kv.ts` uses the `sites/<domain>/` folder name as the KV siteId (e.g. `site-config:scienceworld`). The `site_id` field in `dashboard-index.yaml` is a Cloudflare numeric ID — never use it for KV key construction.
22. **Site deletion performs full resource cleanup.** `deleteSiteEntry()` in `src/actions/sites.ts` deletes: (a) known KV keys (`site:*`, `site-config:*`, `article-index:*`, `sync-status:*`), (b) prefix-scanned KV keys (`article:<domain>:*`, `shared-page:<domain>:*`, `site-config-prev:<domain>`) via `listKVKeys` + `bulkDeleteKV`, (c) `sites/<domain>/` AND `overrides/<domain>/` files from Git main in one atomic commit, and (d) `<domain>/*` objects from `atl-assets-prod` R2 bucket. All KV operations target both namespaces. `permanentlyDeleteSite()` retries all cleanup as a safety net. R2 cleanup requires `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` env vars — logs a warning and skips if not configured.
23. **Content Aggregator dropped `vertical_id` (2026-04-29).** Verticals are now tier-1 categories (`parent_id=null`). Dashboard UI says "Category" everywhere. Internal field names (`verticalId`, `WizardFormData.vertical`, `SiteBrief.vertical_id`) are kept for backward compat with stored data. API routes use `parent_id` (categories) and no longer send `vertical_id` (tags, bundles).
24. **site-worker — Server Islands need `_atl_site` propagation.** PixelLoader, AdSlot, and InterstitialLoader are Astro Server Islands (`server:defer`). The browser fetches them via `/_server-islands/<Name>?...`. On staging (workers.dev), these sub-requests don't carry `_atl_site` by default, so middleware resolves the wrong site. Fixed by patching `window.fetch` in `generatePreviewScript()` (`preview-override.ts`) to inject `_atl_site` into server island requests. If you add a new Server Island, this is automatic — no per-component work needed.
25. **site-worker — PixelLoader loads gtag.js once per Google's spec.** GA4 + Google Ads share a single gtag.js load. Do not add a second `<script src="gtag.js">` tag — it causes duplicate events and incorrect attribution. GTM is loaded independently (its own snippet).
26. **Content Aggregator URL requires `/api` suffix.** The aggregator base URL (`CONTENT_AGGREGATOR_URL`) defaults to the CloudGrid URL which does NOT include `/api`. All fetch calls must append `/api/...` to the base. See `wizard.ts` `getAggregatorApiBase()` which strips a trailing `/api` if present, then re-adds it per-call.
27. **`createBundleForSite` in wizard.ts.** Site settings (ContentAgentTab) can create a content bundle from existing category + subcategory + tag selections. Calls `POST /api/bundles` on the aggregator. Handles 409 (duplicate name) by retrying with " (2)" suffix. Requires at least one subcategory selected.
29. **Single R2 bucket — `atl-assets-prod` serves both staging and production.** The site-worker's `ASSET_BUCKET` binding points to `atl-assets-prod` in both wrangler environments. The `atl-assets-staging` bucket was retired (2026-05-13) — it was never read by any runtime. All image uploads (dashboard article upload, content-pipeline generation, seed-kv) write to `atl-assets-prod`. Dashboard article upload optimizes images via sharp (resize to max 1200px, WebP quality ladder 80→60→40, target ≤350KB) — see `src/app/api/articles/upload/route.ts`.
30. **site-worker — `QUERY_HANDLER` and `ATL_STREAMED_LANDER` Service Bindings remain on site-worker.** Even though the manager handles `?x=1` and `?agi=1011` routing for production traffic, these bindings are kept on `atomic-site-worker` as a safety net for staging (workers.dev) and any direct access. Middleware still checks these before KV lookup.
31. **site-worker — `load-routes.ts` is a stub returning `[]`.** All Custom Domains are on `atl-sites-workers-manager`. `atomic-site-worker` deploys with `routes=[]` and receives production traffic only via the manager's `ATL_SITES_MAIN` Service Binding. The old Dev1 filter logic was removed.
32. **Dashboard dual-account routing is opt-in per call.** All `cloudflare.ts` functions accept an optional `domain?: string` last parameter. If omitted, they default to Assets account. Only pass `domain` when you know the operation targets a specific site. Functions that list across accounts (e.g. `getAvailableZones()` in `wizard.ts`) explicitly query both accounts and merge results.
33. **CloudGrid auto-injects `CONTENT_AGGREGATOR_URL` as a stale platform read-only env.** It points to `content-aggregator-cloudgrid.apps.cloudgrid.io` (wrong). The correct aggregator is `content-aggregator-v2-34cd.atomic.cloudgrid.io`. All code must check `CONTENT_API_BASE_URL` **before** `CONTENT_AGGREGATOR_URL` in the env var fallback chain. Both `cloudgrid.yaml` services set `CONTENT_API_BASE_URL` to the correct URL. Never add new code that reads `CONTENT_AGGREGATOR_URL` first.

34. **n8n image generation is fire-and-forget.** Articles are created with a default site image (`{site-slug}-general-article`). n8n webhooks fire in the background after article commit. If n8n is down or slow, articles are unaffected — they just keep the default image. Slack alerts fire on failure. If the worker process exits during background delivery, in-flight images are silently lost (no retry mechanism).
35. **n8n image callback routes through the dashboard proxy.** The content-pipeline is an internal-only CloudGrid service (no public URL). n8n cannot reach it directly. The callback URL points to `https://sites-platform-e297.atomic.cloudgrid.io/api/agent/image-callback`, which is a dashboard API route that proxies to `http://content-pipeline-app/image-callback` inside the cluster. The dashboard middleware excludes `/api/` from auth, so n8n's unauthenticated callbacks work. If you change the CloudGrid entity slug, update the default callback URL in `agent.ts`.
36. **`WORKER_NAME_PROD` is `atl-sites-workers-manager`, not `atomic-site-worker`.** Changed 2026-05-19. `registerWorkerCustomDomain`/`deregisterWorkerCustomDomain` in `cloudflare.ts` target the manager. Dashboard `attachCustomDomain`/`detachCustomDomain` register Custom Domains on the manager — but the manager's `MIGRATED_SITES` set must be updated and redeployed separately for the site to actually receive traffic. The manager code is outside this repo.
37. **`attachCustomDomain` gracefully handles WordPress domains.** When CF Custom Domain registration fails with "externally managed DNS records" (WordPress domains with existing A/CNAME), the error is caught and registration is skipped — KV seeding and promotion continue normally. This is intentional for WordPress migration where domains reach the manager via Routes, not Custom Domains. See `wizard.ts` Step 2. Only the specific "externally managed DNS" error is skipped; other CF errors still roll back.
38. **site-worker — KV config is a live schema. Never access new config fields without runtime defaults.** KV configs are written by `seed-kv.ts` and cached indefinitely until the next sync. If you add a new field to `ResolvedConfig` (or any sub-object like `layout`), existing KV entries will NOT have it. Accessing `config.newField.enabled` on stale KV data throws `"Cannot read properties of undefined"`, which Astro swallows and returns a generic `"Not found"` 404 — **taking down every production site silently**. This happened 2026-05-20 with `layout.whats_new` and `layout.more_on`. **Mandatory rules:**
    - **Runtime defaults in `getConfig()`**: every new config field MUST have a `??=` fallback in `packages/site-worker/src/lib/config.ts`. The `LAYOUT_DEFAULTS` pattern there is the template.
    - **Seed-time defaults in `resolveLayout()` / `resolve.ts`**: the seed script must also populate the new field so future syncs write it.
    - **Never deploy site-worker with new schema fields without re-seeding all live sites** via `sync-kv.yml` (trigger with `workflow_dispatch` → `force_all: true`) or manual `pnpm seed:kv` per site.
    - **Test with stale config**: before deploying, mentally ask "what if the KV config was written 3 months ago and doesn't have this field?" If the answer is a crash, add a default.

39. **Video embeds require both worker deploy and KV re-seed.** Videos are stored in article frontmatter (`videos: ArticleVideo[]`) and injected at render time by `inject-videos.ts` in the site-worker. Adding a video via the dashboard only writes to Git (staging branch). To see it on the site: (1) deploy the site-worker (`pnpm deploy:staging`), (2) re-seed KV for the site (`pnpm seed:kv <siteId>` with network repo on the staging branch). Without both steps, KV won't have the `videos` field and/or the worker won't have the injection code.
40. **Video embed YAML round-trip strips quotes.** The `yaml` library's `stringify()` outputs unquoted strings by default. When saving videos (or scripts) via the dashboard API, existing quoted YAML values (`title: "Foo"`) become unquoted (`title: Foo`). Both forms parse identically — no data loss, purely cosmetic.
41. **Conditional overrides require re-seed after adding `activation` field.** Adding or removing an `activation` field on an existing override changes whether it's merged at seed-time or stored in `cond-overrides:<siteId>`. The change only takes effect after `seed-kv` runs for the affected sites. Without re-seeding, the override stays in (or out of) the base config.
42. **Template `${var}` in widget code is resolved from URL params — sanitised values only.** Values are restricted to `[a-zA-Z0-9_-.:` characters. If an ad network requires special characters in their tracking params (e.g. `=`, `&`, `+`), those characters will be stripped. Use URL-encoded values or restructure the template.

## Cloudflare Account Migration & WordPress Migration

Full status doc: `docs/superpowers/specs/2026-05-17-migration-status-and-remaining-work.md`.
Original design: `docs/superpowers/specs/2026-05-14-cloudflare-account-migration-design.md`.

### Two Cloudflare Accounts

| Account | ID | Role | What lives here |
|---------|----|------|-----------------|
| **Assets @ AtomicLabs** | `4a8cfd85d617b38ce1813a552132bc86` | Production | `atl-sites-workers-manager` (routing layer, owns all Custom Domains), `atomic-site-worker` (prod+staging), `atl-query-handler-t`, `atl-streamed-lander`, `green-dream-b06f`, KV, R2. All new sites deploy here. |
| **Dev1 @ AtomicLabs** | `953511f6356ff606d84ac89bba3eff50` | Legacy (temporary) | `atomic-site-worker` (prod+staging) for 2 legacy sites only: `financenewsbase.com`, `coolnews.dev` (muvizzcom). Will be decommissioned after zone transfers. |

### Assets @ AtomicLabs Resources

| Resource | ID / Name |
|----------|-----------|
| CONFIG_KV (prod) | `b258e47065274b8b8af1a0b6d6529c1d` |
| CONFIG_KV_STAGING | `f6c35e1fa8c841b8b193509a3a237f7f` |
| R2 bucket | `atl-assets-prod` |
| Staging worker | `https://atomic-site-worker-staging.accounts-4a8.workers.dev` |
| Production worker | `https://atomic-site-worker.accounts-4a8.workers.dev` |

### Workers on Assets Account

| Worker | Routes/Binding | Purpose | Touch? |
|--------|----------------|---------|--------|
| `atl-sites-workers-manager` | Workers Custom Domains (all migrated sites) | **Routing layer** — owns all Custom Domains, delegates via Service Bindings. Managed outside this repo. | YES — manually maintained |
| `atomic-site-worker` | No Custom Domains (receives traffic via manager's `ATL_SITES_MAIN` binding) | Our platform — Astro SSR from KV + R2 | YES — this is ours |
| `atomic-site-worker-staging` | `*.workers.dev` only | Staging preview via `?_atl_site=` | YES — this is ours |
| `atl-query-handler-t` | Service Binding from manager + site-worker (`QUERY_HANDLER`) | Handles `?x=1` query param requests | YES — this is ours |
| `atl-streamed-lander` | Service Binding from manager (`ATL_LANDER`) + WordPress Routes | WordPress proxy + monetization landing pages | CAREFUL |
| `green-dream-b06f` | Service Binding from manager (`ATL_GREEN`) + WordPress Routes | Monetization, ads, tracking — critical revenue | DO NOT TOUCH |

### Manager Worker Architecture (implemented 2026-05-19)

`atl-sites-workers-manager` is a thin routing Worker that sits in front of all production traffic. It owns all Workers Custom Domains and routes requests to downstream workers via Service Bindings:

```
                           ┌─────────────────────────────────────┐
                           │   atl-sites-workers-manager         │
   travelswire.com ──────► │                                     │
   wineoceans.com  ──────► │   Custom Domains (all sites)        │
   (future sites)  ──────► │                                     │
                           │   Routing rules:                    │
                           │   1. ?agi=1011  → ATL_LANDER        │
                           │   2. /atl/*     → ATL_GREEN         │
                           │   3. MIGRATED_SITES → ATL_SITES_MAIN│
                           │   4. default    → fetch() (WP origin│)
                           └─────────────────────────────────────┘
                              │            │              │
                    ATL_SITES_MAIN    ATL_GREEN      ATL_LANDER
                              │            │              │
                              ▼            ▼              ▼
                    atomic-site-worker  green-dream  atl-streamed-lander
```

**Service Bindings on the manager:**

| Binding | Target Worker | Triggers |
|---------|---------------|----------|
| `ATL_LANDER` | `atl-streamed-lander` | `?agi=1011` |
| `ATL_GREEN` | `green-dream-b06f` | `/atl` or `/atl/*` path |
| `ATL_SITES_MAIN` | `atomic-site-worker` | Hostname in `MIGRATED_SITES` set |

**`MIGRATED_SITES` is a hardcoded `Set<string>` in the manager's code.** When a site is fully migrated (KV seeded, content ready), add its custom domain to the set and redeploy the manager. This is a manual step — the dashboard's `attachCustomDomain` registers the Custom Domain on the manager via CF API, but the manager's routing logic must be updated separately.

**Why this architecture:**
- **Blast radius isolation** — if `atomic-site-worker` has a middleware bug, `green-dream-b06f` and `atl-streamed-lander` keep working (they route independently from the manager)
- **Per-domain rollback** — remove a domain from `MIGRATED_SITES`, redeploy manager, and traffic falls through to WordPress origin
- **WordPress migration path** — domains not in `MIGRATED_SITES` pass through to origin (`fetch(request)`), so WordPress sites continue working until migrated

**Dashboard integration:**
- `WORKER_NAME_PROD` in `constants.ts` = `"atl-sites-workers-manager"` — `attachCustomDomain()` and `detachCustomDomain()` register/deregister Custom Domains on the manager (not on `atomic-site-worker`)
- `atomic-site-worker` deploys with `routes=[]` — no Custom Domains of its own
- `load-routes.ts` returns `[]` — `emit-env-configs.ts` emits empty routes for both staging and production

**Manager worker code is outside this repo** — managed directly in the Cloudflare dashboard or a separate project. The routing logic lives in the manager, not in this codebase.

### Dual-Account Credential Routing (completed 2026-05-17)

Dashboard and CI route CF API calls to the correct account per site. Implemented in:
- `services/dashboard/src/lib/constants.ts` — `DEV1_SITE_IDS`, `DEV1_CUSTOM_DOMAINS`, `isDev1Domain()`, `getKvNamespaces()`, `getWorkerStagingUrl()`
- `services/dashboard/src/lib/cloudflare.ts` — `getCredentials(domain?)`, `headersFromCreds()` — all CF functions accept optional `domain` param
- `atomic-labs-network/.github/workflows/sync-kv.yml` — `DEV1_SITES` conditional for KV seeding

**Dev1 legacy sites (temporary):** `financenewsbase` + `muvizzcom` (custom domains: `financenewsbase.com`, `coolnews.dev`). Remove from sets after zone transfer to Assets.

### Current Sites (dashboard-index.yaml, 2026-05-19)

| Site ID | Status | Custom Domain | Routing |
|---------|--------|---------------|---------|
| `travelswire` | Live | `travelswire.com` | Manager Custom Domain → ATL_SITES_MAIN |
| `wineoceans` | Live | `wineoceans.com` | Manager via Route (WP migration) → ATL_SITES_MAIN |
| `financenewsbase` | Live | `financenewsbase.com` | Dev1 — Direct Custom Domain |
| `muvizzcom` | Live | `coolnews.dev` | Dev1 — Direct Custom Domain |
| `chaibeseret` | Staging | — | Staging worker only |
| `wtpop` | Staging | — | Staging worker only |

### Query Handler Service Binding (completed 2026-05-17)

`atl-query-handler-t` Worker on Assets account, bound to `atomic-site-worker` via `QUERY_HANDLER` Service Binding. Middleware intercepts `?x=1` before KV lookup and forwards to the bound service. Configured in `wrangler.toml` `[[services]]` and `src/middleware.ts`.

### Workers Custom Domains vs Workers Routes

**All Custom Domains are registered on `atl-sites-workers-manager`** — the manager owns the domain, routes traffic via Service Bindings. `atomic-site-worker` has no Custom Domains; it only receives traffic from the manager's `ATL_SITES_MAIN` binding (production) and via `*.workers.dev` (staging).

**WordPress migration sites use Routes** — their zones already have DNS records (A/CNAME) pointing to WordPress, so CF Custom Domain registration fails. Instead, a Workers Route (`domain.com/*` → `atl-sites-workers-manager`) on the zone directs traffic to the manager. The manager checks `MIGRATED_SITES` and forwards to `ATL_SITES_MAIN`. Dashboard's `attachCustomDomain` detects the "externally managed DNS" error and skips CF registration, proceeding directly to KV seeding. The old WordPress Routes (`*domain.com/atl/*` → `green-dream-b06f`) can be cleaned up after migration is confirmed.

### Dev1 Route Filtering (legacy — partially superseded)

`packages/site-worker/scripts/lib/load-routes.ts` is now a stub that always returns `[]` — `atomic-site-worker` no longer claims any Custom Domains (the manager owns them all). The Dev1 filter logic was removed. Dev1 sites (`financenewsbase.com`, `coolnews.dev`) still use direct Custom Domains on the Dev1 account's worker until zone transfer.

### WordPress Migration Architecture

WordPress migration uses `atl-sites-workers-manager` as the routing layer. There are two domain attachment paths depending on whether the domain has existing DNS records:

**New platform sites** (no existing DNS): `attachCustomDomain` registers a Workers Custom Domain on the manager → CF auto-creates DNS → works immediately.

**WordPress migration sites** (existing A/CNAME records): `attachCustomDomain` attempts CF Custom Domain registration, which fails with "externally managed DNS records". The code detects this specific error, logs a warning, and **skips registration** — continuing with KV seeding, promotion, and config patching. Traffic reaches the manager via the zone's existing Workers Routes (not Custom Domains). The domain must also be in the manager's `MIGRATED_SITES` set.

#### WordPress domain attach flow (step by step)

1. **Pre-requisite:** Domain already has a Workers Route (`domain.com/*`) pointing to `atl-sites-workers-manager` on the zone. Add the hostname to `MIGRATED_SITES` in the manager and redeploy.
2. **Dashboard:** Click "Attach Domain" on the site detail page → selects zone → calls `attachCustomDomain()`.
3. **`attachCustomDomain` runs:**
   - Step 1: Updates `dashboard-index.yaml` (status → Live, `custom_domain` set)
   - Step 2: Attempts CF Custom Domain registration → fails with "externally managed DNS" → **skips** (logged as warning, not error)
   - Step 3: Seeds KV `site:<domain>` → `{ siteId }` in production KV
   - Step 4: Promotes site config + articles from staging KV to production KV
   - Step 4b: Patches `config.domain` to the real custom domain in KV + `site.yaml`
   - Step 5: Email routing setup (best-effort)
4. **Result:** Manager routes `domain.com` → ATL_SITES_MAIN → `atomic-site-worker` reads config from KV → site is live.

#### Routing comparison

| Domain type | DNS | How traffic reaches manager | CF API in `attachCustomDomain` |
|-------------|-----|-----------------------------|-------------------------------|
| New platform site | Auto-managed by CF Custom Domain | Custom Domain on manager | Registers Custom Domain |
| WordPress migration | Existing A/CNAME (kept) | Workers Route on zone | Skipped (externally managed DNS) |

Both paths share the same KV seeding, promotion, and config patching logic.

Per-domain rollback: remove from `MIGRATED_SITES`, redeploy manager. Instant — traffic falls through to WordPress origin.

**Migration pipeline:** Design complete (`docs/plans/2026-05-12-wp-migration-design.md`), implementation plan ready (`docs/plans/2026-05-12-wp-migration-plan.md`, 15 tasks). First pilot: `wineoceans.com` (2026-05-19).

### What's Left (priority order)

1. **WordPress migration pipeline** — implement the 15-task content import plan (CSV -> WP REST API -> turndown -> Claude cleanup -> Gemini images -> R2 -> git -> KV)
2. ~~**Pilot WordPress migration**~~ — completed 2026-05-19: `wineoceans.com` attached via Route + manager routing
3. **Batch WordPress migration** — remaining ~44 sites (add Route to manager, add to `MIGRATED_SITES`, attach domain via dashboard)
4. **Dev1 zone transfers** — move `financenewsbase.com` + `coolnews.dev` to Assets account, register on manager
5. **Dev1 decommission** — remove all dual-account code, delete Dev1 KV/R2
6. **Legacy Routes cleanup** — remove WordPress-era Routes from zone configs after full migration

### Article images in R2

`seed-kv.ts` only uploads files from the git repo's `assets/` folder. Article hero images (uploaded via dashboard/content-pipeline) live only in R2. When moving a site between accounts, article images must be copied separately from the source R2 bucket to the target R2 bucket.

## Quick Reference — File Ownership

| Concern | Owner |
|---------|-------|
| Org config | Network repo, main, `org.yaml` |
| Network manifest | Network repo, main, `network.yaml` |
| Group configs | Network repo, main, `groups/<id>.yaml` |
| Config overrides (targeted exceptions) | Network repo, main, `overrides/config/<id>.yaml` |
| Conditional overrides (query-param activated) | KV `cond-overrides:<siteId>`, seeded from overrides with `activation` field |
| Site config + articles | Network repo, staging branch |
| Shared page base content | Network repo, main |
| Per-site shared-page overrides | Network repo, main, `overrides/<site_id>/` |
| Global scheduler gate | Network repo, main, `scheduler/config.yaml` |
| Site list / status / cloudflare ids | Network repo, main, `dashboard-index.yaml` |
| Dashboard UI / APIs | Platform repo, `services/dashboard` |
| Agents + cron handlers | Platform repo, `services/content-pipeline` |
| Deploy config (services, cron) | Platform repo, `cloudgrid.yaml` |
| In-app docs | Platform repo, `services/dashboard/public/guide/*.md` |

## In-App Guide

For any user-visible feature, there should be a matching guide page in `services/dashboard/public/guide/`. Register new pages in `services/dashboard/src/app/guide/page.tsx` (`GUIDE_PAGES` array).

Current pages: overview, sites, shared-pages, ads-txt, content-pipeline, subscribe, email-routing, cloudgrid, scheduler, config-inheritance, overrides, site-worker, theme-and-layout, articles-api, creating-a-site, error-handling, site-deletion, wordpress-import, bulk-image-api, query-param-overrides.
