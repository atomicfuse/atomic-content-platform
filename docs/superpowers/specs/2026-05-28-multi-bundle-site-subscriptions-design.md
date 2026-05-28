# Multi-Bundle Site Subscriptions

**Date:** 2026-05-28
**Status:** Design — awaiting user review

## Problem

A site today can target only **one** tier-1 category (e.g. Travel), and the platform UI then restricts its subcategory and bundle composition to children of that single category. This produces an inadequate content match for sites whose editorial scope is thematic rather than taxonomic.

Concrete case driving this work: **travelnights**. Site is categorized as Travel; menu sections include Culture, Destinations, Food, Guides & Tips, News. Under the current model the platform never fetches food, culture, or lifestyle content for the site because those live under different tier-1 categories. Adding multiple tier-1 categories (or removing the subcategory-under-parent constraint) is not a fix on its own: the site needs **food while traveling**, not generic food; **culture while traveling**, not generic culture.

The platform user (asaf) has been working around this by curating bundles directly on the aggregator UI after site creation — which means the platform's automated bundle creation is effectively decorative.

## Why the obvious fixes don't work

The aggregator's bundle engine matches with **OR within each dimension, AND across dimensions**:

```
match(item, bundle) =
  (category_ids empty OR item.categories ∩ bundle.category_ids ≠ ∅)
  AND
  (tag_ids empty OR item.tags ∩ bundle.tag_ids ≠ ∅)
```

That semantic rules out the two obvious-looking solutions:

1. **One bundle, expanded categories** — e.g. `{category_ids: [Travel, Food, Culture]}` admits all of generic food and culture. Recreates the original "general food, not travel-food" complaint.
2. **One bundle, broad categories ANDed with theme tags** — e.g. `{category_ids: [Travel, Food, Culture], tag_ids: [culinary-travel, food-travel, food-tours]}`. AND-across-dimensions means a pure Travel article without any of those tags is **excluded**. Fixes travel-food at the cost of losing general travel content. Inverts the problem.

The intent for travelnights is logically **OR across category-tag groupings**:

```
(Travel-tier1)                                 ← broad travel
OR (Food-tier1 + travel-flavor tags)           ← only travel-themed food
OR (Culture-tier1 + travel-flavor tags)
```

The aggregator's single-bundle engine cannot express this. Three structural options to deliver it:

- **(a)** Pick a ubiquitous theme anchor (`Travel` tag or `Travelers` audience) that all desired content reliably carries, then use a single AND-bundle. Cheap, but fragile (silently breaks when the anchor isn't assigned), and `audience_ids` is not accepted by bundle rules today.
- **(b)** Let a **site subscribe to N bundles** and union the matches at fetch time. Each bundle stays tightly focused; the OR happens above the bundle layer.
- **(c)** Extend the aggregator engine so bundle rules become an array of AND-groups OR'd together. Maximum expressivity, requires aggregator schema and engine work.

This design picks **(b)**. It expresses the intent using primitives the aggregator already supports, requires no aggregator engine change, keeps bundles small and reusable across sites, and remains debuggable per-bundle.

## Design

### 1. Data model

`brief.bundle_id?: string` (singular, today) becomes `brief.bundle_ids: string[]` on the `SiteBrief` type. A site subscribes to zero or more bundles; content fetch resolves the union of matches across them.

Aggregator-side bundle schema is unchanged. Bundles remain `{ name, description, active, rules: { category_ids, tag_ids } }`.

Backwards compatibility: any existing site config carrying `bundle_id` is read as `bundle_ids: [bundle_id]` at load time. Saves always write the new shape; the old field is dropped when a site is next saved.

### 2. Bundle subscriptions UI — Site Settings → Content Brief

Replace today's single-bundle niche-targeting block with a list of bundle subscriptions for the site:

- Each row: bundle name, a one-line rules summary (e.g. `Travel` or `Food + tags: culinary-travel, food-travel, food-tours`), and a remove control.
- "Add bundle" opens a modal with two paths shown together (no tabs):
  - **Connect existing** — searchable list of all aggregator bundles, sorted by usage count across sites, multi-select. This is the encouraged path.
  - **Create new** — focused-bundle form: one tier-1 category (or a single child), optional subcategories, optional tags. Save creates the bundle on the aggregator and adds it to the site's subscriptions in the same action.

The form for "Create new" deliberately allows only one tier-1 (or a single child) plus tags. The goal is to push users toward composing many small reusable bundles rather than one bloated bundle per site. Power users continue to do deeper curation directly on the aggregator UI.

The legacy "Niche Targeting" block (one tier-1 + child subcats + tags) is removed from the Content Brief tab and replaced entirely by the subscriptions list. The same data is now expressed through one or more focused bundles.

### 3. Wizard step — Niche Targeting

The wizard's niche-targeting step is restructured into a single screen with two sections, both visible at once:

1. **Suggested bundles** — list filtered by the tier-1 category the user picks (the step still asks for a category to anchor suggestions), sorted by usage count. Multi-select checkboxes. Empty state when the library is thin.
2. **Create a starter bundle (optional)** — inline focused-bundle form below, prefilled from the niche-targeting choices.

Submit subscribes the new site to the union of (checked existing bundles) ∪ ({newly created starter} if one was filled in). The wizard's `createBundleForSite` action is replaced by a `subscribeSiteToBundles(siteId, bundle_ids[])` action that accepts both existing IDs and freshly created starter IDs.

Showing both sections inline avoids picking a default that ages poorly: when the bundle library is sparse, users naturally fall through to "create starter"; once the library matures, users naturally pick from suggestions. No migration when the balance shifts.

### 4. Content fetch — union semantics

Content pipeline's aggregator query path moves from single-bundle to multi-bundle:

- **4a (preferred):** the aggregator's content endpoint already accepts a multi-bundle filter (`bundle_ids[]`) and unions/dedupes server-side. Pipeline simply forwards `brief.bundle_ids`.
- **4b (fallback):** the aggregator only accepts a single `bundle_id`. Pipeline fans out one request per subscribed bundle, merges the responses, dedupes by item id, then applies the existing freshness/quality/format constraints and score-sorts. Pagination is handled per-bundle then trimmed on the client side.

Which path applies is decided during planning by inspecting the aggregator client and endpoint contract (`services/content-pipeline/src/agents/content-generation/aggregator.ts` and the aggregator-side API). If 4a is unavailable, 4b is the implementation; no aggregator change is required either way.

The no-bundle fallback path (`category_id`-only query when a site has zero subscriptions) is preserved as a graceful degrade. It is no longer the standard path — sites should land with at least one subscription from the wizard — but it is left in for sites that drop their last subscription or for diagnostic cases.

### 5. Bundle naming convention

The wizard's old "auto-name bundle after the site domain" behavior is dropped. Bundles created from the wizard's starter form default to `{domain}-starter` — a name that visibly marks the bundle as a single-site sketch and invites the user to rename it for reuse.

The Content Brief subscriptions UI surfaces a "Rename for reuse" affordance next to bundles whose name still contains `-starter`. Renaming is a pure aggregator-side update; the subscription reference (by id) is unaffected.

Reusable bundle names should describe **what's in them**, not which site uses them — `travel`, `travel-food`, `travel-culture`, `wine`, `science-news`. This convention is documented in the in-app guide (`config-inheritance.md` or a new `bundles.md` page) but not enforced by validation.

### 6. Worked example — travelnights

Subscriptions after migration / re-onboarding:

| Bundle name | Rules |
|---|---|
| `travel` | `{ category_ids: [Travel-tier1] }` |
| `travel-food` | `{ category_ids: [Food-tier1], tag_ids: [culinary-travel, food-travel, food-tours, local-cuisine] }` |
| `travel-culture` | `{ category_ids: [Culture-tier1, Society-tier1], tag_ids: [travel-culture, cultural-tourism] }` |

Content fetch returns the union, deduped: broad travel content plus travel-themed food and culture, without generic food and culture noise. Other travel sites (`journeypeaks`, `travelclearly`, `travelgeekexplorer`) subscribe to the same three bundles — curation effort amortizes across the network.

## Surface of changes

Platform-side only. No aggregator engine change. Touch list:

- `packages/shared-types/src/` — `SiteBrief.bundle_id` → `bundle_ids: string[]`; loader compat shim.
- `services/dashboard/src/components/site-detail/ContentAgentTab.tsx` — replace niche-targeting block with subscriptions list + Add Bundle modal.
- `services/dashboard/src/components/wizard/StepNicheTargeting.tsx` — replace with the suggestions-plus-starter screen described in §3.
- `services/dashboard/src/actions/wizard.ts` — replace `createBundleForSite` with `subscribeSiteToBundles`; rewire wizard completion.
- `services/dashboard/src/lib/reference-data.ts` (or wherever the aggregator client lives) — add bundle list + usage-count fetch if not present; confirm `BundleItem` shape.
- `services/content-pipeline/src/agents/content-generation/aggregator.ts` — multi-bundle query path (4a) or fan-out + dedupe (4b).
- Site config schema docs in `public/guide/` — update content-pipeline and add a bundles page if not already there.

## Open verification (do during planning, not now)

These are deliberately unresolved until the implementation plan; each is bounded and resolvable by reading code or pinging the aggregator team.

1. **Does the aggregator's content-fetch endpoint accept `bundle_ids[]` today (4a) or only a single `bundle_id` (4b)?** Decides which fetch shape ships.
2. **Does the aggregator expose a bundles-list endpoint with usage counts per bundle?** Drives the "sorted by usage" affordance in suggestions. If not, the dashboard can compute it from `dashboard-index.yaml` by aggregating `bundle_ids` across all site briefs — acceptable fallback.
3. **Exact name of the site-config field today** — `brief.bundle_id` vs another path. Confirms the migration shim.

## Non-goals

- Audience-based filtering inside bundle rules. Audiences remain content-generation metadata (per asaf: "audiences are part of the content summary the aggregator is creating for the site platform to help it write the articles better"). If audience filtering becomes useful later, it is a separate aggregator engine change.
- Aggregator engine change to OR-of-AND-groups bundle rules (Option (c) above). Reconsider only if the multi-bundle approach proves operationally heavy at scale.
- Bundle governance / lifecycle (archival, deprecation, merging). Out of scope for this design; revisit after the model is in use and naming patterns stabilize.
- Per-bundle weighting in the union (e.g. "70% from `travel`, 20% from `travel-food`, 10% from `travel-culture`"). Today's score-and-pick-top-N behavior is preserved across the union. Weighting is a tunable to revisit if the union produces an unbalanced mix in practice.
