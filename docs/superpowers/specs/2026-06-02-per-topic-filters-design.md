# Per-Topic Content Filters

**Date:** 2026-06-02
**Status:** Design — awaiting user review

## Problem

The current multi-bundle subscription model (shipped via [2026-05-28-multi-bundle-site-subscriptions-design.md](2026-05-28-multi-bundle-site-subscriptions-design.md)) fixes the cross-category fetch problem but leaves three real editorial problems unsolved:

1. **Article→topic assignment is lossy.** When the pipeline fetches an article from a site-level bundle pool and then has to decide which topic (menu item) it belongs to, the existing topic-matching logic picks one topic — sometimes the wrong one. Concrete report from production testing: an article titled "Wine 101: Breaking Down Barriers for New Generation of Drinkers" landed under "Food around the world" while "Wine & Beer" stayed empty.
2. **Empty topics.** Some topics never get content because the site-wide article quota gets spent on whichever items the pipeline finds first; topics without their own quota are starved.
3. **AI brief generation is biased by the primary category.** Topic name suggestions in the wizard read only `brief.vertical`, so a travel-themed site asking for menu items gets Travel-only suggestions and nothing food-flavored — even when the editorial intent is "travel + food".

The deeper observation: **the topic IS the editorial unit, not the bundle**. Editors think in sections ("Wine & Beer should run weekly, Destinations daily, News three times a week, all travel-themed"). The current model asks them to think in bundles first and topics second, then guesses at the mapping. Per-topic filters invert that.

## Constraints

**Live sites with advertisers must not be touched.** The existing flat-bundle model (`brief.bundle_ids`) and the existing Content Brief / Niche Targeting UI keep working unchanged, forever. Migration is opt-in per site and one-way at the dashboard level. The two models coexist; the data model has a presence-based discriminator (`brief.topics_v2` exists ⇒ new model active).

**No aggregator engine change.** The aggregator's `/api/content` endpoint already accepts `category_ids` + `tag_ids` as raw query params, and bundles still work as before. We don't ask the aggregator team for anything.

**AI may only use existing aggregator taxonomy.** AI proposals never invent categories or tags. The dashboard pre-fetches the taxonomy, passes it to Claude as the available vocabulary, and validates every returned ID before persisting.

## Design

### 1. Data model

The site config schema gains a new optional field, `brief.topics_v2`, that is the discriminator for the new model. Presence of `topics_v2` ⇒ use new path. Absence ⇒ use legacy path. A site can carry both during transitional moments, but the migration commit removes `bundle_ids` so a stable site is in exactly one model.

```yaml
# Example site.yaml on the new model
brief:
  theme: "Travel and eating while traveling — destinations, food tourism, wine routes, and culture you experience through the local table."

  # Identification only — does NOT drive content matching or AI prompts.
  # Used by ads.txt (IAB code), dashboard categorization, site listing.
  vertical_id: <aggregator-tier-1-id>
  vertical: "Travel"
  iab_vertical_code: "IAB20"

  topics_v2:
    - name: "Destinations"
      description: "Travel destinations, places to visit, cultural guides"  # optional, AI hint
      source:
        type: filter
        category_ids: [Travel/Day-Trips, Travel/Adventure-Travel, Travel/Hotels-and-Motels]
        tag_ids: [travel-destinations, day-trips, adventure-travel, hotels-and-motels, sightseeing]
      schedule:
        articles_per_week: 3
        preferred_days: [Monday, Wednesday, Friday]

    - name: "Wine & Beer"
      description: "Wine and brewery culture for travelers"
      source:
        type: filter
        category_ids: [Food/Alcoholic-Beverages]
        tag_ids: [wine-tourism, culinary-travel, wine-travel, brewery-tours]
      schedule:
        articles_per_week: 1
        preferred_days: [Tuesday]

    - name: "News"
      source:
        type: bundle
        bundle_id: <aggregator-bundle-id>   # links to a shared, curated bundle
      schedule:
        articles_per_week: 2
        preferred_days: [Monday, Wednesday]

  # All other brief fields stay as today:
  audiences: [Travelers, Foodies]
  tone: "Engaging, informative, conversational"
  content_guidelines:
    - "Each article must mention the destination or country."
    - "Prefer practical, actionable guidance over abstract opinions."
  # ... etc
```

When the new model is active, `brief.bundle_ids` is removed entirely. The presence-based discriminator is unambiguous.

Article frontmatter gains a `topics: string[]` array (article belongs to N topics by name); the primary topic is `topics[0]`. Cross-topic discovery — see §4.

### 2. UI surface

Three screens change. All three only render the new UI when `brief.topics_v2` is present; legacy sites render the existing UI unchanged.

#### 2.1. Content Brief tab (the topics list)

Replaces today's Niche Targeting + Content Bundles sections. From top to bottom:

- **Site Theme** — textarea, 1–2 lines, free text. Required (cannot save the screen with an empty theme). Drives AI proposals.
- **Primary Category** — single-line read-only field showing the category name + IAB code. Identification only. A small "Change" affordance opens the same vertical picker we have today. Doesn't gate anything else on this screen.
- **Topics list** — each topic is a row with:
  - Drag handle (left) for reordering. Order = menu item order on the live site, so reordering is semantic.
  - Topic name in bold.
  - Filter summary: small purple "N categories" pill + small cyan "M tags" pill + the first few item names truncated.
  - Schedule summary: "3 articles/week · Mon, Wed, Fri" or similar.
  - "X articles published this month" counter on the right.
  - Edit button → opens the topic-edit modal (§2.2).
  - × button → confirm-then-remove.
  - **Three visual states**:
    - Normal: gray border.
    - Empty filter (no filter set or AI couldn't propose): amber border + "filter not set" badge + "Set up filter →" link.
    - Linked bundle: cyan "🔗 LINKED BUNDLE" badge + bundle name + small text "Used by N other sites — changes affect all of them" warning.
- **+ Add Topic** button — opens the topic-edit modal with a blank topic.
- **Editorial guidelines** section below the topics list — tone, audiences, content guidelines, image guidelines. Existing fields, just relocated.

#### 2.2. Topic-edit modal

Opens for + Add Topic and Edit. Single modal, no second screen. Fields:

- **Topic name** (required, text input)
- **Brief description** (optional, single-line input) — explanation: "helps AI propose better filters"
- **Filter** section:
  - Default state: AI-proposed filter. Renders Categories pills (purple, removable) + Tags pills (cyan, removable) + "+ Add category" / "+ Add tag" buttons opening manual pickers + an AI-attribution box with the rationale and a "✨ Re-propose with AI" button.
  - Initial empty state (no filter yet): a single primary button "✨ Propose filter with AI".
  - Power-user path: small text link below the AI box, "Use a shared bundle instead →". Clicking it replaces the AI section with a bundle picker (search the aggregator's existing bundles); a "← Back to AI-proposed filter" link returns to the default mode. State `topic.source.type` changes between `filter` and `bundle`.
- **Schedule** section:
  - "Articles per week" — number input.
  - "Preferred days" — Mon..Sun toggle pills, same as today's wizard.
- **Cancel** / **Save topic** buttons.

Save validates: topic name non-empty AND unique within the site (case-insensitive); if filter mode, at least one category OR at least one tag; if bundle mode, bundle_id selected. Renaming an existing topic also runs the uniqueness check.

#### 2.3. Site Settings → Identity tab

Gains a single new control near the bottom: **"Migrate to per-topic filters"** toggle.

- Off by default for all existing sites.
- When toggled on: if `brief.theme` is empty, prompts for the theme inline before continuing. Then opens the migration review screen (§5).
- Off → on is a deliberate user action that triggers an explicit review step. Never silent.
- The toggle disappears on already-migrated sites (replaced by a static "✓ Per-topic filters active" indicator with no toggle-back affordance; reverting is a git operation).

### 3. AI proposal mechanics

Triggered exclusively by user action — the "✨ Propose filter with AI" or "✨ Re-propose with AI" button in the topic-edit modal, or batched across topics in the migration review screen.

#### 3.1. Pre-call data fetch

Before the Claude call, the dashboard fetches:
- Full categories tree (tier-1s + every subcategory) — already covered by the `useAllCategories()` hook shipped 2026-05-31.
- Full tag library (paginated) — already covered by the paginated `getTags()` from 2026-05-31.

The full taxonomy lookup is cached for the session. A single proposal call doesn't refetch.

#### 3.2. Prompt

```
You are proposing a content filter for a topic on an editorial site.

Site theme: {brief.theme}
Topic name: {topic.name}
Topic description: {topic.description || "(none)"}

Available taxonomy:
- Categories: {newline-separated list of "id | name (parent)" entries}
- Tags: {newline-separated list of "id | name | usage_count" entries, sorted by usage_count desc}

Constraints:
- Pick ONLY category_ids and tag_ids from the available lists above. Never invent IDs or names.
- If no good match exists for a concept, omit it rather than picking a tangential alternative.
- Prefer tags with higher usage_count when there are equivalent options.
- A good filter has 1–4 category_ids and 3–8 tag_ids, but follow the topic's needs.
- Categories alone (no tags) is acceptable for broad topics; tags alone is acceptable for cross-category niches.

Return JSON: { "category_ids": [...], "tag_ids": [...], "rationale": "1-2 sentence explanation" }
```

#### 3.3. Response handling

The dashboard validates every returned `category_id` and `tag_id` against the pre-fetched taxonomy. Unknown IDs are dropped with a `console.warn` (Claude is constrained enough that this is rare, but defense-in-depth catches model hallucinations before they corrupt site.yaml). The rationale is shown in the AI-attribution box; users can re-propose or hand-edit.

#### 3.4. Cost & latency

One Claude call per user-initiated proposal. Migration screen batches N topics → N calls in parallel (capped at the dashboard's existing concurrency limit). Total cost per site migration ≈ N × the cost of a small Claude call (input ~5–10k tokens depending on taxonomy size; output ~200 tokens).

### 4. Content fetch — per-topic fan-out

Implemented in `services/content-pipeline/src/agents/content-generation/agent.ts`. The dispatcher checks `brief.topics_v2`:

- **Absent**: take the existing path (`brief.bundle_ids` fan-out + dedup, as shipped 2026-05-28/05-31). Unchanged.
- **Present**: take the new per-topic path.

New path:

1. Determine which topics are eligible for *this* run based on schedule. A topic is eligible if today's day is in `topic.schedule.preferred_days` AND the topic's articles-per-week budget hasn't been exhausted this calendar week (counted from Monday).
2. For each eligible topic, compute its remaining weekly budget. The target for this run is min(remaining, ceil(articles_per_week / preferred_days.length)).
3. For each eligible topic, resolve fetch params from `topic.source`:
   - `type: filter` → query aggregator's `/api/content` with `category_ids=...&tag_ids=...`
   - `type: bundle` → query with `bundle_id=...`
4. Fetch up to the topic's run target, paginating against duplicates (same dedup logic as today against existing article URLs + titles).
5. **Cross-topic membership**: for each fetched article, evaluate it against every OTHER topic's filter on the site (compare the article's `category_ids` and `tags` against each topic's rules using OR-within/AND-across, same as bundle matching). Each match adds the topic name to the article's frontmatter `topics: []`. The fetching topic is `topics[0]` (primary).
6. The pipeline writes the article markdown with `topics: [primary, ...secondaries]` in frontmatter.

Renderer (site-worker, Astro): each topic page lists articles whose `topics` array includes that topic. No code change needed beyond the rendering layer reading the array instead of a single topic field. (Today's article frontmatter likely carries `topic: string` singular — the migration of the frontmatter is part of the site-worker work in §6.)

#### 4.1. Cross-topic semantics

Auto, not manual. The user does not confirm secondary topics; they appear when their filters match. This is the right default because:
- The user already curated the filters per topic. If the filters overlap, that's their intent.
- Manual confirmation introduces an "article moderation" step that doesn't exist today and adds friction.
- An article that ends up in too many topics signals the user's filters overlap too much — that's actionable feedback in the editor.

Article detail page on the dashboard surfaces a "Also shown in: {topics}" line so editors can see and understand cross-topic assignments. If an assignment is wrong, the fix is to tighten the relevant topic's filter, not to remove the article from a topic.

#### 4.2. Empty topics

A topic with no filter (filter mode with empty category_ids and empty tag_ids, or bundle mode with no bundle_id) produces zero fetches. No fallback to site-wide search. The topics-list UI shows the amber "filter not set" warning state to make this explicit.

Side effect: a site with all topics empty produces zero articles per run. The user sees the warning on every topic; the cause is visible.

### 5. Migration flow

#### 5.1. Trigger

User flips "Migrate to per-topic filters" on Site Settings → Identity. If `brief.theme` is empty, an inline modal prompts for the theme first; user types a 1–2 line description, hits Continue.

#### 5.2. Migration review screen

A full-page navigation (not a modal — the workflow is multi-step and benefits from breathing room). For each existing topic name in `brief.topics`, the dashboard kicks off a parallel AI proposal call (same flow as §3, with the just-entered theme + the topic name; topic description starts blank). The screen renders a list of topics with their proposed filters inline, each editable on the spot (same controls as the topic-edit modal but compact). Defaults:

- Schedule per topic: `articles_per_week` defaults to `ceil(current_site_articles_per_day × 7 / topics.length)` so the total site volume roughly matches today.
- `preferred_days` per topic: copy the site's existing `preferred_days` to every topic (user can adjust per-topic afterwards).

Below the topics, a section showing the legacy bundles the site is currently subscribed to. Each bundle marked either "Orphan (only used by this site)" or "Shared (used by N sites)". A checkbox: *"Also delete this site's orphan bundles on the aggregator"* — defaulted ON. Shared bundles are listed as "kept (shared)" with no delete option.

Action buttons at the bottom: **Cancel** / **Confirm migration**.

#### 5.3. Confirm

One server action that:
1. Writes site.yaml with `brief.topics_v2` populated, removes `brief.bundle_ids`, removes the legacy niche-targeting fields (`brief.category_ids`, `brief.tag_ids` — they're no longer used; topics own filtering).
2. If checkbox ON: deletes each orphan bundle on the aggregator via `DELETE /api/bundles/{id}`. Failures are logged but don't block the migration.
3. Commits to the site's staging branch (existing save infrastructure).
4. Toasts "Migration complete — your next scheduled run will use the new per-topic filters."

After confirm, Site Settings → Identity shows the static "✓ Per-topic filters active" indicator instead of the toggle.

#### 5.4. Migrating from staging vs production

Same as all current dashboard saves: writes to the staging branch. Once verified on staging, the user uses the existing "Publish to production" flow to merge to main. No special migration path beyond standard dashboard staging→prod promotion.

### 6. Backwards compatibility

- Sites without `topics_v2`: legacy path everywhere. Zero change to:
  - Content Brief UI (Niche Targeting + Content Bundles still render)
  - Add Bundle modal
  - Content-pipeline fan-out (same fetch path, same fan-out helpers, same dedup)
  - Article frontmatter (single `topic: string` field on legacy articles)
- Sites with `topics_v2`: new path everywhere. Article frontmatter uses `topics: string[]` array on articles produced after migration.
- Aggregator: no schema changes, no engine changes, no new endpoints.
- Site-worker (rendering): needs an additive change to handle both `topic: string` (legacy) and `topics: string[]` (new) when listing articles by topic on a topic page. Read both; topics_v2-site articles use the array, legacy-site articles use the singular. A `getTopicsArray(article)` helper hides the union from callers.

### Surface of changes

**Modify (types):**
- `packages/shared-types/src/config.ts` — `SiteBrief` gains optional `theme: string`, `topics_v2: TopicV2[]`. Define `TopicV2` interface with `name`, `description?`, `source`, `schedule`.
- `packages/shared-types/src/article.ts` — `ArticleFrontmatter` gains optional `topics?: string[]` alongside the existing `topic?: string`.
- `services/content-pipeline/src/types.ts` — mirror.

**Modify (server-side):**
- `services/dashboard/src/app/api/sites/save/route.ts` — save handler accepts and persists `theme`, `topics_v2` shape; clears `bundle_ids`/`category_ids`/`tag_ids` when `topics_v2` is being written.
- `services/dashboard/src/actions/wizard.ts` — wizard's `createSiteAndBuildStaging` gains an opt-in path: if the wizard sets a per-topic-flag, write `topics_v2` directly instead of `bundle_ids`. (Wizard UI updates are a separate sub-task; for now, the wizard continues to produce legacy sites and migration is done after creation. See §7 deferred.)
- `services/dashboard/src/actions/per-topic-migration.ts` (new) — server action `migrateSiteToPerTopic(domain, theme, topics, deleteOrphanBundles)` that performs the steps in §5.3.
- `services/dashboard/src/app/api/ai/propose-filter/route.ts` (new) — POST endpoint that takes site theme + topic name + description + taxonomy and calls Claude, returns validated `{category_ids, tag_ids, rationale}`.

**Modify (content pipeline):**
- `services/content-pipeline/src/agents/content-generation/agent.ts` — dispatcher checks for `brief.topics_v2`; if present, runs new per-topic fan-out; otherwise falls back to existing bundle fan-out. New function `fetchPerTopic(brief, deps)` mirroring today's `fetchNewItemsUnion` but iterating topics with their own filter sources and schedules. Cross-topic membership evaluation lives in a new helper `evaluateAllTopics(item, topics)` returning the topic-name array.
- Schedule eligibility (per-topic preferred_days + weekly budget) lives in a new helper module.

**Modify (UI — new):**
- `services/dashboard/src/components/site-detail/TopicsListPanel.tsx` (new) — the topics list view inside Content Brief.
- `services/dashboard/src/components/site-detail/TopicEditModal.tsx` (new) — the topic-edit modal.
- `services/dashboard/src/components/site-detail/PerTopicMigrationScreen.tsx` (new) — the migration review screen.
- `services/dashboard/src/components/site-detail/ContentAgentTab.tsx` — conditionally renders TopicsListPanel when `brief.topics_v2` exists, otherwise renders today's existing Niche Targeting + BundleSubscriptionsPanel sections.
- `services/dashboard/src/components/site-detail/AttachDomainPanel.tsx` (or wherever the Identity tab lives) — adds the "Migrate to per-topic filters" toggle.

**Modify (UI — minor):**
- `services/dashboard/src/components/wizard/StepNicheTargeting.tsx` — unchanged for legacy creation. (Wizard's new-model path deferred to §7.)

**Modify (site-worker rendering):**
- `packages/site-worker/src/pages/topics/[slug].astro` (or equivalent topic page) — read both `frontmatter.topic` (legacy) and `frontmatter.topics` (array) when filtering articles for the topic page.

**Tests:**
- `agent-per-topic-fanout.test.ts` — fan-out with schedule eligibility, weekly budgets, cross-topic membership assignment.
- `ai-propose-filter.test.ts` — taxonomy validation, ID-not-in-taxonomy dropping.
- `per-topic-migration.test.ts` — site.yaml write shape, bundle-cleanup behavior, theme-required validation.

**Touch (docs):**
- `services/dashboard/public/guide/20-bundles.md` — annotate as the legacy model; add a new page `21-per-topic-filters.md` covering the new model + migration.

### Open verification (resolve during planning)

1. **Aggregator's behavior with both `category_ids` and `tag_ids` sent**: confirm it applies the same OR-within / AND-across semantic as bundle rules. Almost certainly yes (bundles are persisted versions of these params), but worth verifying with a curl against the live aggregator before depending on it.
2. **Article frontmatter today**: does the current article writer emit `topic: string` (singular) or already `topics: string[]`? If singular, the site-worker rendering change is mandatory. If already array, less work.
3. **Topic name → URL slug stability**: when a user renames a topic, the existing articles' `topics: []` arrays reference the old name. Renames are rare; an inline migration ("rename in N existing articles") on save is the safe path. Confirm renames are infrequent enough that the manual fixup is acceptable; if not, store topic IDs separately from names.

### Non-goals (deferred)

These are out of scope for this design. Each is independent and can ship later:

- **Wizard new-model path.** The wizard continues to produce legacy `bundle_ids` sites. Migration is the path to the new model for now. A wizard rewrite that creates topics_v2 directly is a separate design.
- **Cross-site bundle housekeeping page.** A standalone admin tool listing all aggregator bundles with subscriber counts and bulk-delete affordances. Useful but not on the critical path.
- **Manual IAB code override.** When a site's content genuinely spans tier-1s and the Primary Category's IAB code doesn't fit, a separate override field. Defer until a real site hits the gap.
- **Per-topic article count overrides per run.** "This topic should target 3 articles this run regardless of weekly budget" — config flag for forced runs. Today's quota math is sufficient.
- **Topic icons.** Visual decoration; can add a sub-design later if user testing surfaces a real need.
- **Migration reversibility in the dashboard.** Reverting a migration is a `git revert` of the migration commit. A UI affordance is YAGNI.
- **Audience-based filtering.** Audiences remain content-generation metadata, not a filter axis. If audience filtering becomes useful later, it's a separate aggregator engine change.
