# Config Inheritance & Groups

The platform uses a **four-layer config cascade** to manage settings across every site in the network. Each layer only specifies what it owns; everything else is inherited from the layer above. You define defaults once and customize the minimum needed per profile, group, or site.

## The Cascade at a Glance

```
                        network.yaml
                 (Platform version pin — one file)
                             │
      ┌──────────┬───────────┼───────────┬──────────┐
      ▼          ▼                       ▼          ▼
  org.yaml  monetization/*.yaml   groups/*.yaml   sites/*/site.yaml
  Identity  Tracking, scripts,    Theme colors,   Domain, name, brief,
  Default   ad placements,        fonts, legal    any per-site override
  tracking  ads.txt entries       overrides
  Default
  theme

         Merge order  →  org  →  monetization  →  group  →  site   (last wins)
                                         │
                                         ▼
                               resolve-config.ts
                                         │
                                         ▼
                               ResolvedConfig (single JSON)
```

Two rules to remember:

1. **Order matters — monetization comes before group.** Editorial groups can override a monetization profile in rare cases (e.g. a kids-vertical group killing interstitial ads), not the other way round.
2. **Site always wins.** If you set something in `site.yaml`, nothing above can overturn it.

## What Each Layer Owns

| Layer | File(s) | Typical contents | Who edits it |
|-------|---------|------------------|--------------|
| **Network** | `network.yaml` | Platform version, network id, network name | Platform team (rarely) |
| **Org** | `org.yaml` | Company identity, legal entity, support email pattern, **default** theme and tracking, **default_monetization** pointer | Network admin |
| **Monetization** | `monetization/<id>.yaml` | Tracking IDs, scripts, ad placements, ads.txt entries | Revenue / ops |
| **Group** | `groups/<id>.yaml` | Editorial theme (colors, fonts), category defaults, legal overrides | Editors |
| **Site** | `sites/<domain>/site.yaml` | Domain, site name, content brief, schedule, any override | Per-site owner |

Groups used to carry the ad stack. That moved out into monetization profiles so the same ad setup can be re-used across unrelated editorial groups without duplication.

## Selecting a Monetization Profile

Every site ends up with exactly one monetization profile. Resolution order:

```
site.monetization  →  org.default_monetization  →  (no monetization)
```

```yaml
# sites/coolnews-atl/site.yaml
domain: coolnews-atl
site_name: Cool News ATL
group: news            # editorial group
monetization: test-ads # explicit profile override
active: true
```

If `site.monetization` is omitted, the site picks up `org.default_monetization` automatically. A site with no profile resolved renders with no ads and no third-party tracking — useful for staging / preview.

## Multi-Group Support

A site can still belong to multiple editorial groups. They are listed in order and merged left-to-right; later groups win:

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

# monetization/premium-ads.yaml
tracking:
  google_ads: "AW-MON456"

# sites/muvizz.com/site.yaml
tracking:
  ga4: "G-MUVIZZ-OVERRIDE"

# Resolved for muvizz.com:
#   ga4: "G-MUVIZZ-OVERRIDE"  (site)
#   gtm: null                  (org — kept explicit disable)
#   google_ads: "AW-MON456"    (monetization)
```

**`null` vs. omitted is significant.** Setting a key to `null` means "disable — do not inherit". Omitting the key means "inherit whatever the parent says". Both feel similar but behave oppositely.

### Merge by id (scripts)

Scripts are merged **by their `id` field** rather than replaced as arrays. A child can override a single script while keeping everything else the parent provided:

```yaml
# monetization/premium-ads.yaml
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
    - id: alpha-init         # same id — replaces the monetization entry
      inline: "window.alphaAds.push({ siteId: 'custom-override' })"

# Resolved scripts.head: [gpt-script (unchanged), alpha-init (site version)]
```

### Append + deduplicate (ads.txt)

`ads.txt` entries are the one array type that **accumulates** across layers — org, monetization, group, then site — and are deduplicated as a final step. Child layers can add but cannot remove.

### Spread merge (feature configs)

Feature configs like `preview_page`, `categories`, `sidebar`, and `search` use a flat spread: defaults first, then org, monetization, group, site. All fields are guaranteed present in the resolved config.

## Script Variables & Placeholders

Scripts can contain `{{placeholder}}` variables that are resolved at build time. Variables come from `scripts_vars` at any layer and cascade the same way as regular config:

```yaml
# monetization/premium-ads.yaml
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
| **Settings → General / Tracking / Theme / Legal** | `org.yaml` | `main` |
| **Settings → Network** | `network.yaml` | `main` |
| **Monetization → [profile]** | `monetization/<id>.yaml` | `main` |
| **Groups → [group]** | `groups/<id>.yaml` | `main` |
| **Sites → [domain] → Config / Theme / Brief / Monetization** | `sites/<domain>/site.yaml` | staging branch or `main` |

Every inherited field in the dashboard shows a small **source badge** — `From org`, `From monetization: test-ads`, `From group: news`, or `Custom` — so you can always tell where a value comes from without reading YAML.

## Resolved Config

`resolve-config.ts` is the single place that runs all the merge rules. The output `ResolvedConfig` is a flat JSON object the site builder consumes. Every field is guaranteed present — no `undefined`, no unresolved placeholders. The resolver:

1. Reads `network.yaml`, `org.yaml`, the selected `monetization/<id>.yaml`, each `groups/<id>.yaml` (in order), and `sites/<domain>/site.yaml`.
2. Merges in order: org → monetization → groups (left-to-right) → site.
3. Resolves all `{{placeholders}}` in scripts using merged `scripts_vars`.
4. Appends and deduplicates ads.txt entries.
5. Normalizes ad placements (string sizes like `"728x90"` to tuple arrays).
6. Fills defaults for feature configs.
7. Validates: no unresolved placeholders, all required fields present.

The resolved config is what gets baked into the static HTML at build time and the inline monetization JSON at runtime. See **Site Builder Flow** and **Monetization Flow** for the next stages of the pipeline.
