# Overrides & Config

An **override** is a config patch that targets a set of groups and/or individual sites with **per-field merge mode control**. Overrides live alongside groups in the merge chain. Each field in an override declares how it combines with the group chain — merge, replace, append, or other field-specific modes. Fields the override does not mention pass through untouched.

Use overrides for exceptions — temporary test configs, per-site ad tweaks, A/B experiments — anything that should not be a permanent group but needs to change resolved config for specific targets.

## At a Glance

| Concern | Answer |
|---------|--------|
| **Where do overrides live?** | `overrides/config/<id>.yaml` on the `main` branch of the network repo |
| **How are they applied?** | After the group chain, before the site layer. Higher `priority` wins. |
| **What do they target?** | The **union** of `targets.groups` (all sites in those groups) and `targets.sites` (individual sites) |
| **Merge behavior?** | **Per-field `_mode`** — each field declares its own merge strategy. Safe defaults prevent accidental data loss. |
| **Dashboard route?** | `/overrides`, `/overrides/[id]`, `/overrides/new` |

## Merge Modes

Each field in an override supports a `_mode` directive that controls how it combines with the group chain. When `_mode` is omitted, the field's **default mode** is used.

| Field | Available Modes | Default | Notes |
|-------|----------------|---------|-------|
| `tracking` | `merge`, `replace` | **merge** | Only specified keys change; other tracking IDs inherited |
| `scripts` | `merge_by_id`, `append`, `replace` | **merge_by_id** | Same id = replace that script, new id = append |
| `scripts_vars` | `merge`, `replace` | **merge** | Keys combined; existing placeholders keep working |
| `ads_config` | `replace`, `merge_placements` | **replace** | Ad layouts are complete sets by default |
| `ads_txt` | `add`, `replace` | **add** | Entries appended; revenue-critical safety default |
| `theme` | `merge`, `replace` | **merge** | Change a color without losing fonts/logo |
| `legal` | `merge`, `replace` | **merge** | Add a key without losing others |

### Mode Definitions

- **`merge`** — Deep-merge override fields into the group chain. Only keys you set replace parent values. Unset keys inherit.
- **`replace`** — Wipe the group chain's value for this field entirely. Only the override's value is used.
- **`merge_by_id`** (scripts) — Scripts with the same `id` as a parent script replace it. New `id`s are appended. Existing scripts not in the override pass through.
- **`append`** (scripts) — Add new scripts without replacing any existing ones, even if IDs match.
- **`add`** (ads_txt) — Entries are appended to the accumulated list, deduplicated.
- **`merge_placements`** (ads_config) — Keep the group chain's ad placements and add/update specific ones by `id`.

## Override YAML Structure

```yaml
# overrides/config/test-ads-mock.yaml
override_id: test-ads-mock
name: "Test Ads (Mock Demo)"
priority: 100
targets:
  sites:
    - coolnews-atl

# tracking: merge (default) — only ga4 overridden, GTM + Google Ads preserved
tracking:
  ga4: "G-TESTDEMO000"

# scripts: merge_by_id (default) — adds to existing group scripts
scripts:
  head:
    - id: gilad-1
      src: http://whatever.com/123.js
      async: true
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"

# ads_config: replace (explicit) — full ad layout swap for testing
ads_config:
  _mode: replace
  interstitial: false
  layout: standard
  ad_placements:
    - id: top-banner
      position: above-content
      device: all
      sizes:
        desktop: [[728, 90], [970, 90]]
        mobile: [[320, 50], [320, 100]]
    - id: in-content-1
      position: after-paragraph-3
      device: all
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250]]
    - id: in-content-2
      position: after-paragraph-7
      device: all
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250]]
    - id: sidebar-sticky
      position: sidebar
      device: desktop
      sizes:
        desktop: [[300, 600], [160, 600], [300, 250]]
    - id: mobile-anchor
      position: sticky-bottom
      device: mobile
      sizes:
        mobile: [[320, 50]]

# ads_txt: add (default) — no entries to add, group chain preserved
ads_txt: []
```

An override uses the same YAML schema as org, group, and site configs. Any field that is valid in those files is valid in an override — `tracking`, `ads_config`, `scripts`, `scripts_vars`, `ads_txt`, `theme`, `legal`, and so on.

## Targeting

An override declares its targets under `targets`:

```yaml
targets:
  groups: ["taboola"]          # every site that lists "taboola" in its groups
  sites: ["coolnews-atl"]      # this specific site, regardless of groups
```

The effective target set is the **union** of both lists. A site is affected by an override if:

- The site is explicitly listed in `targets.sites`, **or**
- The site belongs to any group listed in `targets.groups`.

Both fields are optional. An override with only `targets.sites` affects just those sites. An override with only `targets.groups` affects every site in those groups. An override with neither target affects nothing (useful as a draft).

## Priority

The `priority` field (integer) controls application order when multiple overrides affect the same site:

- Overrides are sorted by `priority` **ascending**.
- **Higher priority = applied later = wins conflicts.** If two overrides both define `ads_config`, the one with the higher priority replaces the other.
- If two overrides have the same priority, ordering is undefined — avoid this by assigning distinct values.

Suggested convention:

| Range | Use case |
|-------|----------|
| 1 -- 9 | Network-wide defaults and baseline overrides |
| 10 -- 49 | Standard overrides (partner configs, seasonal tweaks) |
| 50 -- 99 | High-priority exceptions and A/B tests |
| 100+ | Emergency / debug overrides |

## Per-Field Merge Modes (Worked Examples)

### Tracking: merge (default)

```
Group chain resolves to:
  tracking:
    ga4: "G-ORG123"
    gtm: "GTM-ABC"
    google_ads: "AW-XYZ"

Override defines:
  tracking:
    ga4: "G-TESTDEMO000"      # only this changes

Result:
  tracking:
    ga4: "G-TESTDEMO000"      # from override
    gtm: "GTM-ABC"            # inherited from groups
    google_ads: "AW-XYZ"      # inherited from groups
```

With the old blanket-replace behavior, GTM and Google Ads would have been lost. The `merge` default prevents this.

### Tracking: replace (explicit)

```yaml
tracking:
  _mode: replace
  ga4: "G-TESTDEMO000"
```

Result: only `ga4` is set. `gtm`, `google_ads`, `facebook_pixel` all become null. Use only when you want to completely reset tracking.

### Scripts: merge_by_id (default)

```
Group chain scripts.head: [gpt-script, alpha-init, alpha-loader]
Group chain scripts.body_end: [interstitial-trigger]

Override defines:
  scripts:
    body_end:
      - id: mock-ad-fill
        src: "/mock-ad-fill.js"

Result:
  scripts.head: [gpt-script, alpha-init, alpha-loader]   # untouched
  scripts.body_end: [interstitial-trigger, mock-ad-fill]  # merged by id
```

### Ads Config: replace (default)

```
Group chain ads_config: { interstitial: true, layout: "high-density", ad_placements: [...7 items] }

Override defines:
  ads_config:
    _mode: replace
    interstitial: false
    layout: standard
    ad_placements: [...5 mock items]

Result:
  ads_config: { interstitial: false, layout: "standard", ad_placements: [...5 mock items] }
```

The entire group chain ads_config is replaced. This is the default for ads_config because ad layouts are complete sets.

### Ads Config: merge_placements

```yaml
ads_config:
  _mode: merge_placements
  ad_placements:
    - id: "top-banner"
      position: above-content
      sizes: { desktop: [[970, 250]] }
      device: all
```

Result: the `top-banner` placement is updated, all other placements from the group chain are kept.

### ads.txt: add (default)

```
Group chain ads_txt: ["google.com, pub-XXX, DIRECT", "advertising.com, 28246, DIRECT"]

Override defines:
  ads_txt:
    - "test-partner.com, pub-TEST, DIRECT"

Result:
  ads_txt: ["google.com, pub-XXX, DIRECT", "advertising.com, 28246, DIRECT", "test-partner.com, pub-TEST, DIRECT"]
```

Revenue-critical entries are never lost.

## The Full Merge Chain

```
org  ->  groups[0]  ->  groups[1]  ->  ...  ->  overrides (by priority, per-field _mode)  ->  site
         \_______________ deep merge _______________/   \_________ per-field merge ________/    \_ deep merge _/
```

Step by step:

1. Start with `org.yaml`.
2. Deep-merge each group in the site's `groups` list, left to right.
3. Apply overrides whose targets include this site, sorted by ascending `priority`. Each override applies its per-field `_mode` (merge, replace, merge_by_id, add, etc.).
4. Deep-merge the site's own `site.yaml` on top (site always wins).
5. Resolve `{{placeholders}}` in scripts, deduplicate `ads_txt`, fill defaults.

The output is a single `ResolvedConfig` JSON consumed by the site builder.

## When to Use an Override vs a Group

| Scenario | Use a group | Use an override |
|----------|-------------|-----------------|
| Shared ad partner setup (Taboola, AdSense) used by many sites | Yes | No |
| Editorial vertical (entertainment, news) with theme + fonts | Yes | No |
| Temporary mock-ads config for QA on one site | No | Yes |
| A/B testing a different ad layout on a subset of sites | No | Yes |
| Per-site tracking ID tweak that doesn't warrant a new group | No | Yes |
| Seasonal campaign script injected across a group for two weeks | No | Yes |
| Permanent legal config shared by a region of sites | Yes | No |

**Rule of thumb:** if the config is permanent and shared, make it a group. If it is temporary, exceptional, or narrowly targeted, make it an override.

## Where Overrides Live

Overrides are stored in the network repo under:

```
overrides/
  config/                  <-- Config overrides (this page)
    test-ads-mock.yaml
    seasonal-campaign.yaml
    ...
  <site_id>/               <-- Shared-page overrides (different thing — see Shared Pages guide)
    about.yaml
    contact.yaml
```

**Do not confuse the two.** `overrides/config/` holds config overrides that affect the merge chain. `overrides/<site_id>/` holds per-site content overrides for shared pages (about, contact, privacy, etc.) and is managed from the Shared Pages UI.

Config overrides are always committed to the `main` branch of the network repo. They take effect on the next site build.

## Dashboard UI

### Override List (`/overrides`)

Lists all overrides with name, priority, target summary (N groups, N sites), and a quick indicator of which config fields are defined. Click any row to edit.

### Override Editor (`/overrides/[id]`)

A tabbed editor with three tabs:

| Tab | Contents |
|-----|----------|
| **General** | Override id, name, priority |
| **Targeting** | Searchable toggle lists for groups and sites. Groups show how many sites they contain; sites show which groups they belong to. |
| **Config** | Unified config form with **merge mode selectors** at the top of each section. Each section shows a dropdown with available modes and an info tooltip explaining the behavior. When "Replace" is selected, an amber warning banner appears. |

The Config tab uses the same `UnifiedConfigForm` component used by org, group, and site pages — just with `mode="override"` to show merge mode selectors. The merge mode dropdowns allow you to choose how each field combines with the group chain:

- **Tracking** — "Merge (recommended)" or "Replace"
- **Scripts** — "Merge by ID (recommended)", "Append only", or "Replace"
- **Script Variables** — "Merge (recommended)" or "Replace"
- **Ads Config** — "Replace (default)" or "Merge placements"
- **ads.txt** — "Add (recommended)" or "Replace"
- **Theme** — "Merge (recommended)" or "Replace"
- **Legal** — "Merge (recommended)" or "Replace"

Only fields you define affect the resolved config. An override with only Ads Config filled replaces only `ads_config` for targeted sites — all other fields pass through from the group chain. The selected `_mode` is saved into the YAML and read by the config resolver at build time.

### Create Override (`/overrides/new`)

Provide a kebab-case id and a display name. The new override starts with no targets and no config fields — a safe draft state. Add targeting and config, then save.

## End-to-End Edit Flow

```
Dashboard -> /overrides/<id>   (edit form)
         |
         |  Click "Save"
         v
PUT /api/overrides/<id>
         |
         |  1. Serialize form -> YAML (with _mode directives embedded per field)
         |  2. commitNetworkFiles([{overrides/config/<id>.yaml}], "config(overrides): update <id>")
         |     -> commits to network repo main
         |  3. Enumerate sites affected by this override's targets
         |  4. For each Live affected site:
         |       touch sites/<domain>/.build-trigger on main
         |
         v
Cloudflare Pages: detect changed .build-trigger -> rebuild affected sites
         |
         v
Astro build uses updated ResolvedConfig (with new override applied using _mode semantics)
         |
         v
Live site serves updated config
```

## Code Map

```
services/dashboard/
  src/app/overrides/page.tsx               -- Override list UI
  src/app/overrides/[id]/page.tsx          -- Override editor (tabbed, with merge mode support)
  src/app/overrides/new/page.tsx           -- Create new override
  src/app/api/overrides/[id]/route.ts      -- GET / PUT override
  src/app/api/overrides/route.ts           -- GET list / POST create

packages/shared-types/
  src/monetization.ts                      -- OverrideConfig type with _mode fields, MergeMode types

packages/site-builder/
  scripts/resolve-config.ts                -- Merge chain: org -> groups -> overrides (per-field _mode) -> site

docs/specs/
  smart-override-merge-modes-spec.md       -- Full design spec for the merge mode system

<network-repo>/overrides/config/<id>.yaml  -- Override config files (on main)
```

## Operations

### Create a test-ads override for a single site

1. Go to `/overrides/new`, enter id `test-ads-mock`, name "Test Ads (Mock Demo)".
2. On the **Targeting** tab, toggle on the target site (e.g. `coolnews-atl`).
3. On the **Config** tab, set the Ads Config mode to "Replace" and configure mock placements with `interstitial: false`.
4. On the **Scripts** section, leave mode as "Merge by ID" and add the mock ad-fill script to `body_end` — group scripts are preserved.
5. Click **Save**. The site rebuilds with mock ads and preserved tracking; no other sites are affected.

### Switch a site from mock ads to real ads

Remove the site from the test-ads override's target list (or delete the override entirely). The site falls back to whatever its group chain provides. Save and the site rebuilds.

### Run an A/B test on ad layout

Create two overrides with different `ads_config` (both with `_mode: replace`), each targeting a different subset of sites. Give the "B" variant a higher priority in case of overlap. Compare performance, then delete the losing override.

### Add a test tracking pixel without breaking existing tracking

Create an override with `tracking` in merge mode (the default). Only set the one ID you need — all other tracking IDs inherit from the group chain. No risk of losing GTM or Google Ads attribution.

### Debug "why does this site have unexpected ads config?"

Check the site's resolved config in **Sites -> [domain] -> Config**. Source badges show whether each field came from org, a group, an override (with override name), or the site itself. If an override is the source, click through to `/overrides/<id>` to inspect its targeting, priority, and `_mode` per field.
