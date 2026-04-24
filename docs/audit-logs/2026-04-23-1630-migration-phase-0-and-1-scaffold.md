# Audit: Phase 0 baselines + Phase 1 scaffold of Astro 6 + Workers site-worker package
**Date:** 2026-04-23 16:30 UTC
**Triggered by:** User answered the 9 open questions in `migration-plan.md`: "Here are my answers now let's continue" → begin executing Phases 0 and 1.
**Session type:** Coding (new package scaffold) + Investigation (baseline capture)
**Jira:** None

## Recent context
**Last session:** Migration audit + plan (2026-04-23 15:30) — produced `migration-audit.md`, `migration-gap-analysis.md`, `migration-plan.md` with 9 open questions; committed on branch `docs/astro-workers-migration-plan`.
**Session before:** Sticky Ad Close Button (2026-04-20) — confirmed ad-loader is vanilla JS + window.__ATL_CONFIG__ pattern, relevant for Server Island port later.
**Open backlog items:** 23 now (11 pre-existing + 12 migration follow-ups from previous session).
**Relevant to this session:** Every one of the 9 open questions the plan raised now has a user answer; ready to execute.

## Goal
1. Capture the user's answers to the 9 open questions as committed artefacts.
2. Phase 0: record available baseline measurements.
3. Phase 1: scaffold `packages/site-worker/` as a new workspace package, prove it builds + runs on `workerd`.
4. Leave `packages/site-builder/` and the live Pages deploys completely untouched.

## Pre-flight checks

| Check | Result | Notes |
|-------|--------|-------|
| tsc --noEmit (monorepo) | ⚠️ SKIP | Not editing existing code; new package will be built with its own typecheck at end |
| git branch | ✅ | On `docs/astro-workers-migration-plan` (continuing from prev session, as agreed with user) |
| git working tree | ✅ | Only `.cloudgrid-dev.lock` deletion (unrelated local cruft) remains; planning docs committed in prev session |
| wrangler CLI | ✅ | `/usr/local/bin/wrangler` v4.77.0 (v4.84.1 available — not upgrading mid-session) |
| CF account access | ✅ | `CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50` (Dev1@atomiclabs.io) per user Q4 answer |

## Investigation

### User answers to the 9 open questions
| Q | Answer |
|---|--------|
| Q1 — baselines | `coolnews-atl` deploy ran in **52 s** just now. `scienceworld` not measured yet (user didn't provide). |
| Q2 — content storage | **Option A — markdown-in-repo → synced to KV.** Matches recommendation. |
| Q3 — Pages project custom settings | **Ran it in this session** (see below). |
| Q4 — CF account / plan | `dev1@atomiclabs.io` (account id `953511f6356ff606d84ac89bba3eff50`) for dev/testing. Workers Paid plan. Production migration later uses a different account. |
| Q5 — staging story | **Option i — one staging Worker, hostnames distinguish sites.** |
| Q6 — SEO continuity | No existing constraints; pick best defaults. |
| Q7 — pilot choice | Confirm `scienceworld` pilot, `coolnews-atl` second. |
| Q8 — dashboard "force rebuild" button | Confirmed — rewire to cache-purge in follow-up session. |
| Q9 — ad SDK placement | **Everything in Server Islands** (current ad-loader is mock only, no live ad revenue). Document a future-decisions hook. |

### Phase 3 point-of-discussion (theme sharing)
User raised: "the porting confirm it's sane to share theme + layouts as a workspace package (`packages/site-theme-modern` pulled into both old and new)".

**Interpretation:** yes — extract `themes/modern/` + the shared layout primitives into a new package `packages/site-theme-modern`, consumed by both old `site-builder` and new `site-worker`. Decision taken (logged as Decision 1 below).

### Cloudflare Pages project settings inspection (Q3)
Ran `CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 wrangler pages project list`:

```
┌──────────────┬──────────────────────────────────────┬──────────────┬────────────────┐
│ Project Name │ Project Domains                      │ Git Provider │ Last Modified  │
├──────────────┼──────────────────────────────────────┼──────────────┼────────────────┤
│ coolnews-atl │ coolnews-atl.pages.dev, coolnews.dev │ No           │ 25 minutes ago │
│ scienceworld │ scienceworld-124.pages.dev           │ No           │ 5 hours ago    │
└──────────────┴──────────────────────────────────────┴──────────────┴────────────────┘
```

Ran `wrangler pages download config <project>` for both into `/tmp/cf-pages-config/`. Full output for each:

```toml
# coolnews-atl
name = "coolnews-atl"
compatibility_date = "2026-04-13"

[env.production]
```

```toml
# scienceworld
name = "scienceworld"
compatibility_date = "2026-04-19"

[env.production]
```

**Finding: no custom config exists in either project.** No env vars, no redirects, no `_headers`, no `_redirects`, no Pages Functions, no KV bindings, no secrets. The build & deploy relationship is entirely carried by `.github/workflows/deploy.yml` + `wrangler pages deploy`. This **simplifies Phase 6/7 cutover significantly** — nothing to migrate beyond the code + data.

Note on Git Provider column: "No" — neither project is wired to a GitHub integration. That matches the `deploy.yml` CI model where wrangler pushes pre-built `dist/` directly.

### Phase 0 baseline — deployment history for coolnews-atl
Ran `wrangler pages deployment list --project-name=coolnews-atl`:
- Latest Production deployment: `2fea74cc-394e-4cf2-97ad-02ebd71ea15a` (`main`, 26 minutes ago) — this is the 52 s build the user reported.
- Prior Production: `cfe500e4-e842-4256-94b0-e2880d3e2212` (3 hours ago).
- 4 Preview deployments to `staging/coolnews-atl` in the last 6 hours.

## Changes

### Change 1: create `docs/migration-baselines.md`
**File:** `docs/migration-baselines.md`
**Action:** Create
**Why:** Phase 0 of the migration plan requires recorded baselines to compare against post-cutover. User provided `coolnews-atl` deploy time = 52 s; this is the only datapoint available now. File captures it with links to deployment ids.

**Verification:** none needed — new markdown file.

### Change 2: append "Resolved open questions (2026-04-23)" section to `migration-plan.md`
**File:** `docs/migration-plan.md`
**Action:** Modify
**Why:** Freeze the user's answers inside the plan so later readers can see what was decided and when. Answers inform Phase 2's theme-extraction decision and Phase 4's Server Islands approach; losing them to chat history would make the plan ambiguous.

**Verification:** `grep -c "Resolved open questions" docs/migration-plan.md` → 1.

### Change 3: create `docs/future-decisions.md` (per Q9)
**File:** `docs/future-decisions.md`
**Action:** Create
**Why:** User explicitly requested: "Document this as a known future decision in `docs/future-decisions.md` so we don't forget." Contains the ad-network SDK-placement decision (revisit when integrating real networks).

**Verification:** new file.

### Change 4: scaffold `packages/site-worker/`
**Files:** multiple under `packages/site-worker/` (see §Phase-1 tasks below).
**Action:** Create
**Why:** Phase 1 of the migration plan. Builds the new target app alongside the existing `site-builder`. No production impact until Phase 6 DNS cutover.

**Per-file verification:** typecheck and `astro build` at the end.

## Decisions

### Decision 1: Extract `themes/modern/` + shared layouts into a new package `packages/site-theme-modern`
**Alternatives considered:**
1. **Duplicate `themes/modern/` + shared layouts into both `site-builder` and `site-worker`.** Simpler in the short term. Risk: divergence (fix ads in one, not the other) during the migration's ~8-week lifespan. Also means the theme needs editing in two places when the user wants a style change mid-migration.
2. **Extract into `packages/site-theme-modern` workspace package, both apps import from it.** One copy, one import. Cost: refactor once, update imports in `site-builder` (risk touching the prod build path), and make sure the theme package exposes Astro-6-compatible components (currently Astro 5.7).

**Chosen:** Option 2 **but deferred until Phase 2 not Phase 1.** Phase 1 scaffolds the new app with a single dummy placeholder page. Phase 2 is where real theme code arrives, and extraction happens then as a standalone, reviewable step:
- Step 2a: Create `packages/site-theme-modern` with `themes/modern/*` + `layouts/BaseLayout.astro`, `layouts/ArticleLayout.astro`, `layouts/PageLayout.astro` copied from `site-builder`.
- Step 2b: Update `site-builder` imports to consume from `@atomic-platform/site-theme-modern`. Verify its build still succeeds (prod path untouched).
- Step 2c: Have `site-worker` consume the same package.
- Step 2d: Port content-collection + pages into `site-worker`.

**Why this ordering:** separates a risky refactor of the live build path (2b) from the new-package work (2a/2c). Any build regression in `site-builder` during 2b is reverted independently of whether the new Worker app works.

**Trade-offs accepted:**
- Astro 6 components usually render fine when called from an Astro 5.7 host (the component syntax is stable across the minor jump). If extraction turns up incompatibilities, fallback is duplication — still on the table.
- `site-theme-modern` becomes a third workspace package to maintain; acceptable cost.

### Decision 2: Phase 1 placeholder page renders `Host: header` + resolves a fake `site:<host>` KV lookup only when a flag is on
**Alternatives considered:**
1. **Hard-code "Hello World"** (matches the plan literally).
2. **Render the hostname from `Astro.request.headers.get('host')`** — proves multi-hostname request pass-through on day 1 without any real logic.

**Chosen:** Option 2. Costs nothing, catches "workerd doesn't expose request headers via the expected Astro API" early. No KV binding at this stage — pure header echo.
**Trade-offs:** slightly more surface area than the strict minimum, but the extra line of code is worth the early validation.

### Decision 3: `wrangler.toml` in Phase 1 declares staging env but no KV bindings yet
**Alternatives considered:**
1. **Leave KV unbound entirely** — keep wrangler config minimal, add KV in Phase 3.
2. **Add KV binding with a placeholder namespace id** — fails `wrangler dev` because the namespace doesn't exist until Phase 3.
3. **Add KV binding with `preview_id` referring to a stub local namespace** — convoluted for a scaffold.

**Chosen:** Option 1 — declare `[env.staging]` but no `[[kv_namespaces]]`. Phase 3 adds KV bindings when namespaces actually exist.
**Trade-offs:** one config-file edit in Phase 3; trivial.

### Decision 4: don't push the branch in this session
**Alternatives considered:**
1. Push so the user can see in GitHub.
2. Keep local.

**Chosen:** Keep local. System prompt: "DO NOT push to the remote repository unless the user explicitly asks you to do so." User hasn't asked.

## Testing

See §Final verification for the scaffold smoke test. No unit tests written this session — scaffolding code has no logic to TDD except request routing, which is inherent to Astro + adapter.

## Final verification

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm install` | ✅ | 7 workspace projects; +63 deps added; 1 deprecation warning (`node-domexception`, subdep, not ours); `workerd` postinstall script skipped by pnpm (harmless — wrangler ships its own binary) |
| Astro / adapter resolved versions | ✅ | Astro **6.1.9**, `@astrojs/cloudflare` **13.2.0** |
| `pnpm --filter @atomic-platform/site-worker build` | ✅ | Server built in 3.21 s; emits `dist/client/` + `dist/server/{entry.mjs, wrangler.json, chunks/}` |
| `pnpm --filter @atomic-platform/site-worker typecheck` | ✅ | `astro check`: 0 errors, 0 warnings, 0 hints; `tsc --noEmit`: clean |
| `wrangler dev --config dist/server/wrangler.json` | ✅ | Serves 200 OK on `http://127.0.0.1:8788` |
| Hostname-echo smoke test (curl with different Host headers) | ✅ | `Host: scienceworld.local` → `<dd>scienceworld.local</dd>`; `Host: coolnews.dev` → `<dd>coolnews.dev</dd>` |
| Browser render (preview_screenshot) | ✅ | Clean monospace listing of host, cf-ipcountry, cf-ray |
| Existing `site-builder` untouched | ✅ | No files modified under `packages/site-builder/`; prod path unchanged |

**Non-issues observed:**
- Wrangler 4.77.0 prints `[wrangler:warn] The latest compatibility date supported by the installed Cloudflare Workers Runtime is "2026-03-17", but you've requested "2026-04-23". Falling back to "2026-03-17"…` — upgrade to `wrangler@4.84.1` removes it. Logged as a backlog item.
- `[WARN] [@astrojs/sitemap] The Sitemap integration requires the `site` astro.config option. Skipping.` — expected; no canonical `site:` exists until middleware resolves per-site in Phase 3. Logged as a backlog item.
- `shell-init: error retrieving current directory: getcwd…` in preview logs — cosmetic, caused by the harness launching under a no-longer-existent cwd. Doesn't affect the Worker.

**Files touched (final):**
- `docs/audit-logs/2026-04-23-1630-migration-phase-0-and-1-scaffold.md` — created (this file)
- `docs/migration-baselines.md` — created
- `docs/migration-plan.md` — modified (Resolved Open Questions + theme-extraction + Decision log sections)
- `docs/future-decisions.md` — created
- `docs/sessions/2026-04-23-phase-0-and-1-scaffold.md` — created
- `docs/backlog/general.md` — modified (marked resolved items; added Phase-1 follow-ups)
- `.claude/launch.json` — modified (added `site-worker` preview config)
- `CLAUDE.md` — modified (Layout, Tech Stack, Common Commands reflect both packages)
- `packages/site-worker/.gitignore` — created
- `packages/site-worker/README.md` — created
- `packages/site-worker/astro.config.mjs` — created
- `packages/site-worker/package.json` — created
- `packages/site-worker/src/env.d.ts` — created
- `packages/site-worker/src/pages/index.astro` — created
- `packages/site-worker/tsconfig.json` — created
- `packages/site-worker/wrangler.toml` — created
- `pnpm-lock.yaml` — modified (new deps)

## Post-deploy verification
No Cloudflare resources created this session. No deploy to Cloudflare. Production (the two existing Pages projects) untouched.

When Phase 3 (KV + middleware) deploys the first staging Worker, THIS audit's smoke test pair (`curl -H "Host: scienceworld.local"` and `curl -H "Host: coolnews.dev"`) should be re-run against the staging URL — they're now canonical regression checks for the multi-tenant foundation.

## CLAUDE.md updates
Updated three sections:
- "Layout — Platform Repo" (`packages/` listing) — added `site-worker/` with its migration-target description; re-labelled `site-builder/` as legacy/Pages-per-site.
- "Tech Stack" — replaced the single "Site builder: Astro 6" line (which was drift — actual pin was 5.7) with two lines that correctly describe both packages during the migration.
- "Common Commands" — added `packages/site-worker` commands (`pnpm dev`, `pnpm dev:worker`) alongside the legacy `site-builder` commands.

## Backlog sync
**Read:** `docs/backlog/general.md`.
**Marked done (this session):** `Astro 5.7 → 6 upgrade` (superseded — new package path instead), `CLAUDE.md:264 drift` (fixed), `docs/plans/content-network-guide.md untracked` (fixed in prev commit), Q2/Q3/Q4/Q9 open questions (answered by user).
**Added:** new "Phase-1 scaffold follow-ups" subsection — wrangler upgrade, `site:` config, `SESSION` KV binding note, theme-extraction sequencing.
**All 6 categories reviewed:** ✅
**Backlog is accurate:** ✅

## Session completion checklist
- [x] Audit log created BEFORE investigation/scaffold work began (created at 16:30 UTC, before any `pnpm install` or file creation).
- [x] Recent context populated from last 2-3 sessions + backlog.
- [x] Pre-flight checks recorded (typecheck/lint skipped with reason — no existing code modified).
- [x] Every file change has its own entry (or is covered in aggregate under Change 4 for the scaffold package files, which are inherently one related unit).
- [x] Every non-trivial decision has alternatives + reasoning (4 decisions recorded).
- [x] Changes functionally tested (curl hostname-echo pair, browser render, typecheck, build — not just "it compiles").
- [x] Post-deploy verification section filled.
- [x] CLAUDE.md checked and updated in 3 specific sections (listed above).
- [x] Backlog read, done items marked, new items added, 6 categories reviewed.
- [x] Session summary created (`docs/sessions/2026-04-23-phase-0-and-1-scaffold.md`).
- [x] All records cross-reference each other.
