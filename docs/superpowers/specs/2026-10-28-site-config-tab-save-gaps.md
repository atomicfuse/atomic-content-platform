# Site Config tab — sections that never save

## Goal
Make every section shown in a site's **Config** tab either save to `site.yaml` or not appear there.

## Problem
`SiteConfigTab.handleSave` sends only `tracking`, `scripts`, `scripts_vars` and `ads_config`.
The form also renders **ads.txt**, **Theme** and **Legal**. Edits to those are dropped without any message.
The save still reports success and commits an unchanged `site.yaml`.
Found on hypezen on 2026-10-28: two empty commits, and `hypezen.com/ads.txt` stayed empty.

`/api/sites/save` has no handling for `ads_txt` or `legal` either, so sending them would not be enough.

## Architecture / components

| File | Change |
|---|---|
| `services/dashboard/src/lib/site-config-updates.ts` (new) | Pure helpers: `collectChangedSections()` (client: which sections changed since load) and `applyAdsTxtAndLegal()` (server: write the lists into the parsed `site.yaml`). |
| `services/dashboard/src/components/site-detail/SiteConfigTab.tsx` | Use `collectChangedSections()`, which now covers `ads_txt` and `legal`. Snapshot both on load and after a save. |
| `services/dashboard/src/app/api/sites/save/route.ts` | Call `applyAdsTxtAndLegal()` next to the existing `scripts`/`ads_config` handling. Accept `ads_txt` and `legal` in the body type. |
| `services/dashboard/src/components/config/UnifiedConfigForm.tsx` | Hide the **Theme** section when `mode === "site"`. The site's own **Theme** tab (`SiteThemeTab`) already edits the site theme, so a second editor that doesn't save is just confusing. |

## Data flow
Config tab form → `collectChangedSections()` → `POST /api/sites/save` `{ configUpdates: { ads_txt?, legal?, ... } }` → read `site.yaml` from git → `applyAdsTxtAndLegal()` → commit to `staging/<domain>` → `upsertSiteConfig` (Mongo dual-write, already in place) → sync-kv seeds staging KV → Publish to Production.

## Rules
- **ads.txt:** trim lines, drop blanks, dedupe. A non-empty list replaces the site's own `ads_txt`. An empty list removes the key; the site keeps whatever org/groups provide, since ads.txt is additive at seed time.
- **Legal:** drop empty-string values. A non-empty object replaces the site's own `legal`. An empty object removes the key, and org/group values flow through.
- Only send a section when it changed since load. This is the existing rule, so untouched sections never shadow inherited values.

## Edge cases
- **Stale Mongo copy.** The tab loads from Mongo, but the save writes the full ads.txt list. If Mongo is behind git, saving could drop entries that exist only in git. hypezen is in that state right now: Claude committed its ads.txt straight to git. Mitigation: re-sync hypezen's Mongo record (`backfill-mongo`) before anyone edits its ads.txt in the dashboard. The general Mongo-vs-git drift is out of scope.
- **Blank ads.txt lines** left in the editor are ignored.
- A site with **no `legal` / `ads_txt` key** loads as empty and saves nothing unless edited.

## Test plan
- Unit (`lib/__tests__/site-config-updates.test.ts`):
  - change detection includes `ads_txt`/`legal` only when changed;
  - apply: set, trim/dedupe, empty → key removed, legal blank values dropped, other keys untouched.
- Component (`components/config/__tests__/UnifiedConfigForm.site-sections.test.tsx`): site mode shows ads.txt and Legal and hides Theme; group mode still shows Theme.
- Full dashboard suite + `pnpm typecheck`, output saved to `docs/test-results/`.
- Manual (Asaf, local `grid dev`): add an ads.txt line on a staging site → Save → the commit diff contains `ads_txt` → staging `/ads.txt` serves it.

## Out of scope
- **Merge-mode selectors** ("add"/"replace") in the site tab. `merge_modes` is deliberately not persisted by the save route (commented out), so those selectors still do nothing. They should be fixed or hidden in a separate change.
- The **org/group rebuild button** timing out on many sites. That's a separate optional change, see the plan.
