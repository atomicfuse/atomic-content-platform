# Audit: Mongo dual-write gaps — sync action + wizard flows (six-bugs follow-up)

**Date:** 2026-07-16 14:55 UTC
**Triggered by:** Asaf clicked "Sync Domains" after the six-bugs deploy and saw no UI change. Investigation showed the sync worked in git (DogsLabs → Live, commit `235f6b150`) but `syncDomainsFromCloudflare` never mirrors to MongoDB — the same class as bug #1, in an action whose *logic* was fixed this morning but whose write path wasn't audited.
**Session type:** Coding (continuation of `2026-07-16-0856-six-bugs-investigation.md`)

## Ops performed (user-approved)
- `POST /api/agent/backfill-mongo {"phases":["index"]}` against `sites-platform-e297` → `indexEntriesBackfilled: 49`, 0 errors. UI unblocked (DogsLabs shows Live).

## Investigation
Systematic audit of ALL 15 git-index write sites (agent-verified, file:line evidence): 10 correct, 4 gaps + the sync action:
1. `sync.ts` — no Mongo mirror at all (the reported symptom).
2. **HIGH:** `wizard.ts` attach rollback paths (3 catch blocks) revert git but not Mongo → UI shows Live + attached domain for a failed attach, forever.
3. **MED:** wizard re-run on an existing site mirrored the freshly-built `siteEntry`, clobbering preserved Mongo fields (`custom_domain`, `site_id`, `created_at`, …).
4. **LOW:** `saveStagingPreview` never mirrored `saved_previews`.
5. **LOW:** `restoreSiteEntry` mirrored hardcoded `Staging` while git may restore Live/Ready; also used non-upsert update (no-op if doc missing).
Cleared: rename route (has full mirror `route.ts:153-172`) — the bugs.md entry for it was wrong and is removed.

## Changes
1. `src/actions/sync.ts` — track changed sites; after `writeDashboardIndex`, mirror each status change via `updateDashboardIndexEntry` and each orphan removal via `deleteDashboardIndexEntry`.
2. `src/lib/db/dashboard-index.ts` — new `deleteDashboardIndexEntry` (soft-fail, matches module style).
3. `src/actions/wizard.ts` — `rollbackAttach()` helper reverts git AND Mongo in all 3 attach failure paths; wizard re-run mirrors only the 5 fields git updates; `saveStagingPreview` mirrors `saved_previews`.
4. `src/actions/sites.ts` — `restoreSiteEntry` upserts the actual restored entry (status re-detected by `restoreSiteInIndex`).

## Decisions
- Mirror per-entry (`updateDashboardIndexEntry` loop) rather than bulk-rewriting the collection from the full index: bulk overwrite would clobber concurrent writers; per-entry matches the established pattern.
- Wizard re-run: mirror scoped fields, not the rebuilt entry — Mongo must never receive values git preserved.
- Restore: upsert full entry (doc may be absent or status:"deleted" in Mongo; upsert self-heals both).

## Testing
- New: `src/actions/__tests__/sync-action.test.ts` (3 — status change mirrored, orphan removal mirrored, no-op when unchanged); `attach-domain.test.ts` +2 (rollback mirrored on CF failure and KV failure).
- Full dashboard suite: **307 passing** (302 → 307, Δ +5), 0 failures. `tsc --noEmit` PASS.
- Artifact: `docs/test-results/2026-07-16-1510-mongo-mirror-gaps-dashboard.txt`.

## Post-deploy verification
- Click "Sync Domains" → any status change appears in the UI immediately (no backfill needed).
- Attach a domain to a test site with an intentionally-bad zone → after the error, the site does NOT show Live/domain in the UI.

## Docs sync
- `bugs.md`: removed the rename-route entry (verified NOT a bug — mirror exists). Other entries unchanged.
- Backlog item "commitAndSyncSiteConfig helper" remains open — these fixes reduce its urgency but the systemic helper is still the right end state.

## Status
Implemented + green. NOT committed — awaiting Asaf's check/approval per standing rule.
