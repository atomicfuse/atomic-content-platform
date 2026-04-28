# Session: Migration Phase 0 baselines + Phase 1 scaffold (site-worker)
**Date:** 2026-04-23 16:30-16:45 UTC
**Type:** Coding (new package) + Investigation (Phase 0 baselines)
**Duration:** ~45 minutes
**Branch:** `docs/astro-workers-migration-plan`
**Jira:** None

## What happened

User answered all 9 open questions from `docs/migration-plan.md` and asked to continue. This session executed Phase 0 (captured the baseline deploy time for coolnews-atl at 52 s and confirmed neither Pages project has custom settings) and Phase 1 (scaffolded `packages/site-worker/` as a new Astro 6.1.9 + @astrojs/cloudflare 13.2.0 Workers app alongside the existing `packages/site-builder`). The new package builds cleanly, passes typecheck with zero errors, and serves HTTP 200 under `wrangler dev` with the workerd runtime. Verified multi-tenant request routing by curling the same endpoint with different `Host` headers — each response correctly echoes the incoming hostname, proving the foundation for Phase 3 middleware.

## Key outcomes

- **Phase 0 artefacts:**
  - `docs/migration-baselines.md` created with the 52 s coolnews-atl deploy datapoint, article-count rough estimate, and pre-cutover Pages project snapshot.
  - Confirmed (via `wrangler pages download config`) that neither `coolnews-atl` nor `scienceworld` has any custom settings (env vars, redirects, `_headers`, Pages Functions, KV bindings). Removes an entire category of migration risk.
  - `docs/future-decisions.md` opens four deferred-decision records: ad-SDK loading strategy, Pagefind replacement, theme-extraction fallback, article-storage scale trigger.
- **Phase 1 artefacts:**
  - New workspace package `@atomic-platform/site-worker` with 8 source files (`package.json`, `astro.config.mjs`, `wrangler.toml`, `tsconfig.json`, `src/env.d.ts`, `src/pages/index.astro`, `.gitignore`, `README.md`).
  - `.claude/launch.json` (repo root) gains a `site-worker` preview config on port 8788.
  - `CLAUDE.md` Tech Stack + Layout + Commands updated to describe both packages during the migration.
- **Plan updated:** `docs/migration-plan.md` gains a "Resolved open questions" section + the theme-extraction decision + a live decision log for this session.
- **Two clean commits on `docs/astro-workers-migration-plan`:** `1177af1` (docs) and `9d96832` (scaffold).

## Decisions made

- **Defer the theme-extraction refactor to Phase 2.** Phase 1 scaffold deliberately has no theme code; Phase 2 will extract `themes/modern/` + shared layouts into `packages/site-theme-modern` consumed by both apps. Fallback: duplicate if Astro 5/6 incompatibility surfaces (logged in `future-decisions.md`).
- **Phase 1 placeholder renders the `Host` header.** Costs nothing, proves workerd pass-through today, shapes the Phase 3 middleware contract.
- **`wrangler.toml` omits KV bindings at Phase 1.** Phase 3 adds them once real namespaces exist. Avoids `wrangler dev` failing against stub namespace IDs.
- **`deploy:staging` script includes an `astro build` step** because `@astrojs/cloudflare` v13 emits the authoritative wrangler config into `dist/server/wrangler.json` at build time — deploys must run against that generated file.
- **Not upgrading wrangler mid-phase.** CLI 4.77.0 serves fine; the 4.84.1 warning is cosmetic (requested `compatibility_date` 2026-04-23 vs CLI's 2026-03-17 upper bound). Scheduled as a follow-up.

## Backlog items added

- Upgrade `wrangler` CLI from 4.77.0 → 4.84.1 when convenient (removes a warning; not blocking).
- Configure Astro `site:` option in `site-worker` astro.config.mjs once a canonical URL exists per site (resolves the "Sitemap integration requires site" warning at build).
- Pagefind replacement strategy — not urgent until search is needed; tracked in `future-decisions.md`.
- Theme-extraction-fallback trigger (duplicate `themes/modern/` into `site-worker/src/themes/` if Phase 2 extraction fails).

## Backlog items resolved

- **Q1 baseline** partially resolved: 52 s for coolnews-atl captured. Scienceworld pending user next-build.
- **Q3 Pages project config** resolved — downloaded via `wrangler pages download config` and confirmed no custom settings in either project.
- **Astro 6 version drift** in `CLAUDE.md:264` (claimed Astro 6, actual 5.7) — resolved by re-phrasing the CLAUDE.md Tech Stack section to describe both `site-builder` (5.7, legacy) and `site-worker` (6.1, migration target).

## Post-deploy verification needed

**None for this session.** Phase 1 scaffold is local-only; no Cloudflare resources created, no DNS touched, no production traffic affected. Full verification already happened locally (build + typecheck + wrangler dev + curl parity).

**For later phases:** Phase 3 (KV + middleware) will need post-deploy checks against the staging Worker (KV reads resolve correctly, fail-closed 404 behaviour works, multi-hostname routing stable under load).

## Learning notes

The Astro 6 + `@astrojs/cloudflare` v13 build pipeline has a subtle gotcha worth remembering for anyone touching this package: `wrangler.toml` at the package root cannot specify a `main` field because the adapter doesn't emit the Worker entrypoint until `astro build` runs. If `main` points to a non-existent file, `@cloudflare/vite-plugin` (which the adapter uses internally) fails at config-resolution time before any build happens. The fix is to leave `main` unset in the user wrangler.toml and let the adapter write its own wrangler.json into `dist/server/` at build time with the correct `main = "entry.mjs"`. Deploy commands then point at the generated config: `wrangler deploy --config dist/server/wrangler.json`.

The adapter also auto-wires a `SESSION` KV binding for Astro Sessions, visible in the local bindings table when `wrangler dev` attaches. We don't use Astro Sessions today, but the binding is inert — no KV namespace ID is required for local mode, and in production it can be left empty or pointed at an unused namespace. Something to remember when Phase 3 adds our own `CONFIG_KV` bindings: don't accidentally overwrite the auto-bound `SESSION` name.

Finally, the pattern of "render the request's Host header as a placeholder page" turns out to be a surprisingly load-bearing choice for this migration. Astro's `Astro.request.headers.get('host')` proves on day one that the Worker can discriminate requests by hostname — the single most important property for Phase 3 middleware. A hard-coded "Hello World" would have deferred that validation until actual KV lookups got wired. One extra line of code, one extra curl pair, and the multi-tenant model is already demonstrable.

## Related records

- Audit log: `docs/audit-logs/2026-04-23-1630-migration-phase-0-and-1-scaffold.md`
- Baselines: `docs/migration-baselines.md`
- Future decisions: `docs/future-decisions.md`
- Plan (updated): `docs/migration-plan.md` → "Resolved open questions" + "Decision log" sections
- Audit (unchanged): `docs/migration-audit.md`
- Gap analysis (unchanged): `docs/migration-gap-analysis.md`
- Backlog: `docs/backlog/general.md` (updated — see changes in this commit)
- Commits on `docs/astro-workers-migration-plan`:
  - `1177af1` — docs(migration): freeze Phase-4 Q&A answers, Phase-0 baselines, future-decisions hooks
  - `9d96832` — feat(site-worker): scaffold Astro 6 + Cloudflare Workers app (migration Phase 1)
  - (pending this commit) chore(claude-md,backlog): reflect site-worker scaffold in docs
