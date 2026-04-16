# Revised Architecture: Unified Groups + Overrides
## Replace Monetization Layer with Enhanced Groups + Override System

**Date:** April 16, 2026
**Status:** Manager-approved direction after demo review
**Replaces:** monetization-layer-spec.md (Phase 1 implementation)

---

# PART A — What Changed and Why (For Team)

After reviewing the working demo, the manager identified that `monetization/` as a separate layer type is unnecessary complexity. Groups and monetization files have **identical YAML schemas** — same fields (tracking, scripts, ads_config, ads.txt, theme, legal). The only difference was the name and where they sat in the merge chain.

**The change:** Remove `monetization/` as a concept. Instead:

1. **Groups become the universal config layer.** A group can hold theme config, ad config, tracking, legal — whatever you need. Some groups are "verticals" (entertainment, sports), some are "ad partner" groups (taboola, outbrain), some are organizational (all-sites, taboola-test). The system doesn't care about the "type" — it just merges.

2. **Sites list multiple groups.** `groups: [entertainment, taboola-exclusive]` — merged in order, last group wins conflicts.

3. **Overrides replace monetization as the "exception" mechanism.** An override is a YAML with the same schema but with **replace** semantics (not merge) and flexible **targeting** — it can attach to groups, individual sites, or both.

**What this simplifies:**
- One dashboard form component for everything (org, group, override, site — same fields)
- No separate "Monetization" section in the dashboard — it's just groups
- No `monetization:` field in site.yaml — just `groups:` array
- Creating "Taboola ads for these 20 sites" = one group with ad config, not a group + a monetization profile

---

# PART B — Technical Spec

## 1. New Architecture

```
network.yaml              ← Platform version pin (unchanged)

org.yaml                  ← Company-wide defaults (same schema as everything)

groups/                   ← Multi-purpose config layers
  entertainment.yaml      ← Vertical: theme, fonts, analytics
  sports.yaml             ← Vertical: theme, fonts
  taboola.yaml            ← Ad partner: ads_config, scripts, ads.txt, tracking
  outbrain-atomic.yaml    ← Ad partner: ads_config, scripts, ads.txt
  taboola-test.yaml       ← Subset for testing specific ad changes
  all-sites.yaml          ← Network-wide group (optional)

overrides/                ← Targeted exceptions with REPLACE semantics
  config/                 ← Override config YAMLs (NEW location for config overrides)
    fb-traffic-test.yaml  ← Override: different ads for Facebook traffic test
    newsletter-popup.yaml ← Override: floating CTA for specific sites
  <site_id>/              ← Existing shared-page overrides (unchanged)

sites/
  coolnews-atl/
    site.yaml             ← groups: [entertainment, taboola]
  travelbeautytips.com/
    site.yaml             ← groups: [travel, outbrain-atomic]
```

### Unified YAML Schema

Every config file (org, group, override, site) supports the SAME fields:

```yaml
# === IDENTITY (varies per type) ===
# org.yaml: organization, legal_entity, company_address, support_email_pattern
# group: group_id, name
# override: override_id, name, priority, targets
# site: domain, site_name, site_tagline, groups, active, brief

# === UNIVERSAL CONFIG FIELDS (same in all) ===
tracking:
  ga4: string | null
  gtm: string | null
  google_ads: string | null
  facebook_pixel: string | null
  custom: []

scripts:
  head: ScriptEntry[]
  body_start: ScriptEntry[]
  body_end: ScriptEntry[]

scripts_vars:
  key: value

ads_config:
  interstitial: boolean
  layout: "standard" | "high-density"
  ad_placements: AdPlacement[]

ads_txt: string[]

theme:
  base: "modern" | "editorial"
  colors: { primary, secondary, accent, background, text, muted }
  logo: string
  favicon: string
  fonts: { heading, body }

legal:
  key: value

legal_pages_override:
  privacy: string
  terms: string
```

**This is the key insight:** The dashboard form for editing any of these is the SAME component. Just different title and context.

## 2. Multi-Group Support

A site lists its groups in order. Merge is left-to-right, last wins conflicts:

```yaml
# sites/coolnews-atl/site.yaml
domain: coolnews-atl
site_name: "Cool News ATL"
groups:
  - entertainment        # Theme, fonts, vertical analytics
  - taboola              # Ad config, scripts, ads.txt, tracking
active: true
```

**Merge chain:** `org → entertainment → taboola → site`

If entertainment sets `tracking.ga4: "G-ENT"` and taboola also sets `tracking.ga4: "G-TAB"`, taboola wins (it's later in the array). Site can still override both.

**Ordering convention for the team:**
- Vertical/editorial groups first (theme, fonts, legal)
- Ad partner groups last (ads, scripts, tracking)
- This way ad config "wins" over editorial defaults, but site always has final word

## 3. Override System

An override has the same config fields but with two additions: **targets** and **priority**.

```yaml
# overrides/config/taboola-test-q2.yaml
override_id: taboola-test-q2
name: "Taboola Q2 Test Campaign"
priority: 10                      # Higher = applied later = wins over lower priority

# WHO gets this override
targets:
  groups:                         # All sites in these groups
    - taboola
    - taboola-test
  sites:                          # Plus these specific sites
    - coolnews-atl
    - travelbeautytips.com

# WHAT gets overridden — only fields defined here participate
# Override uses REPLACE semantics: if ads_config is defined here,
# it FULLY REPLACES the ads_config from the group chain
ads_config:
  interstitial: false
  layout: standard
  ad_placements:
    - id: "test-banner"
      position: above-content
      sizes:
        desktop: [[970, 250]]
        mobile: [[320, 100]]
      device: all

scripts:
  body_end:
    - id: taboola-test-pixel
      src: "https://cdn.taboola.com/test-pixel-q2.js"
      async: true
```

### Override resolution rules

**Who is affected:** A site is affected by an override if:
- The site is listed in `targets.sites`, OR
- The site belongs to ANY group listed in `targets.groups`

The target is the **union** — not intersection.

**Override merge semantics: REPLACE, not merge.**
- If an override defines `ads_config`, it **completely replaces** the `ads_config` from the group chain
- If an override defines `tracking.ga4`, only `tracking.ga4` is replaced (tracking is field-level replace within the tracking object)
- If an override defines `scripts.head`, it replaces the entire `scripts.head` array (not merge-by-id)
- Fields NOT defined in the override are untouched — the group chain result passes through

**Why replace not merge?** An override is an intentional exception. When Taboola says "use exactly these ads for this test," you want exactly those ads — not a merge of those ads with the existing ones. If you wanted merge, you'd add another group.

**Priority:** When multiple overrides target the same site, they apply in priority order (lowest first, highest last = highest wins). Priority is a simple integer.

### Full resolution chain

```
1. Start with org.yaml
2. Merge each group from site.groups[] in order (left to right)
   - Standard merge rules: objects deep-merge, scripts merge by id, 
     ads_txt additive, null = disable, omitted = inherit
3. Find all overrides whose targets include this site
4. Sort overrides by priority ascending
5. Apply each override using REPLACE semantics
6. Apply site.yaml last (standard merge, site wins everything)
```

## 4. Changes to Existing Files

### site.yaml changes

```yaml
# BEFORE (current)
group: entertainment
monetization: test-ads

# AFTER
groups:
  - entertainment
  - taboola           # Ad config now lives in a group
```

The `monetization:` field is removed. The `group:` field (singular) becomes `groups:` (array).

**Backward compat:** If resolve-config encounters `group: string` (singular, no array), treat as `groups: [string]`. If it encounters `monetization: string`, find the matching file and treat it as an additional group appended to the array.

### Network repo restructure

```
# BEFORE
monetization/
  premium-ads.yaml       → MOVE to groups/taboola.yaml (rename, keep ad config)
  standard-ads.yaml      → MOVE to groups/adsense-default.yaml
  test-ads.yaml          → MOVE to overrides/config/test-ads-mock.yaml (it's a test override)

# AFTER — monetization/ directory deleted
groups/
  entertainment.yaml     ← exists, unchanged
  taboola.yaml           ← renamed from premium-ads, has ad config
  adsense-default.yaml   ← renamed from standard-ads
overrides/
  config/
    test-ads-mock.yaml   ← the demo/mock ads — now an override
```

### Dashboard changes

**Remove:**
- `/[org]/monetization` route and all sub-routes
- `MonetizationForm`, `AdPlacementsEditor` etc. as standalone monetization components
- The `monetization:` field from site forms

**Add/Update:**
- Groups list page shows ALL groups (verticals + ad partners + organizational)
- Group detail page uses the SAME form component for all fields (tracking, scripts, ads_config, theme, legal)
- Groups can be "tagged" for organization: type indicator (vertical, ad-partner, organizational, test) — but this is display-only, not functional
- Site detail: remove Monetization tab, merge its content into the Config tab (which now shows resolved config from all groups)
- Site creation wizard: step 2 is "Select groups" (multi-select, ordered)
- New section: Overrides management (`/[org]/overrides`)

**The unified form component:**
One React component that renders the full config form (tracking, scripts, script vars, ads_config with visual placement editor, ads.txt, theme, legal). Used by:
- Org settings page
- Group detail page
- Override detail page
- Site detail page (with inheritance badges showing source)

---

# PART C — Claude Code Implementation Prompt

> **Follow the `atomic-labs-dev-standards` skill. Superpowers methodology applies.**
> **Autonomous execution. Do not ask for permission. Just build.**

## Context

We have a working system with monetization/ as a separate layer. The manager wants it simplified: monetization becomes groups, overrides replace monetization as the exception mechanism. The existing coolnews-atl site with mock ads must keep working throughout.

**CRITICAL: Do not break the existing site.** coolnews-atl currently has mock ads working via the test-ads monetization profile. After this refactor, the same mock ads must still appear — just sourced from an override instead of a monetization profile.

## Phase 1: Update shared-types

**[atomic-content-platform]** `packages/shared-types/src/config.ts`

**Remove:** `MonetizationConfig` interface, `MonetizationJson` interface

**Add:** `OverrideConfig` interface:

```typescript
interface OverrideConfig {
  override_id: string;
  name: string;
  priority: number;                    // Higher = applied later = wins

  targets: {
    groups?: string[];                 // Sites in these groups get this override
    sites?: string[];                  // These specific sites get this override
  };

  // Same universal fields as everything else
  tracking?: Partial<TrackingConfig>;
  scripts?: Partial<ScriptsConfig>;
  scripts_vars?: Record<string, string>;
  ads_config?: Partial<AdsConfig>;
  ads_txt?: string[];
  theme?: DeepPartial<ThemeConfig>;
  legal?: Record<string, string>;
  legal_pages_override?: Record<string, string>;
}
```

**Update `SiteConfig`:**
```typescript
interface SiteConfig {
  domain: string;
  site_name: string;
  site_tagline?: string | null;
  groups: string[];                    // Array of group IDs (was: group: string + monetization: string)
  active: boolean;
  // ... rest unchanged
}
```

**Update `ResolvedConfig`:**
- Remove `monetization: string` field
- Change `group: string` to `groups: string[]`
- Add `applied_overrides: string[]` (list of override IDs that were applied)

**Verification:** `tsc --noEmit` passes.

## Phase 2: Update resolve-config.ts

**[atomic-content-platform]** `packages/site-builder/scripts/resolve-config.ts`

**New resolution logic:**

```
1. Read org.yaml
2. Read site.yaml → get groups[] array
   - Backward compat: if site has `group: string`, treat as `groups: [string]`
   - Backward compat: if site has `monetization: string`, append to groups array
3. For each group in groups[] (left to right):
   - Read groups/{id}.yaml
   - Merge using standard rules (deep merge objects, scripts merge by id, 
     ads_txt additive, null = disable)
4. Read all files in overrides/config/*.yaml
   - For each override, check if this site is in targets.groups or targets.sites
   - Collect matching overrides, sort by priority ascending
5. Apply matching overrides in order using REPLACE semantics:
   - If override defines ads_config → replaces entire ads_config
   - If override defines scripts.head → replaces entire scripts.head array
   - If override defines tracking.ga4 → replaces only tracking.ga4
   - Fields not defined in override → pass through from group chain
6. Apply site.yaml (standard merge, site wins)
7. Resolve {{placeholders}} in scripts using merged scripts_vars
8. Resolve support_email_pattern
9. Assemble ads_txt (additive from all groups, override ads_txt REPLACES)
10. Return ResolvedConfig
```

**Delete:** `resolve-monetization.ts` (no longer needed)

**Update unit tests** — add:
```
Test: "multi-group merge — groups merge left to right, last wins"
Test: "backward compat — group: string treated as groups: [string]"
Test: "backward compat — monetization: string appended to groups"
Test: "override targets — site in targeted group gets override applied"
Test: "override targets — site directly listed gets override applied"
Test: "override targets — union of groups and sites"
Test: "override targets — site NOT in any target is unaffected"
Test: "override replace — ads_config in override replaces group chain ads_config entirely"
Test: "override replace — scripts.head in override replaces entire array"
Test: "override replace — tracking.ga4 replaces only ga4, others inherit"
Test: "override replace — fields not in override pass through unchanged"
Test: "override priority — higher priority override wins over lower"
Test: "multiple overrides — both apply, higher priority last"
Test: "override ads_txt — replaces group chain ads_txt (not additive)"
Test: "group ads_txt — additive across groups (unchanged behavior)"
```

## Phase 3: Restructure network repo

**[atomic-labs-network]** on `main` branch:

### Step 3a: Move monetization files to groups

```bash
# premium-ads.yaml → groups/taboola.yaml
# Read monetization/premium-ads.yaml, create groups/taboola.yaml with:
#   - Rename monetization_id → group_id
#   - Rename to group name
#   - Keep ALL config fields (tracking, scripts, ads_config, ads_txt, etc.)
#   - Remove provider field (not needed for groups)

# standard-ads.yaml → groups/adsense-default.yaml  
# Same transformation
```

### Step 3b: Move test-ads to overrides

```bash
# monetization/test-ads.yaml → overrides/config/test-ads-mock.yaml
# Transform to override format:
#   - Add override_id, name, priority
#   - Add targets: { groups: [], sites: [coolnews-atl] }  ← keep targeting coolnews-atl
#   - Keep the mock-ad-fill.js script entry
#   - Keep all ad_placements
```

The test-ads-mock override should look like:

```yaml
override_id: test-ads-mock
name: "Test Ads (Mock Demo)"
priority: 100

targets:
  sites:
    - coolnews-atl

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

### Step 3c: Create a second mock group for QA contrast

Create `groups/mock-minimal.yaml` — a group with DIFFERENT ad placements, sizes, and the mock ads use DIFFERENT colors. This is for QA testing that group-level ad config works differently from the override.

```yaml
group_id: mock-minimal
name: "Mock Minimal Ads (QA)"

ads_config:
  interstitial: false
  layout: standard
  ad_placements:
    - id: "mini-top"
      position: above-content
      sizes:
        desktop: [[468, 60]]
        mobile: [[320, 50]]
      device: all
    - id: "mini-mid"
      position: after-paragraph-5
      sizes:
        desktop: [[300, 250]]
        mobile: [[300, 250]]
      device: all

scripts:
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"
```

Note: different placement IDs (`mini-top`, `mini-mid`), different positions (after-paragraph-5 not 3), different sizes (468x60 not 728x90), and only 2 placements instead of 5. When QA, the mock ads will look visibly different — smaller banners, fewer slots — proving the group config is what controls the layout.

### Step 3d: Update coolnews-atl site.yaml

**[atomic-labs-network]** on `staging/coolnews-atl` branch:

```yaml
# BEFORE
group: entertainment
monetization: test-ads

# AFTER
groups:
  - entertainment        # Theme, fonts
  - taboola              # Ad config (from former premium-ads)
```

The test-ads-mock override targets coolnews-atl by site name, so it will be applied automatically. No need to reference it in site.yaml.

### Step 3e: Delete monetization/ directory

```bash
rm -rf monetization/
git add -A
git commit -m "config: replace monetization layer with unified groups + overrides

- Moved monetization/premium-ads.yaml → groups/taboola.yaml
- Moved monetization/standard-ads.yaml → groups/adsense-default.yaml
- Moved monetization/test-ads.yaml → overrides/config/test-ads-mock.yaml
- Created groups/mock-minimal.yaml for QA testing
- Updated sites to use groups: [] array instead of group: + monetization:
- Deleted monetization/ directory"
git push origin main
```

Also push the site.yaml change on the staging branch:
```bash
git checkout staging/coolnews-atl
# Update site.yaml
git commit -m "config(coolnews-atl): switch to groups array, remove monetization ref"
git push origin staging/coolnews-atl
```

## Phase 4: Update dashboard — Remove monetization section

**[atomic-content-platform]**

### 4a: Delete monetization routes and components

- Delete `services/dashboard/src/app/[org]/monetization/` (entire directory)
- Delete `services/dashboard/src/components/monetization/` (entire directory)
- Remove monetization nav item from sidebar
- Remove any `monetization:` field from site forms

### 4b: Create unified config form component

Create `services/dashboard/src/components/config/UnifiedConfigForm.tsx`

This single component renders the full config form with sections:
- Tracking (ga4, gtm, google_ads, facebook_pixel, custom)
- Scripts (head, body_start, body_end with id/src/inline editors)
- Script Variables (key-value editor)
- Ad Placements (visual editor with article layout preview)
- ads.txt (multiline editor)
- Theme (base, colors, fonts, logo, favicon)
- Legal (key-value editor + legal_pages_override)

Props:
```typescript
interface UnifiedConfigFormProps {
  config: Partial<UniversalConfigFields>;
  onChange: (config: Partial<UniversalConfigFields>) => void;
  mode: 'org' | 'group' | 'override' | 'site';
  inheritedConfig?: ResolvedConfig;  // For showing source badges
}
```

The `mode` prop controls:
- Which identity fields show at the top (org name vs group_id vs override targets)
- Whether source badges are shown (site mode shows "From group: X" etc.)
- Whether the override targeting UI is shown (only in override mode)

### 4c: Update group detail page

`services/dashboard/src/app/[org]/groups/[groupId]/page.tsx`

Use `UnifiedConfigForm` with `mode='group'`. This now shows ALL config fields — tracking, scripts, ads_config, theme, legal — not just the "slimmed" version from before.

### 4d: Create overrides management

- `services/dashboard/src/app/[org]/overrides/page.tsx` — list of config overrides
- `services/dashboard/src/app/[org]/overrides/[id]/page.tsx` — override detail with targeting UI
- `services/dashboard/src/app/[org]/overrides/new/page.tsx` — create override

The override detail page has:
- Identity: override_id, name, priority
- **Targeting panel:** Multi-select for groups + multi-select for individual sites. Shows "Affects N sites" count.
- Config form: same `UnifiedConfigForm` with `mode='override'`
- Warning banner: "Fields defined here REPLACE the group chain — they do not merge."

### 4e: Update site detail page

- Remove Monetization tab
- Config tab now shows:
  - Groups: ordered multi-select (drag to reorder)
  - Resolved config with source badges showing which group each value comes from
  - Active overrides: read-only list of overrides targeting this site, with links
  - Override indicator: if an override is active, show which fields it replaces

### 4f: Update site creation wizard

Step 2 becomes "Select groups" (multi-select, orderable). No monetization dropdown.

### 4g: Add "Overrides" to sidebar navigation

Between "Groups" and "Settings".

## Phase 5: Update build pipeline

**[atomic-content-platform]**

### 5a: Update detect-changed-sites.ts

```
overrides/config/*.yaml changed    → rebuild sites targeted by that override
groups/<id>.yaml changed           → rebuild sites with that group in their groups[] array
```

(Was: `monetization/*.yaml` → no rebuild. Now overrides DO trigger rebuilds because the config is baked inline at build time.)

### 5b: Update build-site.ts

Update to call the new resolve-config that handles multi-group + overrides.

### 5c: Inline config in BaseLayout

The `window.__ATL_MONETIZATION__` variable should be renamed to `window.__ATL_CONFIG__` (it's not just monetization anymore). Same mechanism — resolved config baked into the HTML at build time.

## Phase 6: Update ad-loader.js

**[atomic-content-platform]** `packages/site-builder/public/ad-loader.js`

Change `window.__ATL_MONETIZATION__` to `window.__ATL_CONFIG__`. Same logic otherwise — read the inline config, create ad containers, load scripts.

## Phase 7: Global cleanup

- Remove any `monetization` references in shared-types barrel exports
- Update guide pages in `services/dashboard/public/guide/`
- Update CLAUDE.md conventions section (config inheritance line)

## Phase 8: Commit and verify

```bash
# Platform repo
cd ~/Documents/ATL-content-network/atomic-content-platform
pnpm typecheck
pnpm build
pnpm test
git add -A
git commit -m "feat: replace monetization layer with unified groups + overrides

- Removed monetization/ concept entirely
- Groups now support all config fields (tracking, scripts, ads, theme, legal)
- Sites list multiple groups: groups: [entertainment, taboola]
- New override system: targeted exceptions with replace semantics
- Unified config form component used across org/group/override/site
- Updated resolve-config for multi-group merge + override apply
- Renamed window.__ATL_MONETIZATION__ to window.__ATL_CONFIG__"
git push origin michal-dev
cloudgrid deploy
```

```bash
# Network repo (already pushed in Phase 3)
# Trigger coolnews-atl rebuild
cd ~/Documents/ATL-content-network/atomic-labs-network
git checkout staging/coolnews-atl
touch sites/coolnews-atl/.build-trigger
git commit -am "chore: trigger rebuild after architecture change"
git push origin staging/coolnews-atl
```

---

# PART D — QA Plan

## QA 1: Config Resolution

### Test 1.1 — Multi-group merge

**Setup:** coolnews-atl has `groups: [entertainment, taboola]`

**Run:** `resolveConfig('.', 'coolnews-atl')`

**Check:**
- [ ] Theme colors come from entertainment group (first group, sets theme)
- [ ] If taboola also sets theme colors, taboola wins (last group)
- [ ] ads_config comes from taboola group
- [ ] ads_txt combines entries from org + entertainment + taboola (additive)
- [ ] scripts merge by id across both groups

### Test 1.2 — Override applied to coolnews-atl

The test-ads-mock override targets coolnews-atl directly.

**Check:**
- [ ] Override's ads_config REPLACES the taboola group's ads_config
- [ ] Override's scripts.body_end REPLACES (includes mock-ad-fill.js)
- [ ] Override's tracking.ga4 replaces with "G-TESTDEMO000"
- [ ] Theme still comes from group chain (override doesn't define theme)
- [ ] `resolved.applied_overrides` includes "test-ads-mock"

### Test 1.3 — Override via group targeting

**Setup:** Create override targeting `groups: [taboola]`

**Check:** Every site with taboola in its groups[] gets the override applied.

### Test 1.4 — Override priority order

**Setup:** Two overrides both target coolnews-atl, priority 10 and priority 20.

**Check:** Priority 20 override's fields win over priority 10.

### Test 1.5 — Backward compatibility

**Test with old site.yaml format:**
```yaml
group: entertainment
monetization: test-ads
```

**Check:** resolve-config treats this as `groups: [entertainment, test-ads]` without errors.

## QA 2: Mock Ads Still Work (coolnews-atl)

### Test 2.1 — Build succeeds

```bash
SITE_DOMAIN=coolnews-atl NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network pnpm build
```

**Check:** Zero errors.

### Test 2.2 — Mock ads visible on staging site

Open `staging-coolnews-atl.coolnews-atl.pages.dev`, click any article.

**Check (same as before — these must NOT regress):**
- [ ] Blue "TechGadget Pro X" banner above content
- [ ] Orange "CloudHost Premium" after paragraph 3
- [ ] Green "LearnCode Academy" after paragraph 7
- [ ] Red "Premium Hosting" in sidebar (desktop)
- [ ] Teal "Download Our App" bottom anchor (mobile)
- [ ] Debug panel shows override name "test-ads-mock"

### Test 2.3 — Source is override, not group

In the debug panel or resolved config, verify:
- [ ] ads_config comes from override "test-ads-mock" (not from taboola group)
- [ ] mock-ad-fill.js is loaded via override's scripts.body_end

## QA 3: Group Ad Config Works (mock-minimal group)

### Test 3.1 — Switch coolnews-atl to mock-minimal group

Temporarily change coolnews-atl to test group-level ads:

**[atomic-labs-network]** on `staging/coolnews-atl`:
```yaml
groups:
  - entertainment
  - mock-minimal          # Instead of taboola
```

Also temporarily remove coolnews-atl from the test-ads-mock override targets (so the override doesn't apply and we see pure group config).

Rebuild.

### Test 3.2 — Different ads appear

Open staging site, click article.

**Check:**
- [ ] Only 2 ad slots visible (not 5) — mini-top and mini-mid
- [ ] Top banner is SMALLER (468×60 instead of 728×90)
- [ ] In-content ad is after paragraph 5 (not paragraph 3)
- [ ] No sidebar ad
- [ ] No mobile anchor
- [ ] This proves the group's ads_config is controlling the layout

### Test 3.3 — Revert

Change coolnews-atl back to `groups: [entertainment, taboola]` and re-add to override targets. Rebuild. Verify original mock ads are back.

## QA 4: Override Targeting

### Test 4.1 — Override targets a group

**Setup:** Edit test-ads-mock override:
```yaml
targets:
  groups:
    - taboola            # All sites in taboola group
  sites: []              # No direct sites
```

**Check:**
- [ ] coolnews-atl (which is in the taboola group) gets the override
- [ ] A site NOT in the taboola group does NOT get the override

### Test 4.2 — Override targets group + specific site

```yaml
targets:
  groups:
    - taboola
  sites:
    - some-other-site    # A site not in taboola group
```

**Check:**
- [ ] coolnews-atl gets override (via taboola group)
- [ ] some-other-site gets override (via direct site target)
- [ ] Both see the same override config

### Test 4.3 — Remove site from override targets

Remove coolnews-atl from targets. Rebuild.

**Check:**
- [ ] coolnews-atl NO LONGER shows mock ads from override
- [ ] coolnews-atl shows the taboola group's ad config instead (real ad scripts, not mock)

## QA 5: Dashboard Verification

### Test 5.1 — Monetization section is gone

- [ ] No "Monetization" item in sidebar
- [ ] No `/monetization` routes accessible
- [ ] No `monetization:` field in any site form

### Test 5.2 — Groups page shows all groups

- [ ] entertainment, taboola, adsense-default, mock-minimal all visible
- [ ] Each shows site count
- [ ] Clicking a group shows the full config form (tracking, scripts, ads_config, theme, legal)

### Test 5.3 — Group detail — ad placements editor works

- [ ] Open taboola group → Ad Placements section visible
- [ ] Visual article preview shows placement positions
- [ ] Can add/edit/remove placements
- [ ] Save commits to groups/taboola.yaml

### Test 5.4 — Overrides page

- [ ] New "Overrides" section in sidebar
- [ ] Lists test-ads-mock override
- [ ] Shows target count (groups + sites)
- [ ] Detail page shows targeting UI + config form
- [ ] Can edit targets (add/remove groups, add/remove sites)
- [ ] Priority field editable
- [ ] Warning banner about replace semantics visible

### Test 5.5 — Site detail updated

- [ ] No Monetization tab
- [ ] Config tab shows resolved values with source badges
- [ ] Groups field is multi-select, orderable
- [ ] "Active overrides" section shows test-ads-mock with link
- [ ] Override indicator shows which fields are being replaced

### Test 5.6 — Site creation wizard

- [ ] Step 2 is "Select groups" (multi-select)
- [ ] No monetization dropdown
- [ ] Selecting groups shows preview of combined config

### Test 5.7 — Unified form component

- [ ] Same form layout in org settings, group detail, override detail, site detail
- [ ] All have: tracking, scripts, script vars, ads config, ads.txt, theme, legal sections

## QA 6: Build Filter

### Test 6.1 — Group change triggers correct rebuilds

Change `groups/taboola.yaml` → only sites with taboola in their groups[] should rebuild.

### Test 6.2 — Override change triggers correct rebuilds

Change `overrides/config/test-ads-mock.yaml` → only sites targeted by that override should rebuild.

### Test 6.3 — Unrelated group change does NOT rebuild coolnews-atl

Change `groups/sports.yaml` (coolnews-atl is not in sports group) → coolnews-atl should NOT rebuild.

## QA 7: Edge Cases

### Test 7.1 — Site with no groups

```yaml
groups: []
```

**Check:** Site inherits only from org.yaml. No crash.

### Test 7.2 — Site with nonexistent group

```yaml
groups: [entertainment, nonexistent]
```

**Check:** Descriptive error: "Group 'nonexistent' not found."

### Test 7.3 — Override with no targets

```yaml
targets:
  groups: []
  sites: []
```

**Check:** Override affects no sites. No crash, no warning needed.

### Test 7.4 — Two overrides conflict

Both define ads_config, priority 10 and 20.

**Check:** Priority 20 wins entirely. No partial merge between overrides.