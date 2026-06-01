# QA Spec: Config Inheritance System

**Date:** 2026-04-20
**Test runner:** Vitest
**Test file:** `packages/site-builder/scripts/__tests__/resolve-config-qa.test.ts`
**Fixtures dir:** `packages/site-builder/scripts/__tests__/fixtures-qa/`

## System Under Test

The `resolveConfig()` function in `packages/site-builder/scripts/resolve-config.ts`.

Inheritance chain: `org.yaml → groups[0] → groups[1] → … → overrides (by priority) → site.yaml`

---

## Fixture Strategy

Create a dedicated `fixtures-qa/` directory with configs designed to isolate each behavior. Key fixture sites:

| Site domain | Groups | Purpose |
|---|---|---|
| `org-only.test` | none | Tests org defaults pass through with no group/override |
| `single-group.test` | `[qa-group-alpha]` | Tests single group overrides org |
| `multi-group.test` | `[qa-group-alpha, qa-group-beta]` | Tests left-to-right group merge |
| `three-groups.test` | `[qa-group-alpha, qa-group-beta, qa-group-gamma]` | Tests 3-group merge cascade |
| `override-merge.test` | `[qa-group-alpha]` | Targeted by `merge-override` (mode: merge) |
| `override-replace.test` | `[qa-group-alpha]` | Targeted by `replace-override` (mode: replace) |
| `override-priority.test` | `[qa-group-alpha]` | Targeted by 2 overrides at different priorities |
| `override-group-target.test` | `[qa-group-beta]` | Override targets `qa-group-beta` via group targeting |
| `site-overrides-all.test` | `[qa-group-alpha]` | Site-level config overrides every field |
| `null-clear.test` | `[qa-group-alpha]` | Site sets fields to `null` to clear inherited values |
| `combo-full-chain.test` | `[qa-group-alpha, qa-group-beta]` | Full chain: org → 2 groups → override → site |
| `combo-ads-cascade.test` | `[qa-group-alpha, qa-group-beta]` | Ads placement changes cascade through layers |
| `combo-scripts-merge.test` | `[qa-group-alpha, qa-group-beta]` | Scripts merge-by-id across all layers |

---

## Test Categories

### A. Org Config Tests (10 tests)

Test that org.yaml serves as the root default layer.

```
A1. Org tracking passes through when no group/site overrides
    - org sets ga4: "G-ORG", gtm: "GTM-ORG"
    - site has no tracking block
    → resolved tracking.ga4 === "G-ORG", tracking.gtm === "GTM-ORG"

A2. Org scripts pass through unchanged
    - org defines head: [{id: "org-analytics", src: "..."}]
    - no group or site scripts
    → resolved scripts.head has "org-analytics" with org's src

A3. Org ads_config is baseline when nothing overrides
    - org defines ad_placements: [{id: "org-banner", ...}]
    - no group or site ads_config
    → resolved ads_config.ad_placements contains "org-banner"

A4. Org ads_txt entries are baseline
    - org defines ads_txt: ["google.com, pub-org, DIRECT"]
    → resolved ads_txt contains that entry

A5. Org legal values pass through
    - org sets legal.company_name: "QA Org Ltd"
    → resolved legal.company_name === "QA Org Ltd"

A6. Org theme defaults apply (default_theme, default_fonts)
    - org sets default_theme: "modern", default_fonts: {heading: "Arial", body: "Helvetica"}
    → resolved theme.base === "modern", theme.fonts.heading === "Arial"

A7. Org support_email_pattern resolves with site domain
    - org: support_email_pattern: "support@{{domain}}"
    - site domain: org-only.test
    → resolved support_email === "support@org-only.test"

A8. Org scripts_vars available for placeholder resolution
    - org sets scripts_vars: {org_var: "org-value"}
    - org script inline: "init('{{org_var}}')"
    → resolved script inline contains "org-value", not "{{org_var}}"

A9. Org ad_placeholder_heights pass through
    - org sets ad_placeholder_heights: {above-content: 100, sidebar: 500}
    → resolved ad_placeholder_heights matches

A10. Org with null tracking fields — null is preserved
     - org sets tracking.ga4: null, tracking.gtm: "GTM-ORG"
     → resolved tracking.ga4 === null, tracking.gtm === "GTM-ORG"
```

### B. Group Config Tests (10 tests)

Test single-group and multi-group merge behavior.

```
B1. Single group overrides org tracking field
    - org: tracking.gtm: "GTM-ORG"
    - qa-group-alpha: tracking.gtm: "GTM-ALPHA"
    → resolved tracking.gtm === "GTM-ALPHA"

B2. Single group leaves unset org fields intact
    - org: tracking.ga4: "G-ORG", tracking.gtm: "GTM-ORG"
    - qa-group-alpha only sets tracking.gtm (no ga4)
    → resolved tracking.ga4 === "G-ORG" (inherited from org)

B3. Group ads_config replaces org ad_placements entirely
    - org: ad_placements: [{id: "org-banner"}]
    - qa-group-alpha: ad_placements: [{id: "alpha-banner"}]
    → resolved ad_placements contains "alpha-banner", NOT "org-banner"

B4. Group ads_txt appends to org (additive, deduplicated)
    - org ads_txt: ["google.com, pub-org, DIRECT"]
    - qa-group-alpha ads_txt: ["adnetwork.com, 111, DIRECT"]
    → resolved ads_txt contains both entries

B5. Multi-group: later group overrides earlier group (left-to-right)
    - qa-group-alpha: tracking.google_ads: "AW-ALPHA"
    - qa-group-beta: tracking.google_ads: "AW-BETA"
    - site groups: [qa-group-alpha, qa-group-beta]
    → resolved tracking.google_ads === "AW-BETA"

B6. Multi-group: earlier group field persists if later group doesn't set it
    - qa-group-alpha: tracking.facebook_pixel: "PX-ALPHA"
    - qa-group-beta: no facebook_pixel
    → resolved tracking.facebook_pixel === "PX-ALPHA"

B7. Multi-group: ads_txt entries from all groups combined
    - qa-group-alpha ads_txt: ["net-a.com, 1, DIRECT"]
    - qa-group-beta ads_txt: ["net-b.com, 2, DIRECT"]
    → resolved ads_txt contains entries from org + both groups

B8. Multi-group: scripts merge by ID across groups
    - qa-group-alpha head: [{id: "shared", src: "alpha.js"}, {id: "alpha-only", ...}]
    - qa-group-beta head: [{id: "shared", src: "beta.js"}, {id: "beta-only", ...}]
    → "shared" has beta.js (later wins), both "alpha-only" and "beta-only" present

B9. Multi-group: theme deep merge left-to-right
    - qa-group-alpha: theme.colors.primary: "#AA0000", theme.colors.secondary: "#AA1111"
    - qa-group-beta: theme.colors.primary: "#BB0000" (no secondary)
    → primary === "#BB0000", secondary === "#AA1111"

B10. Three groups cascade: last group wins on conflicts
     - qa-group-alpha: tracking.gtm: "GTM-A"
     - qa-group-beta: tracking.gtm: "GTM-B"
     - qa-group-gamma: tracking.gtm: "GTM-C"
     → resolved tracking.gtm === "GTM-C"
```

### C. Override Config Tests (12 tests)

Test override targeting, merge modes, and priority ordering.

```
C1. Override applied via direct site targeting
    - override targets.sites: ["override-merge.test"]
    → applied_overrides contains the override ID

C2. Override applied via group targeting
    - override targets.groups: ["qa-group-beta"]
    - site belongs to qa-group-beta
    → applied_overrides contains the override ID

C3. Override NOT applied to non-targeted site
    - override targets.sites: ["other-site.test"]
    - current site is "single-group.test"
    → applied_overrides is empty

C4. Override tracking merge mode (default) — merges keys
    - inherited tracking: {ga4: "G-ORG", gtm: "GTM-ORG"}
    - override tracking: {ga4: "G-OVERRIDE"} (no _mode, defaults to merge)
    → ga4 === "G-OVERRIDE", gtm === "GTM-ORG" (preserved)

C5. Override tracking replace mode — wipes and replaces
    - inherited tracking: {ga4: "G-ORG", gtm: "GTM-ORG", google_ads: "AW-ALPHA"}
    - override tracking: {_mode: "replace", ga4: "G-OVERRIDE"}
    → ga4 === "G-OVERRIDE", gtm === null, google_ads === null

C6. Override scripts replace mode — wipes inherited scripts
    - inherited head has 3 scripts
    - override scripts: {_mode: "replace", head: [{id: "new-script"}]}
    → head contains only "new-script", inherited scripts gone

C7. Override scripts merge_by_id mode — merges by script ID
    - inherited head: [{id: "analytics", src: "old.js"}, {id: "consent", src: "cmp.js"}]
    - override scripts: {_mode: "merge_by_id", head: [{id: "analytics", src: "new.js"}]}
    → "analytics" has "new.js", "consent" still present

C8. Override ads_config replaces entire ads config (default mode)
    - inherited ads_config: {interstitial: true, ad_placements: [{id: "inherited-banner"}]}
    - override ads_config: {interstitial: false, ad_placements: [{id: "override-banner"}]}
    → interstitial === false, only "override-banner" in placements

C9. Override ads_txt add mode — appends entries
    - inherited ads_txt: ["google.com, pub-org, DIRECT"]
    - override ads_txt: {_mode: "add", _values: ["extra.com, 999, DIRECT"]}
    → both entries present

C10. Override ads_txt replace mode — wipes and replaces
     - inherited ads_txt: ["google.com, pub-org, DIRECT", "net-a.com, 1, DIRECT"]
     - override ads_txt: {_mode: "replace", _values: ["new-only.com, 1, DIRECT"]}
     → only "new-only.com, 1, DIRECT" present

C11. Higher priority override wins over lower priority
     - low-priority override (priority: 10): tracking.ga4: "G-LOW"
     - high-priority override (priority: 50): tracking.ga4: "G-HIGH"
     - both target the same site
     → tracking.ga4 === "G-HIGH"

C12. applied_overrides lists IDs in priority order (low → high)
     - override A priority: 10, override B priority: 50
     → applied_overrides === ["override-a", "override-b"]
```

### D. Combination / Cross-Layer Tests (10 tests)

Test the full inheritance chain and interactions between layers.

```
D1. Full chain: org → group → override → site (tracking)
    - org: ga4: "G-ORG"
    - qa-group-alpha: ga4: "G-ALPHA"
    - merge-override: ga4: "G-OVERRIDE"
    - site: ga4: "G-SITE"
    → tracking.ga4 === "G-SITE" (site always wins last)

D2. Full chain: site null clears an override value
    - override sets tracking.gtm: "GTM-OVERRIDE"
    - site sets tracking.gtm: null
    → tracking.gtm === null

D3. Group changes ad placement, override doesn't touch ads, site sees group's placement
    - org: ad_placements: [{id: "org-banner", position: "above-content"}]
    - qa-group-alpha: ad_placements: [{id: "alpha-banner", position: "sidebar"}]
    - override: only changes tracking (no ads_config)
    - site: no ads_config
    → resolved ad_placements has "alpha-banner" at "sidebar", no "org-banner"

D4. Override replaces ads, then site adds on top
    - group has placements
    - override replaces ads_config with [{id: "override-ad"}]
    - site adds ads_config with [{id: "site-ad"}]
    → both "override-ad" and "site-ad" present (site deep-merges on top of override result)

D5. Scripts accumulate across org → group → override (merge_by_id) → site
    - org head: [{id: "org-script"}]
    - group head: [{id: "group-script"}]
    - override (merge_by_id) head: [{id: "override-script"}]
    - site: no scripts
    → head has all three scripts

D6. ads_txt accumulates: org + group + (override add) + site
    - org: ["org-entry"]
    - group: ["group-entry"]
    - override (add): ["override-entry"]
    - site: ["site-entry"]
    → all four entries present

D7. Placeholder resolution uses merged vars from all layers
    - org scripts_vars: {org_var: "from-org"}
    - group scripts_vars: {group_var: "from-group", shared_var: "from-group"}
    - site scripts_vars: {shared_var: "from-site"}
    - script inline: "{{org_var}}-{{group_var}}-{{shared_var}}"
    → resolved: "from-org-from-group-from-site"

D8. Theme merges across all layers
    - org default_theme: "modern", default_fonts: {heading: "Arial", body: "Helvetica"}
    - qa-group-alpha theme: {colors: {primary: "#AAA"}}
    - qa-group-beta theme: {colors: {accent: "#BBB"}}
    - site theme: {colors: {primary: "#CCC"}, logo: "/logo.svg"}
    → base: "modern", primary: "#CCC" (site wins), accent: "#BBB", fonts from org, logo: "/logo.svg"

D9. Legal merges across org → group → site
    - org legal: {company_name: "Org Ltd", company_country: "US"}
    - group legal_pages_override: {company_country: "UK"}
    - site legal: {site_description: "My site"}
    → company_name: "Org Ltd", company_country: "UK", site_description: "My site"

D10. Override via group targeting + another override via site targeting both apply
     - override-A targets groups: ["qa-group-alpha"], priority: 10, sets tracking.ga4
     - override-B targets sites: ["combo-full-chain.test"], priority: 50, sets tracking.gtm
     → both overrides in applied_overrides, ga4 from A, gtm from B
```

---

## Fixture Data Design

### `fixtures-qa/org.yaml`
```yaml
organization: "QA Test Org"
legal_entity: "QA Org Ltd"
company_address: "456 QA Blvd"
support_email_pattern: "support@{{domain}}"
default_theme: modern
default_fonts:
  heading: "Arial"
  body: "Helvetica"

tracking:
  ga4: "G-ORG"
  gtm: "GTM-ORG"
  google_ads: null
  facebook_pixel: null
  custom: []

scripts:
  head:
    - id: org-analytics
      src: "https://analytics.example.com/org.js"
      async: true
  body_start: []
  body_end:
    - id: org-footer
      inline: "console.log('{{org_var}}')"

scripts_vars:
  org_var: "org-value"

ads_config:
  interstitial: false
  layout: standard
  ad_placements:
    - id: org-banner
      position: above-content
      sizes:
        desktop: [[728, 90]]
        mobile: [[320, 50]]
      device: all

ad_placeholder_heights:
  above-content: 100
  after-paragraph: 280
  sidebar: 500
  sticky-bottom: 50

ads_txt:
  - "google.com, pub-org, DIRECT"

legal:
  company_name: "QA Org Ltd"
  company_country: "US"
  effective_date: "2026-01-01"
```

### `fixtures-qa/network.yaml`
```yaml
network_id: qa-network
platform_version: "1.0.0"
```

### `fixtures-qa/groups/qa-group-alpha.yaml`
```yaml
group_id: qa-group-alpha
name: "QA Group Alpha"

tracking:
  gtm: "GTM-ALPHA"
  google_ads: "AW-ALPHA"
  facebook_pixel: "PX-ALPHA"

scripts:
  head:
    - id: org-analytics
      src: "https://analytics.example.com/alpha.js"
      async: true
    - id: alpha-script
      inline: "console.log('alpha: {{group_var}}')"
  body_start: []
  body_end: []

scripts_vars:
  group_var: "alpha-value"
  shared_var: "from-alpha"

ads_config:
  interstitial: true
  layout: standard
  ad_placements:
    - id: alpha-banner
      position: sidebar
      sizes:
        desktop: [[300, 250]]
        mobile: [[300, 250]]
      device: all

ads_txt:
  - "net-alpha.com, 111, DIRECT"

theme:
  colors:
    primary: "#AA0000"
    secondary: "#AA1111"

legal_pages_override:
  company_country: "UK"
```

### `fixtures-qa/groups/qa-group-beta.yaml`
```yaml
group_id: qa-group-beta
name: "QA Group Beta"

tracking:
  google_ads: "AW-BETA"

scripts:
  head:
    - id: org-analytics
      src: "https://analytics.example.com/beta.js"
      async: true
    - id: beta-script
      inline: "console.log('beta')"
  body_start: []
  body_end: []

scripts_vars:
  shared_var: "from-beta"
  beta_var: "beta-value"

ads_config:
  interstitial: false
  layout: high-density

ads_txt:
  - "net-beta.com, 222, DIRECT"

theme:
  colors:
    primary: "#BB0000"
    accent: "#BBB"
```

### `fixtures-qa/groups/qa-group-gamma.yaml`
```yaml
group_id: qa-group-gamma
name: "QA Group Gamma"

tracking:
  gtm: "GTM-C"

scripts:
  head: []
  body_start: []
  body_end: []

ads_txt:
  - "net-gamma.com, 333, DIRECT"
```

### Override files

**`fixtures-qa/overrides/config/merge-override.yaml`**
```yaml
override_id: merge-override
name: "Merge Override"
priority: 20

targets:
  sites:
    - override-merge.test
    - combo-full-chain.test
    - combo-scripts-merge.test

tracking:
  ga4: "G-OVERRIDE"

scripts:
  _mode: merge_by_id
  head:
    - id: override-script
      inline: "console.log('override')"
```

**`fixtures-qa/overrides/config/replace-override.yaml`**
```yaml
override_id: replace-override
name: "Replace Override"
priority: 30

targets:
  sites:
    - override-replace.test

tracking:
  _mode: replace
  ga4: "G-REPLACE-ONLY"

scripts:
  _mode: replace
  head:
    - id: replace-script
      src: "/replace.js"
  body_start: []
  body_end: []

ads_config:
  interstitial: false
  layout: standard
  ad_placements:
    - id: override-banner
      position: above-content
      sizes:
        desktop: [[728, 90]]
        mobile: [[320, 50]]
      device: all

ads_txt:
  _mode: replace
  _values:
    - "override-only.com, 1, DIRECT"
```

**`fixtures-qa/overrides/config/low-priority.yaml`**
```yaml
override_id: low-priority
name: "Low Priority Override"
priority: 10

targets:
  sites:
    - override-priority.test

tracking:
  ga4: "G-LOW"
  gtm: "GTM-LOW"
```

**`fixtures-qa/overrides/config/high-priority.yaml`**
```yaml
override_id: high-priority
name: "High Priority Override"
priority: 50

targets:
  sites:
    - override-priority.test

tracking:
  ga4: "G-HIGH"
```

**`fixtures-qa/overrides/config/group-target-override.yaml`**
```yaml
override_id: group-target-override
name: "Group Target Override"
priority: 20

targets:
  groups:
    - qa-group-beta

tracking:
  ga4: "G-GROUP-TARGET"
```

**`fixtures-qa/overrides/config/combo-site-override.yaml`**
```yaml
override_id: combo-site-override
name: "Combo Site Override"
priority: 50

targets:
  sites:
    - combo-full-chain.test

tracking:
  gtm: "GTM-COMBO-OVERRIDE"
```

### Site fixtures

**`fixtures-qa/sites/org-only.test/site.yaml`**
```yaml
domain: org-only.test
site_name: "Org Only Site"
active: true
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: ["qa"]
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/single-group.test/site.yaml`**
```yaml
domain: single-group.test
site_name: "Single Group Site"
groups: [qa-group-alpha]
active: true
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: ["qa"]
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/multi-group.test/site.yaml`**
```yaml
domain: multi-group.test
site_name: "Multi Group Site"
groups: [qa-group-alpha, qa-group-beta]
active: true
brief:
  audience: "QA testers"
  tone: "Casual"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 5
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "10:00"}
```

**`fixtures-qa/sites/three-groups.test/site.yaml`**
```yaml
domain: three-groups.test
site_name: "Three Groups Site"
groups: [qa-group-alpha, qa-group-beta, qa-group-gamma]
active: true
brief:
  audience: "QA testers"
  tone: "Casual"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 5
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "10:00"}
```

**`fixtures-qa/sites/override-merge.test/site.yaml`**
```yaml
domain: override-merge.test
site_name: "Override Merge Site"
groups: [qa-group-alpha]
active: true
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/override-replace.test/site.yaml`**
```yaml
domain: override-replace.test
site_name: "Override Replace Site"
groups: [qa-group-alpha]
active: true
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/override-priority.test/site.yaml`**
```yaml
domain: override-priority.test
site_name: "Override Priority Site"
groups: [qa-group-alpha]
active: true
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/override-group-target.test/site.yaml`**
```yaml
domain: override-group-target.test
site_name: "Group Target Site"
groups: [qa-group-beta]
active: true
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/site-overrides-all.test/site.yaml`**
```yaml
domain: site-overrides-all.test
site_name: "Site Overrides All"
groups: [qa-group-alpha]
active: true
tracking:
  ga4: "G-SITE"
  gtm: "GTM-SITE"
  google_ads: "AW-SITE"
ads_config:
  interstitial: false
  layout: minimal
  ad_placements:
    - id: site-banner
      position: above-content
      sizes:
        desktop: [[970, 250]]
        mobile: [[320, 100]]
      device: all
ads_txt:
  - "site-specific.com, 42, DIRECT"
scripts_vars:
  group_var: "site-override-value"
theme:
  colors:
    primary: "#SITE00"
  logo: "/site-logo.svg"
  fonts:
    heading: "Site Font"
legal:
  site_description: "Site overrides all"
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/null-clear.test/site.yaml`**
```yaml
domain: null-clear.test
site_name: "Null Clear Site"
groups: [qa-group-alpha]
active: true
tracking:
  ga4: null
  gtm: null
  google_ads: null
brief:
  audience: "QA testers"
  tone: "Professional"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 10
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "09:00"}
```

**`fixtures-qa/sites/combo-full-chain.test/site.yaml`**
```yaml
domain: combo-full-chain.test
site_name: "Full Chain Combo"
groups: [qa-group-alpha, qa-group-beta]
active: true
tracking:
  ga4: "G-SITE"
scripts_vars:
  shared_var: "from-site"
theme:
  colors:
    primary: "#CCC"
  logo: "/logo.svg"
legal:
  site_description: "Full chain test"
brief:
  audience: "QA testers"
  tone: "Casual"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 5
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "10:00"}
```

**`fixtures-qa/sites/combo-ads-cascade.test/site.yaml`**
```yaml
domain: combo-ads-cascade.test
site_name: "Ads Cascade Combo"
groups: [qa-group-alpha, qa-group-beta]
active: true
ads_config:
  ad_placements:
    - id: site-ad
      position: after-paragraph
      sizes:
        desktop: [[300, 250]]
        mobile: [[300, 250]]
      device: all
ads_txt:
  - "site-ads.com, 99, DIRECT"
brief:
  audience: "QA testers"
  tone: "Casual"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 5
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "10:00"}
```

**`fixtures-qa/sites/combo-scripts-merge.test/site.yaml`**
```yaml
domain: combo-scripts-merge.test
site_name: "Scripts Merge Combo"
groups: [qa-group-alpha, qa-group-beta]
active: true
scripts_vars:
  org_var: "org-value"
  group_var: "combo-group-val"
  shared_var: "combo-shared"
  beta_var: "beta-value"
brief:
  audience: "QA testers"
  tone: "Casual"
  article_types: {standard: 100}
  topics: ["qa"]
  seo_keywords_focus: []
  content_guidelines: "Test"
  review_percentage: 5
  schedule: {articles_per_day: 1, preferred_days: [Monday], preferred_time: "10:00"}
```

---

## Test Listing (42 tests total)

| # | ID | Category | Test Name | Asserts |
|---|---|---|---|---|
| 1 | A1 | Org | org tracking passes through with no overrides | ga4, gtm match org values |
| 2 | A2 | Org | org scripts pass through unchanged | head contains org-analytics with org src |
| 3 | A3 | Org | org ads_config is baseline | ad_placements contains org-banner |
| 4 | A4 | Org | org ads_txt entries are baseline | contains org entry |
| 5 | A5 | Org | org legal values pass through | company_name matches |
| 6 | A6 | Org | org theme defaults apply | base, fonts match |
| 7 | A7 | Org | support_email_pattern resolves with site domain | support@ + domain |
| 8 | A8 | Org | org scripts_vars resolve placeholders | inline contains resolved value |
| 9 | A9 | Org | org ad_placeholder_heights pass through | heights match |
| 10 | A10 | Org | org null tracking fields preserved | ga4 null, gtm present |
| 11 | B1 | Group | single group overrides org tracking field | gtm from group |
| 12 | B2 | Group | single group leaves unset org fields intact | ga4 from org |
| 13 | B3 | Group | group ad_placements replace org placements | alpha-banner only |
| 14 | B4 | Group | group ads_txt appends to org | both entries present |
| 15 | B5 | Group | multi-group: later group overrides earlier | google_ads from beta |
| 16 | B6 | Group | multi-group: earlier group field persists | facebook_pixel from alpha |
| 17 | B7 | Group | multi-group: ads_txt combined from all groups | all entries present |
| 18 | B8 | Group | multi-group: scripts merge by ID across groups | shared from beta, both unique scripts |
| 19 | B9 | Group | multi-group: theme deep merge left-to-right | primary from beta, secondary from alpha |
| 20 | B10 | Group | three groups cascade: last wins on conflict | gtm from gamma |
| 21 | C1 | Override | override applied via direct site targeting | in applied_overrides |
| 22 | C2 | Override | override applied via group targeting | in applied_overrides |
| 23 | C3 | Override | override NOT applied to non-targeted site | applied_overrides empty |
| 24 | C4 | Override | tracking merge mode — merges keys | ga4 overridden, gtm preserved |
| 25 | C5 | Override | tracking replace mode — wipes and replaces | ga4 set, gtm/google_ads null |
| 26 | C6 | Override | scripts replace mode — wipes inherited | only replace-script in head |
| 27 | C7 | Override | scripts merge_by_id mode | analytics replaced, consent preserved |
| 28 | C8 | Override | ads_config replaces entirely | only override-banner |
| 29 | C9 | Override | ads_txt add mode — appends | both old and new entries |
| 30 | C10 | Override | ads_txt replace mode — wipes and replaces | only new entry |
| 31 | C11 | Override | higher priority override wins | ga4 from high-priority |
| 32 | C12 | Override | applied_overrides in priority order | low before high |
| 33 | D1 | Combo | full chain tracking: org→group→override→site | ga4 from site (wins last) |
| 34 | D2 | Combo | site null clears override value | gtm === null |
| 35 | D3 | Combo | group changes ad placement, site sees it | alpha-banner present, org-banner gone |
| 36 | D4 | Combo | override replaces ads, site adds on top | both override-ad and site-ad |
| 37 | D5 | Combo | scripts accumulate across all layers (merge_by_id) | scripts from org, group, override all present |
| 38 | D6 | Combo | ads_txt accumulates across all layers | entries from all layers |
| 39 | D7 | Combo | placeholder resolution uses merged vars from all layers | all vars resolved |
| 40 | D8 | Combo | theme merges across all layers | correct cascade of colors, fonts, logo |
| 41 | D9 | Combo | legal merges across org→group→site | fields from each layer |
| 42 | D10 | Combo | group-targeting + site-targeting overrides both apply | both in applied_overrides |

---

## Implementation Notes

- All tests call `resolveConfig(FIXTURES_QA, "domain")` directly — pure unit tests, no HTTP
- Fixture YAML files must be committed alongside tests
- Tests should NOT depend on the real `atomic-labs-network` repo
- Each test is independent — no shared mutable state
- Run with: `cd packages/site-builder && pnpm test`
