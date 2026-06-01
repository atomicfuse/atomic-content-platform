# Decisions: Niche Targeting Wizard Step

**Date:** 2026-04-23
**Context:** Planning the "Niche Targeting" wizard step per `docs/specs/site-builder-v2-plan.md`

---

## D1: Bundle creation is best-effort, not transactional

**Decision:** If the Content Aggregator is down or bundle creation fails, the site is still created without a `bundle_id`. The bundle can be attached later.

**Rationale:** The wizard creates a CF Pages project, git branches, and dashboard index entries. These are the critical operations. A missing bundle is recoverable; a half-created site with no CF project is not. Making bundle creation blocking would add a single point of failure for the entire wizard flow.

**Consequence:** Need a future backlog item to allow attaching/editing bundles on existing sites.

---

## D2: IAB vertical code resolved client-side via extended verticals API

**Decision:** Extend `getVerticals()` to return `iab_code` alongside `id` and `name`. Store `iabVerticalCode` on form data directly from the dropdown selection.

**Alternative considered:** Resolve server-side in `createSiteAndBuildStaging` by calling aggregator. Rejected because it adds a server round-trip and the data is already available in the client-side API response — we just need to stop discarding it.

---

## D3: Categories are NOT creatable in the wizard

**Decision:** Categories are IAB-governed and seeded (466 entries). The wizard only allows selecting from existing categories, not creating new ones. Only tags support inline creation.

**Rationale:** Per spec: "Categories are IAB-governed. Operator picks from existing seeded categories only."

---

## D4: Vertical change clears all niche selections

**Decision:** When the operator changes the vertical, all category and tag selections are immediately cleared (no confirmation dialog).

**Alternative considered:** Show confirmation dialog per spec ("with confirmation if any were selected"). Deferred — the wizard is forward-only with a back button, so accidental vertical changes are rare. The dialog can be added as a polish item if operators report friction.

---

## D5: Bundle naming = Site name (1:1)

**Decision:** The auto-created bundle is named identically to the site name. On 409 (duplicate), append " (2)".

**Rationale:** Per spec: "Bundle name = Site name. This creates a 1:1 site↔bundle relationship."

---

## D6: New step position: index 1 (between Create Site and Groups)

**Decision:** "Niche Targeting" becomes step 2 in the UI (index 1 in code), pushing Groups to step 3 and all subsequent steps +1.

**Rationale:** Per spec flow: "Create Site → Niche Targeting → Groups → Theme → Content Brief → Script Vars → Preview → Review"

---

## D7: Categories use client-side search, not server-side

**Decision:** The full category list for a vertical is loaded in one request (`page_size=100`) and searched client-side.

**Rationale:** Per spec: "Client-side filter on the loaded list (typically < 100 categories per vertical). Instant, no API call." The aggregator has 466 total categories across all verticals; per-vertical count is well under 100.

---

## D8: Tags dropdown uses a floating dropdown pattern, not a checkbox list

**Decision:** Tags use a text input with floating dropdown (type-to-search + create) rather than a checkbox list like categories.

**Rationale:** Tags are open-ended and can be created inline. A checkbox list doesn't support the "Create new" affordance naturally. The chip/pill + dropdown pattern (like the existing Audiences multi-select in StepIdentity) matches the spec's design.
