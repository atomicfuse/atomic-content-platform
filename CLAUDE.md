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
      shared-pages/          Shared page editor + per-site overrides
      review/                Article review queue
      trash/                 Deleted sites
      scheduler/             Scheduler Agent UI (enable toggle, run_at_hours, Run Now)
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
  site-builder/              Astro 6 static site generator (themes, components, config resolver)
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
overrides/                   Shared-page per-site overrides (by site_id)
scheduler/config.yaml        Global scheduler gate: { enabled, run_at_hours, timezone }
org.yaml / network.yaml      Org- and network-wide defaults (merged with group.yaml → site.yaml)
groups/<group>.yaml          Group-level defaults
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

## Shared Pages Overrides

- Shared pages (about, contact, privacy, tos…) live in the network repo.
- Sites can override content per-site via `overrides/<site_id>/<name>.yaml` (written from dashboard `/shared-pages`).
- Per-site overrides are on `main` of the network repo; the site-builder resolves overrides at build time.

## Site Detail Page — Unified Tab Architecture

The site detail page (`/sites/[domain]`) has 4 top-level tabs:

1. **Staging & Preview** — deploy status, staging URL, build trigger
2. **Content** — article list, status filters
3. **Site Identity** — 4 sub-tabs:
   - **Identity** — site name, tagline, audience, tone
   - **Content Brief** — topics, schedule (`articles_per_day`, `preferred_days`), content guidelines, inline Generate Articles section, quality threshold + criteria sliders
   - **Groups** — assign/remove groups, view active overrides with source badges, links to group pages
   - **Config** — `SiteConfigTab` renders `UnifiedConfigForm` (same component used on Org/Group pages); shows inheritance badges ("From org", "From group: X")
4. **Email** — email routing config

Each sub-tab has its own independent Save button. The Config sub-tab fetches from `/api/sites/site-config` which returns the full inheritance chain (`{ config, inheritance: { org, groups[] } }`).

### Config inheritance model

```
org.yaml → groups[0].yaml → groups[1].yaml → … → site.yaml
```

Sites can belong to multiple groups (`groups: [id1, id2, ...]`). Groups merge left-to-right. Config fields display badges indicating their source (org, group, or local override). Normalizer functions in `src/lib/config-normalizers.ts` are shared between the group page and `SiteConfigTab`.

## Tech Stack

- **Monorepo:** Turborepo + pnpm. Package names: `@atomic-platform/<name>`.
- **Dashboard:** Next.js 15 (App Router), React 19, next-themes, NextAuth.
- **Site builder:** Astro 6 (static output).
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

# Site builder (for debugging static output)
cd packages/site-builder
SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network pnpm dev
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

## Conventions

- TypeScript strict, no `any`, explicit return types, functional React components return `React.ReactElement`.
- Shared types in `packages/shared-types/`.
- YAML extension `.yaml` (never `.yml`).
- Article slugs: kebab-case, e.g. `best-thriller-movies-2026.md`.
- Config inheritance: `org.yaml → group[0].yaml → group[1].yaml → … → site.yaml` (deep merge, multi-group). Sites list groups in `groups: []` array; legacy `group` string field still supported.
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
10. **Site page tabs restructured** — old tab names (Tracking, Scripts & Vars, Ads Config, Content Agent, Quality) no longer exist as separate tabs. Config is unified under Site Identity → Config; generation and quality are in Site Identity → Content Brief.

## Quick Reference — File Ownership

| Concern | Owner |
|---------|-------|
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


## Content Agent v2 — Dual-Model Generation (append to existing CLAUDE.md)

> Added 2026-04-19. Restructure of content-generation and article-regeneration agents.

### What Changed

The content-pipeline agents now consume the **Content Aggregator v2 API** instead of scraping original article URLs. The old flow (`read URL → fallback to title+description → Claude`) is replaced by a summary-based dual-model pipeline.

**Old flow (removed):**
```
RSS item URL → try scrape full text → success: generate from text / fail: generate from title+description → Claude
```

**New flow:**
```
Content Aggregator API (enriched items with summary, taxonomy, thumbnail)
  → Router: isFactual? → NEWS: Claude Sonnet (via @cloudgrid-io/ai) / GENERAL: OpenAI GPT-4o-mini
  → Image Pipeline: analyze source thumbnail → generate original image (DALL-E 3)
  → SEO: meta tags, schema.org, slug, reading time
  → Output: ArticlePackage
```

### Why Two Models

- **News/factual** (vertical: News/Politics/Finance, tags matching `factual_tags` from settings) → Claude Sonnet via CloudGrid AI. Accuracy and factual fidelity are critical. No hallucinated facts.
- **General/evergreen** (how-tos, listicles, opinions) → OpenAI GPT-4o-mini. 10-20x cheaper, fast, creative enough for non-news content.
- The Content Aggregator's `GET /api/settings` provides `classification.factual_tags: ["news", "announcement", "breaking"]` — used by the router.

### Content Aggregator v2 API

- **Base URL env**: `CONTENT_AGGREGATOR_URL` (defaults to `https://content-aggregator-cloudgrid.apps.cloudgrid.io`)
  - Also available as: `CONTENT_API_BASE_URL=https://content-aggregator-cloudgrid.atomic.cloudgrid.io/api`
- **Primary endpoint**: `GET /api/content?enriched=true&status=active&content_type=article`
- `enriched` defaults to `true` — "golden plate" philosophy, items arrive ready-to-use
- **Key fields per item**: `id`, `url`, `title`, `description`, `summary` (structured brief: "What happened… Why it matters… Content opportunity…"), `thumbnail.url`, `content_type`, `vertical.name`, `categories[].name`, `tags[].name`, `audience_types[].name`, `source.name`, `published_at`, `language`
- **Settings**: `GET /api/settings` → `classification.factual_tags`, `enrichment.batch_size`, etc.

### File Structure (under `services/content-pipeline/src/agents/`)

```
content-generation/
  index.ts                  — orchestrator (fetch → route → generate → image → SEO → output)
  router.ts                 — isFactual() classifier using vertical, tags, settings
  api-client.ts             — Content Aggregator v2 typed HTTP client
  types.ts                  — ContentItem, GeneratedArticle, ArticlePackage, SEOMetadata, etc.
  generators/
    base-generator.ts       — shared Generator interface & prompt context builder
    claude-generator.ts     — news/factual via @cloudgrid-io/ai (model: claude-sonnet)
    openai-generator.ts     — general/evergreen via openai SDK (model: gpt-4o-mini)
  prompts/
    news-article.ts         — Claude prompt: journalist tone, factual, no invented facts
    general-article.ts      — OpenAI prompt: engagement + SEO, conversational, TL;DR
    seo-metadata.ts         — meta title/description generation prompt
  image-pipeline/
    analyzer.ts             — vision model extracts style/mood/palette from source thumbnail
    generator.ts            — DALL-E 3 generates ORIGINAL image (never copies source — copyright)
    types.ts                — ImageAnalysis, ImageGenerationResult
  seo/
    metadata-generator.ts   — meta title, description, schema.org JSON-LD, OG tags, reading time
    slug-generator.ts       — title → URL-safe slug

article-regeneration/
  index.ts                  — updated to use new generator pipeline
```

### Image Pipeline — Copyright Rules (HARD REQUIREMENT)

1. **NEVER** use the source thumbnail directly in generated articles
2. Analyze thumbnail with vision model → extract subject, palette, composition, mood
3. Use analysis ONLY AS INSPIRATION for a DALL-E 3 prompt
4. Generate a completely new, original image
5. Always generate alt text for accessibility + SEO

### Additional Environment Variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `OPENAI_API_KEY` | content-pipeline | For GPT-4o-mini (general articles) + DALL-E 3 (images). In CloudGrid secrets. |
| `CONTENT_API_BASE_URL` | content-pipeline | Content Aggregator v2 endpoint. Set via `cloudgrid env set`. |

### Error Handling Strategy

- API fetch fails → retry 3x with exponential backoff, skip batch
- Claude fails → fallback to OpenAI for that item (log the fallback)
- OpenAI fails → fallback to Claude via CloudGrid AI (log the fallback)
- Image gen fails → use placeholder, don't block article
- SEO gen fails → generate basic metadata algorithmically (no AI)

### Router Logic

```typescript
function isFactual(item: ContentItem, settings: AggregatorSettings): boolean {
  const factualVerticals = ['News', 'Politics', 'Finance', 'World News'];
  if (factualVerticals.includes(item.vertical?.name)) return true;
  const factualTags = settings.classification.factual_tags;
  if (item.tags.some(t => factualTags.includes(t.name.toLowerCase()))) return true;
  return false;
}
// factual → Claude Sonnet (via @cloudgrid-io/ai), general → OpenAI GPT-4o-mini
```