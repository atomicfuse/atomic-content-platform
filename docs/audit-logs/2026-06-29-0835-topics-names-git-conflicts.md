# Audit: Stop persisting topic category/tag names in site.yaml (git conflicts)

**Date:** 2026-06-29 08:35 UTC
**Triggered by:** "i saw that i have few conflicts on git when i update the topics categories and tags on websites and try to save it as now it saves the categories and tags with names.. can you check and tell me why?"
**Session type:** Coding (bugfix / follow-up to 2026-06-28)
**Jira:** None

## Recent context
**Last session:** Theme/menu/topics fixes (2026-06-28, commit 83dac89) — added persisted `category_names`/`tag_names` to topic sources as defense-in-depth for display.
**Relevant:** That persistence is now causing git merge conflicts. The aggregator `?ids=` endpoint shipped (a65a251), so on-the-fly resolution is viable and persistence is redundant.

## Goal
Eliminate the git conflicts users hit when saving topic category/tag edits, by no longer writing `category_names`/`tag_names` into `sites/<domain>/site.yaml`. Names resolve live via `?ids=` for display.

## Investigation
- Save flow: `services/dashboard/src/app/api/sites/save/route.ts` writes `brief.topics_v2` to `site.yaml` and `commitSiteFiles(domain, files, msg, site.staging_branch)` → commits to `staging/<domain>`.
- Topic names are added client-side in `TopicEditModal.handleSave` + `PerTopicReviewScreen.handleSave` (this session's prior change).
- Conflict (user screenshots, PR #48 "staging/muvizz ↔ main"): the `staging` site.yaml topics block now carries `category_names:`/`tag_names:` blocks; `main` still has ids-only (and some `category_ids: []` from before the fix). Reconciling the branches conflicts on the topics region.
- **Root cause:** every save rewrites the entire topics block (adding name blocks), so ALL topics — even unedited ones — diverge from `main`, turning small/auto-mergeable diffs into overlapping conflicts. The persisted names also duplicate aggregator state into the config (drift).

## Decision: stop persisting names; resolve via `?ids=`
**Alternatives:**
1. **Keep persisting, fix the sync flow** — publish once so main also has names; future edits only conflict on real changes. Still duplicates state; still bloats yaml; conflicts recur whenever main/staging drift.
2. **Stop persisting; resolve live via `?ids=`** — config stores ids only (canonical). Names display via aggregator resolution. Minimal diffs; no duplication.

**Chosen:** #2. `?ids=` is deployed, cheap, and bounded — persistence is no longer needed for the display fix it was protecting. Config should not duplicate aggregator state. Directly removes the conflict amplification.
**Trade-offs:** If the aggregator deletes a tag, the modal shows the id instead of a last-known name (acceptable — arguably more honest than a stale name). The existing PR #48 conflict still needs a one-time manual resolution; future saves won't re-introduce it.

## Changes
- `services/dashboard/src/components/site-detail/TopicEditModal.tsx` — `handleSave` now writes `{type, category_ids, tag_ids}` only (strips name maps).
- `services/dashboard/src/components/topic-review/PerTopicReviewScreen.tsx` — same; ids-only on save.
- `packages/shared-types/src/config.ts` + `services/dashboard/src/types/dashboard.ts` — `category_names`/`tag_names` marked `@deprecated` (kept optional for legacy parse + display seed). Rebuilt shared-types `dist`.
- Display unchanged: `?ids=` resolution effect + legacy-name seed still populate names in the UI.
All `tsc --noEmit` clean (shared-types 0, dashboard 0, site-worker 0).

## Testing
- `TopicEditModal.test.tsx` — added "saves ids ONLY — strips legacy name maps"; existing "renders persisted names" still passes (seed path). 5 tests in file.
- Full dashboard suite: **289 passing / 0 failing** (+1 vs the 288 from the prior session). Saved `docs/test-results/2026-06-29-0835-topics-names-conflicts-dashboard.txt`.

## Final verification
| Check | Result |
|-------|--------|
| tsc — shared-types / dashboard / site-worker | PASS (0/0/0) |
| dashboard tests | 289 pass / 0 fail |

## Post-deploy verification
- After deploy: edit a topic, save, confirm `site.yaml` on staging has NO `category_names`/`tag_names` (ids only); confirm the modal still shows names (resolved via `?ids=`).
- Confirm subsequent staging↔main reconciles only show genuinely-changed topics.
- The current PR #48 conflict needs a one-time manual resolve (accept either side — names are cosmetic); future saves won't re-introduce it.

## CLAUDE.md updates
No structural change. (Reinforces existing principle: config stores aggregator *ids*, not denormalized names.)

## Docs sync
**Read:** `docs/backlog/general.md`. **Marked done:** the 2026-06-28 backlog note about persisted-names is superseded (names no longer persisted). **Added:** none new (this resolves a regression from the prior session).

## Session completion checklist
- [x] Audit log created BEFORE code changes
- [x] Changes logged with tsc result
- [x] Decision logged with alternatives
- [x] Tests updated + run
- [x] Delta stated (288 → 289)
- [x] CLAUDE.md checked
- [x] Docs synced
- [x] Session summary created (docs/sessions/2026-06-29-topics-names-git-conflicts.md)

> **NOT YET COMMITTED** — awaiting Asaf's local test + approval.
