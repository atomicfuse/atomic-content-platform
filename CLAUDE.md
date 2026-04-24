# CLAUDE.md

Orientation for Claude Code sessions. Read this before touching code.

## Overview

Atomic Content Network Platform — a multi-tenant content network for managing ad-monetized static websites at scale. Turborepo/pnpm monorepo with two CloudGrid services plus reusable Astro site-builder + shared-types.

## Two-Repo Architecture

| Repo | Contents |
|------|----------|
| **atomic-content-platform** (this repo) | All code: dashboard, content-pipeline, site-builder, shared-types, migration. Deployed to CloudGrid. |
| **atomic-labs-network** (network data) | Pure data: `dashboard-index.yaml`, `sites/<domain>/` configs + articles, `overrides/`, `scheduler/config.yaml`. Zero code. Deployed via Cloudflare Pages per site. |

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
      guide/                 In-app markdown docs (loads /public/guide/*.md)
      api/                   Server routes (shared-pages, sites, groups, agent proxy, scheduler, ads-txt, …)
    src/lib/
      github.ts              readFileContent, commitNetworkFiles, updateSiteInIndex, dashboard-index helpers
      scheduler.ts           readSchedulerConfig / writeSchedulerConfig / triggerSchedulerRun
      shared-pages.ts        Shared-page + override primitives
      config-normalizers.ts  Shared normalizers (tracking, scripts, ads) used by group page + SiteConfigTab
    src/components/site-detail/
      SiteConfigTab.tsx      Unified config form for sites (fetches inheritance chain, shows source badges)
      ContentAgentTab.tsx    Site Identity tab container with sub-tabs (Identity, Content Brief, Groups, Config)
    src/actions/             Server actions (wizard, agent, sites)
    public/guide/            Markdown guide content (must be in public/ so standalone bundle ships it)

  content-pipeline/          Node/TypeScript service (content-generation + scheduler agents)
    src/agents/
      content-generation/    agent.ts orchestration + HTTP handler
      content-quality/       Claude-based scoring
      article-regeneration/  Low-score rewrite flow
      scheduled-publisher/   Cron-triggered batch publisher (gated by scheduler/config.yaml)
    src/lib/
      github.ts              Octokit wrappers: readFile, listFiles, commitFile, commitBatch
      writer.ts              shouldWriteLocal(cfg) — local FS iff LOCAL_NETWORK_PATH set AND no branch
      site-brief.ts          listActiveSites (via dashboard-index.yaml), readSiteBriefWithFallback
      ai.ts                  @cloudgrid-io/ai → @anthropic-ai/sdk fallback
      config.ts              loadConfig() — env-driven AgentConfig
    src/index.ts             HTTP server: /health, /content-generate, /scheduled-publish

packages/
  shared-types/              TS interfaces: SiteConfig, SiteBrief, PublishSchedule, DashboardIndex, Article, Ads, Tracking
  site-builder/              Astro 5.7 static site generator (themes, components, config resolver) — legacy Pages-per-site target, serves production during the Pages→Workers migration
  site-worker/               Astro 6 + @astrojs/cloudflare SSR app (migration target, Phase 1 scaffold). One Worker serves many hostnames via KV-driven config. Lives alongside site-builder until Phase 8 cutover. See docs/migration-plan.md
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
  .build-trigger             Touched to force Cloudflare Pages rebuild
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
- `staging/<domain>` — where `sites/<domain>/` lives while in development or staging. Cloudflare Pages deploys this branch to the staging URL (e.g. `staging-coolnews-atl.coolnews-atl.pages.dev`).
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

The site-builder resolves config at build time (`packages/site-builder/scripts/resolve-config.ts`). The full chain:

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
- Per-site overrides are on `main` of the network repo; the site-builder resolves overrides at build time.
- **These are content overrides, not config overrides** — distinct from `overrides/config/` above.

## Site Detail Page — Unified Tab Architecture

The site detail page (`/sites/[domain]`) has 3 top-level tabs:

1. **Site Settings** (default tab) — 5 sub-tabs:
   - **Identity** — site name, tagline, audience, tone, Custom Domain panel
   - **Content Brief** — topics, schedule (`articles_per_day`, `preferred_days`), content guidelines, inline Generate Articles section, quality threshold + criteria sliders
   - **Groups** — assign/remove groups, view active overrides with source badges, links to group pages
   - **Overrides** — overrides that apply to this site
   - **Config** — `SiteConfigTab` renders `UnifiedConfigForm` (same component used on Org/Group pages); shows inheritance badges ("From org", "From group: X")
2. **Deployments** — deploy status, staging URL, build trigger
3. **Content** — article list, status filters

Each sub-tab has its own independent Save button. The Config sub-tab fetches from `/api/sites/site-config` which returns the full inheritance chain (`{ config, inheritance: { org, groups[] } }`).

### Config inheritance model

See **Config Inheritance — 5-Layer Resolution** above for the full chain (`org → groups → overrides/config → site`). The Config sub-tab shows `SourceBadge` indicating where each value comes from. Normalizer functions in `src/lib/config-normalizers.ts` are shared between org, group, override, and site config pages.

## Tech Stack

- **Monorepo:** Turborepo + pnpm. Package names: `@atomic-platform/<name>`.
- **Dashboard:** Next.js 15 (App Router), React 19, next-themes, NextAuth.
- **Site builder (legacy, live traffic):** Astro 5.7 (static output), deployed to Cloudflare Pages per-site. Retires in Phase 8 of the migration.
- **Site worker (migration target, Phase 1 scaffold):** Astro 6.1 + `@astrojs/cloudflare` 13.2 (`output: 'server'`), deployed to Cloudflare Workers. One deployment serves many hostnames.
- **Content pipeline:** Node 20, raw `http.createServer`, Octokit.
- **Styling:** Tailwind CSS v4.
- **Language:** TypeScript strict — no `any`, explicit return types.
- **Testing:** Vitest (content-pipeline).

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

# Site builder (legacy, for debugging static output)
cd packages/site-builder
SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network pnpm dev

# Site worker (migration target — Phases 1-4 done)
cd packages/site-worker
pnpm dev                 # astro dev (Vite) — fast iteration, no workerd
pnpm dev:worker          # astro build && wrangler dev --config dist/server/wrangler.json  (workerd parity)
pnpm build               # astro build — emits dist/_worker.js + dist/server/wrangler.json
pnpm deploy:staging      # astro build && wrangler deploy --env staging
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 pnpm seed:kv <siteId> [hostname ...]
                         # Manual KV seed (Phase-3 bootstrap / local recovery).
                         # Phase-5 CI (atomic-labs-network/.github/workflows/sync-kv.yml)
                         # runs this automatically on commits to the network repo.
```

## CloudGrid

Deploys to `atomic-content-platform.apps.cloudgrid.io`.

```bash
cloudgrid deploy                                       # deploy current branch
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
| `CONTENT_AGGREGATOR_URL` | content-pipeline | Defaults to `https://content-aggregator-cloudgrid.apps.cloudgrid.io`. |
| `GEMINI_API_KEY` | content-pipeline | For image generation. |
| `SITE_DOMAIN`, `NETWORK_DATA_PATH` | site-builder | For local builds/previews. |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | dashboard | Auth. |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` | dashboard | Google auth + Sheets sync. |
| `CLOUDFLARE_ACCOUNT_ID` | site-worker (dev + CI) | `953511f6356ff606d84ac89bba3eff50` for Dev1 account during migration. Required for `wrangler deploy`, `wrangler kv ...`, `pnpm seed:kv`. |
| `CLOUDFLARE_API_TOKEN` | CI only | Needed by the sync-kv.yml workflow. Required scopes: Workers Scripts:Edit, Workers KV Storage:Edit. Not needed for local dev (uses OAuth via `wrangler login`). |
| `KV_NAMESPACE_ID` | seed-kv.ts | Defaults to CONFIG_KV_STAGING (`4673c82cdd7f41d49e93d938fb1c6848`). Set to `a69cb2c59507482ca5e6d114babdd098` for CONFIG_KV (prod). |

## Conventions

- TypeScript strict, no `any`, explicit return types, functional React components return `React.ReactElement`.
- Shared types in `packages/shared-types/`.
- YAML extension `.yaml` (never `.yml`).
- Article slugs: kebab-case, e.g. `best-thriller-movies-2026.md`.
- Config inheritance: `org.yaml → groups → overrides/config → site.yaml` (deep merge, multi-group, targeted overrides with per-field merge modes). Sites list groups in `groups: []` array; legacy `group` string field still supported.
- Commit messages: conventional (`feat(scope):`, `fix(scope):`, `docs:`). Always include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.
- Local vs prod env parity: defaults must match across `.env`, `config.ts`, and CloudGrid; always add local SDK fallbacks.

## Git Workflow (follow without being asked)

- Asaf → `asaf-dev`. Michal → `michal-dev`. **Never commit directly to `main`.**
- Always run `git branch --show-current` before committing.
- "Commit and push" = stage relevant files (never `git add -A` — may include secrets), commit with clear message, push to `origin/<dev-branch>`.
- "Open a PR" = use the compare URL (`gh pr create` fails due to token scope):
  `https://github.com/atomicfuse/atomic-content-platform/compare/main...<dev-branch>`
- Never touch the other developer's branch.
- After merge to main: `cloudgrid deploy` (manual — no auto-deploy hook).

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

## Quick Reference — File Ownership

| Concern | Owner |
|---------|-------|
| Org config | Network repo, main, `org.yaml` |
| Network manifest | Network repo, main, `network.yaml` |
| Group configs | Network repo, main, `groups/<id>.yaml` |
| Config overrides (targeted exceptions) | Network repo, main, `overrides/config/<id>.yaml` |
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

Current pages: overview, sites, shared-pages, ads-txt, content-pipeline, subscribe, email-routing, cloudgrid, scheduler, config-inheritance, overrides, site-builder.
