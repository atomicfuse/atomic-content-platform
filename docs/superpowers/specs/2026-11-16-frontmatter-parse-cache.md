# Frontmatter parsing without gray-matter's shared cache

**Date:** 2026-11-16 · **Status:** approved (option B) · **Owner:** content-pipeline

## Goal

Parse article frontmatter in the content pipeline so that no two parses share a `data`
object. This fixes hero images never reaching production, and stops the unbounded
parse cache.

## Problem (root cause, reproduced)

`gray-matter`'s `matter(input)` with no options caches its result in
`matter.cache[input]`. A repeat call with identical text returns
`Object.assign({}, cached)`, a shallow copy, so the **same `data` object** is handed
to every caller.

The n8n image callback (`processN8nImageResult`) parses the staging article and sets
`parsed.data.featuredImage = <hero>`. It then queues `applyHeroImagesToMain`, which
parses the `main` copy of the article. Before the image, the staging and `main` text
are byte-identical, so it gets the mutated cached object. It reads `featuredImage ===
<hero>`, decides `main` "already has this image" and returns `null`. The result is no
commit and no log line.

- 2026-11-16: 1 of 355 hero images reached `main`. That one had a duplicate n8n
  callback, so the staging text already differed from `main` and there was no cache hit.
- Reproduced with a local vitest against the real `main` file: `matter(raw)`, mutate
  `data`, then `heroImageUpdateForMain(raw, …)` returns `null`.

Secondary problems:

- **Memory:** every distinct article text ever parsed stays in `matter.cache` for the
  life of the process.
- **Silent failure:** `applyHeroImagesToMain` swallows every read error as "not
  published yet", so even a real failure would be invisible.

## Architecture

- New `src/lib/frontmatter.ts` exporting `parseFrontmatter(raw)`. It calls
  `matter(raw, {})`. Passing an options object skips gray-matter's cache read and
  write; parsing behaviour is otherwise identical, because the defaults are applied
  the same way.
- Every `matter(...)` parse in `services/content-pipeline/src` goes through
  `parseFrontmatter`. That covers agents, queue and scripts: 23 calls across 14 files.
  `matter.stringify` has no cache and stays as is.
- `applyHeroImagesToMain`:
  - logs read errors that are not a 404;
  - stays quiet for a 404 on `main`, which means the article isn't published yet;
  - logs one line when `main` already shows a non-default image, so a skipped update
    is visible.

## Components

| File | Change |
|---|---|
| `src/lib/frontmatter.ts` | new: `parseFrontmatter()` with the cache-bypass note |
| `src/__tests__/frontmatter.test.ts` | new: isolation + parity + guard tests |
| `src/__tests__/hero-image-to-main.test.ts` | extended: the exact production sequence |
| 15 source files listed in the plan | `matter(x)` → `parseFrontmatter(x)` |
| `src/agents/content-generation/hero-image-main.ts` | uses `parseFrontmatter`; logs non-404 read errors |

## Error handling

Parsing errors behave exactly as before; `parseFrontmatter` doesn't catch anything. In
the copy step, a 404 on `main` is still skipped silently. Any other read error is logged
with the path and the step moves on: it never throws, as now.

## Edge cases

- **Empty string:** gray-matter's early return (`{data:{}}`) still applies with options.
  A fresh object is returned each call.
- **Identical text parsed twice, first result mutated:** the second result is unaffected.
  This is the regression test.
- **Files with no frontmatter:** `data` is `{}`, same as before.

## Test plan

1. `parseFrontmatter` returns independent `data` objects for identical input: mutate the
   first, the second is unchanged.
2. `parseFrontmatter` output matches `matter()` (`data`, `content`) for a real article
   fixture.
3. `parseFrontmatter` doesn't grow `matter.cache`.
4. Regression on the production sequence: parse staging text, mutate `featuredImage`,
   then `heroImageUpdateForMain(sameText, hero, alt)` returns updated content, not `null`.
   This fails before the fix.
5. Guard: no file under `src/` other than `lib/frontmatter.ts` calls `matter(`, so a
   future caller can't reintroduce the shared cache.
6. `applyHeroImagesToMain` logs a non-404 read error, and stays quiet on a 404.
7. The full content-pipeline suite and typecheck stay green.

## Out of scope

- **Dashboard:** it has the same pattern in 16 places; this is a follow-up.
- **Backfilling `main` for images already on staging:** done manually on 2026-11-16
  (commit `514c90096` in the network repo).
- **Retrying or alerting on n8n trigger failures:** a separate follow-up.
