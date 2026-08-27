# Spec — Auto-publish must not destroy late staging commits

**Date:** 2026-08-27
**Bug:** B (of two found in the image-alert investigation)

## Goal

Stop `autoPublishSite` from force-resetting a staging branch when commits have
landed on it since the branch was snapshotted, which permanently destroys those
commits.

## The defect

`autoPublishSite` does three things in sequence:

1. snapshot `sites/<domain>/` from `staging/<domain>`
2. commit that snapshot to `main`
3. **force-reset `staging/<domain>` to `main` HEAD**

Anything committed to the staging branch between (1) and (3) is copied nowhere
and then erased by (3).

n8n image callbacks commit article frontmatter (`featuredImage`) to the staging
branch asynchronously, ~20s after the article is created. Auto-publish runs from
the scheduler's parent job as soon as the generation children finish, which
overlaps that window.

### Observed instance — 2026-08-27 morning run

12 articles generated. All 12 logged `Git commit OK` + `SUCCESS — image
delivered` (n8n durations 20.4s–23.6s; zero image failures). Five nonetheless
carry `<site>-general-article.webp` on `main`:

| Article | Image committed to staging | On `main` |
|---|---|---|
| trendscores/brazil-womens-u20-world-cup-poland-arrival | 09:01:08 | general |
| dramadispatch/i-knew-you-were-trouble-transformed-from-ballad-to-dubstep | 09:01:11 | general |
| dramadispatch/olivia-jade-taylor-fritz-dating-rumors | 09:01:19 | general |
| trendscores/india-panama-friendly-test-world-cup | 09:01:21 | general |
| diydecorschool/elevate-fall-decor-cinnamon-tones | 09:01:26 | general |

Auto-publish commits landed ~09:02. The image bytes are still in R2 (all five
return HTTP 200 at `/<siteId>/assets/images/<slug>.webp`) — only the frontmatter
reference was lost.

The existing `clearTreeCache(stagingBranch)` guard (added for this same concern)
fixes stale *caching* but not the *interleaving*: a fresh snapshot taken at T0 is
still stale relative to a commit landing at T0+n.

## Architecture

Contained entirely within `autoPublishSite`. No new infrastructure, no shared
state, no change to the image-callback path.

Compare-and-swap on the staging ref:

- read the staging ref SHA **before** snapshotting (`shaAtSnapshot`)
- after committing to `main`, re-read it (`shaNow`)
- `shaNow === shaAtSnapshot` → safe to reset
- otherwise → commits arrived during the copy; redo the copy (bounded retries)
- retries exhausted → **skip the reset** and log loudly

Leaving staging ahead of main is always safer than destroying commits: the
preview stays correct, and the next auto-publish for that site copies the
commits to main. Nothing is lost.

Reading the ref *before* `getTreeCached` resolves its own ref makes the
comparison conservative in the safe direction. If a commit lands in the gap
between our read and the tree fetch, the snapshot already contains it and we
detect drift anyway — causing one harmless redundant copy, never a silent loss.

## Components

- **Modify** `services/content-pipeline/src/queue/scheduler-flow.ts`
  - add `getBranchSha()` — read a branch's head SHA, `null` if absent
  - add `decideStagingReset()` — pure CAS decision, exported for unit test
  - restructure `autoPublishSite` into a bounded attempt loop
- **Modify** `services/content-pipeline/src/__tests__/auto-publish.test.ts`
  - unit tests for `decideStagingReset`
  - orchestration tests for `autoPublishSite` drift behaviour

## Data flow

Unchanged on the happy path: snapshot → commit to main → Mongo dual-write →
reset staging → cache invalidation. The loop only re-enters when drift is
detected, and the reset + `deleteArticlesForSiteBranch` are skipped when it
cannot be done safely.

## Error handling

- `getBranchSha` returns `null` on any failure (missing branch, API error).
  Either SHA being `null` → decision is `reset`, preserving today's behaviour
  including the create-branch fallback.
- Drift detected with retries exhausted → skip reset, `console.warn`, return
  normally. Not an exception: the publish to `main` succeeded.
- `deleteArticlesForSiteBranch` runs **only** when the reset actually happens —
  otherwise the staging Mongo docs still describe live staging content.

## Edge cases

- Staging branch does not exist → `null` SHA → reset path → existing
  `createRef` fallback still applies.
- No files under `sites/<domain>/` → early return, unchanged.
- Repeated drift (a very chatty site) → bounded at 3 attempts, then skip.
- Re-copy commits identical content → harmless; drift means content changed.
- Drift on a staging branch is always *this* site's commits: only this site's
  content and image callbacks write to `staging/<domain>`.

## Test plan

`decideStagingReset` (pure):
- equal SHAs → `reset`
- differing SHAs, attempts remain → `recopy`
- differing SHAs, final attempt → `skip` with reason
- either SHA `null` → `reset`

`autoPublishSite` (injected fake Octokit, mocked github/db modules):
- no drift → commits to main AND force-resets staging
- drift → commits to main, **never** calls `updateRef`, never deletes staging
  article docs
- drift on first attempt then settles → re-copies, then resets
- the regression assertion: with drift present, the pre-fix code called
  `updateRef` — the new test fails against it

## Out of scope

- Bug A (per-replica in-memory image tracking / false timeout alerts) — next.
- Re-pointing the 5 already-lost `featuredImage` values — separate remediation.
- Dual-committing image callbacks to `main` (considered, not chosen).
- Any change to alert behaviour.
