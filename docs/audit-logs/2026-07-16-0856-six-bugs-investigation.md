# Audit: Six reported platform bugs — investigation + fixes

**Date:** 2026-07-16 08:56 UTC
**Triggered by:** "i have few bugs that i want to fix and adjust" — (1) UI doesn't reflect git-completed site actions (wineoceans per-topic migration done in git, UI unchanged 1h+); (2) sites stuck on status "ready" instead of "live" when connected to a domain (DogsLabs); (3) "no content in aggregator" errors on article generation despite 3k+ items (giantsavings); (4) dedup broken between per-topic and general generation; (5) aggregator content types (articles/videos/trends) — can the platform handle all of them?; (6) ~49 sites show 0 articles after US server migration — likely MongoDB article stats need re-sync from KV/git.
**Session type:** Investigation → Coding
**Jira:** None

## Recent context

**Last session:** Stop persisting topic names in site.yaml (2026-06-29) — reverted name denormalization to fix staging↔main git conflicts; names resolved live via aggregator `?ids=`.
**Session before:** Theme button contrast, menu-item size, robust topics taxonomy (2026-06-28) — taxonomy pagination fixes, `?ids=` endpoint, empty-filter vs no-match vs all-duplicates diagnostics in pipeline.
**Open backlog items:** many (migration follow-ups); relevant: "Content agent integration — fetch by bundle_id", "no bugs.md exists yet in this repo".
**Relevant to this session:** Issue 3 (aggregator "no content") directly relates to the 2026-06-28 topics/content-fetch work. Standing rule: never commit/deploy until Asaf tests locally.

## Goal

Root-cause all six reported issues; implement fixes where the root cause is confirmed; produce a sync tool/fix for the 0-articles sites (issue 6); report an assessment for issue 5 (capability question).

## Pre-flight checks

| Check | Result | Notes |
|-------|--------|-------|
| pnpm typecheck | PASS (5/5 packages) | 3 pre-existing unused-var hints in site-worker |
| npm test (baseline) | dashboard 289 / pipeline 592 | from 2026-06-28 artifacts; pipeline stats/costs/alerts suites were env-blocked (corrupt mongodb-memory-server download) |

## Investigation

### Issue 5 — Content-type handling assessment (agent report, complete)

Live aggregator client is `api-client.ts` (`GET /api/content`, `content_type` field, open string set). `aggregator.ts` (`/api/articles`, `content_format`) is dead code — never imported outside its own tests.

Support matrix: **article** = full end-to-end. **video** = special prompt (`core.ts:123-127`), agent writes `frontmatter.videos=[{url, position:'after-paragraph-1'}]` (`agent.ts:770-779`), BUT rendering is YouTube-only (`inject-videos.ts:12-53`) — non-YouTube URLs render as `""` and are silently dropped while the article body promises an embed. **social_post** = prompt-only (`core.ts:128-133`), no storage field, no render. **trend** = NO special handling anywhere — becomes a generic article with zero differentiation.

Gaps: (1) trend undifferentiated; (2) non-YouTube videos break silently; (3) agent bypasses the dashboard's `YOUTUBE_RE` validation when writing `frontmatter.videos`; (4) social_post never embedded; (5) no emptiness guard on `summary` (the sole fact source) for thin video/trend items → hallucination risk; (6) source `content_type` not persisted in frontmatter; (7) dead legacy `aggregator.ts` is a confusion hazard. No `content_type` filter is passed at any `getContent` call site (`agent.ts:901-910, 1337-1347, 1381-1386`) — deliberate, per `api-client.ts:96-105`.

### Issue 3 — "No content in aggregator" (giantsavings) — ROOT CAUSE FOUND (agent report)

giantsavings (`sites/giantsavings`, per-topic site) queries the aggregator with `category_ids` AND `tag_ids` per topic (`agent.ts:1335-1347` → `api-client.ts:90-136`). Aggregator semantics: OR within a dimension, AND across dimensions (`per-topic-fetch.ts:88-121`). Its seeded `tag_ids` are cross-vertical junk (nutrition, sleep, healthy-eating, public-health, artificial-intelligence on a personal-finance site — likely from seed-time topic inference, commit f57293a). Finance categories ∩ health/AI tags = 0 items → `no-match` skip for every topic → "no new items from aggregator for any eligible topic" (`agent.ts:1472-1481`).

**Structural gap:** the legacy flat path has a drop-tags fallback (`agent.ts:1096-1110` — retries without tag filters when the narrow query returns 0), but the per-topic path has NO such fallback — it fails hard.

Dedup is NOT Mongo-based on this path — it reads `sites/<domain>/dedup-index.json` (`agent.ts:305-360`), so this is genuinely a zero-match query, not all-duplicates.

Fix candidates: (a) per-topic drop-tags fallback mirroring the legacy path; (b) validate topic ids against live taxonomy and drop unknown ids (mechanism exists in `propose-filter.ts` `dropped_unknown_ids`); (c) data fix: clean giantsavings' topic tag_ids + audit other f57293a-seeded sites.

### Issue 2 — Stuck on "Ready" instead of "Live" (DogsLabs) — ROOT CAUSE FOUND (agent report)

Statuses: `Staging | Ready | Live` (`dashboard/src/types/dashboard.ts:1`). Contract: Live ⟺ has `custom_domain`. The ONLY promotion to Live is `attachCustomDomain()` (`src/actions/wizard.ts:748,761`). There is no automatic Ready→Live.

DogsLabs timeline (origin/main git history): attach set Staging→Live (commit f0564c704, 11:38); 15 min later the "Go Live" button ran `goLive()` which **unconditionally hardcodes `status: "Ready"`** (`wizard.ts:500-505`) — demoting the already-Live site (commit b66c5d1dd). Nothing ever re-promotes.

Three defects: (1) `goLive()` hardcodes "Ready", ignores `site.custom_domain`; (2) the "Go Live" button was clickable due to stale props in an open tab (`StagingTab.tsx:58,337` gates on status but props were stale); (3) self-heal is dead code — `syncDomainsFromCloudflare` (`src/actions/sync.ts:41-46`) checks the `staging_branch && Ready/Live` branch BEFORE the `custom_domain → Live` branch, so nearly every real site short-circuits and sync can never repair a stuck-Ready site.

Fix candidates: (a) `goLive()` → `status: site.custom_domain ? "Live" : "Ready"`; (b) reorder sync so `custom_domain → Live` wins (auto-repairs all stuck sites on next sync); (c) guard the Go Live button; (d) data remediation for dogslabs (sync fix makes it self-heal).

### Issue 1 — Stale UI after git actions (wineoceans) — ROOT CAUSE FOUND (agent report)

The dashboard was migrated to a **MongoDB read layer** (`USE_MONGO_READS=true` in prod; `db/site-configs.ts`, `db/dashboard-index.ts`, `db/articles.ts`). CLAUDE.md's `invalidateSiteCaches`/`articlesCache`/`siteConfigCache`/`dashboardIndexCache` guidance is STALE — those symbols no longer exist.

Root cause: `migrateSiteToPerTopic` (`src/actions/per-topic-migration.ts:29-92`) commits the new site.yaml to Git (`commitSiteFiles`, lines 66-71) but does **no `upsertSiteConfig` and no `revalidatePath`**. The dashboard reads config exclusively from Mongo → staleness is INFINITE (Mongo is a store, not a TTL cache). Pages are all `force-dynamic` so the Next.js route cache is not the issue; there is no branch mismatch (Mongo config is keyed by domain only).

Correct dual-write reference pattern exists: `wizard.ts:296,392-395`, `agent.ts:54-64`, `review.ts:145-172`. Offenders: `per-topic-migration.ts` (the wineoceans bug) and possibly `api/sites/rename/route.ts` (only invalidates the legacy tree cache).

No self-heal: pipeline `/reconcile-mongo` (`content-generation/index.ts:1124-1268`) reconciles only `articles`, never `site_configs`/`dashboard_index`. `/api/cache/invalidate` only calls `revalidatePath` (no-op under force-dynamic) and nothing POSTs to it.

Latent landmine: `kv-api.ts:27` `KV_CACHE_TTL = Infinity` with a never-called invalidator — permanent staleness if `USE_MONGO_READS=false`.

Fix candidates: (a) dual-write in `migrateSiteToPerTopic` (+revalidatePath) — fixes wineoceans; (b) shared `commitAndSyncSiteConfig()` helper; (c) extend `/reconcile-mongo` to site_configs + dashboard_index as safety net; (d) fix CLAUDE.md stale guidance; (e) fix the Infinity-TTL KV cache.

### Issue 6 — ~49 sites show 0 articles post-US-migration — ROOT CAUSE CONFIRMED (agent report)

Article counts come exclusively from Mongo `articles` collection when `USE_MONGO_READS=true`: `SitesTable.tsx:86,373` → `GET /api/sites/article-counts` → `countArticlesForSites` (`db/articles.ts:177-201`, Mongo aggregation keyed `{domain, branch: staging_branch}`, no fallback). Writes are incremental upserts on publish only — a fresh Mongo (new US instance) stays 0 forever for any site that hasn't published since. Verified data intact: `origin/staging/travelswire` has 93 .md articles; Mongo has 0.

**Backfill tooling already exists:**
- `GET /reconcile-mongo` on pipeline (`content-generation/index.ts:1125-1294`, Bearer `CACHE_INVALIDATE_SECRET`) — compares git vs Mongo counts per site on staging_branch + main, re-upserts mismatches, prunes orphans, returns per-site report. Best fit.
- `POST /backfill-mongo` (pipeline) / `POST /api/agent/backfill-mongo` (dashboard proxy) → `backfill-mongo.ts` phases `articles|site-configs|index|configs`, supports `domains` targeting.
- CLI: `npx tsx services/content-pipeline/src/scripts/backfill-mongo.ts --phase articles`.

Other state silently lost with fresh Mongo: `site_stats.topicRotation` (round-robin cursor resets to 0 → early topics repeat), `generation_events` (weekly/today tiles = 0), cost_events, r2_usage, alert throttle state (possible alert re-fire). Dedup registry is NOT in Mongo (git `dedup-index.json`) — unaffected by the migration.

Fix: run reconcile/backfill against prod Mongo (operational action — needs Asaf's env access/approval); optionally add `site_configs`/`dashboard_index` reconciliation (overlaps issue 1 fix candidate c).

### Issue 4 — Dedup between per-topic and general generation — ROOT CAUSE FOUND (agent report)

Single cross-run dedup store: git `sites/<domain>/dedup-index.json` with only `urls[]` + `titles[]` (`agent.ts:270-302`), maintained by the BullMQ worker (`queue/content-generation.ts:164-201`). No Mongo dedup.

Two of three dedup signals are dead cross-run:
1. **Title key mismatch:** index stores the LLM-REWRITTEN frontmatter title (`agent.ts:750`), but checks compare `normalizeTitleKey(item.title)` — the ORIGINAL aggregator title (`agent.ts:917, 1356, 1395`). Stored ≠ queried → title dedup never matches across runs.
2. **Stable aggregator id never used cross-run:** `item.id` is written to frontmatter as `source_item_id` (`agent.ts:760`) but never read back; `DedupIndexData` has no ids field. Only in-run `seenIds`.
→ Cross-run dedup collapses to exact normalized source-URL match. Same story with a different URL (per-topic filter query vs general/bundle query returning different canonical/tracking-variant links) = duplicate article with slug `-2`.

Situational vector: dashboard generate route falls back from BullMQ to `POST /content-generate` when Redis is unreachable (`api/agent/generate/route.ts:112-125`); that HTTP handler never commits or updates the dedup index → runs leave no memory.

Fix candidates: (1) persist + check aggregator ids in the dedup index; (2) store `source_title` and fix the key mismatch; (3) close/fail-loudly the non-persisting fallback; (4) harden URL normalization; (5) per-site generation lock; (6) post-migration `rebuild-dedup-index.ts --all`.

## Changes

### Change 1 (Fix A, issue 1): dual-write per-topic migration to Mongo
**File:** `services/dashboard/src/actions/per-topic-migration.ts` — Modify
**Why:** Dashboard reads config from Mongo (`USE_MONGO_READS`); the git-only commit left the UI stale forever (wineoceans).
**What changed:** After `commitSiteFiles`, added `upsertSiteConfig(args.domain, existing)` + `revalidatePath("/")` + `revalidatePath("/sites/<domain>")`. Mirrors the reference pattern in `actions/agent.ts:54-64`.
**Verification:** vitest 8/8 (`per-topic-migration.test.ts` +2 tests), `tsc --noEmit` PASS.

### Change 2 (Fix B, issue 2): goLive keeps Live when a domain is attached
**File:** `services/dashboard/src/actions/wizard.ts` — Modify (goLive, ~line 499)
**What changed:** `status: site.custom_domain ? "Live" : "Ready"` (both `updateSiteInIndex` and the Mongo dual-write) instead of hardcoded `"Ready"` — the exact call that demoted DogsLabs.
**Verification:** vitest 2/2 (`go-live-status.test.ts`, new file), tsc PASS.

### Change 3 (Fix B, issue 2): sync self-heal for stuck-Ready sites
**Files:** `services/dashboard/src/lib/site-status.ts` — Create (`computeCorrectStatus` pure function); `services/dashboard/src/actions/sync.ts` — Modify (use it)
**What changed:** Status resolution order is now Staging-sticky → `custom_domain ⇒ Live` → keep Ready/Live → cfZone ⇒ Ready → config ⇒ Staging → null (orphan). Previously the `staging_branch && Ready/Live` branch shadowed the custom_domain check, so a stuck-Ready site with a domain could never be repaired. Helper lives in `lib/` because `"use server"` files may only export async functions.
**Verification:** vitest 9/9 (`sync-status.test.ts`, new file), tsc PASS.

### Change 4 (Fix C, issue 3): per-topic drop-tags fallback
**File:** `services/content-pipeline/src/agents/content-generation/agent.ts` — Modify (filter branch of `runPerTopicGeneration`)
**What changed:** Extracted the filter pagination loop into `fetchFilterPages(tagIds)`; after the narrow (categories AND tags) pass yields nothing new, retries with categories only — mirroring the legacy path's narrow→broad fallback (`agent.ts:1096-1110`). Guarded: only fires when the topic has BOTH categories and tags. Distinct log line for observability.
**Verification:** vitest 3/3 (`per-topic-fallback.test.ts`, new file) + all neighboring suites green, tsc PASS.

### Change 5 (Fix D, issue 4): dedup index v2 — ids + source_title
**Files:**
- `services/content-pipeline/src/agents/content-generation/agent.ts` — Modify: `ExistingArticles.ids`, `DedupIndexData` v2 (`ids?`), `serializeDedupIndex` writes v2, `parseDedupIndex` accepts v1 (ids=∅) and v2, `extractFromFrontmatter` reads `source_item_id`→ids and `source_title`→titles, `source_title: item.title` added to generated frontmatter, `existing.ids.has(item.id)` check added to the legacy per-bundle loop and both per-topic loops, `FetchUnionDeps.existing`/`PerTopicDeps.existing` typed as `ExistingArticles`.
- `services/content-pipeline/src/queue/content-generation.ts` — Modify: index merge now also folds in `source_title` + `source_item_id` of new articles.
- `services/content-pipeline/src/scripts/rebuild-dedup-index.ts` — Modify: captures ids + source_title.
- `services/content-pipeline/src/agents/migration/orchestrator.ts` — Modify: passes `ids: new Set()` (imports have no aggregator ids).
**Why:** Cross-run dedup had collapsed to exact-URL matching: the index stored LLM-rewritten titles but checks compared original aggregator titles (dead), and the stable `item.id` was never persisted (dead). Same story via per-topic then general queries → duplicate articles.
**Verification:** vitest — dedup-index 9/9 (+4), agent 16/16 (+2), process-generate-job (extended merge assertions), per-topic-fallback 3/3; tsc PASS.

### Change 6: CLAUDE.md — replace stale cache guidance
**File:** `CLAUDE.md` — Modify. "Cache Invalidation After Mutations" (referencing nonexistent `invalidateSiteCaches`/named caches) replaced with "Mongo Dual-Write After Git Mutations" describing the actual `USE_MONGO_READS` read layer and the dual-write pattern.

### Change 7: ops runbook
**File:** `docs/runbooks/2026-07-16-post-us-migration-remediation.md` — Create. Issue 6 backfill commands (`/reconcile-mongo`, `backfill-mongo.ts` phases), lost-Mongo-state table, `rebuild-dedup-index.ts --all` for v2 indexes, giantsavings topic-tag data fix + f57293a audit, REDIS_URL verification.

## Decisions

### Decision: sync order — Staging sticky ABOVE custom_domain⇒Live
**Alternatives:** (1) custom_domain wins over everything (heals more states but fights unpublish intent — an unpublished site with a still-attached domain would bounce back to Live); (2) Staging-sticky first, domain second (chosen).
**Chosen:** (2) — heals the reported class (Ready+domain) while preserving operator intent for unpublished sites. Trade-off: a corrupted Staging+domain state isn't auto-healed.

### Decision: fix dedup by persisting ids + source_title, not by hardening URL normalization alone
**Alternatives:** (1) URL canonicalization (strip tracking params/AMP) — reduces but can't eliminate variant misses, no stable key; (2) Mongo-based dedup registry — new infra, diverges from the git-resident index the queue worker already maintains; (3) persist the aggregator item id + original title into the existing index (chosen).
**Chosen:** (3) — `item.id` is the stable cross-query key; piggybacks on the existing v1 index with back-compat parsing (no forced rescans). Trade-off: articles created before `source_title` existed still rely on URL/id only; URL normalization hardening deferred to backlog.

### Decision: per-topic fallback requires non-empty category_ids
Dropping tags when a topic has ONLY tags would issue an unfiltered query over the whole aggregator. Fallback fires only when categories remain as a filter. All-duplicates (not just 0-sourced) also triggers fallback — mirrors legacy semantics.

### Decision: issues 5 & 6 get no code this session
Issue 6's tooling already exists (`/reconcile-mongo`, `backfill-mongo.ts`) — the remedy is operational, needs prod env/secrets (Asaf). Issue 5 is a capability-gap report; fixes (trend prompts, non-YouTube embeds) are feature work routed to backlog/notes, not bugfixes to bundle here.

## Testing

### Tests written this session
- `services/dashboard/src/actions/__tests__/per-topic-migration.test.ts` — +2 (dual-write + no-write-on-commit-failure)
- `services/dashboard/src/actions/__tests__/go-live-status.test.ts` — new, 2 (Live kept with domain / Ready without)
- `services/dashboard/src/actions/__tests__/sync-status.test.ts` — new, 9 (status matrix incl. DogsLabs heal + Staging sticky)
- `services/content-pipeline/src/__tests__/per-topic-fallback.test.ts` — new, 3 (broad retry, no-retry-when-narrow-works, skip-not-crash)
- `services/content-pipeline/src/__tests__/dedup-index.test.ts` — +4 (v2 round-trip, v2 serialization, v1 back-compat, v2 parse)
- `services/content-pipeline/src/__tests__/agent.test.ts` — +2 (skip-by-id, source_title in frontmatter)
- `services/content-pipeline/src/__tests__/process-generate-job.test.ts` — extended merge test (ids + source_title in written index)

### Test runner output
**Files:** `docs/test-results/2026-07-16-0930-six-bugs-dashboard.txt`, `docs/test-results/2026-07-16-0930-six-bugs-content-pipeline.txt`
**Dashboard:** 289 (2026-06-28 baseline) → **302 passing, 0 failing** (Δ +13)
**Content-pipeline:** 592 baseline → **627 passing, 0 failing, 0 skipped** (Δ +35: +12 new/extended this session; the remainder are the stats/costs/alerts suites previously blocked by a corrupted mongodb-memory-server binary cache — repaired this session by clearing `~/.cache/mongodb-binaries`, env fix, no code)
**Status:** All green.

### UI verification
Backend-only session — all changes are server actions / pipeline logic asserted by unit+integration tests above; no visual UI change.

### Edge cases covered
- v1 dedup index without ids → parse succeeds, ids empty (`dedup-index.test.ts`)
- Same item id with different URL and rewritten title → skipped (`agent.test.ts`)
- Filter topic with tags-only config → no unfiltered fallback (guard condition; `per-topic-fallback.test.ts` narrow/broad assertions)
- Commit failure → no Mongo dual-write (`per-topic-migration.test.ts`)
- Orphaned index entry → null → removal (`sync-status.test.ts`)

## Final verification

| Check | Result | Notes |
|-------|--------|-------|
| tsc --noEmit (all packages) | PASS | `pnpm typecheck` 5/5 |
| pnpm build | PASS | see session summary |
| dashboard full suite | PASS 302 (Δ +13) | artifact above |
| content-pipeline full suite | PASS 627 (Δ +35) | artifact above |
| UI verification | N/A | backend-only |

**Files touched (code):**
- `services/dashboard/src/actions/per-topic-migration.ts` — modified
- `services/dashboard/src/actions/wizard.ts` — modified
- `services/dashboard/src/actions/sync.ts` — modified
- `services/dashboard/src/lib/site-status.ts` — created
- `services/content-pipeline/src/agents/content-generation/agent.ts` — modified
- `services/content-pipeline/src/queue/content-generation.ts` — modified
- `services/content-pipeline/src/scripts/rebuild-dedup-index.ts` — modified
- `services/content-pipeline/src/agents/migration/orchestrator.ts` — modified
- `CLAUDE.md` — modified

**Test files touched:** the 7 listed under Testing.

## Post-deploy verification

**After Asaf tests locally, merges, and `cloudgrid plug`:**
- [ ] Run the runbook (`docs/runbooks/2026-07-16-post-us-migration-remediation.md`): `/reconcile-mongo` → sites list shows real article counts (travelswire ≈ 93).
- [ ] Trigger "Sync from Cloudflare" in the dashboard → DogsLabs flips Ready → Live (self-heal path).
- [ ] Re-run the wineoceans-style flow: migrate any test site to per-topic → site detail reflects topics immediately.
- [ ] giantsavings: generate per-topic → articles created via the categories-only fallback (check pipeline logs for the "retrying with categories only" line); then fix the topic tags per runbook §4.
- [ ] `rebuild-dedup-index.ts --all` after deploy, then generate per-topic + general on one site → no duplicate story.

**Cannot be tested locally because:** prod Mongo/KV/Cloudflare state; local suites cover the logic.

## CLAUDE.md updates
Replaced the stale "Cache Invalidation After Mutations" section (referenced `invalidateSiteCaches` + caches that no longer exist) with "Mongo Dual-Write After Git Mutations". Checked: "Critical Patterns" (others still accurate), "Known Landmines" #16 wording is now covered by the new section, "Layout"/"Commands" (unchanged by this session).

## Docs sync
See session summary — `docs/bugs.md` created (repo had none), `docs/backlog/general.md` + `docs/notes.md` updated.

## Session completion checklist
- [x] Audit log created BEFORE work started
- [x] Recent context populated from last 2 sessions + backlog
- [x] Pre-flight checks recorded
- [x] Every file change has its own entry with verification
- [x] Every decision has alternatives and reasoning
- [x] Test artifacts saved (`docs/test-results/2026-07-16-0930-six-bugs-*.txt`, delta stated)
- [x] Docs synced (bugs.md created, backlog/general.md + notes.md updated)
- [x] Session summary created (`docs/sessions/2026-07-16-six-bugs-investigation-fixes.md`)
- [x] NOT committed — awaiting Asaf's local test per standing rule
