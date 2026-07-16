# Session: Mongo dual-write gaps — sync + wizard flows (six-bugs follow-up)

**Date:** 2026-07-16 14:55 UTC
**Type:** Coding + Ops (continuation of the six-bugs session)
**Jira:** None

## What happened

After the six-bugs deploy, Asaf clicked "Sync Domains" and saw no UI change. The sync had worked in git (DogsLabs → Live) but `syncDomainsFromCloudflare` never mirrored to MongoDB — the dashboard's actual read source. An index-phase backfill (user-approved) unblocked the UI immediately; a systematic audit of all 15 git-index write sites then surfaced four more mirror gaps, all fixed TDD-first in this session. Earlier in the day (same conversation): prod Mongo articles backfilled (49 sites / 4,093 articles, verified against git), six-bugs fix set deployed, and dedup v2 indexes rebuilt + pushed to all 49 staging branches (0 failures).

## Key outcomes
- Sync action, attach-rollback paths (×3), wizard re-run mirror scope, saved previews, and trash-restore all dual-write Mongo correctly now.
- Rename route verified CORRECT — removed from bugs.md (bad entry).
- Dashboard suite 302 → **307**, all green; typecheck clean.

## Decisions made
- Per-entry Mongo mirroring (not bulk collection rewrite) — avoids clobbering concurrent writers.
- Wizard re-run mirrors only the 5 git-updated fields — Mongo must never receive values git preserved.
- Restore upserts the actual restored entry — self-heals missing/deleted Mongo docs.

## Tests added
- +5 (sync-action.test.ts ×3 new file, attach-domain.test.ts ×2 rollback regressions).
- Test-results: `docs/test-results/2026-07-16-1510-mongo-mirror-gaps-dashboard.txt`.

## Items captured / completed
- bugs.md: rename entry removed (3 open, 1 High). Backlog `commitAndSyncSiteConfig` helper stays open (reduced urgency).
- Ops completed today: article backfill, index backfill, deploy, dedup rebuild 49/49, Sync Domains (DogsLabs → Live confirmed in git).

## Post-deploy verification
- Sync Domains → status changes visible in UI immediately, no backfill.
- Failed domain attach → site does NOT show Live/domain afterwards.

## Learning notes
When a system migrates its read path (git → Mongo), every writer becomes a dual-writer, and the failure mode of a missed mirror is *permanent* staleness, not eventual consistency — so the audit unit is "every write site," not "the write sites that were reported broken." The subtlest gap class was the rollback: an optimistic mirror (write Mongo before external calls) obligates every failure path to un-mirror, which is why centralizing revert logic in a `rollbackAttach()` helper beats three hand-copied catch blocks. Second lesson: mirror exactly what the source-of-truth write changed — mirroring a rebuilt full entity (`siteEntry`) silently clobbers fields the git path deliberately preserved.

## Related records
- Audit log: `audit-logs/2026-07-16-1455-mongo-mirror-gaps.md`
- Morning session: `sessions/2026-07-16-six-bugs-investigation-fixes.md`
