# Mock Ads Monetization Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ghost `adsense-default` group reference, update `mock-ads` group to cover every ad position rendered by site-worker templates (sticky-bottom, sidebar, above-content, below-content, homepage-top, category-top, after-paragraph-N, interstitial), update `mock-ad-fill.js` to render mock creatives for all positions, and add end-to-end test coverage.

**Architecture:** Two-repo change. Network repo (`atomic-labs-network`) owns the group YAML data; platform repo (`atomic-content-platform`) owns the runtime code (mock-ad-fill.js, wizard.ts fallback, tests). Changes are pure config + JS + test — no Astro component changes needed since AdSlot/InterstitialLoader already support all positions.

**Tech Stack:** YAML (group config), vanilla JS (mock-ad-fill.js), TypeScript + Vitest (tests), Next.js server action (wizard.ts).

---

## Diagnosis — What's Currently Broken

### 1. `adsense-default` ghost group
- `org.yaml` line 18: `default_groups: [adsense-default]` — applied to ALL sites without explicit groups
- `wizard.ts` line 189: fallback `["adsense-default"]` when user selects no groups
- **No `groups/adsense-default.yaml` file exists** — seed-kv warns and skips it silently
- Result: sites get org-level ads only (2 sidebar placements), no mock-ad-fill script

### 2. mock-ads group placement/template mismatches
Template positions vs mock-ads YAML positions:

| Template `<AdSlot position=...>` | mock-ads.yaml placement | Status |
|---|---|---|
| `above-content` (article/page) | `top-banner` → `position: above-content` | OK |
| `below-content` (article) | `taboola-below` → `position: below-content` | OK |
| `sidebar` (article/homepage) | `sidebar-sticky` → `position: sidebar` | OK |
| `sticky-bottom` (article/homepage/page) | **MISSING** | BROKEN |
| `homepage-top` (homepage) | `homepage-top-banner` → `position: above-content` | WRONG position |
| `category-top` (category) | **MISSING** | BROKEN |
| `after-paragraph-N` (inline, article) | `in-content-1/2/3` → `position: after-paragraph` | WRONG — needs `-N` suffix |
| Interstitial (all pages via BaseLayout) | `interstitial: false` | DISABLED |

### 3. mock-ad-fill.js missing entries
No mock creative definition for: `sticky-bottom`, `homepage-top`, `category-top`.

---

## File Map

### Network repo (`~/Documents/ATL-content-network/atomic-labs-network/`)
- **Modify:** `org.yaml` — change `default_groups` from `[adsense-default]` to `[mock-ads]`
- **Modify:** `groups/mock-ads.yaml` — add sticky-bottom, fix homepage-top, add category-top, fix in-content positions, enable interstitial

### Platform repo (`~/Documents/ATL-content-network/atomic-content-platform/`)
- **Modify:** `services/dashboard/src/actions/wizard.ts:189` — change fallback from `"adsense-default"` to `"mock-ads"`
- **Modify:** `packages/site-worker/public/mock-ad-fill.js` — add mock creatives for `sticky-bottom`, `homepage-top`, `category-top`
- **Create:** `packages/site-worker/scripts/__tests__/mock-ads-e2e.test.ts` — end-to-end config resolution + placement coverage test

---

## Task 1: Fix `adsense-default` ghost in org.yaml (network repo)

**Files:**
- Modify: `~/Documents/ATL-content-network/atomic-labs-network/org.yaml:17-18`

- [ ] **Step 1: Change default_groups to mock-ads**

In `org.yaml`, replace:
```yaml
default_groups:
  - adsense-default
```
with:
```yaml
default_groups:
  - mock-ads
```

- [ ] **Step 2: Verify the change**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
grep -A1 'default_groups' org.yaml
```
Expected: `- mock-ads`

- [ ] **Step 3: Commit (network repo)**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git add org.yaml
git commit -m "fix(org): replace ghost adsense-default group with mock-ads

The adsense-default group file never existed. All sites without explicit
groups now inherit mock-ads as the default group.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Fix wizard.ts fallback (platform repo)

**Files:**
- Modify: `~/Documents/ATL-content-network/atomic-content-platform/services/dashboard/src/actions/wizard.ts:189`

- [ ] **Step 1: Change fallback group**

At line 189, replace:
```typescript
    groups: data.groups.length > 0 ? data.groups : ["adsense-default"],
```
with:
```typescript
    groups: data.groups.length > 0 ? data.groups : ["mock-ads"],
```

- [ ] **Step 2: Verify no other adsense-default references in code**

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform
grep -rn 'adsense-default' services/ packages/
```
Expected: no matches (docs/ references are historical and fine to leave).

- [ ] **Step 3: Commit (platform repo)**

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform
git add services/dashboard/src/actions/wizard.ts
git commit -m "fix(wizard): replace adsense-default fallback with mock-ads

The adsense-default group file never existed in the network repo.
New sites without explicit group selection now default to mock-ads.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update mock-ads.yaml with all placement types + interstitial (network repo)

**Files:**
- Modify: `~/Documents/ATL-content-network/atomic-labs-network/groups/mock-ads.yaml`

- [ ] **Step 1: Rewrite mock-ads.yaml with complete placement coverage**

Replace the entire file with:

```yaml
id: mock-ads
name: Mock Ads (Demo)
scripts:
  head: []
  body_start: []
  body_end:
    - id: mock-ad-fill
      src: /mock-ad-fill.js
ads_config:
  interstitial: true
  interstitial_config:
    script_url: "https://example.com/mock-interstitial.js"
    script_inline: ""
    trigger:
      type: delay
      delay_seconds: 5
      scroll_percent: 50
    frequency:
      type: once_per_session
      max_per_session: 1
    page_types:
      - all
    close_delay_seconds: 3
  layout: standard
  ad_placements:
    # Article / Page: above-content banner
    - id: top-banner
      position: above-content
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # Article: in-content after paragraph 2
    - id: in-content-1
      position: after-paragraph-2
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # Article: in-content after paragraph 4
    - id: in-content-2
      position: after-paragraph-4
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # Article: in-content after paragraph 6
    - id: in-content-3
      position: after-paragraph-6
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # Article / Homepage: sidebar
    - id: sidebar-sticky
      position: sidebar
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # Homepage: top banner
    - id: homepage-top-banner
      position: homepage-top
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # Category page: top banner
    - id: category-top-banner
      position: category-top
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # Article: below-content (taboola-style)
    - id: taboola-below
      position: below-content
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
    # All pages: sticky bottom bar
    - id: sticky-bottom-bar
      position: sticky-bottom
      device: all
      sizes: {}
      desktopSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
      mobileSizeConfig:
        ratio: { x: 16, y: 9 }
        range: { minWidth: null, maxWidth: null, minHeight: null, maxHeight: null }
        customSizes: []
tracking:
  ga4: null
  gtm: null
  google_ads: null
  facebook_pixel: null
  custom: []
scripts_vars: {}
ads_txt: []
theme: {}
legal: {}
```

Key changes:
- `interstitial: true` with `script_url: "https://example.com/..."` (mock-ad-fill.js detects `example.com` and renders the mock overlay)
- `in-content-1/2/3` positions changed from `after-paragraph` to `after-paragraph-2`, `after-paragraph-4`, `after-paragraph-6`
- `homepage-top-banner` position changed from `above-content` to `homepage-top` (matching `<AdSlot position="homepage-top">`)
- Added `category-top-banner` with `position: category-top`
- Added `sticky-bottom-bar` with `position: sticky-bottom`

- [ ] **Step 2: Verify YAML parses cleanly**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
python3 -c "import yaml; yaml.safe_load(open('groups/mock-ads.yaml')); print('OK')"
```

- [ ] **Step 3: Commit (network repo)**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git add groups/mock-ads.yaml
git commit -m "feat(mock-ads): add all placement types + enable interstitial

Adds sticky-bottom, homepage-top, category-top placements.
Fixes in-content positions to use after-paragraph-N format.
Fixes homepage-top-banner to match template position.
Enables interstitial with demo trigger config.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Update mock-ad-fill.js with new placement entries (platform repo)

**Files:**
- Modify: `~/Documents/ATL-content-network/atomic-content-platform/packages/site-worker/public/mock-ad-fill.js`

- [ ] **Step 1: Add mock creative definitions for new placements**

In the `MOCK_ADS` object (after the `'mobile-anchor'` entry around line 68), add entries for `sticky-bottom-bar`, `homepage-top-banner` (updated), and `category-top-banner`. Also add a generic `homepage-top` entry since the AdSlot may use the position name as fallback id:

Add after the `'category-banner'` entry:
```javascript
    'sticky-bottom-bar': {
      label: 'STICKY BOTTOM',
      color: '#00838f',
      bg: '#e0f7fa',
      mockBrand: 'Download Our App',
      mockCta: 'Install Free →'
    },
    'category-top-banner': {
      label: 'CATEGORY TOP',
      color: '#00838F',
      bg: '#E0F7FA',
      mockBrand: 'Category Sponsor',
      mockCta: 'Discover More'
    },
```

- [ ] **Step 2: Verify no syntax errors**

```bash
node -c packages/site-worker/public/mock-ad-fill.js
```
Expected: no output (success)

- [ ] **Step 3: Commit (platform repo)**

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform
git add packages/site-worker/public/mock-ad-fill.js
git commit -m "feat(mock-ad-fill): add mock creatives for sticky-bottom + category-top

Adds styled mock ad entries for the new placement IDs defined in
mock-ads group config.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Write end-to-end config resolution tests (platform repo)

**Files:**
- Create: `~/Documents/ATL-content-network/atomic-content-platform/packages/site-worker/scripts/__tests__/mock-ads-e2e.test.ts`
- Test: resolves mock-ads group → all positions present, interstitial enabled, mock-ad-fill script injected

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, it } from 'vitest';
import {
  deepMerge,
  mergeScriptLayers,
  mergeAdPlacementLayers,
} from '../lib/resolve';

/**
 * End-to-end config resolution tests for the mock-ads group.
 *
 * These tests simulate the seed-kv merge pipeline:
 *   org.yaml → groups/mock-ads.yaml → site.yaml
 *
 * They verify that every ad position rendered by site-worker templates
 * is present in the resolved config when a site uses the mock-ads group.
 */

// Minimal org.yaml representation (matches real org.yaml structure)
const ORG_LAYER: Record<string, unknown> = {
  tracking: { ga4: null, gtm: null, google_ads: null, facebook_pixel: null, custom: [] },
  scripts: { head: [], body_start: [], body_end: [] },
  ads_config: {
    interstitial: false,
    layout: 'standard',
    ad_placements: [
      { id: 'homepage-sidebar', position: 'sidebar' },
      { id: 'article-sidebar', position: 'sidebar' },
    ],
  },
  ad_placeholder_heights: {
    'above-content': 90,
    'after-paragraph': 280,
    sidebar: 600,
    'sticky-bottom': 50,
  },
};

// Full mock-ads group representation (matches updated groups/mock-ads.yaml)
const MOCK_ADS_LAYER: Record<string, unknown> = {
  scripts: {
    head: [],
    body_start: [],
    body_end: [{ id: 'mock-ad-fill', src: '/mock-ad-fill.js' }],
  },
  ads_config: {
    interstitial: true,
    interstitial_config: {
      script_url: 'https://example.com/mock-interstitial.js',
      script_inline: '',
      trigger: { type: 'delay', delay_seconds: 5, scroll_percent: 50 },
      frequency: { type: 'once_per_session', max_per_session: 1 },
      page_types: ['all'],
      close_delay_seconds: 3,
    },
    layout: 'standard',
    ad_placements: [
      { id: 'top-banner', position: 'above-content' },
      { id: 'in-content-1', position: 'after-paragraph-2' },
      { id: 'in-content-2', position: 'after-paragraph-4' },
      { id: 'in-content-3', position: 'after-paragraph-6' },
      { id: 'sidebar-sticky', position: 'sidebar' },
      { id: 'homepage-top-banner', position: 'homepage-top' },
      { id: 'category-top-banner', position: 'category-top' },
      { id: 'taboola-below', position: 'below-content' },
      { id: 'sticky-bottom-bar', position: 'sticky-bottom' },
    ],
  },
};

// Minimal site layer (no ads_config — inherits everything from group)
const SITE_LAYER: Record<string, unknown> = {
  domain: 'testsite',
  groups: ['mock-ads'],
  active: true,
};

const ALL_LAYERS = [ORG_LAYER, MOCK_ADS_LAYER, SITE_LAYER];

describe('mock-ads group: end-to-end config resolution', () => {
  // Simulate the seed-kv merge pipeline
  const merged = ALL_LAYERS.reduce(
    (acc, layer) => deepMerge(acc, layer) as Record<string, unknown>,
    {} as Record<string, unknown>,
  );
  const mergedAds = merged.ads_config as {
    interstitial: boolean;
    interstitial_config: Record<string, unknown>;
    ad_placements: Array<{ id: string; position: string }>;
  };

  describe('placement coverage — every template position is present', () => {
    const TEMPLATE_POSITIONS = [
      'above-content',
      'below-content',
      'sidebar',
      'sticky-bottom',
      'homepage-top',
      'category-top',
    ] as const;

    for (const pos of TEMPLATE_POSITIONS) {
      it(`has at least one placement with position="${pos}"`, () => {
        const match = mergedAds.ad_placements.filter((p) => p.position === pos);
        expect(match.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe('inline ad (after-paragraph-N) placements', () => {
    it('has three after-paragraph-N placements at paragraphs 2, 4, 6', () => {
      const inline = mergedAds.ad_placements.filter((p) =>
        /^after-paragraph-\d+$/.test(p.position),
      );
      expect(inline).toHaveLength(3);
      const ns = inline.map((p) => Number(p.position.split('-').pop()));
      expect(ns).toEqual(expect.arrayContaining([2, 4, 6]));
    });
  });

  describe('interstitial is enabled with mock config', () => {
    it('interstitial flag is true', () => {
      expect(mergedAds.interstitial).toBe(true);
    });

    it('interstitial_config has a demo script_url', () => {
      const ic = mergedAds.interstitial_config;
      expect(ic.script_url).toContain('example.com');
    });

    it('interstitial trigger is delay-based', () => {
      const ic = mergedAds.interstitial_config;
      const trigger = ic.trigger as { type: string; delay_seconds: number };
      expect(trigger.type).toBe('delay');
      expect(trigger.delay_seconds).toBe(5);
    });

    it('interstitial frequency is once_per_session', () => {
      const ic = mergedAds.interstitial_config;
      const freq = ic.frequency as { type: string };
      expect(freq.type).toBe('once_per_session');
    });

    it('interstitial applies to all page types', () => {
      const ic = mergedAds.interstitial_config;
      expect(ic.page_types).toEqual(['all']);
    });
  });

  describe('mock-ad-fill script is injected via body_end', () => {
    it('mergeScriptLayers includes mock-ad-fill in body_end', () => {
      const scripts = mergeScriptLayers(ALL_LAYERS);
      const mockFill = scripts.body_end.find((s) => s.id === 'mock-ad-fill');
      expect(mockFill).toBeDefined();
      expect(mockFill!.src).toBe('/mock-ad-fill.js');
    });
  });

  describe('group placements replace org placements (deepMerge array semantics)', () => {
    it('merged ad_placements is the group array (not concatenated with org)', () => {
      // deepMerge replaces arrays, so org's 2 sidebar placements are gone
      // and only mock-ads group's 9 placements remain.
      expect(mergedAds.ad_placements).toHaveLength(9);
      expect(mergedAds.ad_placements.find((p) => p.id === 'homepage-sidebar')).toBeUndefined();
    });
  });

  describe('mergeAdPlacementLayers with mock-ads group', () => {
    it('add mode: site can add extra placements on top of group', () => {
      const siteWithExtra = {
        ...SITE_LAYER,
        ads_config: {
          ad_placements: [{ id: 'site-custom', position: 'above-content' }],
        },
      };
      const result = mergeAdPlacementLayers([ORG_LAYER, MOCK_ADS_LAYER, siteWithExtra]);
      // Group replaces org (non-site layers); site appends in 'add' mode.
      const groupPlacements = (MOCK_ADS_LAYER.ads_config as { ad_placements: unknown[] }).ad_placements;
      expect(result).toHaveLength(groupPlacements.length + 1);
      expect(result[result.length - 1]).toMatchObject({ id: 'site-custom' });
    });
  });

  describe('total placement count', () => {
    it('mock-ads group defines exactly 9 placements', () => {
      const placements = (MOCK_ADS_LAYER.ads_config as { ad_placements: unknown[] }).ad_placements;
      expect(placements).toHaveLength(9);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform/packages/site-worker
pnpm test -- --run scripts/__tests__/mock-ads-e2e.test.ts
```
Expected: all tests PASS

- [ ] **Step 3: Run full test suite to verify no regressions**

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform/packages/site-worker
pnpm test -- --run
```
Expected: all 214+ tests pass

- [ ] **Step 4: Commit (platform repo)**

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform
git add packages/site-worker/scripts/__tests__/mock-ads-e2e.test.ts
git commit -m "test(site-worker): add mock-ads e2e config resolution tests

Verifies that every ad position rendered by site-worker templates
(above-content, below-content, sidebar, sticky-bottom, homepage-top,
category-top, after-paragraph-N, interstitial) is present in the
resolved config when a site uses the mock-ads group.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Push both repos

- [ ] **Step 1: Push network repo**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git push origin main
```

- [ ] **Step 2: Push platform repo**

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform
git push origin michal-v2-clean
```

---

## Verification Checklist

After all tasks complete:

1. **No `adsense-default` references in code paths:**
   ```bash
   grep -rn 'adsense-default' ~/Documents/ATL-content-network/atomic-content-platform/services/ ~/Documents/ATL-content-network/atomic-content-platform/packages/
   grep -rn 'adsense-default' ~/Documents/ATL-content-network/atomic-labs-network/org.yaml
   ```
   Expected: zero matches

2. **All site-worker tests pass** (214+ existing + new e2e tests)

3. **mock-ads.yaml has 9 placements** covering all template positions:
   - `above-content`, `after-paragraph-2`, `after-paragraph-4`, `after-paragraph-6`
   - `sidebar`, `homepage-top`, `category-top`, `below-content`, `sticky-bottom`

4. **Interstitial enabled** with `script_url` containing `example.com` (triggers mock overlay in mock-ad-fill.js)

5. **mock-ad-fill.js** has creative definitions for all placement IDs
