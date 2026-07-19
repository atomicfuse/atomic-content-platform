# Session: Article counts + staging banner — root-cause investigation + banner ops fix
**Date:** 2026-07-19 13:24 UTC
**Type:** Investigation + Ops
**Duration:** ~40 minutes
**Jira:** None

## What happened
Asaf reported that some sites still show "–" in the Sites table Articles column (and an empty Content tab) despite the 2026-07-16 backfill, and that the yellow "unpublished changes on staging" banner no longer appears after site edits. Both were traced to root cause with code-level and live-API evidence; no code was changed (findings + fix proposals delivered for approval per the local-testing gate).

## Key outcomes
- **Counts:** `autoPublishSite` (scheduler-flow.ts) re-keys Mongo article docs to branch `"main"` and deletes the staging-branch docs on every nightly publish, while all dashboard reads query only `branch = staging_branch`. Auto-published Live sites therefore always count zero. This also explains why the 07-16 backfill "didn't stick."
- **Banner:** commit 9f77622 switched `hasPendingChanges` from `ahead_by > 0` to filtering the GitHub compare `files` list by `sites/<domain>/` — but that list caps at 300 alphabetical entries, and 10 staging branches carry thousands of cross-domain files from the topic-backfill batch op, pushing the site's own files out of the window. Verified live against all 51 staging branches.
- Two [High] bugs recorded in `docs/bugs.md` with fix directions (union staging+main reads / tree-SHA compare per domain).
- **Banner bug FIXED same day (ops, no code):** ran the cross-domain cleanup script (9 branches, ~3.5k files each), then — after discovering revert commits don't move the merge-base GitHub compares against — merged `origin/main` into 8 polluted branches and pushed (normal merges; conflicts resolved own-domain→staging, cross-domain→main). Full 51-branch API re-scan confirms every processed branch now returns an exact domain-only compare. `chaibeseret` + `travelingfoodie2` skipped per Asaf (sites will be deleted). Hardening ideas parked in `notes.md` → "Staging-branch hygiene". Local uncommitted tweak: `cleanup-staging-crossdomain.sh` `NETWORK_REPO` is now env-overridable.

## Decisions made
- Report findings without implementing — fix shape needs operator's choice and the no-untested-commits rule applies.

## Article-counts fix implemented (same session, after Asaf's go-ahead)
Dual-branch reads in `services/dashboard/src/lib/db/articles.ts` (TDD): `countArticlesForSites` now matches `branch ∈ {staging_branch, "main"}` per site (null-staging sites included via main) and counts distinct slugs; `readArticlesFromDb` unions staging+main and dedupes by slug preferring the staging doc. Spec/plan in `docs/superpowers/`. **Uncommitted — awaiting Asaf's local test + approval.** Note: local dev uses the Git read path, so the fix is proven by unit tests and verifiable in production after deploy (see audit log post-deploy checklist).

## Follow-up: .gitkeep surfaced as an article (same session, post-deploy)
The dual-branch read exposed placeholder docs: `autoPublishSite` had been dual-writing `articles/.gitkeep` to Mongo as an article (slug `.gitkeep`, branch `main`) for every auto-published site. Fixed both sides TDD: pipeline `isArticleMarkdownPath()` filter in the auto-publish dual-write, and a dot-slug exclusion (`{$not: /^\./}`) in both dashboard read queries so the existing prod docs disappear without a migration.

## Tests added
- +4 dual-branch tests (union counting, empty-input guard, slug dedup preference, main-only default) + 2 dot-slug filter tests in `src/lib/db/__tests__/articles.test.ts`; +2 `isArticleMarkdownPath` tests in pipeline `auto-publish.test.ts`. Dashboard suite 307 → 313; pipeline suite 629, all green.
- Test-results files: `docs/test-results/2026-07-19-article-counts-dual-branch.txt`, `2026-07-19-gitkeep-filter-dashboard.txt`, `2026-07-19-gitkeep-filter-pipeline.txt`.

## Items captured this session
**To `backlog.md`:** None
**To `bugs.md`:** "Article counts disappear for auto-published sites" [High] (Dashboard); "Unpublished-changes banner hidden on polluted staging branches" [High] (Dashboard)
**To `notes.md`:** None — reviewed all 6 categories
**[High] count in backlog.md:** 0 / 3
**[High] count in bugs.md:** 2 / 3 (banner bug ticked off same day; article-counts + Redis-loss remain)

## Items completed this session
**Backlog items closed:** None
**Bugs ticked off:** "Unpublished-changes banner hidden on polluted staging branches" (2026-07-19, ops fix — see audit log Change 1)

## Post-deploy verification needed
- None — no code changes. (For the eventual fixes: counts visible for wineoceans/decoratingmom/etc.; banner appears after editing topics on hiddenstorydaily.)

## Learning notes
The article-count bug is a lesson in *key migration during lifecycle transitions*: the Mongo `articles` collection is keyed by `(domain, slug, branch)`, and auto-publish deliberately re-keys docs from the staging branch to `main` (then deletes the staging copies so a reset branch doesn't leave ghosts). That's internally consistent for the pipeline, but every dashboard read assumed articles always live under the site's `staging_branch` — so the read and write sides disagree about which key is authoritative after publish. When a store is keyed by a mutable dimension (branch), every reader must handle all states of the lifecycle, not just the pre-publish one. The banner bug is a classic *silent API truncation*: GitHub's compare endpoint returns at most 300 files with no error, so a filter applied to that list is only correct when the true diff is small; a boolean derived from a truncated list flips to a confident false negative. Deriving "does this subtree differ?" from tree SHAs (content-addressed hashes) is both exact and cheap, which is why it's the recommended fix over paginating file lists.

## Related records
- Audit log: `audit-logs/2026-07-19-1324-article-counts-staging-banner.md`
- Prior related sessions: `sessions/2026-07-16-mongo-mirror-gaps.md`, `sessions/2026-07-16-six-bugs-investigation-fixes.md`
- Files touched: `bugs.md`
