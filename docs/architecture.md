# Architecture Reference

Full architecture reference for the Atomic Content Network Platform. For rules, conventions, and landmines, see `CLAUDE.md` in the repo root.

## Tech Stack

- **Monorepo:** Turborepo + pnpm. Package names: `@atomic-platform/<name>`.
- **Dashboard:** Next.js 15 (App Router), React 19, next-themes, NextAuth.
- **Site worker:** Astro 6.1 + `@astrojs/cloudflare` 13.2 (`output: 'server'`), deployed to Cloudflare Workers on Assets @ AtomicLabs account.
- **Content pipeline:** Node 20, raw `http.createServer`, Octokit.
- **Styling:** Tailwind CSS v4.
- **Language:** TypeScript strict.
- **Testing:** Vitest (site-worker + content-pipeline).

## Services

### dashboard

- Next.js 15 App Router, `output: "standalone"`.
- **Local port:** `3001` (per `cloudgrid dev`).
- Standalone output only bundles traced imports — anything read at runtime must live under `public/`.
- Auth: NextAuth with Google. `NETWORK_REPO_OWNER`/`NETWORK_REPO_NAME` in `src/lib/constants.ts`.

### content-pipeline

- Plain Node HTTP server, TypeScript.
- **Local port:** `5000` (per `cloudgrid dev`).
- Endpoints: `GET /health`, `POST /content-generate`, `GET /scheduled-publish` (accepts `?force=true`).
- In CloudGrid uses `@cloudgrid-io/ai`. Locally uses `@anthropic-ai/sdk` via `ANTHROPIC_API_KEY`.

### CloudGrid

Deploys to `atomic-content-platform.apps.cloudgrid.io`. Service contract: listen on `process.env.PORT` (default 8080), expose `GET /health` returning HTTP 200.

## Network Repo Branch Conventions

- `main` — authoritative for `dashboard-index.yaml`, `scheduler/config.yaml`, `overrides/`, and published sites.
- `staging/<domain>` — where `sites/<domain>/` lives while in development. Dashboard "Worker Preview" button serves via `?_atl_site=<domain>` against staging Worker.
- **Do not enumerate `sites/` on main** — only published sites. Use `dashboard-index.yaml`.

### Staging -> Production Publish Flow

Each site has an isolated staging branch. Publishing copies **only** that site's folder to main — never a full git merge.

```
main:           A---------B (site1 publish)----C (site2 publish)----D (site1 publish)
                 \          ^  \                 ^  \                 ^
staging/site1:    -e1--e2---+   -(reset)--e3-----+-------e3----------+
                   \                             |
staging/site2:      --------------eA--eB---------+   -(reset)--...
```

1. User edits site1 -> changes go to `staging/site1`, only in `sites/site1/`.
2. Click "Apply to Live Site" -> dashboard reads **only** `sites/site1/` from `staging/site1` and commits to `main` via `commitNetworkFiles()`.
3. Staging branch resets -> deleted and recreated from current `main`.

**Key invariant: sites never interfere with each other.** The publish function (`mergeOrCopySiteToMain` in `wizard.ts` / `review.ts`) only reads `sites/<domain>/` — never does a full `git merge`.

CLI alternative: `./scripts/publish-site.sh <site-name>` in the network repo.

## Config Inheritance — 5-Layer Resolution

Resolved at seed-time by `packages/site-worker/scripts/seed-kv.ts`. Layer logic in `packages/site-worker/scripts/lib/resolve.ts`.

```
org.yaml -> groups[0].yaml -> groups[1].yaml -> ... -> overrides/config (by priority) -> site.yaml
```

### Layer 1: `org.yaml` — Org-Wide Defaults

Root of inheritance. Contains: `organization`, `legal_entity`, `support_email_pattern`, `default_theme`, `default_fonts`, `default_groups`, `tracking` (GA4/GTM/Google Ads/Facebook Pixel), `scripts` (head/body_start/body_end/before_footer), `scripts_vars`, `ads_config`, `ad_placeholder_heights`, `ads_txt`, `legal`, feature flags.

**Dashboard:** Settings -> Org tab -> `GET/PUT /api/settings/org`.

### Layer 2: `groups/<id>.yaml` — Group-Level Config

Same fields as org, all optional/partial. Sites can belong to **multiple groups** (`groups: [id1, id2, ...]` in `site.yaml`), merged left-to-right.

**Dashboard:** `/groups/[groupId]` -> three tabs: General, Config (`UnifiedConfigForm` in `mode="group"`), Sites.

### Layer 3: `overrides/config/<id>.yaml` — Targeted Config Exceptions

Named exception sets targeting specific groups and/or sites. Sorted by `priority` (lowest first, highest wins).

```yaml
override_id: my-override
name: "My Override"
priority: 10
targets:
  groups: [group-a]       # all sites in these groups
  sites: [domain.com]     # specific sites (UNION, not intersection)
tracking:
  _mode: merge            # per-field merge mode
  ga4: "G-NEWID"
ads_config:
  _mode: replace
  ad_placements: [...]
```

**Per-field merge modes:**

| Field | Default | Available |
|-------|---------|-----------|
| `tracking` | `merge` | `merge`, `replace` |
| `scripts` | `merge_by_id` | `merge_by_id`, `replace` |
| `scripts_vars` | `merge` | `merge`, `replace` |
| `ads_config` | `replace` | `add`, `merge_placements`, `replace` |
| `ads_txt` | `add` | `add`, `replace` |
| `theme` | `merge` | `merge`, `replace` |
| `legal` | `merge` | `merge`, `replace` |

### Layer 3b: Conditional Overrides (query-param-activated)

Overrides with an `activation` field are **not** merged at seed-time. Stored separately in KV (`cond-overrides:<siteId>`) and applied at request-time when matching query param present.

```yaml
override_id: test-sticky
activation:
  query_param: stickytest
  query_value: "true"       # optional
targets:
  sites: [travelswire]
ads_config:
  ad_placements: [...]
```

- Middleware reads `cond-overrides:*` only when URL has query params (zero overhead otherwise)
- Responses with conditional overrides get `cache-control: private, no-store`
- Activation params propagate across navigation via inline script

### Template Variables in Widget Code

Ad placement `code` fields support `${paramName}` placeholders resolved from URL query params at request-time. Values sanitised to `[a-zA-Z0-9_-.:` — unresolved vars become empty strings.

### Layer 4: `sites/<domain>/site.yaml` — Per-Site Config

The leaf. Site-level values always win. Contains `domain`, `groups`, `active`, `brief` (editorial), plus optional config fields.

### Key Merge Rules

- **Tracking, theme, legal:** deep merge, later wins per-key
- **Scripts:** merge-by-id across 4 positions. `before_footer` renders as raw HTML, not `<script>` wrapped
- **Ads config:** deep merge top-level; `ad_placements` is replacement (last non-empty wins)
- **Ads.txt:** additive append, deduped
- **Script vars:** shallow merge, `{{placeholder}}` resolved; unresolved tokens throw
- **CLS heights (`ad_placeholder_heights`):** org/group level only

## Shared Pages Overrides

- Shared pages (about, contact, privacy, tos...) live in the network repo on main.
- Per-site content overrides via `overrides/<site_id>/<name>.yaml`.
- `seed-kv.ts` resolves overrides at sync time, writes merged bodies into KV.
- **Content overrides, not config overrides** — distinct from `overrides/config/`.

## Site Detail Page — Tab Architecture

`/sites/[domain]` has 3 top-level tabs:

1. **Site Settings** — 5 sub-tabs: Identity, Content Brief, Groups, Overrides, Config
2. **Deployments** — deploy status, staging URL
3. **Content** — article list, status filters

### Article Detail Page (`/sites/[domain]/articles/[slug]`)

Server component reading article markdown from Git. Three panels:
- **Videos** (`ArticleVideosPanel`) — YouTube embeds. `PUT /api/articles/[domain]/[slug]/videos`
- **Scripts** (`ArticleScriptsPanel`) — per-article injection. `PUT /api/articles/[domain]/[slug]/scripts`
- **Editor** (`ArticleEditor`) — markdown with save, image upload, AI image generation

### Video Embeds — End-to-End

Videos stored as `ArticleVideo[]` in article frontmatter, rendered at request time:
- **Content pipeline:** Auto-adds video entry when `content_type === "video"`
- **Dashboard:** `ArticleVideosPanel` for manual management
- **seed-kv:** Extracts `videos` from frontmatter into KV `ArticleIndexEntry`
- **Site worker:** `inject-videos.ts` renders responsive YouTube iframes
- **Shared types:** `ArticleVideo { id, url, position }` in `packages/shared-types/src/article.ts`

## Scheduler

- CloudGrid cron fires hourly (`0 * * * *`, EST) -> `/scheduled-publish`. Most ticks are no-ops.
- Global gate: `scheduler/config.yaml` on main — `{ enabled, run_at_hours: [0-23], timezone }`. Missing = defaults (`enabled: true, run_at_hours: [14], timezone: EST`).
- Per-site: `brief.schedule.articles_per_day` + `brief.schedule.preferred_days`.
- **Run Now** = `/scheduled-publish?force=true` (bypasses global gate only, per-site `preferred_days` still applies).

## Cloudflare Account Migration

Full status: `docs/superpowers/specs/2026-05-17-migration-status-and-remaining-work.md`.

### Two Accounts

| Account | ID | Role |
|---------|----|------|
| **Assets @ AtomicLabs** | `4a8cfd85d617b38ce1813a552132bc86` | Production — all new sites |
| **Dev1 @ AtomicLabs** | `953511f6356ff606d84ac89bba3eff50` | Legacy — 2 sites only (`financenewsbase.com`, `coolnews.dev`) |

### Assets Account Resources

| Resource | ID / Name |
|----------|-----------|
| CONFIG_KV (prod) | `b258e47065274b8b8af1a0b6d6529c1d` |
| CONFIG_KV_STAGING | `f6c35e1fa8c841b8b193509a3a237f7f` |
| R2 bucket | `atl-assets-prod` |
| Staging worker | `https://atomic-site-worker-staging.accounts-4a8.workers.dev` |
| Production worker | `https://atomic-site-worker.accounts-4a8.workers.dev` |

### Workers on Assets Account

| Worker | Purpose | Touch? |
|--------|---------|--------|
| `atl-sites-workers-manager` | Routing layer — owns all Custom Domains, delegates via Service Bindings. Outside this repo. | Manually maintained |
| `atomic-site-worker` | Platform SSR from KV + R2 | This is ours |
| `atomic-site-worker-staging` | Staging preview via `?_atl_site=` | This is ours |
| `atl-query-handler-t` | Handles `?x=1` requests | This is ours |
| `atl-streamed-lander` | WordPress proxy + landing pages | CAREFUL |
| `green-dream-b06f` | Monetization, ads, tracking | DO NOT TOUCH |

### Manager Worker Architecture

`atl-sites-workers-manager` sits in front of all production traffic:

```
                           +-------------------------------------+
                           |   atl-sites-workers-manager         |
   travelswire.com ------> |   Custom Domains (all sites)        |
   wineoceans.com  ------> |                                     |
                           |   Routing:                          |
                           |   1. ?agi=1011  -> ATL_LANDER       |
                           |   2. /atl/*     -> ATL_GREEN        |
                           |   3. MIGRATED_SITES -> ATL_SITES_MAIN|
                           |   4. default    -> fetch() (WP)     |
                           +-------------------------------------+
                              |            |              |
                    ATL_SITES_MAIN    ATL_GREEN      ATL_LANDER
                              |            |              |
                              v            v              v
                    atomic-site-worker  green-dream  atl-streamed-lander
```

**`MIGRATED_SITES` is a hardcoded `Set<string>` in manager code.** Adding a site requires: add to set + redeploy manager. Dashboard's `attachCustomDomain` registers the CF Custom Domain but routing logic needs separate manager update.

**Why:** Blast radius isolation, per-domain rollback, WordPress migration path (non-migrated domains fall through to WP origin).

### Dual-Account Credential Routing

Implemented in:
- `services/dashboard/src/lib/constants.ts` — `DEV1_SITE_IDS`, `isDev1Domain()`, `getKvNamespaces()`
- `services/dashboard/src/lib/cloudflare.ts` — `getCredentials(domain?)` — all CF functions accept optional `domain`
- `atomic-labs-network/.github/workflows/sync-kv.yml` — `DEV1_SITES` conditional

Dev1 legacy sites: `financenewsbase` + `muvizzcom`. Remove after zone transfers.

### WordPress Migration

Two domain attachment paths:

| Type | DNS | CF API | Traffic path |
|------|-----|--------|-------------|
| New platform site | Auto-managed by CF Custom Domain | Registers Custom Domain | Custom Domain -> manager -> ATL_SITES_MAIN |
| WordPress migration | Existing A/CNAME kept | Skipped ("externally managed DNS") | Workers Route -> manager -> ATL_SITES_MAIN |

**WordPress domain attach flow:**
1. Pre-req: Workers Route on zone + hostname in `MIGRATED_SITES`
2. Dashboard calls `attachCustomDomain()`
3. CF Custom Domain registration fails (expected) -> skipped
4. KV seeded, config promoted from staging to prod, `config.domain` patched
5. Site is live via manager routing

Per-domain rollback: remove from `MIGRATED_SITES`, redeploy manager.

### Current Sites

| Site ID | Status | Custom Domain | Routing |
|---------|--------|---------------|---------|
| `travelswire` | Live | `travelswire.com` | Manager Custom Domain |
| `wineoceans` | Live | `wineoceans.com` | Manager via Route (WP migration) |
| `financenewsbase` | Live | `financenewsbase.com` | Dev1 direct |
| `muvizzcom` | Live | `coolnews.dev` | Dev1 direct |
| `chaibeseret` | Staging | -- | Staging worker only |
| `wtpop` | Staging | -- | Staging worker only |

### Migration TODO (priority order)

1. WordPress migration pipeline — 15-task content import plan
2. Batch WordPress migration — ~44 remaining sites
3. Dev1 zone transfers — move `financenewsbase.com` + `coolnews.dev` to Assets
4. Dev1 decommission — remove dual-account code
5. Legacy Routes cleanup

### Article Images in R2

`seed-kv.ts` only uploads from `assets/` folder. Article hero images live only in R2. Moving sites between accounts requires separate R2 bucket copy.

## Full Environment Variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `GITHUB_TOKEN` | dashboard, pipeline | Repo scope. No `pull_requests:write`. |
| `NETWORK_REPO` | pipeline | `atomicfuse/atomic-labs-network` |
| `LOCAL_NETWORK_PATH` | pipeline (dev) | Local checkout path. Enables FS write when no branch passed. |
| `CONTENT_AGENT_URL` | dashboard | `http://content-pipeline-app` in CloudGrid; needs fallback. |
| `CONTENT_AGGREGATOR_URL` | pipeline | **Stale** — check `CONTENT_API_BASE_URL` first. |
| `GEMINI_API_KEY` | pipeline | Image generation. |
| `N8N_IMAGE_WEBHOOK_URL` | pipeline | Async image gen webhook. Optional. |
| `IMAGE_CALLBACK_URL` | pipeline | n8n callback URL override. Default: dashboard proxy. |
| `NETWORK_DATA_PATH` | seed-kv | Network repo checkout path. |
| `R2_BUCKET` | seed-kv | `atl-assets-prod` (single bucket, both envs). |
| `R2_ACCESS_KEY_ID` | dashboard | R2 S3 API. Image uploads + site deletion cleanup. |
| `R2_SECRET_ACCESS_KEY` | dashboard | Paired with above. |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | dashboard | Auth. |
| `GOOGLE_CLIENT_ID/SECRET` | dashboard | Google auth. |
| `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY` | dashboard | Sheets sync. |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard, seed-kv | Assets: `4a8cfd85d617b38ce1813a552132bc86`. Dev1: `953511f6356ff606d84ac89bba3eff50`. |
| `CLOUDFLARE_API_TOKEN` | dashboard, CI | Zone:Read, DNS:Edit, Workers Scripts:Edit, KV Storage:Edit, R2:Edit. |
| `KV_NAMESPACE_ID` | seed-kv | Staging: `f6c35e1fa8c841b8b193509a3a237f7f`. Prod: `b258e47065274b8b8af1a0b6d6529c1d`. Dev1 staging: `4673c82cdd7f41d49e93d938fb1c6848`. Dev1 prod: `a69cb2c59507482ca5e6d114babdd098`. |
| `DEV1_CLOUDFLARE_API_TOKEN` | dashboard | Dev1 account token. Temporary. |
| `DEV1_R2_ACCESS_KEY_ID` | dashboard | Dev1 R2. Temporary. |
| `DEV1_R2_SECRET_ACCESS_KEY` | dashboard | Dev1 R2. Temporary. |
