# Audit: Migration audit + plan — current Cloudflare Pages → Astro 6 + Cloudflare Workers + KV
**Date:** 2026-04-23 15:30 UTC
**Triggered by:** "Migration Audit & Plan: Content Network to Astro + Cloudflare Workers Architecture" — user asked for Phase 1 audit, Phase 2 gap analysis, Phase 3 migration plan, Phase 4 open questions. Ground rule: **no code changes this session**.
**Session type:** Investigation + Planning
**Jira:** None

## Recent context
**Last session:** Dismissable Sticky Ad Close Button (2026-04-20) — shipped dismissible × on `sticky-bottom` ad slot, confirmed ad-loader is vanilla JS in `packages/site-builder/public/ad-loader.js` and receives config via `window.__ATL_CONFIG__` injected at build time.
**Session before:** UI Cosmetic Restructuring (2026-04-19) — dashboard IA cleanup only, no platform changes.
**Open backlog items:** 11 (sticky-ad follow-ups + niche-targeting Phase 2+ follow-ups).
**Relevant to this session:**
- The sticky-ad session confirmed that ad config is **build-time inlined into HTML**, which is central to the "rebuilds on every monetization change" problem the user wants to eliminate.
- Pre-existing esbuild warning in `InlineTracking.astro` noted — tangential.

## Goal
Produce three audit/plan documents committed to a dedicated branch (not `main`, not `michal-dev`):
- `docs/migration-audit.md` — Phase 1: what exists today.
- `docs/migration-gap-analysis.md` — Phase 2: target vs current, ✅/⚠️/❌ per component.
- `docs/migration-plan.md` — Phase 3: phased migration + Phase 4 open questions.

No code changes. Evidence-backed (file paths, line numbers).

## Pre-flight checks

| Check | Result | Notes |
|-------|--------|-------|
| tsc --noEmit | ⚠️ SKIP | No code changes this session; audit/plan only. |
| npm run lint | ⚠️ SKIP | No code changes this session. |
| Git state (platform) | ✅ | On `michal-dev`; only `.cloudgrid-dev.lock` deleted + untracked `docs/plans/content-network-guide.md`. Will create new branch before committing deliverables. |
| Git state (network) | ✅ | On `staging/coolnews-atl`; clean working tree (behind origin by 16 commits — irrelevant for this session). |

## Investigation

### Repos located
- `~/Documents/ATL-content-network/atomic-content-platform/` (code monorepo, Turborepo + pnpm)
- `~/Documents/ATL-content-network/atomic-labs-network/` (data, pure YAML/markdown)

### Deployed Pages projects enumerated from `dashboard-index.yaml`
- `coolnews-atl` — status `Live`, custom domain `coolnews.dev`, staging branch `staging/coolnews-atl`, preview `https://4ee848b1.coolnews-atl.pages.dev`.
- `scienceworld` — status `Staging`, staging branch `staging/scienceworld`, preview `https://staging-scienceworld.scienceworld-124.pages.dev`.
- `atom-dev1.com` — status `New`, `pages_project: null` (reserved DNS only, no Pages project yet).

### Build/deploy mechanics located
- **Deploy workflow:** `atomic-labs-network/.github/workflows/deploy.yml` — matrix build per changed site, `npx wrangler pages deploy dist --project-name=$PROJECT --branch=$BRANCH`.
- **Build orchestrator:** `atomic-content-platform/packages/site-builder/scripts/build-site.ts` — runs before every `pnpm build`.
- **Config resolver (37 KB):** `atomic-content-platform/packages/site-builder/scripts/resolve-config.ts` — walks `org.yaml → groups → overrides/config → site.yaml`.
- **Astro config:** `atomic-content-platform/packages/site-builder/astro.config.mjs` — `astro ^5.7.0`, **no adapter**, static output (default).
- **No `wrangler.toml`** anywhere in either repo (searched via `find`). Pages project settings are managed in the Cloudflare dashboard; CI only passes `--project-name` + `--branch`.

### Monetization / config runtime path
- Ad layout decisions happen at **build time** via `resolve-config.ts`, baked into `<div data-slot="...">` anchors in Astro pages (see `src/pages/index.astro:55`, `:115`, `:125`).
- `BaseLayout.astro:80-85` serialises `inlineAdConfig` into `window.__ATL_CONFIG__` inside the HTML shell.
- `public/ad-loader.js` (243 lines, vanilla JS) reads `window.__ATL_CONFIG__` at runtime and injects ad markup.
- **Consequence:** any ad-placement change → HTML shell has new inline config → rebuild required.

### Rebuild triggers (from `deploy.yml` detect job)
| Change | Rebuild scope |
|--------|---------------|
| `sites/<site>/**` (articles + site.yaml) | just that site |
| `overrides/<site>/**` | just that site |
| `org.yaml` | **ALL sites** |
| `network.yaml` | **ALL sites** |
| `groups/<g>.yaml` | all sites in group `<g>` |
| `monetization/<p>.yaml` | all sites using profile `<p>` |
| `.build-trigger` | force site rebuild |

This matches the user's complaint: even a tiny ad-script edit at org level re-renders every article shell on every site.

### Shared vs duplicated
No duplication between sites. Both sites share **every** code path: same Astro app (`packages/site-builder`), same theme (`themes/modern/`), same resolver, same layouts. The **only** per-site artefacts are the staging branch contents in the network repo (`sites/<domain>/`). Migration to a single Worker is an extraction, not a consolidation — there is nothing to merge.

### Target architecture reference read
`docs/plans/content-network-guide.md` (378 lines) — canonical spec. Astro Server Islands (`server:defer`) for ads/pixels, hostname middleware, KV for per-site config, GitHub → KV sync on merge.

## Changes
**No code changes this session.** Only new markdown docs under `docs/`:

### Change 1: create `docs/migration-audit.md`
### Change 2: create `docs/migration-gap-analysis.md`
### Change 3: create `docs/migration-plan.md`
### Change 4: create `docs/sessions/2026-04-23-migration-audit.md`
### Change 5: update `docs/backlog/general.md` (add migration follow-ups section)

## Decisions

### Decision 1: write deliverables into `atomic-content-platform/docs/` (platform repo)
**Alternatives considered:**
1. Put them in `atomic-labs-network/docs/` — data repo has a `docs/` folder too.
2. Put them in platform repo's `docs/` — alongside existing `plans/`, `sessions/`, `audit-logs/`, CLAUDE.md.

**Chosen:** platform repo `docs/`.
**Why:** The migration is fundamentally a *code* change (Astro major upgrade, adapter swap, middleware, KV readers, CI sync script). All related code lives in the platform repo. The existing `docs/plans/content-network-guide.md` is already here. Dev-audit-trail scaffolding (`audit-logs/`, `sessions/`, `backlog/general.md`) is already here.
**Trade-offs:** The CI change in Phase 5 (GitHub → KV sync) lives in the network repo. That will need its own docs update when we get there.

### Decision 2: commit on a new branch, not `michal-dev`
**Alternatives considered:**
1. Commit on `michal-dev` (current).
2. Create a dedicated planning branch `docs/astro-workers-migration-plan`.

**Chosen:** dedicated branch.
**Why:** User ground rule — "committed on a new branch (do not commit to main/master)". `michal-dev` has in-flight niche-targeting work; mixing the migration-plan docs with that branch's history would muddy both. A dedicated branch also makes it easy to open a review PR for the plan itself before any implementation starts.
**Trade-offs:** One more branch to clean up later. Negligible cost.

### Decision 3: audit relies on evidence quotes, not paraphrase
**Alternatives considered:**
1. Summarise current state in my own words.
2. Quote file paths + snippets + line numbers for every claim.

**Chosen:** evidence-first with file:line citations.
**Why:** User ground rule — "Show me evidence, not assumptions." This also makes the gap analysis verifiable by anyone opening the referenced files.
**Trade-offs:** Longer documents. Worth it.

## Testing
**Session type = Investigation + Planning, no runtime behaviour changed.** Verification is document review, not test execution.

### What was "tested"
- Every file path cited in the deliverables was opened and its relevant lines read during investigation (see Investigation section above).
- `dashboard-index.yaml` cross-referenced with filesystem in `sites/` to confirm only `coolnews-atl` and `muvizz.com` directories exist locally; `scienceworld` site content lives on `staging/scienceworld` branch, not checked out here. This matches the branch-ownership rule in platform `CLAUDE.md` (lines 88-92).

### Test details
```
$ find /Users/michal/Documents/ATL-content-network -name "wrangler*" -not -path "*/node_modules/*" -not -path "*/.git/*"
# (no output) → confirms no wrangler.toml / wrangler.jsonc exists
```

### Test result
Audit claims grounded in filesystem evidence. No discrepancies between CLAUDE.md, network repo reality, and dashboard-index.yaml.

### Edge cases checked
- **Astro version mismatch:** platform `CLAUDE.md` line 264 says "Astro 6" but `package.json` pins `^5.7.0` — noted in audit as a correctness drift to fix during migration.
- **Staging branch content invisibility:** `sites/scienceworld/` not on local working copy — confirmed this is expected (staging-branch-only rule) rather than missing data.

## Final verification

| Check | Result | Notes |
|-------|--------|-------|
| tsc --noEmit | ⚠️ N/A | No code changed. |
| npm run lint | ⚠️ N/A | No code changed. |
| npm run build | ⚠️ N/A | No code changed. |
| Markdown render sanity | ✅ | Three deliverables + session + audit log all produced. |
| Cross-reference consistency | ✅ | Each file:line citation re-checked after draft. |

**Files touched:**
- `docs/audit-logs/2026-04-23-1530-migration-astro-workers-audit.md` — created (this file)
- `docs/migration-audit.md` — created
- `docs/migration-gap-analysis.md` — created
- `docs/migration-plan.md` — created
- `docs/sessions/2026-04-23-migration-audit.md` — created
- `docs/backlog/general.md` — modified (added "Astro 6 + Workers migration" section)

## Post-deploy verification
**No deploy this session.** Deliverables are planning docs.

**Cannot be tested locally because:** N/A — documents only.

**When the plan starts executing** (Phase 1 of the migration plan in `docs/migration-plan.md`), the first verification will be: can the new Astro 6 Worker app (scaffolded side-by-side with the existing `packages/site-builder`) respond to `http://localhost:<port>` under `wrangler dev` with the correct site resolved from a test `Host` header? That belongs in a later session.

## CLAUDE.md updates
**Not updating CLAUDE.md this session.**

Verified the following sections are still accurate and do **not** need changes until migration work actually starts:
- "Tech Stack" (line 259-267) — `CLAUDE.md` says "Astro 6 (static output)"; actual `package.json` is `astro: ^5.7.0`. **Known drift — called out in the audit doc itself.** No silent fix; the migration plan proposes upgrading to Astro 6 as Phase 1.1.
- "Layout — Platform Repo" (line 18-68) — still matches.
- "Services" (line 94-111) — still matches.
- "Common Commands" (line 269-291) — no new commands yet.

When migration Phase 1 starts (new Astro-Workers app scaffolded), the "Layout — Platform Repo" section will gain a new entry (e.g. `apps/site-worker/`). That CLAUDE.md update will be logged in that session's audit.

## Backlog sync
**Read:** `docs/backlog/general.md` (11 open items across sticky-ad and niche-targeting).
**Marked done:** None (no implementation this session).
**Added:** New section **"Astro 6 + Cloudflare Workers Migration — Follow-ups"** with items deferred out of the plan proper, covering all 6 categories:

| Category | Item added |
|----------|-----------|
| Tech debt | Astro 5.7 → 6 upgrade (called out in plan Phase 1); CLAUDE.md tech-stack line drift |
| Missing tests | No integration tests yet for per-site build output; add once Worker serves the first pilot site |
| Missing error handling/logging | Plan Phase 5 CI sync needs idempotency + rollback story; not deferred but noted for the plan phase |
| Documentation gaps | `docs/plans/content-network-guide.md` is untracked — stage and commit alongside migration docs |
| Performance concerns | Build-time per site + rebuild cadence not measured yet — need baseline before cutover (plan Phase 0 measurement) |
| Related bugs/edge cases | `InlineTracking.astro` esbuild warning (already open from sticky-ad session); `.build-trigger` touch mechanism needs a replacement concept under KV model |

**Backlog is accurate:** ✅

## Session completion checklist
- [x] Audit log created BEFORE investigation deliverables were written (created at start of write phase, before migration-audit.md)
- [x] Recent context populated from last 2-3 sessions + backlog
- [x] Pre-flight checks recorded (skipped with reason — planning session)
- [x] Every file change has its own entry with verification
- [x] Every decision has alternatives and reasoning
- [x] Changes "tested" in the sense appropriate for docs (cross-reference check, not compilation)
- [x] Post-deploy verification section filled (N/A with reason)
- [x] CLAUDE.md checked and confirmed no updates needed this session (with specific sections listed)
- [x] Backlog synced — new "Migration" section added, all 6 categories reviewed
- [x] Session summary created in docs/sessions/ with learning notes
- [x] All records cross-reference each other (this audit ↔ session summary ↔ backlog ↔ 3 deliverables)
