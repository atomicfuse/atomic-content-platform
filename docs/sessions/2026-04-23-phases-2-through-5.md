# Session: Migration Phases 2, 3, 4, 5 + runbooks for 6-8
**Date:** 2026-04-23 16:45–17:30 UTC
**Type:** Coding + CI + DevOps
**Duration:** ~75 minutes
**Branch (platform):** `docs/astro-workers-migration-plan`
**Branch (network repo):** `feat/sync-kv-workflow` (new)
**Jira:** None

## What happened

User said "do all phases one by one. no need to ask for permissions. GO". Executed Phases 2 through 5 of the Pages→Workers migration end-to-end: ported the modern theme and article routes into `site-worker`, introduced KV + middleware for multi-tenant hostname resolution, replaced baked ad/pixel markup with Astro Server Islands, and added a GitHub→KV sync CI workflow to the network repo on a feature branch. Phases 6, 7, 8 documented as concrete runbooks because they involve DNS cutover and production decommission — steps that the code is ready for but a human needs to time.

Along the way: resolved three non-obvious Astro 6 + `@astrojs/cloudflare` v13 gotchas live via `wrangler tail` (removed `Astro.locals.runtime.env` → use `cloudflare:workers` import; `run_worker_first` required so middleware runs on SSR routes; `wrangler types` replaces `@cloudflare/workers-types`). Deployed a staging Worker at `atomic-site-worker-staging-staging.dev1-953.workers.dev` on the Dev1 account. Created `CONFIG_KV_STAGING` + `CONFIG_KV` namespaces. Seeded staging KV with coolnews-atl (19 articles, 4 hostnames). Verified Server Islands correctly emit GA4 pixel code from KV config on every request — the proof that monetization/tracking changes no longer require rebuilds.

## Key outcomes

- Four new commits on the platform branch (Phase 2 port, Phase 3 KV+middleware, Phase 4 Server Islands, housekeeping), one on the network repo branch (Phase 5 CI workflow).
- `packages/site-worker/` is now a fully functional multi-tenant Astro 6 SSR Worker reading config + articles from KV.
- Three runbooks for Phases 6-8 documenting the manual cutover and decommission steps with exact commands + rollback procedures.
- Two Cloudflare KV namespaces created and one Worker deployed on Dev1 (no production traffic).

## Decisions made

- Duplicated theme into site-worker rather than extracting to a shared package (see audit log Decision 1).
- `run_worker_first = true` on CF Assets binding so middleware runs on every request.
- Markdown → HTML at seed time (not runtime) to keep the Worker bundle small and boot fast.
- `@cloudflare/workers-types` dropped from tsconfig; use `wrangler types`-generated `worker-configuration.d.ts` instead.
- Phase 5 workflow committed on a feature branch, not directly to network-repo main, so CI doesn't start failing until the user merges + sets secrets.

## Backlog items added

- Integration tests for the Worker request path (middleware → KV read → island render). Smoke-level tests using `wrangler dev --remote` + curl.
- Remove `@cloudflare/workers-types` from `site-worker/package.json` devDependencies (already dropped from tsconfig types[], but still installed).
- Populate `ad_placements` in `org.yaml` / `groups/*.yaml` so AdSlot emits real mock ads during visual QA (currently empty — islands render but produce no slot markup).
- Add a compact `yaml-to-kv` mapper that handles the 5-layer inheritance resolve (today's seed-kv.ts does only 2-layer org+site merge — fine for Phase 3 demo, needs the full resolver for production fidelity in Phase 6/7).
- Consider moving the seed-kv.ts resolver into a shared `@atomic-platform/kv-sync` package so both the manual seed path and the CI workflow share one implementation.
- Network-repo `.gitignore` was absent before this session — review whether further entries belong (e.g. `*.log`).

## Backlog items resolved

- Phase 0 baselines partially resolved (`coolnews-atl` deploy = 52 s; `scienceworld` still pending user action).
- Phase 3 gotchas now visible in commit messages + audit log → operators will not re-hit them.

## Post-deploy verification needed

- **Phase 5 workflow E2E:** after user merges to main and sets the 5 required secrets, first commit to a `sites/*/*.yaml` should trigger the workflow; verify `sync-status:<siteId>.ok = true` in KV, `syncedAt` matches `committedAt ± CI duration`.
- **Phase 6 pilot:** executed per `docs/runbooks/phase-6-dns-cutover-pilot.md` when scheduled.
- **Phase 7 live:** executed per `docs/runbooks/phase-7-dns-cutover-coolnews-atl.md` once Phase 6 stable.

## Learning notes

The hardest part of this session was a 5-minute period between "Worker deployed" and "Worker actually serves content". Three different layers had to cooperate:

1. **Cloudflare Assets layer** stood between the request and the Worker when serving paths without a matching static file. Default behaviour is "no asset → 404 from CF's side, Worker never runs". Fix: `run_worker_first = true` in the assets binding. Without this, the SSR Worker might as well not exist for routes like `/`.

2. **Astro 6 runtime environment access changed.** v5 used `Astro.locals.runtime.env`; v6 removed it in favour of `import { env } from 'cloudflare:workers'`. The error message when you hit this is literal and helpful, but the migration guide is easy to miss because most of Astro 6's surface is backward-compatible. `wrangler tail` surfaces the exception within seconds of a curl — that's the fastest debug loop for deployed Workers.

3. **Type system for the env binding** moved from `@cloudflare/workers-types` to `wrangler types`. The latter generates a `worker-configuration.d.ts` that reflects the ACTUAL bindings from your wrangler.toml. Adding that file to tsconfig.json `include[]` and dropping the old types[] entry is the current idiom. The old `@cloudflare/workers-types` still works, but starts lying the moment you add a binding that isn't in its static interface.

The Server Island payoff was worth the setup: a direct curl of `/_server-islands/PixelLoader?e=...` returns the GA4 script with the live tracking ID from KV. Changing that KV value would change the next response — no rebuild, no cache purge, no deploy. This is exactly the property the migration plan promised, and it's now demonstrable on a real, deployed Worker.

Finally, the plan's insistence on "side-by-side, both apps exist during migration" paid off immediately. Every change this session was additive; the legacy `site-builder` is untouched, the legacy Pages projects are unchanged, the two live URLs (`coolnews.dev`, `scienceworld-124.pages.dev`) serve exactly the same content they did yesterday. Every commit on this branch is revertable without ANY production impact. That's the property that lets us go fast.

## Related records

- Audit log: `docs/audit-logs/2026-04-23-1645-migration-phases-2-through-5.md`
- Planning docs (from earlier sessions): `docs/migration-audit.md`, `docs/migration-gap-analysis.md`, `docs/migration-plan.md`, `docs/migration-baselines.md`, `docs/future-decisions.md`
- Runbooks: `docs/runbooks/phase-6-dns-cutover-pilot.md`, `phase-7-dns-cutover-coolnews-atl.md`, `phase-8-decommission.md`
- Backlog: `docs/backlog/general.md` (updates in this commit)
- Platform commits: `f4d4846` (Phase 2), `<Phase 3>`, `2658b01` (Phase 4), `<housekeeping>` (this commit)
- Network-repo commit: `2429148` on `feat/sync-kv-workflow`
