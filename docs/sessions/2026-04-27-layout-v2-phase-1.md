# Session: Layout v2 — design, plan, and Phase 1 implementation
**Date:** 2026-04-27 14:00–16:30 UTC
**Type:** Planning + Coding (subagent-driven)
**Duration:** ~2.5 hours
**Jira:** None

## What happened
User asked for a spec for a new magazine-style homepage + article-page layout, plus per-site control of brand colors, fonts, and layout knobs. After 6 clarifying questions and 5 design sections (each user-approved before moving on), the design was committed at `d3a43cf`. A 21-task implementation plan followed at `309af15`. Subagent-driven execution then completed Phase 1 (schema + resolver wiring) — 7 of 8 tasks, stopping before Task 1.8 because it crosses into the network repo and pushes to production. All Phase 1 work is on `feat/wizard-post-migration-rewrite` and reversible.

## Key outcomes
- Design + plan documents committed and cross-referenced in `docs/plans/`.
- 7 Phase-1 tasks complete: 9 commits, 109 unit tests passing (net +18), zero typecheck regressions in the touched packages.
- `LayoutConfig` and `LAYOUT_DEFAULTS` added to `@atomic-platform/shared-types` and exported from the barrel.
- `resolveLayout()` and `parseFeatured()` (build-time helpers) and `selectFeatured()` (runtime helper) all implemented test-first with TDD.
- `seed-kv.ts` now writes resolved layout + `theme.layout_v2` and parses `featured` frontmatter into the article index.
- Three real cleanup items surfaced into the backlog: stale `dist/` artifacts, Co-Author trailer mismatch, and an `as unknown as` cast in `seed-kv.ts` that hides missing required fields.

## Decisions made
- **Two-color brand model** (header `primary` + CTA `accent`) on top of variant-owned neutrals. Stored in existing `theme.colors.{primary,accent}` so the schema doesn't grow.
- **Frontmatter `featured: hero|must-read`** drives curated slots, with `selectFeatured()` auto-filling missing slots from the latest articles. Sane default for new sites.
- **Per-site `theme.layout_v2: true` toggle** for safe rollout. Allows the legacy and new layouts to coexist until Phase 4.2 cleanup.
- **Site-worker `/api/articles` endpoint** for Load More (server-rendered partial; `?page=N` URL fallback for no-JS).
- **Subagent-driven execution with phase checkpoints** — implementer + spec reviewer + code-quality reviewer per task, pausing for user authorization at the first cross-repo / production-affecting task.
- **Pause at Task 1.7** instead of finishing Task 1.8 autonomously, because 1.8 pushes to production network repo's main and triggers `sync-kv.yml`.

## Backlog items added
- Tech debt: `packages/shared-types/dist/*` stale-in-git cleanup (rebuild-on-change, or `dist/` to `.gitignore`). (→ `backlog/general.md`)
- Tech debt: reconcile Co-Author trailer (`Claude Opus 4.6` in CLAUDE.md vs `Claude Opus 4.7 (1M context)` in this session's commits). (→ `backlog/general.md`)
- Tech debt: remove the `as unknown as ResolvedConfig` cast at `seed-kv.ts:374` so missing required fields surface at typecheck. (→ `backlog/general.md`)
- Phase 1 follow-up: Task 1.8 (`org.yaml` defaults) needs user authorization to push to network main. (→ `backlog/general.md`)

## Post-deploy verification needed
**Phase 1 itself has no production effect.** When this branch merges to main:
- Verify `sync-kv.yml` writes `layout: { ... }` and `theme.layout_v2: false` to KV for every site (`wrangler kv key get site-config:<siteId>`).
- Verify deployed sites render the OLD layout (because `layout_v2: false`).
- Re-seed an article with `featured: hero` in frontmatter and confirm KV's article-index entry now has `featured: ['hero']`.

## Learning notes
**The 5-layer config inheritance chain is the load-bearing pattern.** `org.yaml → groups[*].yaml → overrides/config[*].yaml → site.yaml`, deep-merged via the existing `deepMerge` helper. Because `deepMerge` is generic (it doesn't care what keys exist), adding the new optional `layout?: LayoutConfig` block to `OrgConfig`, `GroupConfig`, and `SiteConfig` was a one-line change per type — no resolver changes needed for the merge step. The resolver only needs `resolveLayout()` to apply code-level defaults *after* the merged result is known. Task 1.3 added regression tests asserting this — even though they pass without code changes, they freeze the contract so a future "let's special-case array merge" change can't silently break layout merging.

**TDD discipline came from the `subagent-driven-development` skill.** Each subagent was instructed to write the failing test first, watch it fail with the right error (e.g. "Cannot find module"), and only then implement. This caught the C1 issue (missing barrel exports) on Task 1.1 — the implementer's tests passed in isolation, but the code-quality reviewer noticed Task 1.4's `import { LAYOUT_DEFAULTS } from '@atomic-platform/shared-types'` would fail at runtime because the new types weren't re-exported from `index.ts`. Without the review pass, that would have been a wasted Task 1.4 dispatch. Two-stage review (spec compliance, then code quality) is more expensive than one but catches different classes of mistake — spec review catches "did you build the right thing?" and quality review catches "is what you built well-built?".

**Per-site rollout toggles are cheap insurance for layout changes.** `theme.layout_v2: true` is a 1-line yaml addition that lets us land the new layout on staging, flip one production site at a time after sanity check, and keep the old code path until everyone's migrated. Phase 4.2 deletes the toggle once it's no longer needed. This pattern (additive types, defaults applied at resolve time, per-site toggle) generalizes to any future layout / theme change — adopt it as a convention.

**Auto-fallback in `selectFeatured()` is more important than it sounds.** A site with zero articles tagged `featured: hero` still renders correctly (latest 4 articles fill the hero grid). A site that just got created and has 3 articles renders all 3 in the hero grid (count clamps to pool size). This means: editors don't have to do anything special for the new layout to look right; flagging articles is purely an *editorial* decision to control top-of-fold, not a *correctness* requirement. Same pattern shows up in `resolveLayout()` (defaults), `parseFeatured()` (silent strip on bad data), and the eventual Load More API (empty slice → button hides).

## Related records
- Audit log: [audit-logs/2026-04-27-1400-layout-v2-phase-1.md](../audit-logs/2026-04-27-1400-layout-v2-phase-1.md)
- Plan: [plans/2026-04-27-layout-v2-and-site-controls.md](../plans/2026-04-27-layout-v2-and-site-controls.md)
- Design: [plans/2026-04-27-layout-v2-and-site-controls-design.md](../plans/2026-04-27-layout-v2-and-site-controls-design.md)
- Backlog: [backlog/general.md](../backlog/general.md) (4 items added)
