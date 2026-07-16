# CLAUDE.md

Orientation for Claude Code sessions. Read this before touching code. For full architecture details, see `docs/architecture.md`.

## Rules

- **Never run `cloudgrid plug` without explicit user permission.** Always ask first.
- **Never commit directly to `main`.** Asaf uses `asaf-dev`, Michal uses `michal-dev`.
- **Never `git add -A`** — may include secrets. Stage specific files.
- **Never call `gh pr create`** — token lacks `pull_requests:write`. Print compare URL instead:
  `https://github.com/atomicfuse/atomic-content-platform/compare/main...<dev-branch>`

## Overview

Atomic Content Network Platform — multi-tenant content network for ad-monetized sites. Turborepo/pnpm monorepo with two CloudGrid services plus a multi-tenant Astro Worker (`site-worker`) serving all sites from KV + R2. Production traffic flows through `atl-sites-workers-manager` (routing Worker) which delegates to `atomic-site-worker` via Service Binding.

## Two Repos

| Repo | Contents |
|------|----------|
| **atomic-content-platform** (this) | All code: dashboard, content-pipeline, site-worker, shared-types. Deployed to CloudGrid + Cloudflare Workers. |
| **atomic-labs-network** (data) | Pure data: `dashboard-index.yaml`, `sites/<domain>/`, `overrides/`, `scheduler/config.yaml`. Zero code. |

Both live at `~/Documents/ATL-content-network/`.

## File Ownership

| Concern | Owner |
|---------|-------|
| Org config | Network repo, main, `org.yaml` |
| Group configs | Network repo, main, `groups/<id>.yaml` |
| Config overrides | Network repo, main, `overrides/config/<id>.yaml` |
| Conditional overrides | KV `cond-overrides:<siteId>`, seeded from overrides with `activation` field |
| Site config + articles | Network repo, `staging/<domain>` branch |
| Shared-page overrides | Network repo, main, `overrides/<site_id>/` |
| Scheduler gate | Network repo, main, `scheduler/config.yaml` |
| Site list / status | Network repo, main, `dashboard-index.yaml` |
| Dashboard UI / APIs | This repo, `services/dashboard` |
| Agents + cron | This repo, `services/content-pipeline` |
| Site runtime | This repo, `packages/site-worker` |
| Deploy config | This repo, `cloudgrid.yaml` |
| In-app docs | This repo, `services/dashboard/public/guide/*.md` |

## Layout

```
services/
  dashboard/               Next.js 15 App Router (port 3001)
    src/app/               Routes: groups/, sites/, settings/, overrides/, wizard/, import/, guide/, api/
    src/lib/               github.ts, scheduler.ts, shared-pages.ts, config-normalizers.ts
    src/components/        site-detail/ (SiteConfigTab, ContentAgentTab, ArticleScriptsPanel, ArticleVideosPanel)
    src/actions/           Server actions (wizard, agent, sites)
    public/guide/          Markdown docs (must be in public/ for standalone bundle)
  content-pipeline/        Node HTTP server (port 5000)
    src/agents/            content-generation/, content-quality/, article-regeneration/, scheduled-publisher/, migration/
    src/lib/               github.ts, writer.ts, site-brief.ts, ai.ts, config.ts
    src/index.ts           /health, /content-generate, /scheduled-publish
packages/
  shared-types/            TS interfaces (SiteConfig, SiteBrief, Article, etc.)
  site-worker/             Astro 6 + @astrojs/cloudflare SSR — multi-tenant via hostname -> KV lookup
  migration/               WordPress migration tooling
```

Network repo layout:
```
dashboard-index.yaml       Authoritative site list (source of truth — NOT sites/ on main)
sites/<domain>/            Per-site config + articles (on main only after publish; otherwise staging/<domain>)
overrides/config/<id>.yaml Config overrides with merge modes
overrides/<site_id>/       Shared-page content overrides
scheduler/config.yaml      Global scheduler gate
org.yaml                   Org-wide defaults
groups/<group>.yaml        Group-level overrides
```

## Common Commands

```bash
pnpm install                    # after dep changes
pnpm typecheck                  # all packages
pnpm build
pnpm test

# Per-service typecheck (preferred)
cd services/dashboard && pnpm typecheck
cd services/content-pipeline && pnpm typecheck

# Local dev
cloudgrid dev                   # dashboard :3000, content-pipeline :5000 (via CONTENT_PIPELINE_PORT in .env)

# Site worker
cd packages/site-worker
pnpm dev                        # Vite dev (fast, no workerd)
pnpm dev:worker                 # build + wrangler dev (workerd parity)
pnpm build
pnpm deploy:staging
pnpm deploy:production

# KV seeding
CLOUDFLARE_ACCOUNT_ID=4a8cfd85d617b38ce1813a552132bc86 pnpm seed:kv <siteId> [hostname ...]
# For prod KV: add KV_NAMESPACE_ID=b258e47065274b8b8af1a0b6d6529c1d
# For cross-branch: use git worktree + NETWORK_DATA_PATH=<worktree>

# CloudGrid
cloudgrid plug                  # build + deploy (ask user first!)
cloudgrid secrets set atomic-content-platform KEY=val
cloudgrid env set atomic-content-platform KEY=val
```

## Critical Patterns

### Service Communication — URL Fallback

`http://content-pipeline-app` doesn't resolve on host under `cloudgrid dev`. **Every** dashboard -> pipeline call needs:

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

### Writer Invariant

`content-pipeline/src/lib/writer.ts`: `LOCAL_NETWORK_PATH` set + no branch = local FS write. **Agents wanting git commits must pass a branch.** Scheduler passes `staging/<domain>`.

### Mongo Dual-Write After Git Mutations

The dashboard reads from a **MongoDB read layer** when `USE_MONGO_READS=true` (production): `site_configs`, `dashboard_index`, `articles` collections via `src/lib/db/*`. Mongo is a persistent store, not a TTL cache — any server action that commits to Git WITHOUT mirroring the write to Mongo leaves the UI stale **forever**, not for 15 minutes. Every config-mutating action must follow the dual-write pattern (see `actions/agent.ts:54-64`): `commitSiteFiles(...)` → `upsertSiteConfig(domain, config)` (and/or `updateDashboardIndexEntry`) → `revalidatePath(...)`. The legacy in-memory `treeCacheStore` in `github.ts` (5 min TTL) only matters on the `USE_MONGO_READS=false` Git-read path.

### KV Schema Evolution (3 mandatory steps)

Adding a field to `ResolvedConfig` or any KV-stored type:
1. Runtime default via `??=` in `packages/site-worker/src/lib/config.ts` (`LAYOUT_DEFAULTS` pattern)
2. Seed-time default in `resolveLayout()` / `resolve.ts`
3. Re-seed all live sites before deploying

Skipping this **silently 404s all production sites** (happened 2026-05-20).

### Config Inheritance

```
org.yaml -> groups[0].yaml -> groups[1].yaml -> ... -> overrides/config (by priority) -> site.yaml
```

Resolved at seed-time by `seed-kv.ts`. Key rules:
- **Tracking, theme, legal:** deep merge, later wins per-key
- **Scripts:** merge-by-id across 4 positions; `before_footer` renders as raw HTML (not wrapped in `<script>`)
- **Ads config:** deep merge top-level; `ad_placements` is replacement (last non-empty wins)
- **Ads.txt:** additive append, deduped
- **Script vars:** shallow merge, `{{placeholder}}` resolved; unresolved tokens throw

### Content Aggregator URL

`CONTENT_AGGREGATOR_URL` env is stale (CloudGrid auto-injects wrong value). Always check `CONTENT_API_BASE_URL` first. All fetch calls must append `/api/...` to the base URL.

## Conventions

- TypeScript strict, no `any`, explicit return types, functional React components return `React.ReactElement`.
- Shared types in `packages/shared-types/`.
- YAML extension `.yaml` (never `.yml`).
- Article slugs: kebab-case, e.g. `best-thriller-movies-2026.md`.
- Commit messages: conventional (`feat(scope):`, `fix(scope):`, `docs:`). Always include `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.
- Env parity: defaults must match across `.env`, `config.ts`, and CloudGrid; always add local SDK fallbacks.
- Config normalizers are centralized in `src/lib/config-normalizers.ts` — never duplicate.
- `UnifiedConfigForm` renders in 4 modes: `"org"`, `"group"`, `"override"`, `"site"`. Override mode shows `MergeModeSelector`.
- `/api/sites/site-config` returns `{ config, inheritance: { org, groups[] } }` — not raw config.
- Tabs component is lazy by default; pass `keepMounted` when state must survive switching.
- Heavy components (`SiteConfigTab`, `UnifiedConfigForm`, `ColorPickerField`, `FontPickerField`, etc.) use `next/dynamic` — don't convert to static imports.
- `ScriptsConfig` has local copies in `UnifiedConfigForm.tsx` and `ScriptsEditor.tsx` — adding a script position requires updating both plus `shared-types`.
- In-app guide: user-visible features need a page in `public/guide/`. Register in `GUIDE_PAGES` array in `guide/page.tsx`.

## Git Workflow

- Always run `git branch --show-current` before committing.
- Never touch the other developer's branch.
- After merge to main: `cloudgrid plug` (manual, no auto-deploy).

## Key Environment Variables

| Variable | Used by | Notes |
|----------|---------|-------|
| `GITHUB_TOKEN` | dashboard, pipeline | Repo scope. No `pull_requests:write`. |
| `CONTENT_AGENT_URL` | dashboard | `http://content-pipeline-app` in CloudGrid; needs fallback pattern. |
| `CONTENT_AGGREGATOR_URL` | pipeline | **Stale** — check `CONTENT_API_BASE_URL` first. |
| `LOCAL_NETWORK_PATH` | pipeline (dev) | Enables local-FS write when no branch passed. |
| `NETWORK_DATA_PATH` | seed-kv | Path to network repo checkout. |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard, seed-kv | `4a8cfd85d617b38ce1813a552132bc86` (Assets). Legacy Dev1: `953511f6356ff606d84ac89bba3eff50`. |
| `CLOUDFLARE_API_TOKEN` | dashboard, CI | Scopes: Zone:Read, DNS:Edit, Workers Scripts:Edit, KV Storage:Edit, R2:Edit. |
| `KV_NAMESPACE_ID` | seed-kv | Staging: `f6c35e1fa8c841b8b193509a3a237f7f`. Prod: `b258e47065274b8b8af1a0b6d6529c1d`. |
| `R2_BUCKET` | seed-kv | `atl-assets-prod` (single bucket for both envs). |
| `R2_ACCESS_KEY_ID/SECRET` | dashboard | R2 S3 API. Required for image uploads + site deletion cleanup. |
| `GEMINI_API_KEY` | pipeline | Image generation. |
| `N8N_IMAGE_WEBHOOK_URL` | pipeline | Async image gen. Articles created without images if unset. |

Full env var list in `docs/architecture.md`.

## Known Landmines

1. **Standalone bundle** — runtime `readFile` outside `public/` fails in prod. Guide docs stay in `public/guide/`.
2. **`sites/` on main is incomplete** — only published sites. Use `dashboard-index.yaml`.
3. **Writer fallback** — no branch + `LOCAL_NETWORK_PATH` = disk write, bypassing git.
4. **`CONTENT_AGENT_URL` DNS** — doesn't resolve on host; use fallback pattern.
5. **GITHUB_TOKEN** — no `pull_requests:write`; print compare URL.
6. **Article count + topic rotation** — scheduler uses `articles_per_day` from site-level `brief.schedule` (fallback: `ceil(articles_per_week / preferred_days.length)`). Topics are selected via round-robin (`site_stats.topicRotation.nextIndex` in MongoDB), 1 article per topic per run. Per-topic `schedule` fields in `topics_v2` are deprecated and ignored.
7. **Astro 6 env** — `Astro.locals.runtime.env` removed. Use `import { env } from 'cloudflare:workers'`.
8. **Middleware must run first** — `run_worker_first = true` in `wrangler.toml` required.
9. **Fail closed on unknown hostname** — no default-site fallback (caused real incidents).
10. **Use `wrangler types`** — not `@cloudflare/workers-types`. Re-run after binding changes.
11. **KV/R2 eventually consistent** — ~60s propagation. Articles: `s-maxage=300`, homepage: `s-maxage=60`.
12. **seed-kv fails hard** if `sites/<siteId>/site.yaml` missing. Use `git worktree` for cross-branch.
13. **KV siteId = domain folder name** (e.g. `site-config:scienceworld`), NOT the numeric `site_id`.
14. **Site deletion is two-phase.** Soft delete preserves staging + R2 (restorable). Permanent delete destroys everything.
15. **KV config is a live schema** — new fields without runtime defaults silently 404 all prod sites. See "KV Schema Evolution" above.
16. **Cache invalidation** — `revalidatePath()` does NOT clear in-memory caches. Must call `invalidateSiteCaches()`.
17. **Server Islands need `_atl_site` propagation** — handled automatically by `preview-override.ts`.
18. **gtag.js loads once** — GA4 + Google Ads share it. Don't add a second tag.
19. **Aggregator URL needs `/api`** — base URL doesn't include it. See `getAggregatorApiBase()`.
20. **`CONTENT_AGGREGATOR_URL` is stale** — CloudGrid injects wrong value. Check `CONTENT_API_BASE_URL` first.
21. **n8n image gen is fire-and-forget** — no retry. Callback routes through dashboard proxy.
22. **`WORKER_NAME_PROD` = `atl-sites-workers-manager`** — Custom Domains register on manager, not site-worker.
23. **WordPress domains skip CF registration** — "externally managed DNS" error is caught; KV seeding continues.
24. **`before_footer` = raw HTML** — not wrapped in `<script>` tags. Dashboard uses `RAW_HTML_POSITIONS`.
25. **Conditional overrides need re-seed** — adding/removing `activation` only takes effect after `seed-kv`.
26. **Template `${var}` sanitised** — only `[a-zA-Z0-9_-.:` chars. Special chars stripped.
27. **`ScriptsConfig` has 3 copies** — shared-types, `UnifiedConfigForm.tsx`, `ScriptsEditor.tsx`. Update all three.
28. **Single R2 bucket** — `atl-assets-prod` for both staging and prod. `atl-assets-staging` retired.
29. **Video embeds need both deploy + re-seed** — dashboard writes to Git; site needs worker deploy + KV seed.
30. **Dual-account routing is opt-in** — `cloudflare.ts` functions default to Assets account. Pass `domain` only when targeting a specific site.
31. **Override `ad_placements: []` wipes inherited** — an override with `ad_placements: []` clears all group-level placements via `mergeAdPlacementLayers`. Only include `ads_config` in an override if you intend to change ad behavior. Tracking-only overrides must omit `ads_config` entirely.
32. **Pipeline `.env` overrides cloudgrid-injected env** — content-pipeline loads dotenv with `override: true`, so vars in its local `.env` beat what `cloudgrid dev` injects. cloudgrid runs an embedded Redis on an ephemeral port and injects `REDIS_URL` into both services: keep `REDIS_URL` OUT of the pipeline's `.env`, or the dashboard enqueues to one Redis while the worker listens on another and jobs are never consumed. cloudgrid also injects `PORT=3000` (collides with the dashboard) — `CONTENT_PIPELINE_PORT=5000` in `.env` keeps the pipeline where the dashboard proxy expects it.
