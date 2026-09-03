# Spec: Six-bugs fix set (stale UI, ready/live, no-content, dedup, content types, 0-articles)

**Date:** 2026-07-16
**Status:** Implemented pending Asaf's local test (standing rule: no commit until approved)
**Investigation:** `docs/audit-logs/2026-07-16-0856-six-bugs-investigation.md` (full root-cause evidence)

## Goal

Fix the four code-level root causes found in the six-bug investigation (issues 1–4), document the operational remediations for issues 3/6, and report the content-type support assessment (issue 5).

## Root causes → fixes

| # | Issue | Root cause | Fix |
|---|-------|-----------|-----|
| 1 | UI stale after git actions | `migrateSiteToPerTopic` commits site.yaml to Git but never dual-writes MongoDB (`USE_MONGO_READS=true` reads only Mongo) → infinite staleness | **Fix A:** add `upsertSiteConfig` + `revalidatePath` after commit |
| 2 | Sites stuck on "Ready" | `goLive()` hardcodes `status: "Ready"` even when `custom_domain` is attached; `syncDomainsFromCloudflare` checks `staging_branch && Ready/Live` before `custom_domain` so it can never self-heal | **Fix B:** `goLive` → domain-aware status; sync → `custom_domain ⇒ Live` wins over keep-current |
| 3 | "No content in aggregator" | Per-topic filter topics AND `category_ids` with junk `tag_ids` (cross-vertical, from seed inference) → 0 matches; per-topic path lacks the legacy drop-tags fallback | **Fix C:** add drop-tags fallback to the per-topic filter path (retry categories-only when narrow returns nothing new); ops: clean giantsavings tags |
| 4 | Dedup broken across generation modes | Dedup index stores rewritten titles but checks source titles (dead signal); aggregator `item.id` never persisted (dead signal) → cross-run dedup is URL-exact-match only | **Fix D:** dedup index v2 with `ids`; persist `source_title` in frontmatter; check ids in all fetch loops; update queue worker + rebuild script + migration orchestrator |
| 5 | Content types | Assessment only: article=full, video=YouTube-only render, social_post=prompt-only, trend=undifferentiated | Report + backlog items (no code this session) |
| 6 | 0 articles on ~49 sites | US migration created a fresh Mongo; `articles` collection only populated incrementally on publish; counts read exclusively from Mongo | Ops runbook: existing `/reconcile-mongo` + `backfill-mongo.ts` (no new code needed) |

## Architecture notes

- Fix A mirrors the existing dual-write pattern (`actions/agent.ts:54-64`, `wizard.ts:392-395`).
- Fix B sync ordering: `Staging` stays sticky (a Staging site with a staging branch remains Staging); `custom_domain ⇒ Live` must be evaluated before the "keep Ready/Live" branch so stuck-Ready sites with a domain self-heal on next sync.
- Fix C mirrors `agent.ts:1096-1110` (legacy narrow→broad fallback). Fallback fires only for `filter` topics with BOTH non-empty `category_ids` and `tag_ids` (dropping tags with no categories would query the whole aggregator unfiltered).
- Fix D: `DedupIndexData` version bumps 1→2 (`ids: string[]` added). `parseDedupIndex` accepts v1 (ids=∅) so existing indexes stay valid — no forced full rescans. New frontmatter field `source_title` (the ORIGINAL aggregator title) is indexed into `titles` alongside the rewritten `title`, fixing the stored≠queried mismatch for all future articles. `existing.ids.has(item.id)` added to the legacy per-bundle loop and both per-topic loops.

## Error handling

- `upsertSiteConfig` is already soft-fail (logs, never throws) — migration success is not blocked by a Mongo outage; the reconcile safety net (backlog) covers the gap.
- Fix C logs the fallback distinctly (`narrow filter returned nothing — retrying without tag filter`) so misconfigured topics stay visible in logs.

## Edge cases

- Fix B sync: site with `custom_domain` but status `Staging` → stays Staging (unpublish intent wins; Staging-sticky is checked first). Ready/Live with a domain → Live.
- Fix D: v1 index without `ids` → parse succeeds, id-dedup contributes nothing until the index is rewritten by the next batch commit or `rebuild-dedup-index.ts`.
- Fix D: articles predating `source_title` → title dedup for them remains rewritten-title-only (as today); URL + id still guard.
- Fix C: topic with only tags (no categories) returning 0 → NO fallback (would un-filter entirely); classified by existing `describeZeroResultFetch`.

## Test plan

- Dashboard (vitest): per-topic migration asserts `upsertSiteConfig` + `revalidatePath` called; goLive status Live-vs-Ready both ways; sync self-heal matrix.
- Pipeline (vitest): dedup index v2 round-trip + v1 back-compat; id-based dedup in fetch loops; per-topic drop-tags fallback (narrow 0 → broad retry; no retry when categories empty); `source_title` written to frontmatter and merged into the queue worker's index update.

## Out of scope (→ backlog/notes)

- Extending `/reconcile-mongo` to `site_configs`/`dashboard_index`; a `commitAndSyncSiteConfig()` helper routing all config mutations; the non-persisting `POST /content-generate` fallback; URL normalization hardening; per-site generation lock; content-type gaps (trend prompts, non-YouTube embeds, social embeds, `source content_type` persistence); `kv-api.ts` Infinity TTL; rename-route Mongo audit; deleting dead `aggregator.ts`.
