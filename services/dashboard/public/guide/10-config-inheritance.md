# Config Inheritance & Groups

The platform uses a **three-layer config hierarchy** to manage settings across all sites in the network. Each layer can override the one above it, so you define defaults once and only customize what's different per group or site.

## The Three Layers

```
org.yaml          Network-wide defaults (one file)
    |
groups/*.yaml     Group-level overrides (one per group)
    |
sites/*/site.yaml Site-level overrides (one per site)
```

**org.yaml** sets the baseline for the entire network: organization name, legal entity, default theme, tracking IDs, scripts, ads config, and legal variables.

**Group configs** override org defaults for a cluster of sites. A group like `premium-ads` might add ad network scripts, tracking pixels, and ad placements. Another group like `entertainment` might set theme colors for entertainment-vertical sites.

**Site configs** are the final layer. A site inherits everything from its group(s) and only specifies what's unique: domain, site name, editorial brief, and any per-site overrides.

## Multi-Group Support

A site can belong to **multiple groups**. Groups are listed in order and merged left-to-right — later groups override earlier ones:

```yaml
# sites/muvizz.com/site.yaml
domain: muvizz.com
site_name: Muvizz
groups:
  - premium-ads      # ad config, scripts, placements
  - entertainment    # theme colors, category defaults
active: true
```

In this example, `muvizz.com` gets ad config from `premium-ads` and theme colors from `entertainment`. If both groups define `theme.colors.primary`, the `entertainment` value wins because it comes later in the list.

The legacy `group: "single-group"` field still works and is treated as `groups: ["single-group"]`.

## How Merging Works

Different types of config are merged differently:

### Deep Merge (objects)

Objects like `tracking`, `ads_config`, and `theme` use **deep merge** — only the keys you specify at a lower layer override the parent. Unspecified keys are inherited.

```yaml
# org.yaml
tracking:
  ga4: "G-ORG123"
  gtm: null

# groups/premium-ads.yaml
tracking:
  google_ads: "AW-GROUP456"

# Result for a site in premium-ads:
# tracking:
#   ga4: "G-ORG123"        (from org)
#   gtm: null               (from org)
#   google_ads: "AW-GROUP456" (from group)
```

### Merge by ID (scripts)

Scripts are merged **by their `id` field**, not replaced as arrays. This means a group can override a specific org script without removing the others:

```yaml
# org.yaml
scripts:
  head:
    - id: analytics
      src: "https://example.com/analytics.js"

# groups/premium-ads.yaml
scripts:
  head:
    - id: gpt-script
      src: "https://securepubads.g.doubleclick.net/tag/js/gpt.js"
      async: true

# Result: head has BOTH analytics (from org) and gpt-script (from group)
```

If a child defines a script with the **same id** as a parent, it replaces that script entirely.

### Append + Deduplicate (ads.txt)

ads.txt entries are **appended** from all layers — org, then each group (in order), then site — and deduplicated:

```yaml
# org.yaml → ads_config.ads_txt
- "google.com, pub-123, DIRECT, f08c47fec0942fa0"

# groups/premium-ads.yaml → ads_txt
- "appnexus.com, 10239, RESELLER, f5ab79cb980f11d1"
- "google.com, pub-123, DIRECT, f08c47fec0942fa0"   # duplicate

# Result: 2 lines (duplicate removed)
```

### Spread Merge (feature configs)

Feature configs like `preview_page`, `categories`, `sidebar`, and `search` use a flat spread: defaults first, then org, group, site. All fields are guaranteed present in the resolved config.

## Script Variables & Placeholders

Scripts can contain `{{placeholder}}` variables that are resolved at build time:

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
```

Variables are defined in `scripts_vars` at any layer and cascade org → group → site:

```yaml
# sites/muvizz.com/site.yaml
scripts_vars:
  alpha_site_id: "muvizz-001"
  alpha_zone: "entertainment"
  interstitial_enabled: "true"
```

The special variable `{{domain}}` is always available and resolves to the site's domain.

**Strict mode:** If any `{{placeholder}}` remains unresolved after merging all layers, the build fails with an error listing the missing variables. This prevents silent bugs from undefined ad IDs or tracking codes.

## Ads Configuration

The `ads_config` object controls how ads appear on a site:

```yaml
ads_config:
  interstitial: true          # full-page interstitial ads
  layout: "standard"          # or "high-density"
  in_content_slots: 3         # ad units between paragraphs
  sidebar: true               # sidebar ad placement
  ad_placements:
    - id: "top-banner"
      position: "above-content"
      device: "all"
      sizes:
        desktop: [[728, 90], [970, 250]]
        mobile: [[320, 50], [300, 250]]
    - id: "sidebar-sticky"
      position: "sidebar"
      device: "desktop"
      sizes:
        desktop: [[300, 600], [160, 600]]
```

Ad placements support device targeting (`all`, `desktop`, `mobile`) and multiple size options per device. The site builder renders the appropriate `AdSlot` components based on these placements.

**YAML shorthand:** In group YAML files, you can write sizes as strings (`"728x90"`) instead of tuple arrays. The resolver normalizes them automatically:

```yaml
# This YAML shorthand:
sizes: ["728x90", "970x250"]
# Becomes:
sizes: { desktop: [[728, 90], [970, 250]] }
```

## Tracking

The `tracking` config supports built-in vendor IDs and custom scripts:

| Field | Example | Purpose |
|-------|---------|---------|
| `ga4` | `G-XXXXXXXXXX` | Google Analytics 4 |
| `gtm` | `GTM-XXXXXXX` | Google Tag Manager |
| `google_ads` | `AW-XXXXXXXXXX` | Google Ads conversions |
| `facebook_pixel` | `1234567890` | Facebook/Meta Pixel |
| `custom` | Array of scripts | Any other tracking |

Set a field to `null` at any layer to explicitly disable it (different from omitting it, which inherits the parent value).

## Managing from the Dashboard

### Settings Page

The **Settings** page in the sidebar lets you edit `org.yaml` directly. It has tabs for:

- **General** — organization name, legal entity, address, support email pattern, default theme and fonts
- **Network** — platform version, network ID, network name (from `network.yaml`)
- **Tracking** — vendor IDs and custom tracking scripts
- **Scripts** — head, body start, and body end script entries
- **Script Variables** — org-level placeholder values
- **Ads Config** — interstitial toggle, layout, in-content slots, ad placements
- **Legal** — template variables for legal pages (privacy policy, terms, etc.)

### Groups Page

The **Groups** page lists all groups with their ID, layout, and interstitial status. Click a group to edit it, or click **Create New Group** to add one.

Each group editor has tabs matching the org settings (tracking, scripts, script variables, ads config, theme), plus:

- **Identity** — group ID (read-only) and display name
- **Ads.txt** — multiline editor for IAB-format ads.txt entries

Fields inherited from the org level are indicated so you can see what you're overriding.

### Site Wizard

When creating a new site, the wizard includes:

1. **Create Site** — project name, site name, domain, company, vertical
2. **Groups** — select which groups this site belongs to (click to toggle, drag to reorder)
3. **Theme** — choose a base theme
4. **Content Brief** — audience, tone, topics, schedule
5. **Script Vars** — auto-detected `{{placeholder}}` variables from the selected groups' scripts
6. **Preview** — deploy to staging
7. **Review** — go live

## Resolved Config

The final resolved config is what the site builder consumes. Every field is guaranteed present — no `undefined`, no unresolved placeholders. The resolver:

1. Reads `org.yaml`, all group YAMLs (in order), and `site.yaml`
2. Merges groups left-to-right with deep merge
3. Merges org → effective group → site for each config section
4. Resolves all `{{placeholders}}` in scripts
5. Appends and deduplicates ads.txt entries
6. Normalizes ad placements (string sizes to tuples)
7. Fills defaults for feature configs
8. Validates: no unresolved placeholders, all required fields present

The output `ResolvedConfig` includes computed fields like `support_email` (resolved from the org pattern) and `groups` (the full array of group IDs).
