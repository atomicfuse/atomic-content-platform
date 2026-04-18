# Overrides & Config

An **override** is a config patch that targets a set of groups and/or individual sites with **REPLACE semantics**. Overrides live alongside groups in the merge chain but behave differently: where groups deep-merge their fields into the cascade, an override **completely replaces** any field it defines. Fields the override does not mention pass through untouched.

Use overrides for exceptions — temporary test configs, per-site ad tweaks, A/B experiments — anything that should not be a permanent group but needs to change resolved config for specific targets.

## At a Glance

| Concern | Answer |
|---------|--------|
| **Where do overrides live?** | `overrides/config/<id>.yaml` on the `main` branch of the network repo |
| **How are they applied?** | After the group chain, before the site layer. Higher `priority` wins. |
| **What do they target?** | The **union** of `targets.groups` (all sites in those groups) and `targets.sites` (individual sites) |
| **Merge behavior?** | **REPLACE** — if an override defines a field, it completely replaces what the group chain produced for that field |
| **Dashboard route?** | `/overrides`, `/overrides/[id]`, `/overrides/new` |

## Override YAML Structure

```yaml
# overrides/config/test-ads-mock.yaml
override_id: test-ads-mock
name: "Test Ads (Mock Demo)"
priority: 100
targets:
  sites:
    - coolnews-atl

tracking:
  ga4: "G-TESTDEMO000"

scripts:
  head:
    - id: gilad-1
      src: http://whatever.com/123.js
      async: true
  body_start: []
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"

ads_config:
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

## REPLACE vs Deep Merge

This is the key difference between overrides and groups.

**Groups use deep merge.** When two groups both define `tracking`, their keys are merged — group B adds or overwrites individual keys without removing what group A provided.

**Overrides use REPLACE.** If an override defines `ads_config`, the entire `ads_config` object from the group chain is thrown away and replaced with the override's version. Keys the override does not mention at the top level pass through from the group chain.

Example:

```
Group chain resolves to:
  tracking:
    ga4: "G-ORG123"
    gtm: "GTM-ABC"
  ads_config:
    interstitial: true
    layout: aggressive
    ad_placements: [...]

Override (priority 10) defines:
  ads_config:
    interstitial: false
    layout: standard
    ad_placements: [... different set ...]

Result after override:
  tracking:                    # UNTOUCHED — override did not define tracking
    ga4: "G-ORG123"
    gtm: "GTM-ABC"
  ads_config:                  # REPLACED — override's version wins entirely
    interstitial: false
    layout: standard
    ad_placements: [... different set ...]
```

This design makes overrides predictable. When you define `ads_config` in an override, you know exactly what every targeted site gets — no surprises from partially inherited keys.

## The Full Merge Chain

```
org  ->  groups[0]  ->  groups[1]  ->  ...  ->  overrides (by priority)  ->  site
         \_______________ deep merge _______________/   \__ REPLACE __/    \_ deep merge _/
```

Step by step:

1. Start with `org.yaml`.
2. Deep-merge each group in the site's `groups` list, left to right.
3. Apply overrides whose targets include this site, sorted by ascending `priority`. Each override **replaces** the fields it defines.
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
| **Config** | Unified config form with all sections: Tracking, Scripts, Script Variables, Ads Config, ads.txt, Theme, Legal. Each section shows "REPLACE semantics" notices reminding you that defined fields entirely replace the group chain's values. |

The Config tab uses the same `UnifiedConfigForm` component used by org, group, and site pages — just with `mode="override"` to show REPLACE semantics descriptions. Only fields you define affect the resolved config. An override with only Ads Config filled replaces only `ads_config` for targeted sites — all other fields pass through from the group chain.

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
         |  1. Serialize form -> YAML
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
Astro build uses updated ResolvedConfig (with new override applied)
         |
         v
Live site serves updated config
```

## Code Map

```
services/dashboard/
  src/app/overrides/page.tsx               -- Override list UI
  src/app/overrides/[id]/page.tsx          -- Override editor (tabbed)
  src/app/overrides/new/page.tsx           -- Create new override
  src/app/api/overrides/[id]/route.ts      -- GET / PUT override
  src/app/api/overrides/route.ts           -- GET list / POST create

packages/site-builder/
  scripts/resolve-config.ts                -- Merge chain: org -> groups -> overrides -> site

<network-repo>/overrides/config/<id>.yaml  -- Override config files (on main)
```

## Operations

### Create a test-ads override for a single site

1. Go to `/overrides/new`, enter id `test-ads-mock`, name "Test Ads (Mock Demo)".
2. On the **Targeting** tab, toggle on the target site (e.g. `coolnews-atl`).
3. On the **Ads Config** tab, configure mock placements and set `interstitial: false`.
4. On the **Scripts** tab, add the mock ad-fill script to `body_end`.
5. Click **Save**. The site rebuilds with mock ads; no other sites are affected.

### Switch a site from mock ads to real ads

Remove the site from the test-ads override's target list (or delete the override entirely). The site falls back to whatever its group chain provides. Save and the site rebuilds.

### Run an A/B test on ad layout

Create two overrides with different `ads_config.layout` values, each targeting a different subset of sites. Give the "B" variant a higher priority in case of overlap. Compare performance, then delete the losing override.

### Debug "why does this site have unexpected ads config?"

Check the site's resolved config in **Sites -> [domain] -> Config**. Source badges show whether each field came from org, a group, an override (with override name), or the site itself. If an override is the source, click through to `/overrides/<id>` to inspect its targeting and priority.
