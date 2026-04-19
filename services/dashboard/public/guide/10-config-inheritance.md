# Config Inheritance & Groups

The platform uses a **four-layer config cascade** to manage settings across every site in the network. Each layer only specifies what it owns; everything else is inherited from the layer above. You define defaults once and customize the minimum needed per group, override, or site.

## The Cascade at a Glance

```
                        network.yaml
                 (Platform version pin — one file)
                             |
      +-----------+----------+-----------+----------+
      v           v          v           v          v
  org.yaml   groups/*.yaml   overrides/   sites/*/site.yaml
  Identity   Theme, ads,     config/      Domain, name, brief,
  Default    tracking,       REPLACE      any per-site override
  tracking   scripts, legal  semantics
  Default    (any combo)
  theme

         Merge order  ->  org  ->  groups (left-to-right)  ->  overrides (by priority)  ->  site   (last wins)
                                         |
                                         v
                               resolve-config.ts
                                         |
                                         v
                               ResolvedConfig (single JSON)
```

Two rules to remember:

1. **Groups merge left-to-right, overrides use REPLACE semantics.** Groups deep-merge in order; each override completely replaces the fields it defines without merging into the group chain's values. Fields not in the override pass through untouched.
2. **Site always wins.** If you set something in `site.yaml`, nothing above can overturn it.

## What Each Layer Owns

| Layer | File(s) | Typical contents | Who edits it |
|-------|---------|------------------|--------------|
| **Network** | `network.yaml` | Platform version, network id, network name | Platform team (rarely) |
| **Org** | `org.yaml` | Company identity, legal entity, support email pattern, **default** theme and tracking | Network admin |
| **Group** | `groups/<id>.yaml` | Theme, ads, tracking, scripts, legal — any combination of config fields | Editors / ops |
| **Override** | `overrides/config/<id>.yaml` | Targeted config overrides with REPLACE semantics; targets groups and/or individual sites | Revenue / ops |
| **Site** | `sites/<domain>/site.yaml` | Domain, site name, content brief, schedule, any override | Per-site owner |

Groups carry everything — theme colors, fonts, ad placements, tracking IDs, scripts, legal pages, ads.txt entries. A single group can hold any combination of these fields, so the same ad setup can be re-used across unrelated editorial verticals without duplication.

## Overrides

Overrides live in `overrides/config/<id>.yaml` and use **REPLACE semantics**: if an override defines a field (e.g. `ads_config`), it completely replaces the value produced by the group chain — no deep merge. Fields the override does not mention pass through untouched.

Each override specifies **targets** — the union of groups and/or individual sites it applies to:

```yaml
# overrides/config/test-ads-mock.yaml
override_id: test-ads-mock
name: "Test Ads (Mock Demo)"
priority: 100
targets:
  sites:
    - coolnews-atl
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
scripts:
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"
```

An override with `targets.groups: [entertainment]` applies to every site whose groups list includes `entertainment`. Both `targets.groups` and `targets.sites` are optional; specify one or both.

A site with no applicable overrides simply inherits the merged group chain as-is.

## Multi-Group Support

A site can belong to multiple groups. They are listed in order and merged left-to-right; later groups win:

```yaml
groups:
  - news              # tone, content defaults
  - entertainment     # overrides theme colors
```

The legacy `group: "single-group"` shorthand is still accepted and is treated as `groups: ["single-group"]`.

## How Merging Works

Different config shapes merge with different rules. The resolver applies them automatically.

### Deep merge (objects)

Objects like `tracking`, `ads_config`, and `theme` use **deep merge** — only the keys you specify at a lower layer override the parent. Unspecified keys are inherited.

```yaml
# org.yaml
tracking:
  ga4: "G-ORG123"
  gtm: null

# groups/premium-ads.yaml
tracking:
  google_ads: "AW-MON456"

# sites/muvizz.com/site.yaml
tracking:
  ga4: "G-MUVIZZ-OVERRIDE"

# Resolved for muvizz.com:
#   ga4: "G-MUVIZZ-OVERRIDE"  (site)
#   gtm: null                  (org — kept explicit disable)
#   google_ads: "AW-MON456"    (group)
```

**`null` vs. omitted is significant.** Setting a key to `null` means "disable — do not inherit". Omitting the key means "inherit whatever the parent says". Both feel similar but behave oppositely.

### Merge by id (scripts)

Scripts are merged **by their `id` field** rather than replaced as arrays. A child can override a single script while keeping everything else the parent provided:

```yaml
# groups/premium-ads.yaml
scripts:
  head:
    - id: gpt-script
      src: "https://securepubads.g.doubleclick.net/tag/js/gpt.js"
      async: true
    - id: alpha-init
      inline: "window.alphaAds.push({ siteId: '{{alpha_site_id}}' })"

# sites/some-site/site.yaml
scripts:
  head:
    - id: alpha-init         # same id — replaces the group entry
      inline: "window.alphaAds.push({ siteId: 'custom-override' })"

# Resolved scripts.head: [gpt-script (unchanged), alpha-init (site version)]
```

### Append + deduplicate (ads.txt)

`ads.txt` entries are the one array type that **accumulates** across layers — org, all groups (in order), overrides, and site — and are deduplicated as a final step. Child layers can add but cannot remove.

### Spread merge (feature configs)

Feature configs like `preview_page`, `categories`, `sidebar`, and `search` use a flat spread: defaults first, then org, groups, overrides, site. All fields are guaranteed present in the resolved config.

## Script Variables & Placeholders

Scripts can contain `{{placeholder}}` variables that are resolved at build time. Variables come from `scripts_vars` at any layer and cascade the same way as regular config:

```yaml
# groups/premium-ads.yaml
scripts:
  head:
    - id: alpha-init
      inline: |
        window.alphaAds.push({
          siteId: '{{alpha_site_id}}',
          zone: '{{alpha_zone}}'
        });

# sites/coolnews-atl/site.yaml
scripts_vars:
  alpha_site_id: "coolnews-atl-001"
  alpha_zone: "news"
```

The special variable `{{domain}}` is always available.

**Strict mode:** if any `{{placeholder}}` remains unresolved after merging, the build fails with an error listing missing variables — no silent bugs from undefined ad ids or tracking codes.

## Dashboard Surfaces

| Where | What you edit | Writes to |
|-------|---------------|-----------|
| **Settings -> General** | `org.yaml` (identity fields) | `main` |
| **Settings -> Config** | `org.yaml` (tracking, scripts, ads, theme, legal) | `main` |
| **Settings -> Network** | `network.yaml` | `main` |
| **Groups -> [group] -> Config** | `groups/<id>.yaml` | `main` |
| **Overrides -> [id] -> Config** | `overrides/config/<id>.yaml` | `main` |
| **Sites -> [domain] -> Content Agent** | `sites/<domain>/site.yaml` | staging branch or `main` |

Every inherited field in the dashboard shows a small **source badge** — `From org`, `From override: test-ads-mock`, `From group: news`, or `Custom` — so you can always tell where a value comes from without reading YAML.

## Resolved Config

`resolve-config.ts` is the single place that runs all the merge rules. The output `ResolvedConfig` is a flat JSON object the site builder consumes. Every field is guaranteed present — no `undefined`, no unresolved placeholders. The resolver:

1. Reads `network.yaml`, `org.yaml`, each `groups/<id>.yaml` (in order), applicable `overrides/config/<id>.yaml` (by priority), and `sites/<domain>/site.yaml`.
2. Merges in order: org -> groups (left-to-right) -> overrides (REPLACE semantics) -> site.
3. Resolves all `{{placeholders}}` in scripts using merged `scripts_vars`.
4. Appends and deduplicates ads.txt entries.
5. Normalizes ad placements (string sizes like `"728x90"` to tuple arrays).
6. Fills defaults for feature configs.
7. Validates: no unresolved placeholders, all required fields present.

The resolved config is what gets baked into the static HTML at build time and the inline config JSON at runtime. See **Site Builder Flow** for the next stage of the pipeline.
