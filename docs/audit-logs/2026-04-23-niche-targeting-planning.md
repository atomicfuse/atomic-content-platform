# Audit Log: Niche Targeting Wizard Step — Planning Session

**Session type:** Implementation planning
**Date:** 2026-04-23
**Branch:** `michal-dev`
**Spec:** `docs/specs/site-builder-v2-plan.md`
**Plan:** `docs/plans/2026-04-23-niche-targeting-wizard-step.md`
**Triggered by:** Add "Niche Targeting" wizard step per site-builder-v2-plan spec — IAB taxonomy selection with auto-bundle creation

---

## Pre-flight Checks

- [x] Read spec: `docs/specs/site-builder-v2-plan.md`
- [x] Read spec: `docs/specs/smart-override-merge-modes-spec.md` (context for config architecture)
- [x] Read API ref: `services/content-pipeline/content-aggr-API.md`
- [x] Reviewed current wizard flow: `WizardShell.tsx` (7-step), `page.tsx`, all Step components
- [x] Reviewed `WizardFormData` type in `types/dashboard.ts`
- [x] Reviewed wizard server actions: `actions/wizard.ts` (createSiteAndBuildStaging)
- [x] Reviewed existing aggregator integration: `/api/verticals`, `/api/audiences` proxy routes, `reference-data.ts`, `useReferenceData.ts`
- [x] Reviewed existing UI components: `Select`, `Input`, `Button`, `Badge`

## Key Findings

1. **Current wizard is 7 steps**: Create Site → Groups → Theme → Content Brief → Script Vars → Preview → Review
2. **Vertical dropdown lives in StepIdentity** (step 1) — needs to move to new Niche Targeting step
3. **No existing API routes** for categories, tags, or bundles — need to create proxy routes
4. **`useVerticals` hook discards `iab_code`** — `extractItems()` only keeps `{ id, name }`. Need to extend.
5. **`WizardFormData` has no niche fields** — needs `categoryIds`, `tagIds`, `tagNames`, `iabVerticalCode`, `iabCategoryCodes`
6. **`createSiteAndBuildStaging` has no bundle logic** — needs post-creation bundle creation call

## Decisions Made

See `docs/decisions/2026-04-23-niche-targeting-decisions.md`

## Plan Created

`docs/plans/2026-04-23-niche-targeting-wizard-step.md` — 8 tasks covering types, API routes, hooks, UI component, wizard wiring, bundle creation, vertical IAB exposure, and integration verification.

## Backlog Items Added

Appended to `docs/backlog/general.md`:
- Bundle lifecycle hooks (deactivate/delete/rename with site)
- Edit niche targeting on existing site detail page
- Migration: create bundles for existing sites with verticals
- Content agent: fetch by bundle_id instead of vertical_id
- Ad-tech IAB metadata pipeline (sellers.json, GPT, Prebid)
