# Network Repo + Platform Repo — Complete Change List

> Send this to Claude Code AFTER the main spec phases, or include it as part of Phase 3.
> Every file change is listed with exact repo, branch, and action.

## [atomic-labs-network] on `main` branch

### Files to CREATE:

**1. `groups/taboola.yaml`** (from former `monetization/premium-ads.yaml`)
```bash
# Read monetization/premium-ads.yaml
# Transform:
#   - Change monetization_id → group_id: taboola
#   - Change name to: "Taboola Exclusive Sites"
#   - Remove provider field
#   - Keep ALL other fields: tracking, scripts, scripts_vars, ads_config, ads_txt, theme, legal
```

**2. `groups/adsense-default.yaml`** (from former `monetization/standard-ads.yaml`)
```bash
# Same transform: monetization_id → group_id: adsense-default
# Remove provider field, keep everything else
```

**3. `groups/mock-minimal.yaml`** (NEW — for QA testing group-level ad config)
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
  head: []
  body_start: []
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"

ads_txt: []
```

**4. `overrides/config/test-ads-mock.yaml`** (from former `monetization/test-ads.yaml`)
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

scripts_vars: {}

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

ads_txt: []
```

### Files to DELETE:

```bash
rm monetization/premium-ads.yaml
rm monetization/standard-ads.yaml
rm monetization/test-ads.yaml
rmdir monetization/    # Remove directory entirely
```

### Files to UPDATE:

**5. `org.yaml`** — Remove `default_monetization` field if present. Replace with `default_groups`:
```yaml
# REMOVE this line:
default_monetization: "standard-ads"

# ADD this line:
default_groups:
  - adsense-default
```
Keep ALL other fields unchanged.

### Existing files to VERIFY (no changes needed, but confirm they exist):

```bash
cat groups/entertainment.yaml     # Should exist from before
cat groups/news-vertical.yaml     # May exist — check if any site references it
cat network.yaml                  # Unchanged
cat dashboard-index.yaml          # Unchanged
cat scheduler/config.yaml         # Unchanged
```

### Commit on main:

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git checkout main
git pull origin main

# Create new files
mkdir -p overrides/config
# (create groups/taboola.yaml, groups/adsense-default.yaml, groups/mock-minimal.yaml, overrides/config/test-ads-mock.yaml)

# Delete old files
rm -rf monetization/

# Update org.yaml

# Verify all YAML is valid
for f in groups/*.yaml overrides/config/*.yaml org.yaml; do echo "=== $f ===" && cat "$f" | head -3; done

git add groups/ overrides/config/ org.yaml
git rm -r monetization/ 2>/dev/null || true
git status

git commit -m "config: replace monetization/ with unified groups + overrides

- groups/taboola.yaml ← was monetization/premium-ads.yaml (ad partner config)
- groups/adsense-default.yaml ← was monetization/standard-ads.yaml
- groups/mock-minimal.yaml ← NEW, QA group with purple/magenta mock ads
- overrides/config/test-ads-mock.yaml ← was monetization/test-ads.yaml (targets coolnews-atl)
- org.yaml: default_monetization → default_groups
- Deleted monetization/ directory entirely"

git push origin main
```

---

## [atomic-labs-network] on `staging/coolnews-atl` branch

### Files to UPDATE:

**6. `sites/coolnews-atl/site.yaml`**

Change:
```yaml
# BEFORE (current)
group: entertainment
monetization: test-ads    # or monetization: premium-ads

# AFTER
groups:
  - entertainment
  - taboola
```

Remove any `monetization:` field entirely.

Keep ALL other fields (domain, site_name, brief, theme, tracking, scripts_vars, etc.) unchanged.

### Commit on staging branch:

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git checkout staging/coolnews-atl
git pull origin staging/coolnews-atl

# Edit sites/coolnews-atl/site.yaml

cat sites/coolnews-atl/site.yaml   # Verify changes

git add sites/coolnews-atl/site.yaml
git commit -m "config(coolnews-atl): switch to groups array, remove monetization ref

groups: [entertainment, taboola]
Override test-ads-mock targets this site automatically."

git push origin staging/coolnews-atl
```

---

## [atomic-content-platform] — mock-ad-fill.js update

### File to UPDATE:

**7. `packages/site-builder/public/mock-ad-fill.js`**

Find the `MOCK_ADS` object dictionary. Add these entries for the mock-minimal group placements:

```javascript
    // === MOCK-MINIMAL GROUP placements (purple/magenta palette) ===
    'mini-top': {
      label: 'GROUP: MINI TOP',
      color: '#7B1FA2',
      bg: '#F3E5F5',
      mockBrand: 'GroupAd Demo',
      mockCta: 'Learn More'
    },
    'mini-mid': {
      label: 'GROUP: MINI MID',
      color: '#AD1457',
      bg: '#FCE4EC',
      mockBrand: 'GroupAd Content',
      mockCta: 'Read More'
    },
```

Also update the `addDebugPanel()` function — after the line that shows profile/monetization info, add override detection:

```javascript
    // Show whether override is active or group-only
    if (c && c.applied_overrides && c.applied_overrides.length > 0) {
      lines.push('<div style="color:#ffd54f;font-weight:700;">Override active: ' + c.applied_overrides.join(', ') + '</div>');
    } else {
      lines.push('<div style="color:#ce93d8;font-weight:700;">Group config only (no override)</div>');
    }
```

### File to UPDATE:

**8. `packages/site-builder/public/ad-loader.js`**

Rename `window.__ATL_MONETIZATION__` to `window.__ATL_CONFIG__`:

```javascript
// BEFORE
var c = window.__ATL_MONETIZATION__ || null;

// AFTER
var c = window.__ATL_CONFIG__ || null;
```

### File to UPDATE:

**9. `packages/site-builder/src/layouts/BaseLayout.astro`**

Rename the inline config variable:

```astro
<!-- BEFORE -->
<script is:inline define:vars={{ monetizationConfig: resolvedConfig.monetizationJson }}>
  window.__ATL_MONETIZATION__ = monetizationConfig;
</script>

<!-- AFTER -->
<script is:inline define:vars={{ siteConfig: resolvedConfig.inlineAdConfig }}>
  window.__ATL_CONFIG__ = siteConfig;
</script>
```

### Files to UPDATE in resolve-config.ts:

**10. `packages/site-builder/scripts/resolve-config.ts`**

The resolved config output should include an `inlineAdConfig` field (replaces `monetizationJson`):

```typescript
const inlineAdConfig = {
  domain: resolved.domain,
  groups: resolved.groups,
  applied_overrides: resolved.applied_overrides,
  tracking: resolved.tracking,
  scripts: resolved.scripts,
  ads_config: resolved.ads_config,
  generated_at: new Date().toISOString()
};
resolved.inlineAdConfig = inlineAdConfig;
```

### Commit on platform repo:

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform
git checkout michal-dev

# After all changes...
pnpm typecheck
pnpm build

git add packages/site-builder/public/mock-ad-fill.js
git add packages/site-builder/public/ad-loader.js
git add packages/site-builder/src/layouts/BaseLayout.astro
git add packages/site-builder/scripts/resolve-config.ts
git add packages/shared-types/

git commit -m "feat: unified groups + overrides, remove monetization concept

- mock-ad-fill.js: added purple/magenta colors for mock-minimal group
- ad-loader.js: __ATL_MONETIZATION__ → __ATL_CONFIG__
- BaseLayout.astro: renamed inline config variable
- resolve-config.ts: multi-group merge + override REPLACE logic
- shared-types: removed MonetizationConfig, added OverrideConfig"

git push origin michal-dev
```

---

## Trigger rebuild after both repos are updated

```bash
# Deploy platform
cd ~/Documents/ATL-content-network/atomic-content-platform
cloudgrid deploy

# Trigger coolnews-atl staging rebuild
cd ~/Documents/ATL-content-network/atomic-labs-network
git checkout staging/coolnews-atl
touch sites/coolnews-atl/.build-trigger
git add sites/coolnews-atl/.build-trigger
git commit -m "chore: trigger rebuild after groups+overrides refactor"
git push origin staging/coolnews-atl
```

---

## Complete file change summary

| # | Repo | Branch | File | Action |
|---|---|---|---|---|
| 1 | atomic-labs-network | main | `groups/taboola.yaml` | CREATE (from monetization/premium-ads.yaml) |
| 2 | atomic-labs-network | main | `groups/adsense-default.yaml` | CREATE (from monetization/standard-ads.yaml) |
| 3 | atomic-labs-network | main | `groups/mock-minimal.yaml` | CREATE (new QA group) |
| 4 | atomic-labs-network | main | `overrides/config/test-ads-mock.yaml` | CREATE (from monetization/test-ads.yaml) |
| 5 | atomic-labs-network | main | `org.yaml` | UPDATE (default_monetization → default_groups) |
| 6 | atomic-labs-network | staging/coolnews-atl | `sites/coolnews-atl/site.yaml` | UPDATE (group+monetization → groups array) |
| — | atomic-labs-network | main | `monetization/` | DELETE (entire directory) |
| 7 | atomic-content-platform | michal-dev | `packages/site-builder/public/mock-ad-fill.js` | UPDATE (add purple/magenta mock-minimal colors) |
| 8 | atomic-content-platform | michal-dev | `packages/site-builder/public/ad-loader.js` | UPDATE (rename __ATL_MONETIZATION__ → __ATL_CONFIG__) |
| 9 | atomic-content-platform | michal-dev | `packages/site-builder/src/layouts/BaseLayout.astro` | UPDATE (rename inline config var) |
| 10 | atomic-content-platform | michal-dev | `packages/site-builder/scripts/resolve-config.ts` | UPDATE (multi-group + overrides logic) |
| — | atomic-content-platform | michal-dev | `packages/shared-types/src/config.ts` | UPDATE (remove MonetizationConfig, add OverrideConfig) |
| — | atomic-content-platform | michal-dev | `services/dashboard/src/app/[org]/monetization/` | DELETE (entire directory) |
| — | atomic-content-platform | michal-dev | `services/dashboard/src/components/monetization/` | DELETE (entire directory) |
| — | atomic-content-platform | michal-dev | Dashboard group/override/site pages | UPDATE (per spec phases 4a-4g) |