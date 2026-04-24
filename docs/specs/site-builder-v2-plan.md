# Site Builder v2 — Smart Niche Targeting

## Overview

When creating a new site in the Atomic Network Dashboard, the wizard should capture the site's **content niche** through IAB taxonomy selection — and automatically create a matching **content bundle** so the site is fed precisely targeted content from the Content Aggregator from day one.

### The commercial logic

Every site we create should be born **ad-ready**:

- **IAB codes** flow from vertical + categories → into the site's metadata, ads.txt signals, and seller taxonomy → ad exchanges match buyers targeting those IAB segments
- **Tight niche = relevant ads = higher CPMs** — a "Poodle Dogs" site with IAB category "Dogs" gets dog food, grooming, pet insurance bids, not generic remnant
- **Google alignment** — IAB taxonomy maps closely to Google's content classification for AdSense contextual matching
- **Bundle = content subscription** — the site's content agent queries `GET /api/content?bundle_id=X&enriched=true` and gets *only* content matching its niche

---

## What changes in the wizard

### Current flow (v1)

```
Create Site → Groups → Theme → Content Brief → Script Vars → Preview → Review
```

Fields on "Create Site": Pages Project Name, Site Name, Domain, Audiences, Company, **Vertical** (single dropdown)

### New flow (v2)

```
Create Site → Niche Targeting (NEW) → Groups → Theme → Content Brief → Script Vars → Preview → Review
```

**Step 1 — Create Site** stays the same but **Vertical moves out** to the new step.

**Step 2 — Niche Targeting** is a new dedicated wizard tab.

---

## Step 2: Niche Targeting — detailed spec

### Layout

```
┌─────────────────────────────────────────────────────┐
│  VERTICAL                                           │
│  ┌─────────────────────────────────────────────┐    │
│  │ Animals                                  ▾  │    │
│  └─────────────────────────────────────────────┘    │
│  IAB: Pets (IAB-706)                                │
│                                                     │
│  CATEGORIES                                         │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🔍 Search categories...                     │    │
│  ├─────────────────────────────────────────────┤    │
│  │  ☑ Dogs          ☑ Dog Breeds              │    │
│  │  ☐ Cats          ☐ Pet Health              │    │
│  │  ☐ Birds         ☐ Pet Nutrition           │    │
│  └─────────────────────────────────────────────┘    │
│  Selected: Dogs, Dog Breeds                         │
│                                                     │
│  TAGS                                               │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🔍 Search or create tags...                 │    │
│  ├─────────────────────────────────────────────┤    │
│  │  poodle  ×    grooming  ×   + Add "breed…"  │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  📊 CONTENT PREVIEW                        │    │
│  │                                             │    │
│  │  47 articles currently match this niche     │    │
│  │  ████████████████░░░░  47 / 1,250 total     │    │
│  │                                             │    │
│  │  Top sources: TechCrunch (12), PetMD (9)    │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  [← Back]                              [Next →]     │
└─────────────────────────────────────────────────────┘
```

### Field specifications

#### Vertical (single-select dropdown)

- **Source**: `GET /api/verticals?active=true&page_size=100`
- **Display**: `{name}` — shows IAB code as subtitle hint
- **Required**: Yes
- **Behavior**: Selecting a vertical filters the Categories list to only show categories under that vertical
- **Stored on site**: `vertical_id` + `iab_code` (from vertical object)

#### Categories (multi-select with search)

- **Source**: `GET /api/categories?vertical_id={selected}&active=true&page_size=100`
- **Display**: Searchable checkbox list filtered by selected vertical
- **Required**: At least 1 category
- **No creation**: Categories are IAB-governed. Operator picks from existing seeded categories only.
- **Behavior**:
  - Changing vertical resets category selection
  - Each selected category shows its IAB code as a subtle badge
  - Searchable by name (client-side filter since page_size=100 covers most verticals)
- **Stored on site**: `category_ids[]` + `iab_codes[]`

#### Tags (multi-select with search + inline creation)

- **Source**: `GET /api/tags?vertical_id={selected}&page_size=100&include_usage=true`
- **Display**: Chip/pill input — type to search, select existing, or create new
- **Required**: No (optional, for niche narrowing)
- **Creation allowed**: Yes — tags are lightweight, not IAB-governed
  - New tags auto-lowercased, trimmed (API handles this)
  - `POST /api/tags` with `vertical_id` from selected vertical
- **Behavior**:
  - Shows `usage_count` next to existing tags so operator sees popularity
  - Typing a non-existent value shows "+ Create '{value}'" option
  - Tags created here are immediately available for bundle rules
- **Stored on site**: `tag_ids[]`

#### Content Preview (live, auto-updating)

- **Source**: `POST /api/bundles/preview`
- **Payload**: `{ rules: { vertical_ids: [...], category_ids: [...], tag_ids: [...] } }`
- **Trigger**: Fires on every selection change (debounced 300ms)
- **Display**:
  - Count: "47 articles currently match this niche"
  - Progress bar: visual ratio vs total content
  - Zero state: "No matching content yet — content will be matched as it's ingested and enriched"
  - High count hint: if > 500, suggest adding more categories/tags to narrow
  - Low count hint: if < 5, suggest broadening (fewer tags, or add another category)

---

## Bundle auto-creation logic

### When: On wizard final submit (Review → Create)

The bundle is created as part of the site creation transaction, not during the Niche Targeting step. This avoids orphaned bundles if the operator cancels mid-wizard.

### Sequence

```
1. Resolve tags
   ├─ For each new tag: POST /api/tags → get tag_id
   └─ Existing tags: already have IDs from selection

2. Create bundle
   POST /api/bundles
   {
     "name": "{site_name}",          ← site name = bundle name (1:1)
     "description": "Auto-created content bundle for {site_name}",
     "active": true,
     "rules": {
       "vertical_ids": ["{selected_vertical_id}"],
       "category_ids": ["{selected_category_ids}"],
       "tag_ids": ["{selected_tag_ids}"]     ← may be empty []
     }
   }

3. Handle 409 (duplicate name)
   ├─ Append " (2)" to bundle name and retry
   └─ This handles edge case of site name collision

4. Store bundle_id on site record
   site.bundle_id = created_bundle.id
   site.iab_vertical_code = vertical.iab_code
   site.iab_category_codes = categories.map(c => c.iab_code)
```

### Bundle naming convention

- Bundle name = Site name (e.g. "The Lovely Poodle")
- This creates a 1:1 site↔bundle relationship
- Easy to find in bundle management UI
- If site is renamed, bundle should be renamed too (PUT /api/bundles/:id)

### Bundle lifecycle tied to site

| Site action | Bundle action |
|---|---|
| Site created | Bundle created (active) |
| Site deactivated | Bundle deactivated (`PUT { active: false }`) |
| Site deleted | Bundle hard-deleted (`DELETE ?hard=true`) |
| Site renamed | Bundle renamed (`PUT { name: newName }`) |
| Niche changed | Bundle rules updated (`PUT { rules: {...} }`) |

---

## Data model changes

### Site record (new fields)

```typescript
interface Site {
  // ... existing fields
  
  // NEW: Niche targeting
  vertical_id: string;
  category_ids: string[];
  tag_ids: string[];
  bundle_id: string;           // ← auto-created bundle reference
  
  // NEW: IAB metadata (denormalized for ad-tech)
  iab_vertical_code: string;   // e.g. "596"
  iab_category_codes: string[]; // e.g. ["597", "598"]
}
```

### Why denormalize IAB codes?

The `iab_vertical_code` and `iab_category_codes` fields are copies of what's on the vertical/category objects. We store them on the site for:

1. **Ad-tech integrations** — sellers.json, ads.txt, and header bidding configs need IAB codes without a round-trip to the aggregator API
2. **Google publisher tags** — GPT slots need IAB content categories at render time
3. **Site template generation** — meta tags for content classification go in the HTML head

---

## Content agent integration

Once the site has a `bundle_id`, the content agent's fetch logic changes from broad queries to:

```
# Before (v1): content agent fetches by vertical only
GET /api/content?vertical_id={x}&enriched=true&status=active

# After (v2): content agent fetches by bundle
GET /api/content?bundle_id={bundle_id}&enriched=true&status=active
```

This is the key payoff — the bundle's rules (vertical + categories + tags) are evaluated server-side. The content agent gets exactly the content that matches the site's niche, pre-filtered.

---

## UX details

### Vertical → Category cascade

When the operator selects a vertical:
1. Categories list reloads with `GET /api/categories?vertical_id=X&active=true`
2. Previous category selections are cleared (with confirmation if any were selected)
3. Tags list reloads with `GET /api/tags?vertical_id=X`
4. Previous tag selections are cleared

### Search behavior

**Categories search**: Client-side filter on the loaded list (typically < 100 categories per vertical). Instant, no API call.

**Tags search**: Client-side filter + "create new" option. Shows `usage_count` so operator prefers popular tags over creating duplicates.

### Validation rules

| Field | Rule |
|---|---|
| Vertical | Required — must select exactly 1 |
| Categories | Required — must select at least 1 |
| Tags | Optional — 0 or more |
| Bundle preview | Informational only — 0 matches does not block Next |

### Empty state

If the aggregator has no content yet (fresh deployment), the preview shows: "No matching content yet. Content will be matched automatically as sources are fetched and enriched."

---

## Commercial implications

### For ad targeting

The site's niche data flows into multiple ad-tech touchpoints:

```
Site niche → iab_codes → ads.txt / sellers.json
                       → Google Publisher Tags (GPT)
                       → Prebid.js ad unit config
                       → Amazon TAM category targeting
```

Example: "The Lovely Poodle" site
- Vertical: Animals (IAB-706)
- Category: Dogs (IAB-707)
- Tags: poodle, grooming, breed info

This means:
- DSPs can target "Pets > Dogs" contextually
- Dog food brands (Royal Canin, Purina Poodle-specific formulas) get high match scores
- Pet insurance, grooming services, breed-specific accessories — all high-intent advertisers
- CPM expectation: significantly higher than generic "Animals" targeting

### For SEO / Google

The category + tag selection directly informs:
- Schema.org `about` markup on the site
- `<meta>` content classification tags
- Content brief generation (the wizard's "Content Brief" tab can pre-populate with niche context)
- Internal linking strategy (related content from same categories)

### For content quality

The bundle ensures content-to-site alignment:
- No off-topic content leaking into the feed
- The enrichment pipeline's IAB classification drives automatic matching
- Tags provide the long-tail specificity that categories alone can't capture

---

## Implementation phases

### Phase 1: Niche Targeting UI
- Add "Niche Targeting" tab to wizard
- Vertical dropdown (moved from Step 1)
- Category multi-select with search
- Tag multi-select with search + create
- Bundle preview (POST /api/bundles/preview)
- Wire cascade logic (vertical → categories → tags)

### Phase 2: Auto-bundle creation
- Bundle creation in site submit flow
- 409 duplicate handling
- Store bundle_id on site record
- Bundle lifecycle hooks (deactivate/delete/rename with site)

### Phase 3: Content agent integration
- Update content agent to use bundle_id for queries
- Migrate existing sites: create bundles for sites that have vertical but no bundle

### Phase 4: Ad-tech metadata
- Denormalize IAB codes on site record
- Surface in site template generation
- Feed into ads.txt / sellers.json generation
- Prebid.js ad unit category config

---

## API calls summary

| When | Endpoint | Purpose |
|---|---|---|
| Wizard loads | `GET /api/verticals?active=true` | Populate vertical dropdown |
| Vertical selected | `GET /api/categories?vertical_id=X&active=true` | Populate category list |
| Vertical selected | `GET /api/tags?vertical_id=X` | Populate tag suggestions |
| Any selection changes | `POST /api/bundles/preview` | Live content count |
| Tag created inline | `POST /api/tags` | Create new tag |
| Wizard submit | `POST /api/bundles` | Create the site's bundle |
| Site deactivated | `PUT /api/bundles/:id { active: false }` | Deactivate bundle |
| Site deleted | `DELETE /api/bundles/:id?hard=true` | Remove bundle |
| Content agent runs | `GET /api/content?bundle_id=X&enriched=true` | Fetch targeted content |
