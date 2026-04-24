# Gap Analysis — Current → Target (Astro 6 + Cloudflare Workers + KV)

**Date:** 2026-04-23
**Target spec:** `docs/plans/content-network-guide.md` (canonical — read it before this doc).
**Current state:** `docs/migration-audit.md` (read that first if unfamiliar with today's setup).
**Legend:** ✅ = exists and compatible · ⚠️ = exists but needs modification · ❌ = doesn't exist, must be built.

---

## Component scorecard

| # | Target component | Status | Evidence (current) |
|---|---|---|---|
| 1 | Astro 6 | ❌ | `packages/site-builder/package.json:21` → `"astro": "^5.7.0"` |
| 2 | `@astrojs/cloudflare` v13+ adapter | ❌ | Not in `package.json` dependencies; `astro.config.mjs:30-52` has no `adapter:` key |
| 3 | Deployment target: Cloudflare **Workers** | ❌ | Today is Cloudflare **Pages** via `wrangler pages deploy` (`.github/workflows/deploy.yml:222`) |
| 4 | `wrangler.toml` / `wrangler.jsonc` committed to repo | ❌ | `find ... -name "wrangler*"` → no matches; Pages projects configured in CF dashboard |
| 5 | Astro output mode `server` or `hybrid` (with `prerender` toggles) | ❌ | Current default = static; no `output:` set |
| 6 | Hostname-based middleware (site resolution at runtime) | ❌ | `astro.config.mjs:11` uses env var `SITE_DOMAIN` baked in at build time |
| 7 | Cloudflare KV namespace(s) for per-site config | ❌ | Configs are YAML files in the network repo, read by `scripts/resolve-config.ts` at build |
| 8 | Astro Server Islands (`server:defer`) for ads / pixels | ❌ | Ads rendered by vanilla JS `public/ad-loader.js` client-side; tracking inlined via `InlineTracking.astro` at build |
| 9 | Template router (picks layout from config) | ❌ | Only one theme `modern/`; `BaseLayout.astro:19` imports it directly |
| 10 | Per-page-type monetization (article / category / homepage) | ⚠️ | Build-time anchors exist per page (`data-slot="homepage-top|homepage-mid|sticky-bottom"` in `index.astro`), but the **layout choice** is baked in; config is flat across page types |
| 11 | GitHub-based config source of truth | ✅ | `atomic-labs-network/` already exists as the authoritative data repo (`dashboard-index.yaml`, `sites/<site>/`, `overrides/`, `groups/`, `org.yaml`) |
| 12 | Config schema split into `site.json` / `template.json` / `monetization.json` / `pixels.json` | ⚠️ | Current schema is consolidated YAML (`site.yaml` + `org.yaml` + `groups/` + `overrides/config/`). Same semantic surface; needs either (a) a JSON-file split to match the target spec or (b) a schema mapper that projects the existing YAML into target keys when syncing to KV. **Recommend option (b) — preserves dashboard-writing contract.** |
| 13 | CI sync script: GitHub → KV (idempotent, rollback-safe) | ❌ | `deploy.yml` today **builds+deploys**; there is no KV-writer. A new workflow (or modified job) must `wrangler kv bulk put` on merge |
| 14 | Cache purge strategy on config changes | ⚠️ | Today the rebuild IS the purge (new Pages deployment). Under Workers, config changes that alter HTML shells (e.g. template switch) need an **explicit** `purge_cache` call, whereas server-island-only changes (e.g. ad layout) don't |
| 15 | Local dev on workerd runtime with KV emulation | ❌ | `pnpm dev` currently runs `astro dev` (Vite) — no Workers parity |
| 16 | Preview / staging KV namespace | ❌ | No KV exists yet. Target needs at least two: `CONFIG_KV` (production) + `CONFIG_KV_STAGING` (or use bindings per env) |
| 17 | Content storage strategy | ❓ | **Open question.** Articles are markdown in the network repo today. Target plan says "on-demand rendering" but is agnostic about source (D1 / R2 / markdown / CMS). See Open Q #2 in `migration-plan.md`. |
| 18 | `.build-trigger` manual force-rebuild mechanism | ⚠️ | Exists as a file-touch (`sites/<site>/.build-trigger` — see `coolnews-atl/.build-trigger`). Under Workers the equivalent is a purge call; the dashboard's "force rebuild" button must be re-wired |
| 19 | Pagefind search | ⚠️ | Current `package.json:11` runs `pagefind --site dist` after every build. With on-demand article rendering, the corpus isn't a static dir anymore; either (a) run pagefind over a periodic snapshot, (b) switch to Cloudflare D1-backed search, or (c) defer search to later |
| 20 | ads.txt generation & per-site symlinked assets | ⚠️ | Today both are resolved by `scripts/build-site.ts:188-221`. Under Workers, `ads.txt` becomes an edge-served route (`/ads.txt`) that reads from KV; assets served from R2 or Pages static bucket |
| 21 | Shared legal pages with per-site overrides | ⚠️ | Today injected into `src/pages/` at build (`injectSharedPages` in `build-site.ts:223-233`). Under Workers, these become real routes (`/about`, `/privacy`, ...) rendering from KV content overrides |
| 22 | Dashboard writes configs to GitHub | ✅ | `services/dashboard/src/lib/github.ts` already commits to the network repo. **No change for migration** — dashboard-side contract is preserved |
| 23 | Content pipeline writes articles to GitHub | ✅ | `services/content-pipeline/src/lib/github.ts` commits to `staging/<domain>`. **No change for migration** if articles stay in markdown-in-repo |
| 24 | Dashboard-index as site enumeration source | ✅ | `dashboard-index.yaml` already has `pages_project`, `zone_id`, `custom_domain`, `staging_branch`. Needs one new field (`worker_binding` or similar) post-migration |
| 25 | CLS-safe ad placeholders | ✅ | `org.yaml:37-42` already defines `ad_placeholder_heights` per slot; portable to Server Island skeletons |
| 26 | Dismissible sticky-ad behaviour | ✅ | `sessionStorage._atl_sticky_dismissed` logic lives in `public/ad-loader.js`; the loader is portable to a Server Island pattern |
| 27 | Observability — build/deploy metrics | ❌ | No instrumentation today. Plan Phase 0 should capture baselines (build time per site, total bytes deployed per change) before cutover |
| 28 | Rollback strategy | ⚠️ | Today: promote an older Pages deployment via dashboard. Under Workers: need `wrangler rollback` + KV snapshot/restore. Both doable; needs runbook |

---

## Interpretation

### What's already in great shape — leverage as-is
- **Config source of truth (#11, #22, #23, #24).** The dashboard and content-pipeline already write everything to the network repo. The migration does not need to change a single dashboard API or pipeline endpoint — it only changes what happens *downstream* of a merge to network `main`.
- **Inheritance model (#11, partially #12).** The 5-layer resolve logic in `scripts/resolve-config.ts` is sound; the KV writer in the new CI should run the same resolver and emit the **resolved** per-site config as a single KV value rather than layered YAML. This preserves the dashboard UX (edit at any layer) while giving the Worker a flat, zero-cost read.
- **Ad placeholder heights (#25).** Reusable directly as CSS for Server Island skeletons.
- **Ad dismiss behaviour (#26).** Portable verbatim.

### What's drift, not a gap — fix in passing
- **Astro 5.7 vs docs claim of Astro 6 (#1).** Fix by actually upgrading to 6 and updating `CLAUDE.md:264`.
- **Tech-stack line in `CLAUDE.md`** will also need "Cloudflare Pages" → "Cloudflare Workers" once we're post-cutover.

### What requires real engineering — the migration proper
Grouped by cost / risk, highest first:

1. **Runtime site resolution from hostname (#3, #4, #5, #6, #15).** This is the central change. One Worker, one `wrangler.toml`, one `astro.config.mjs` with `@astrojs/cloudflare` + `output: "server"` + prerender routes, one `middleware.ts` that looks up `context.url.hostname → site:<hostname> → siteId`.
2. **KV wiring (#7, #16).** Two namespaces (prod + staging), bound to the Worker. Key schema to define: `site:<hostname>`, `site-config:<siteId>` (single resolved object, or split), `site-articles-index:<siteId>` if we keep article lists in KV.
3. **Server Islands for ads + pixels (#8).** Replace `window.__ATL_CONFIG__` injection with Astro components marked `server:defer` that read from KV per request. Keep the existing ad-loader.js vanilla logic inside the island's rendered HTML so the ad-tech behaviour (SDK loaders, sticky dismissal, mock-ad-fill) doesn't regress.
4. **Template router (#9).** Trivial once there is more than one theme, but today there is only `modern/`. Router is scaffolded as a lookup-map; the actual "choose magazine vs editorial vs longform" only pays off when a second template variant exists. **Don't over-build this up front.**
5. **Per-page-type monetization schema (#10, #12).** Today's `ads_config.ad_placements` is a flat list. The target schema (`monetization.layouts.article/category/homepage`) requires restructuring. **Recommend keeping current YAML schema in GitHub and doing the split-by-page-type in the KV writer** — one mapping function, one source of truth, one writer to debug.
6. **GitHub → KV sync CI (#13).** New workflow (or refactor of `deploy.yml`) that runs `resolve-config.ts` per affected site and calls `wrangler kv bulk put` against the right namespace. Idempotency: use deterministic keys + overwrite. Rollback: keep the previous value in a `site-config-prev:<siteId>` key so a manual `wrangler kv put` from prev to current is one command.
7. **Cache purge (#14).** Only needed when the HTML *shell* changes (template switch, new page type). Monetization-only changes hit server islands → no purge. Codify this in the CI by classifying each changed file.
8. **Content source decision (#17, #19, #20, #21).** Open question — see `migration-plan.md` Open Q #2. Cascades into pagefind, ads.txt, shared-legal-pages implementations.

---

## Risk register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Astro 5 → 6 breaking changes (content collections API, config, adapter peer deps) | High | Upgrade as its own PR before the adapter swap; run full typecheck + sample build |
| Dashboard UX silently breaks because the KV schema diverges from what the dashboard writes | High | Schema **mapper lives in CI only**; dashboard keeps writing the same YAML. KV writer is the single translation layer |
| DNS cutover mistakes during pilot (wrong hostname → wrong site) | High | Middleware must fail closed — if `site:<hostname>` returns null, return 404, never fall through to a default site |
| Ad revenue dip during cutover because server-island behaviour differs from current ad-loader | Medium | Keep both rendering paths available behind a KV flag (`ad_renderer: "legacy" | "server-island"`) during pilot; flip per site |
| KV eventual consistency (up to ~60s global propagation) confuses testing after config edits | Medium | Staging KV namespace + documented "wait 60s after CI" in runbook |
| CI sync script fails halfway and leaves KV inconsistent with GitHub | Medium | Each site's sync is idempotent + independent; failures retry per site, not per run. Add a `sync-status:<siteId>` key with `{ gitSha, timestamp, ok }` |
| Pagefind search breaks when articles leave the static dist | Low | Defer: keep pagefind running in Phase 1 (pilot site still has static article content snapshotted); solve search properly in a later phase |
| The two existing Pages projects need to keep serving during migration | Low | Phased cutover by DNS — old Pages stays live until new Worker is verified (see `migration-plan.md` Phase 6) |

---

## What this gap analysis does NOT cover
- Detailed KV key schema — belongs in the Phase 3 implementation plan once content-storage decision is made.
- Pricing / quota comparison (Workers Paid vs Pages usage today) — the user hasn't raised cost as a concern; noted as Open Q #4.
- Analytics migration (GA4 / GTM continuity across cutover) — the target-architecture doc assumes pixels-as-KV-data; preserving historical sessions across domain changes is beyond scope.

Proceed to `migration-plan.md` for the phased, reversible migration plan and the full list of open questions.
