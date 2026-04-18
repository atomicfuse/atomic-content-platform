# Atomic Content Network — FINAL Architecture Spec
## Unified Config Layers, Overrides, Ad Rendering on All Page Types

**Date:** April 16, 2026
**Status:** FINAL — manager-approved, all questions resolved
**Replaces:** ALL previous specs (monetization-layer-spec.md, revised-architecture-groups-overrides-spec.md)

---

# PART A — For the Team

## How the system works in one paragraph

Every site's config is built by merging four layers: **org** (company defaults) → **group(s)** (shared config for subsets of sites) → **override(s)** (targeted exceptions that fully replace) → **site** (per-site specifics). All four layers use the exact same YAML fields. The dashboard uses one form component everywhere — org settings, group editor, override editor, site editor — same fields, same layout, different title. Ads render on ALL page types: articles, homepage, category pages, and shared pages (about, privacy, etc.).

---

# PART B — Technical Spec

## 1. Network Repo Structure

```
atomic-labs-network/
├── network.yaml                      # Platform version pin
├── org.yaml                          # Company-wide defaults
├── groups/
│   ├── entertainment.yaml            # Vertical: theme, fonts, analytics
│   ├── sports.yaml                   # Vertical: theme, fonts
│   ├── taboola.yaml                  # Ad partner: ads, scripts, tracking, ads.txt
│   ├── outbrain-atomic.yaml          # Ad partner: ads, scripts, tracking, ads.txt
│   ├── adsense-default.yaml          # Basic ad config
│   └── mock-minimal.yaml             # QA: different mock ad layout
├── overrides/
│   ├── config/                       # Config overrides
│   │   ├── test-ads-mock.yaml        # Demo mock ads
│   │   └── fb-traffic-test.yaml      # Future: conditional override
│   └── <site_id>/                    # Shared-page content overrides (existing, unchanged)
├── sites/
│   └── coolnews-atl/
│       ├── site.yaml
│       ├── assets/
│       └── articles/
├── dashboard-index.yaml              # Site list (unchanged)
├── scheduler/config.yaml             # Scheduler gate (unchanged)
└── README.md
```

## 2. The Unified Default YAML

This is the **one schema** shared by org, group, override, and site. Every layer supports every field. The dashboard renders ONE component for this.

```yaml
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TRACKING
# Merge order: org → group → override → site
# Per-field inheritance: omit a field to inherit, set to null to disable.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
tracking:
  ga4: string | null              # GA4 Measurement ID (G-XXXXXXXXXX)
  gtm: string | null              # Google Tag Manager (GTM-XXXXXXX)
  google_ads: string | null       # Google Ads Conversion ID (AW-XXXXXXXXXX)
  facebook_pixel: string | null   # Meta/Facebook Pixel ID
  custom:                         # Custom tracking snippets
    - name: string
      src: string
      position: "head" | "body_start" | "body_end"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SCRIPTS
# Merge by `id`: same id in child replaces parent entry; new ids appended.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
scripts:
  head: []                        # ScriptEntry[] — injected in <head>
  body_start: []                  # ScriptEntry[] — after <body>
  body_end: []                    # ScriptEntry[] — before </body>

# ScriptEntry:
#   id: string           (merge key)
#   src: string           (external URL, mutually exclusive with inline)
#   inline: string        (inline JS, supports {{placeholder}} syntax)
#   async: boolean        (for src scripts)

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# SCRIPT VARIABLES
# Shallow-merged across all layers. Resolves {{key}} in scripts.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
scripts_vars: {}                  # Record<string, string>

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ADS CONFIG
# Controls where ad containers appear on ALL page types.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ads_config:
  interstitial: false             # Full-screen interstitial ad enabled
  layout: standard                # "standard" | "high-density" (CSS density)
  ad_placements: []               # AdPlacement[] — the full list of ad slots

# AdPlacement:
#   id: string              unique slot ID, becomes data-ad-id and div id="ad-{id}"
#   position: string        where on the page:
#                             "above-content"      — before main content
#                             "after-paragraph-N"  — after Nth <p> in article body
#                             "sidebar"            — sidebar column (desktop)
#                             "sticky-bottom"      — fixed bottom of viewport
#                             "below-content"      — after main content, before footer
#                             "homepage-top"       — top of homepage
#                             "homepage-mid"       — middle of homepage grid
#                             "category-top"       — top of category page
#   sizes:
#     desktop: number[][]    e.g. [[728, 90], [970, 90]]
#     mobile: number[][]     e.g. [[320, 50]]
#   device: "all" | "desktop" | "mobile"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# CLS PLACEHOLDER HEIGHTS
# Reserved space (px) for ad containers before JS loads.
# Prevents Cumulative Layout Shift.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ad_placeholder_heights:
  above-content: 90
  after-paragraph: 280
  sidebar: 600
  sticky-bottom: 50

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ADS.TXT
# Additive across layers: org + groups + site combined, deduplicated.
# Override REPLACES (see override rules below).
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ads_txt: []                       # string[] — one entry per line

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# THEME
# Merge order: org → group → override → site
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
theme:
  base: "modern" | "editorial"
  colors:
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
    muted: string
  logo: string                    # Path relative to site assets/
  favicon: string                 # Path relative to site assets/
  fonts:
    heading: string               # Google Font name
    body: string                  # Google Font name

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# LEGAL
# Merge order: org → group → override → site
# Variables available as {{key}} in shared legal page templates.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
legal:
  company_name: string
  company_country: string
  effective_date: string
  site_description: string
  [any_key]: string               # Extensible key-value

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# LEGAL PAGES OVERRIDE
# Markdown content appended to (or replacing) platform legal templates.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
legal_pages_override:
  privacy: string                 # Extra privacy policy content
  terms: string
  about: string
  contact: string
  dmca: string
```

## 3. Layer-Specific Identity Fields

Each layer type adds its own identity fields ON TOP of the unified default YAML above.

### org.yaml — identity fields

```yaml
organization: "Atomic Labs"
legal_entity: "Atomic Labs Ltd"
company_address: "Tel Aviv, Israel"
support_email_pattern: "contact@{{domain}}"
default_theme: modern
default_fonts:
  heading: "Inter"
  body: "Inter"
default_groups: []                # Groups assigned to sites that don't specify any

# + unified default YAML fields (tracking, scripts, ads_config, theme, legal, etc.)
```

### groups/{id}.yaml — identity fields

```yaml
group_id: string                  # Unique kebab-case ID (matches filename)
name: string                      # Display name

# + unified default YAML fields
```

### overrides/config/{id}.yaml — identity fields

```yaml
override_id: string               # Unique kebab-case ID (matches filename)
name: string                      # Display name
priority: number                  # Higher = applied later = wins. Integer.

targets:
  groups: string[]                # Sites in these groups get this override
  sites: string[]                 # These specific sites also get it
                                  # Affected = UNION of both

# + unified default YAML fields (only the fields you define participate)
```

### sites/{domain}/site.yaml — identity fields

```yaml
domain: string                    # e.g. "coolnews-atl"
site_name: string                 # Display name
site_tagline: string | null
groups: string[]                  # Ordered list of group IDs, merged left-to-right
active: boolean                   # false = maintenance page

brief:
  audience: string
  tone: string
  article_types:                  # Weighted %, should sum to 100
    listicle: number
    standard: number
    how-to: number
    review: number
  topics: string[]
  seo_keywords_focus: string[]
  content_guidelines: string
  vertical: string
  review_percentage: number
  schedule:
    preferred_days: string[]
    preferred_time: string        # HH:MM
    articles_per_day: number

# + unified default YAML fields (only fields you define override the chain)
```

### What the YAML looks like in practice

**A site that only overrides GA4 and scripts_vars:**

```yaml
# sites/coolnews-atl/site.yaml
domain: coolnews-atl
site_name: "Cool News ATL"
site_tagline: null
groups:
  - entertainment
  - taboola
active: true

brief:
  audience: "News readers 25-55"
  tone: "professional, dramatic"
  article_types:
    listicle: 40
    standard: 30
    how-to: 20
    review: 10
  topics:
    - Current Events
    - In-Depth Analysis
    - Policy & Politics
    - Local Stories
  seo_keywords_focus: []
  content_guidelines: ""
  vertical: News
  review_percentage: 5
  schedule:
    preferred_days: [Monday, Tuesday, Wednesday, Thursday, Friday, Sunday]
    preferred_time: "10:00"
    articles_per_day: 3

theme:
  base: modern
  logo: /assets/logo.png
  favicon: /assets/logo.png

legal:
  site_description: "news and current events"

# Only the fields below are site-level overrides to the group chain:
tracking:
  ga4: "G-COOLNEWS-XXX"

scripts_vars:
  alpha_site_id: "coolnews-atl-001"
  alpha_zone: "news"
  interstitial_enabled: "false"
```

Everything NOT listed (ads_config, scripts, ads_txt, etc.) is inherited from the group chain. Only `tracking.ga4` and `scripts_vars` are site-level additions.

**A group that only sets theme and legal:**

```yaml
# groups/entertainment.yaml
group_id: entertainment
name: "Entertainment Vertical"

theme:
  colors:
    primary: "#E50914"
    accent: "#B81D24"
  fonts:
    heading: "Playfair Display"

legal:
  site_description: "entertainment news and reviews"
```

No tracking, no scripts, no ads_config — all inherited from org or other groups.

**A group that sets ad config:**

```yaml
# groups/taboola.yaml
group_id: taboola
name: "Taboola Exclusive Sites"

tracking:
  google_ads: "AW-TABOOLA-XXX"

scripts:
  head:
    - id: gpt-script
      src: "https://securepubads.g.doubleclick.net/tag/js/gpt.js"
      async: true
    - id: network-alpha-init
      inline: |
        window.alphaAds = window.alphaAds || [];
        window.alphaAds.push({
          siteId: '{{alpha_site_id}}',
          zone: '{{alpha_zone}}',
          autoRender: true
        });
    - id: network-alpha-loader
      src: "https://cdn.alpha-adnetwork.com/sdk/v3/loader.js"
      async: true
  body_start: []
  body_end:
    - id: interstitial-trigger
      inline: |
        if ({{interstitial_enabled}}) {
          window.alphaAds.showInterstitial({ frequency: 'once_per_session', delay: 3000 });
        }

ads_config:
  interstitial: true
  layout: high-density
  ad_placements:
    - id: "top-banner"
      position: above-content
      sizes:
        desktop: [[728, 90], [970, 90]]
        mobile: [[320, 50], [320, 100]]
      device: all
    - id: "in-content-1"
      position: after-paragraph-3
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250], [336, 280]]
      device: all
    - id: "in-content-2"
      position: after-paragraph-7
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250]]
      device: all
    - id: "sidebar-sticky"
      position: sidebar
      sizes:
        desktop: [[300, 600], [160, 600], [300, 250]]
      device: desktop
    - id: "mobile-anchor"
      position: sticky-bottom
      sizes:
        mobile: [[320, 50]]
      device: mobile
    - id: "homepage-top-banner"
      position: homepage-top
      sizes:
        desktop: [[970, 90]]
        mobile: [[320, 50]]
      device: all
    - id: "category-banner"
      position: category-top
      sizes:
        desktop: [[728, 90]]
        mobile: [[320, 50]]
      device: all

ads_txt:
  - "google.com, pub-XXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0"
  - "advertising.com, 28246, DIRECT"
  - "rubiconproject.com, 19116, DIRECT"
```

**An override:**

```yaml
# overrides/config/test-ads-mock.yaml
override_id: test-ads-mock
name: "Test Ads (Mock Demo)"
priority: 100

targets:
  sites:
    - coolnews-atl

# Only the fields below REPLACE the group chain for targeted sites.
# Everything else (theme, legal, etc.) passes through unchanged.
tracking:
  ga4: "G-TESTDEMO000"

scripts:
  head: []
  body_start: []
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"

ads_config:
  interstitial: false
  layout: standard
  ad_placements:
    - id: "top-banner"
      position: above-content
      sizes:
        desktop: [[728, 90], [970, 90]]
        mobile: [[320, 50], [320, 100]]
      device: all
    - id: "in-content-1"
      position: after-paragraph-3
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250]]
      device: all
    - id: "in-content-2"
      position: after-paragraph-7
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250]]
      device: all
    - id: "sidebar-sticky"
      position: sidebar
      sizes:
        desktop: [[300, 600], [160, 600], [300, 250]]
      device: desktop
    - id: "mobile-anchor"
      position: sticky-bottom
      sizes:
        mobile: [[320, 50]]
      device: mobile
```

## 4. Merge Rules — Complete Reference

### 4.1 Standard merge (org → group → site)

| Data type | Strategy |
|---|---|
| Scalars (strings, numbers, booleans) | Last defined wins |
| Objects | Recursive deep merge (child keys override at same path) |
| `null` value | Explicit disable — does NOT fall through to parent |
| Omitted / undefined | Inherit from parent |
| `scripts` arrays (head, body_start, body_end) | Merge by `id`: same id → child replaces that entry; new id → appended |
| `scripts_vars` | Shallow merge — all keys combined, conflicts: child wins |
| `ads_txt` | ADDITIVE — entries from all layers combined, deduplicated |
| `ad_placements` | Full REPLACEMENT — if child defines ad_placements, replaces parent entirely |
| `theme.colors` | Deep merge — child can override just `primary` without losing `secondary` |

### 4.2 Override merge (DIFFERENT from standard)

An override uses **top-level field REPLACEMENT**, not merge.

**Rule:** If an override defines a top-level field, that field's ENTIRE value replaces the group chain result. Fields the override does NOT define pass through unchanged.

| Override defines... | What happens |
|---|---|
| `ads_config` (with ad_placements etc.) | ENTIRE ads_config replaced. Group chain's ads_config is thrown away. |
| `scripts` (with head, body_end, etc.) | ENTIRE scripts replaced. Group chain's scripts are thrown away. |
| `tracking` (with ga4 etc.) | ENTIRE tracking replaced. Group chain's tracking is thrown away. |
| `ads_txt` | REPLACES (not additive). Only override's ads_txt entries used. |
| `theme` | ENTIRE theme replaced. |
| `scripts_vars` | REPLACES (not shallow merge). Only override's vars used. |
| Nothing (field omitted) | Group chain result passes through unchanged. |

**Why REPLACE not merge for overrides?** An override is an intentional exception. When you say "use exactly these ads for this test," you mean exactly those ads — not a mix of the test ads and the existing ones. If you wanted additive behavior, you'd use a group instead.

**Example — override defines only `ads_config` and `scripts`:**

```
Group chain resolved:
  tracking:  { ga4: "G-TAB", gtm: "GTM-123" }
  scripts:   { head: [gpt, alpha-init, alpha-loader], body_end: [interstitial] }
  ads_config: { placements: [top-banner, in-content-1, sidebar, ...] }
  theme:     { colors: { primary: "#E50914" } }

Override defines:
  ads_config: { placements: [test-banner-only] }
  scripts:   { body_end: [mock-ad-fill] }

Result after override:
  tracking:  { ga4: "G-TAB", gtm: "GTM-123" }           ← UNCHANGED (override didn't define tracking)
  scripts:   { body_end: [mock-ad-fill] }                 ← REPLACED entirely
  ads_config: { placements: [test-banner-only] }          ← REPLACED entirely
  theme:     { colors: { primary: "#E50914" } }           ← UNCHANGED
```

### 4.3 Multi-group merge order

A site with `groups: [entertainment, taboola]` merges as:

```
org.yaml → entertainment.yaml → taboola.yaml → (overrides) → site.yaml
```

Groups merge left-to-right using standard merge rules. Last group wins conflicts. Convention: put editorial groups first, ad partner groups last (so ad config has priority).

### 4.4 Multiple overrides

When multiple overrides target the same site:

1. Sort by `priority` ascending (lowest first)
2. Apply each override in order using REPLACE semantics
3. Higher priority override's fields win (because applied last)

```
Override A (priority 10): defines ads_config
Override B (priority 20): defines ads_config + scripts

Result: Override B's ads_config wins (applied last). Override B's scripts win.
         Override A's ads_config is overwritten by B.
```

### 4.5 Rebuild trigger — affected sites

When saving changes, the "affected sites" that need rebuilding:

| What was saved | Affected sites |
|---|---|
| org.yaml | ALL sites |
| groups/{id}.yaml | All sites that list this group in their groups[] |
| overrides/config/{id}.yaml | UNION of: old targets + new targets (covers adds AND removes) |
| sites/{domain}/site.yaml | That one site |

## 5. Where Ads Render — All Page Types

Ads are NOT limited to article pages. The `ad_placements` positions apply across all page types:

### Article pages

| Position | Where |
|---|---|
| `above-content` | Before article body |
| `after-paragraph-N` | After Nth paragraph in article body |
| `sidebar` | Sidebar column (desktop only) |
| `sticky-bottom` | Fixed to viewport bottom |
| `below-content` | After article body, before related articles |

### Homepage

| Position | Where |
|---|---|
| `homepage-top` | Above the article grid |
| `homepage-mid` | Between article card rows (after every N cards) |
| `sidebar` | Sidebar if layout supports it |
| `sticky-bottom` | Fixed to viewport bottom |

### Category pages

| Position | Where |
|---|---|
| `category-top` | Above the category article list |
| `above-content` | Same as category-top (alias) |
| `sidebar` | Sidebar if layout supports it |
| `sticky-bottom` | Fixed to viewport bottom |

### Shared pages (about, privacy, terms, contact, DMCA)

| Position | Where |
|---|---|
| `above-content` | Before page content |
| `sidebar` | Sidebar if layout supports it |
| `below-content` | After page content |
| `sticky-bottom` | Fixed to viewport bottom |
| `after-paragraph-N` | Works here too — shared pages have paragraphs |

**Implementation:** Each Astro layout (ArticleLayout, HomeLayout, CategoryLayout, PageLayout) renders the appropriate structural anchors (`data-slot`) for its page type. `ad-loader.js` creates ad containers at whatever positions the resolved config defines — it doesn't care about page type, it just looks for the matching `data-slot` or `data-p-index` in the DOM.

## 6. Dashboard — Unified Config Component

### The component

`UnifiedConfigForm` — one React component used EVERYWHERE:

```typescript
interface UnifiedConfigFormProps {
  config: Partial<UnifiedConfigFields>;      // Current values
  onChange: (config: Partial<UnifiedConfigFields>) => void;
  mode: 'org' | 'group' | 'override' | 'site';
  inheritedConfig?: ResolvedConfig;          // For source badges in site mode
}
```

**Sections in the form (always in this order):**

1. **Tracking** — GA4, GTM, Google Ads, Facebook Pixel, custom tracking
2. **Scripts** — Head / Body Start / Body End editors with id/src/inline
3. **Script Variables** — Key-value editor
4. **Ads Config** — Interstitial toggle, layout picker, ad placements visual editor
5. **CLS Placeholder Heights** — Above-content, after-paragraph, sidebar, sticky-bottom
6. **ads.txt** — Multiline editor
7. **Theme** — Base picker, color pickers, logo/favicon upload, font selectors
8. **Legal** — Key-value editor + legal pages override markdown

**Same component, different contexts:**

| Page | Mode | What shows above the form |
|---|---|---|
| Org settings | `org` | Org identity fields (name, legal entity, address, email pattern) |
| Group detail | `group` | Group identity (group_id, name) |
| Override detail | `override` | Override identity (id, name, priority) + targeting panel (groups + sites) |
| Site detail | `site` | Site identity (domain, name, groups, brief) + source badges on every field |

In `site` mode, every field shows a badge: "From org", "From group: entertainment", "From override: test-ads-mock", "Custom". This tells the user where each value comes from.

### Dashboard routes (final)

```
/[org]/settings                    Org settings: identity + UnifiedConfigForm (mode=org)
/[org]/groups                      Groups list
/[org]/groups/[id]                 Group detail: identity + UnifiedConfigForm (mode=group)
/[org]/groups/new                  Create group
/[org]/overrides                   Overrides list
/[org]/overrides/[id]              Override detail: identity + targets + UnifiedConfigForm (mode=override)
/[org]/overrides/new               Create override
/[org]/sites                       Sites list
/[org]/sites/[domain]              Site detail: identity + brief + UnifiedConfigForm (mode=site)
/[org]/sites/new                   Site creation wizard
```

### Rebuild dialog (on save)

After saving any config (org, group, override, site):

1. Compute affected sites:
   - For overrides: UNION of old targets + new targets (handles adds AND removes)
   - For groups: all sites with this group in their groups[]
   - For org: all sites
   - For site: that one site

2. Show dialog:
   - Title: "Changes saved — trigger rebuild?"
   - Body: "Your changes are saved to git. Sites need to rebuild to show changes (2-3 min)."
   - Affected count: "{N} site(s) affected: coolnews-atl, ..."
   - **Rebuild now** (primary): info tooltip explains what happens
   - **I'll rebuild later** (secondary): info tooltip explains when changes will appear

3. If "No sites affected" (e.g., override with empty targets): close dialog, show toast "Saved."

---

# PART C — Claude Code Implementation Prompt

> **Follow atomic-labs-dev-standards skill. Autonomous execution. Do not ask.**
> **CRITICAL: Do not break coolnews-atl. Mock ads must keep working.**

## Phase 1: shared-types update

**[atomic-content-platform]** `packages/shared-types/src/config.ts`

Update interfaces to match the spec exactly:
- Remove `in_content_slots` and `sidebar` from AdsConfig
- Remove `MonetizationConfig` and `MonetizationJson` if they still exist
- Add homepage/category position strings to AdPlacement position docs
- Ensure `OverrideConfig` has correct `targets` shape
- Ensure `SiteConfig` uses `groups: string[]`
- Add `applied_overrides: string[]` to ResolvedConfig
- Add `inlineAdConfig` field to ResolvedConfig output

Verification: `tsc --noEmit` passes.

## Phase 2: resolve-config.ts

**[atomic-content-platform]**

Implement the exact merge rules from Section 4 of this spec:
- Standard merge for org → groups → site
- REPLACE merge for overrides (top-level field replacement)
- Multi-group left-to-right merge
- Override priority sorting
- ads_txt additive for standard merge, REPLACE for overrides
- scripts merge-by-id for standard merge, REPLACE for overrides
- Backward compat: `group: string` → `groups: [string]`

Output `inlineAdConfig` on the resolved config for BaseLayout.

Unit tests for all merge rules, override replace cases, priority ordering.

## Phase 3: Network repo restructure

**[atomic-labs-network]** Ensure these files exist correctly on main:
- `groups/taboola.yaml` (with full ad config from spec Section 3)
- `groups/entertainment.yaml` (theme only)
- `groups/adsense-default.yaml` (basic ads)
- `groups/mock-minimal.yaml` (QA: purple/magenta mock ads, 2 placements, different positions)
- `overrides/config/test-ads-mock.yaml` (targeting coolnews-atl)
- `org.yaml` with `default_groups` (not `default_monetization`)
- NO `monetization/` directory

**[atomic-labs-network]** staging/coolnews-atl:
- `sites/coolnews-atl/site.yaml` with `groups: [entertainment, taboola]`
- NO `monetization:` field

Merge main into staging/coolnews-atl so all group/override files are available on the staging branch.

## Phase 4: Astro layouts — all page types

**[atomic-content-platform]** `packages/site-builder/`

Every Astro layout needs structural anchors for ad-loader.js:

### ArticleLayout.astro
- `data-slot="above-content"` before article body
- `data-p-index="N"` on every paragraph
- `data-ad-placeholder` hidden divs at configured positions
- `data-slot="sidebar"` in aside column
- `data-slot="below-content"` after article body
- `data-slot="sticky-bottom"` fixed bottom

### HomeLayout.astro (homepage)
- `data-slot="homepage-top"` above the article grid
- `data-slot="homepage-mid"` between card rows (insert after every N cards, configurable)
- `data-slot="sidebar"` if layout has sidebar
- `data-slot="sticky-bottom"` fixed bottom

### CategoryLayout.astro (category/vertical pages)
- `data-slot="category-top"` above the article list
- `data-slot="sidebar"` if layout has sidebar
- `data-slot="sticky-bottom"` fixed bottom

### PageLayout.astro (shared pages: about, privacy, terms, contact, DMCA)
- `data-slot="above-content"` before page content
- `data-p-index="N"` on paragraphs (shared pages have text content)
- `data-slot="sidebar"` if layout has sidebar
- `data-slot="below-content"` after page content
- `data-slot="sticky-bottom"` fixed bottom

All layouts include InlineTracking.astro in `<head>` and `ad-loader.js` before `</body>`.

## Phase 5: ad-loader.js update

**[atomic-content-platform]** `packages/site-builder/public/ad-loader.js`

- Read from `window.__ATL_CONFIG__`
- Handle ALL position types including `homepage-top`, `homepage-mid`, `category-top`
- For `homepage-mid`: find the article grid container, insert ad after every N cards
- For positions that don't exist on the current page: silently skip (no error)

## Phase 6: mock-ad-fill.js update

**[atomic-content-platform]** `packages/site-builder/public/mock-ad-fill.js`

Add color entries for:
- `homepage-top-banner`: dark blue (#1565C0, bg #E3F2FD), label "HOMEPAGE TOP"
- `category-banner`: dark cyan (#00838F, bg #E0F7FA), label "CATEGORY TOP"
- `homepage-mid`: dark indigo (#283593, bg #E8EAF6), label "HOMEPAGE MID"
- Keep existing entries for article placements
- Keep mock-minimal entries (purple/magenta)

Debug panel: show "Override active: {name}" or "Group config only".

## Phase 7: Dashboard — UnifiedConfigForm component

**[atomic-content-platform]** `services/dashboard/src/components/config/UnifiedConfigForm.tsx`

Create ONE component with all sections from the spec Section 6. Used by org settings, group detail, override detail, and site detail pages.

## Phase 8: Dashboard — route updates

- Remove `/monetization` routes and components if still present
- Group detail: full UnifiedConfigForm (mode=group)
- Override detail: targeting panel + UnifiedConfigForm (mode=override)
- Site detail: merge monetization tab content into config tab, use UnifiedConfigForm (mode=site) with source badges
- Org settings: UnifiedConfigForm (mode=org)
- Site wizard: multi-group selector step

## Phase 9: Dashboard — rebuild dialog fix

- Affected sites = UNION of old targets + new targets (for overrides)
- Handle "no sites affected" gracefully (just close, toast "Saved")
- Rebuild now: commits .build-trigger to each affected site's staging branch
- Info tooltips on both buttons

## Phase 10: Build pipeline

- `detect-changed-sites.ts`: handle `overrides/config/*.yaml` changes (rebuild targeted sites)
- `build-site.ts`: call updated resolve-config, output inlineAdConfig
- BaseLayout: `window.__ATL_CONFIG__` variable name

## Phase 11: Commit, deploy, verify

```bash
# Platform
pnpm typecheck && pnpm build && pnpm test
git commit -m "feat: final architecture — unified config, overrides, all page types"
git push origin michal-dev
cloudgrid deploy

# Network — merge main into staging, trigger rebuild
cd ~/Documents/ATL-content-network/atomic-labs-network
git checkout staging/coolnews-atl
git merge main
date > sites/coolnews-atl/.build-trigger
git add -A && git commit -m "chore: rebuild with final architecture"
git push origin staging/coolnews-atl
```

---

# PART D — QA Plan

## QA 1: Config resolution

- [ ] `resolveConfig('.', 'coolnews-atl')` succeeds
- [ ] Theme from entertainment group, ads from taboola group
- [ ] Override test-ads-mock applies (replaces ads_config and scripts entirely)
- [ ] tracking.ga4 comes from override ("G-TESTDEMO000"), not from group
- [ ] tracking.google_ads passes through from taboola group (override didn't define it)
- [ ] scripts from override (mock-ad-fill.js) replace group scripts entirely
- [ ] ads_txt is additive from org + groups (override ads_txt replaces if defined)

## QA 2: Mock ads on article page

Open staging site → any article:
- [ ] Blue top banner (728×90)
- [ ] Orange in-content after paragraph 3
- [ ] Green in-content after paragraph 7
- [ ] Red sidebar (desktop)
- [ ] Teal mobile anchor (mobile)
- [ ] Debug panel shows "Override active: test-ads-mock"

## QA 3: Mock ads on homepage

Open staging site → homepage:
- [ ] Ad slot at `homepage-top` position (if configured in placements)
- [ ] Ad slot at `homepage-mid` between article cards (if configured)
- [ ] Sticky-bottom visible on mobile

## QA 4: Mock ads on category page

Open staging site → any category (e.g., Current Events):
- [ ] Ad slot at `category-top` position (if configured)
- [ ] Sticky-bottom visible on mobile

## QA 5: Mock ads on shared pages

Open staging site → About / Privacy / Terms:
- [ ] Ad slots render at above-content, sidebar, below-content positions
- [ ] Paragraph indexing works (if page has text content)

## QA 6: Group-only config (remove override)

Temporarily remove coolnews-atl from test-ads-mock override targets. Rebuild.
- [ ] Mock ads from override DISAPPEAR
- [ ] Taboola group's ad config takes over (real ad scripts, not mock)
- [ ] Debug panel shows "Group config only"
- [ ] Revert and rebuild — mock ads return

## QA 7: Mock-minimal group (different visual)

Temporarily change coolnews-atl to `groups: [entertainment, mock-minimal]`, remove from override. Rebuild.
- [ ] Only 2 ad slots (not 5): purple mini-top (468×60) + magenta mini-mid (after paragraph 5)
- [ ] Visually distinct from override's blue/orange/green
- [ ] Revert and rebuild

## QA 8: Override replace semantics

Apply override that defines ONLY `ads_config`. Check:
- [ ] ads_config entirely from override
- [ ] tracking entirely from group chain (override didn't touch it)
- [ ] scripts entirely from group chain (override didn't touch it)
- [ ] theme entirely from group chain

## QA 9: Dashboard unified form

- [ ] Org settings shows UnifiedConfigForm with all sections
- [ ] Group detail shows SAME form layout
- [ ] Override detail shows SAME form layout + targeting panel
- [ ] Site detail shows SAME form layout + source badges
- [ ] All forms save valid YAML to correct paths in git

## QA 10: Rebuild dialog

- [ ] Saving override with targets → shows affected sites → "Rebuild now" works
- [ ] Removing site from override targets → still shows affected site (needs rebuild to remove override)
- [ ] Saving override with empty targets → shows "Saved" toast, no error
- [ ] Saving group → shows sites in that group as affected
- [ ] Info tooltips on both buttons explain what happens

## QA 11: Favicon

- [ ] Site detail page shows favicon upload alongside logo
- [ ] Favicon preview at 32×32 with browser-tab mockup
- [ ] Upload saves to sites/{domain}/assets/

## QA 12: Delete group

- [ ] Delete button on group detail page
- [ ] Confirmation popup shows site count
- [ ] Warning if sites reference this group
- [ ] Delete commits removal to git
- [ ] Redirects to groups list
