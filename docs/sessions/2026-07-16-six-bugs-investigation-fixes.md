# Session: Six reported bugs — root causes + fix set

**Date:** 2026-07-16 08:56 UTC
**Type:** Investigation + Coding
**Duration:** ~1 hour
**Jira:** None

## What happened

Asaf reported six platform bugs (stale UI after site actions, sites stuck on "Ready", false "no content in aggregator", broken dedup across generation modes, uncertain content-type support, 0-article counts on ~49 sites after the US server migration). Six parallel investigation agents produced evidence-backed root causes, all verified against the code before touching anything. Four code fixes were implemented TDD-first; issues 5/6 turned out to need a report + an ops runbook rather than new code. **Nothing committed — pending Asaf's local test per the standing rule.**

## Key outcomes

- **#1 stale UI:** dashboard reads from Mongo (`USE_MONGO_READS`); `migrateSiteToPerTopic` committed to git only → infinite staleness. Fixed with the dual-write pattern. CLAUDE.md's cache guidance was stale (named caches/`invalidateSiteCaches` no longer exist) and was rewritten.
- **#2 ready/live:** `goLive()` hardcoded `Ready`, demoting already-Live sites (DogsLabs' exact git history confirmed it), and the Cloudflare sync's branch order made self-heal dead code. Both fixed; DogsLabs heals on next sync.
- **#3 no content:** giantsavings' per-topic filters AND finance categories with cross-vertical junk tags (nutrition/AI/sleep) → guaranteed 0 matches; per-topic path lacked the legacy drop-tags fallback. Fallback added; data fix + f57293a audit in the runbook.
- **#4 dedup:** cross-run dedup had collapsed to exact-URL match (index stored rewritten titles but checked source titles; aggregator id never persisted). Dedup index v2 (ids + source_title) with v1 back-compat; checks added to all three fetch loops.
- **#5 content types:** support matrix delivered — article full, video YouTube-only (non-YouTube silently dropped after the article promises an embed), social_post prompt-only, trend completely undifferentiated. Routed to bugs.md/notes.md.
- **#6 zero articles:** fresh US Mongo + incremental-only writes. Tooling already exists (`/reconcile-mongo`, `backfill-mongo.ts`) — runbook written; needs prod secrets to execute.

## Decisions made

- Sync status order: Staging-sticky > custom_domain⇒Live > keep — heals stuck-Ready without fighting unpublish intent.
- Dedup fixed via persisted stable ids (v2 index, back-compatible) rather than URL canonicalization or a new Mongo registry.
- Per-topic fallback only fires when categories remain (never degrade to an unfiltered query).
- No code for #6 — existing backfill tooling + runbook; execution is Asaf's call (prod secrets).

## Tests added

- +13 dashboard (302 total, from 289), +12 new/extended pipeline assertions (627 total, from 592 — the rest of the delta is the stats/costs/alerts suites unblocked by repairing a corrupted mongodb-memory-server binary cache, an env fix).
- Test-results: `docs/test-results/2026-07-16-0930-six-bugs-dashboard.txt`, `docs/test-results/2026-07-16-0930-six-bugs-content-pipeline.txt`. All green; typecheck 5/5, build 4/4.

## Items captured this session

**To `docs/bugs.md` (created):** silent article loss on Redis-down fallback [High]; non-YouTube video embeds dropped; rename-route Mongo sync unverified; Infinity-TTL KV cache. **[High] count: 1/3.**
**To `docs/backlog/general.md`:** Mongo backfill run [High]; giantsavings tags + f57293a audit; rebuild-dedup-index --all; extend `/reconcile-mongo` to configs; `commitAndSyncSiteConfig()` helper; URL normalization hardening. **[High] count: 1/3 in the new section** (pre-existing backlog uses a different convention).
**To `docs/notes.md`:** trend/social_post handling, `content_type` persistence, dead `aggregator.ts`, notes.md doc rot, per-topic AND semantics. All 6 categories reviewed.

## Items completed this session

The four code-level bugs (#1–#4) — implemented and green, pending Asaf's local test + commit.

## Post-deploy verification needed

See audit log — reconcile-mongo run + counts check, DogsLabs Ready→Live via sync, per-topic migration reflects immediately, giantsavings generates via fallback, dedup rebuild then cross-mode generation produces no dup.

## Learning notes

The platform quietly migrated from "git is the database" to a MongoDB read layer behind `USE_MONGO_READS`, but not every write path was taught to dual-write — and Mongo, unlike the old TTL caches, never self-heals, so a missed write is *forever* stale, which is why the UI looked an hour+ behind git. The same migration to a fresh US Mongo instance explains the 0-article counts: the `articles` collection is only ever appended to on publish, never recomputed from source. The dedup bug is a classic key-mismatch: the system stored one representation (LLM-rewritten title) and queried with another (original aggregator title), so that check could never match across runs — always verify that a persisted dedup key and the lookup key are produced by the same function on the same value. Finally, the aggregator ANDs filter dimensions, so per-topic "categories AND tags" is only as good as the worst tag in the list; a fallback that drops the narrower dimension makes the system degrade gracefully instead of reporting "no content exists".

## Related records

- Audit log: `audit-logs/2026-07-16-0856-six-bugs-investigation.md`
- Spec: `superpowers/specs/2026-07-16-six-bugs-fix-set.md`
- Plan: `superpowers/plans/2026-07-16-six-bugs-fix-set.md`
- Runbook: `runbooks/2026-07-16-post-us-migration-remediation.md`
- Test results: `test-results/2026-07-16-0930-six-bugs-*.txt`
- Files touched: `bugs.md` (created), `backlog/general.md`, `notes.md`
