# Session: Migration audit + plan — Cloudflare Pages → Astro 6 + Workers + KV
**Date:** 2026-04-23 15:30 UTC
**Type:** Investigation + Planning
**Duration:** ~2 hours
**Jira:** None

## What happened

User asked for an audit + phased plan for migrating from per-site Cloudflare Pages builds to a single Astro 6 + Cloudflare Workers + KV architecture, so that config/article changes don't trigger full-site rebuilds. Ground rules: no code changes, evidence-backed citations, 2-question cap on clarifications, deliverables committed to a new branch. Produced three deliverables — `docs/migration-audit.md` (current state), `docs/migration-gap-analysis.md` (component-by-component gap scorecard), `docs/migration-plan.md` (9-phase reversible plan + 9 open questions).

## Key outcomes

- Confirmed current architecture: single shared Astro 5.7 static generator builds each of two Pages projects (`coolnews-atl`, `scienceworld`) per commit-triggered matrix job; no wrangler.toml, no adapter, no KV.
- Identified the real bottleneck: org/group-level edits in `org.yaml` / `groups/*.yaml` fan out to rebuild every affected site because the ad config is **baked into HTML** via `window.__ATL_CONFIG__` at build time (`BaseLayout.astro:80-85`).
- Scored 28 target components ✅/⚠️/❌ — strong foundation (GitHub source of truth, inheritance resolver, dashboard contract) but the runtime multi-tenancy + KV + Server Islands + Astro 6 adapter are net-new.
- Recommended pilot: `scienceworld` (Staging — zero traffic risk), second: `coolnews-atl` (Live with `coolnews.dev`).
- Surfaced 9 open questions (baseline numbers, content storage choice, Pages project custom settings, CF account ownership, staging story, SEO continuity, pilot choice, force-rebuild button UX, ad-network SDK placement).

## Decisions made

- **Deliverables go in `atomic-content-platform/docs/`** (not network repo) because the migration is a code change and the audit-trail scaffolding is already here.
- **Commit on a dedicated branch** (`docs/astro-workers-migration-plan` or similar) — `michal-dev` has in-flight niche-targeting work; don't mix.
- **Evidence-first documentation style** — every claim in the audit has a file path or file:line citation, enabling independent verification.
- **Schema translation lives only in the CI sync writer, not in the dashboard** — preserves the dashboard-writing contract; single point of YAML-vs-KV drift.
- **Pilot = `scienceworld`** — Staging status means cutover can be rehearsed without traffic risk.

## Backlog items added

Added new section **"Astro 6 + Cloudflare Workers Migration — Follow-ups"** to `docs/backlog/general.md` with items spanning all 6 required categories:
- Tech debt: Astro 5.7 → 6 upgrade; `CLAUDE.md:264` version drift.
- Missing tests: no integration tests yet for per-site Worker output.
- Missing error handling: CI sync idempotency + rollback runbook.
- Documentation: untracked `docs/plans/content-network-guide.md` needs committing alongside plan docs.
- Performance: baseline measurements (build time, deploy time, KB per change) must be captured before cutover.
- Related bugs/edge cases: `InlineTracking.astro` esbuild warning still open; `.build-trigger` concept needs a KV-era replacement.

## Post-deploy verification needed

- None — deliverables are planning docs.
- Next session (start of Phase 0 in the plan) will capture baseline build/deploy metrics from `deploy.yml` logs. That's when production observation starts.

## Learning notes

The existing architecture is actually **well-positioned** for this migration — far better than the user's message implied. The dashboard already writes YAML to a data-only repo, the 5-layer inheritance resolver is already a pure function, and the ad-loader is already runtime-client-side (not build-time). The migration is fundamentally a **change of where config resolution happens** (build time → request time via KV) plus a **change of render target** (per-site Pages project → single multi-tenant Worker). The dashboard, content-pipeline, and 90% of the site-builder's logic carry over unchanged.

The single highest-risk phase is Phase 2 — porting to Astro 6 + `@astrojs/cloudflare` v13 + `output: 'server'` on workerd. These are all stable individually, but the combination at this boundary (content collections over SSR with Workers filesystem restrictions) has known edge cases. The plan isolates that risk: Phase 2 builds the new app alongside the old one, renders from filesystem (same as today), and only Phase 3 introduces KV. If Phase 2 discovers a deep incompatibility (e.g. content-collections + `output: 'server'` doesn't work the way we expect), we can redesign Phase 3-4 without losing Phase 0-1 groundwork.

The most subtle decision in the plan is **what triggers an HTML-shell cache purge vs. what is "island only"**. Monetization edits are the common case and should NEVER purge shells (that was the old behaviour we're leaving behind). Template switches DO need a purge. The classification happens in the CI sync script's path filter, and the classifier correctness is a correctness property to unit-test in Phase 5. Getting this wrong in either direction (over-purging = wasted cache; under-purging = stale layout) is the single biggest ongoing ops risk of the new system.

## Related records

- Audit log: `audit-logs/2026-04-23-1530-migration-astro-workers-audit.md`
- Deliverables (new this session):
  - `migration-audit.md`
  - `migration-gap-analysis.md`
  - `migration-plan.md`
- Target spec (pre-existing, untracked in git): `plans/content-network-guide.md`
- Backlog: `backlog/general.md` (new "Astro 6 + Cloudflare Workers Migration — Follow-ups" section)
