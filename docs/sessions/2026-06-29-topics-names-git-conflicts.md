# Session: Stop persisting topic names in site.yaml (git conflicts)

**Date:** 2026-06-29 08:35 UTC
**Type:** Coding (bugfix — follow-up to 2026-06-28)
**Jira:** None

## What happened
After the 2026-06-28 topics fix shipped, saving topic category/tag edits started producing git merge conflicts between `staging/<domain>` and `main`. Root cause: that change persisted `category_names`/`tag_names` into `sites/<domain>/site.yaml`, rewriting the entire topics block on every save. Since `main` still had ids-only topics, reconciling the branches conflicted across the whole block (even on unedited topics). Fix: stop persisting names; resolve them live via the aggregator `?ids=` endpoint (now deployed). site.yaml returns to ids-only.

## Key outcomes
- Both save handlers (`TopicEditModal`, `PerTopicReviewScreen`) write `{type, category_ids, tag_ids}` only; legacy name maps are stripped on next save.
- Names still display (live `?ids=` resolution + legacy seed). Type fields marked `@deprecated` for backward-compatible parsing.
- Dashboard suite 289/0 (+1 test asserting save strips names). All typechecks clean.

## Decisions made
- Stop persisting names rather than fixing the sync flow — config should store the canonical aggregator *ids*, not a denormalized name copy. `?ids=` makes live resolution cheap/bounded, so persistence is redundant and was the conflict amplifier.

## Tests added
- +1 (`TopicEditModal` "saves ids ONLY"). Test-results: `docs/test-results/2026-06-29-0835-topics-names-conflicts-dashboard.txt`.

## Items captured this session
None new. Supersedes the prior session's persisted-names approach.

## Post-deploy verification needed
Edit/save a topic → staging site.yaml has no name maps; modal still shows names. Existing PR #48 conflict needs a one-time manual resolve.

## Learning notes
The lesson is a data-modeling one: don't denormalize external system state into a version-controlled config. Topic filters reference the aggregator by id; the human-readable names live in the aggregator. Copying names into site.yaml created two sources of truth — every save rewrote the block, and because git merges line-by-line, the duplicated name lines turned routine edits into staging↔main conflicts. The durable fix is to resolve names at the edge (display time) via the `?ids=` endpoint and keep the persisted config minimal and canonical. Defense-in-depth (persisting) was a reasonable hedge *before* `?ids=` existed; once the cheaper live-resolution path shipped, the hedge became pure cost.

## Related records
- Audit log: `audit-logs/2026-06-29-0835-topics-names-git-conflicts.md`
- Supersedes part of: `sessions/2026-06-28-theme-menu-topics-fixes.md` (commit 83dac89)
