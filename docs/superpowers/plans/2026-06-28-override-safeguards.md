# Override Safeguards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 404 bug when creating overrides, add seed-kv validation to prevent dangerous override configs from silently breaking production, and re-create a clean fb-pixel override.

**Architecture:** Three independent fixes: (1) invalidate tree cache after git mutations in `github.ts`, (2) add config validation warnings to `seed-kv.ts` after config resolution, (3) write a safe fb-pixel override via the network repo.

**Tech Stack:** TypeScript, Next.js API routes, Vitest, YAML

---

### Task 1: Fix tree cache invalidation after git mutations

The `commitNetworkFiles` and `deleteNetworkFile` functions in `github.ts` do not call `invalidateTreeCache()` after mutating the network repo. The tree cache has a 5-minute TTL, so immediately after creating/deleting a file, `readFileContent()` still uses the stale cached tree and returns null (404).

**Files:**
- Modify: `services/dashboard/src/lib/github.ts:1206-1260` (commitNetworkFiles)
- Modify: `services/dashboard/src/lib/github.ts:1291-1332` (deleteNetworkFile)

- [ ] **Step 1: Add `invalidateTreeCache(branch)` to `commitNetworkFiles`**

In `services/dashboard/src/lib/github.ts`, add a cache invalidation call after the `updateRef` call at the end of `commitNetworkFiles`:

```typescript
  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
  invalidateTreeCache(branch);
```

- [ ] **Step 2: Add `invalidateTreeCache(branch)` to `deleteNetworkFile`**

Same pattern — add after the `updateRef` call at the end of `deleteNetworkFile`:

```typescript
  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
  invalidateTreeCache(branch);
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/lib/github.ts
git commit -m "fix(dashboard): invalidate tree cache after git mutations

commitNetworkFiles and deleteNetworkFile did not invalidate the tree
cache, causing 404s when reading a file immediately after creating or
deleting it (stale cache served for up to 5 min).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Add seed-kv config validation warnings

After config resolution in `seed-kv.ts`, add validation that warns (and optionally errors) when dangerous patterns are detected. This catches problems like an override wiping `ad_placements` for all sites.

**Files:**
- Create: `packages/site-worker/scripts/lib/validate-config.ts`
- Test: `packages/site-worker/scripts/__tests__/validate-config.test.ts`
- Modify: `packages/site-worker/scripts/seed-kv.ts:529` (after `resolveSiteConfig`, before KV write)

- [ ] **Step 1: Write failing tests for `validateResolvedConfig`**

Create `packages/site-worker/scripts/__tests__/validate-config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { validateResolvedConfig } from '../lib/validate-config';

describe('validateResolvedConfig', () => {
  const base = {
    ads_config: {
      interstitial: false,
      ad_placements: [{ id: 'sidebar', position: 'sidebar', code: '<div>ad</div>' }],
    },
    scripts: { head: [{ id: 'sdk', src: 'https://cdn.example.com/sdk.js' }] },
    tracking: { ga4: 'G-TEST', facebook_pixel: null },
  };

  it('returns no warnings for a valid config', () => {
    const warnings = validateResolvedConfig(base as Record<string, unknown>, 'testsite');
    expect(warnings).toHaveLength(0);
  });

  it('warns when interstitial is enabled but ad_placements is empty', () => {
    const config = {
      ...base,
      ads_config: { interstitial: true, interstitial_config: { script_inline: 'load()' }, ad_placements: [] },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('ad_placements') && w.includes('empty'))).toBe(true);
  });

  it('warns when interstitial is enabled but no script_url or script_inline', () => {
    const config = {
      ...base,
      ads_config: {
        interstitial: true,
        interstitial_config: { script_url: '', script_inline: '' },
        ad_placements: [{ id: 'x' }],
      },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('interstitial') && w.includes('no script'))).toBe(true);
  });

  it('warns when all tracking fields are null', () => {
    const config = {
      ...base,
      tracking: { ga4: null, gtm: null, google_ads: null, facebook_pixel: null, custom: [] },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('tracking'))).toBe(true);
  });

  it('warns when head scripts are empty (no SDK loaded)', () => {
    const config = {
      ...base,
      scripts: { head: [], body_start: [], body_end: [] },
    };
    const warnings = validateResolvedConfig(config as Record<string, unknown>, 'testsite');
    expect(warnings.some(w => w.includes('scripts.head') && w.includes('empty'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/site-worker && npx vitest run scripts/__tests__/validate-config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `validateResolvedConfig`**

Create `packages/site-worker/scripts/lib/validate-config.ts`:

```typescript
/**
 * Post-resolution config validator for seed-kv.
 *
 * Runs after resolveSiteConfig() produces the final merged config.
 * Returns an array of human-readable warning strings. These are
 * logged during seeding so operators notice dangerous patterns
 * (e.g. an override wiping all ad placements).
 *
 * This is a WARN layer, not a hard gate — seeding still proceeds.
 * A future strict mode can promote warnings to errors.
 */

interface AdsConfig {
  interstitial?: boolean;
  interstitial_config?: {
    script_url?: string;
    script_inline?: string;
    [k: string]: unknown;
  };
  ad_placements?: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

interface TrackingConfig {
  ga4?: string | null;
  gtm?: string | null;
  google_ads?: string | null;
  facebook_pixel?: string | null;
  custom?: unknown[];
  [k: string]: unknown;
}

interface ScriptsConfig {
  head?: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export function validateResolvedConfig(
  config: Record<string, unknown>,
  siteId: string,
): string[] {
  const warnings: string[] = [];
  const ads = config.ads_config as AdsConfig | undefined;
  const tracking = config.tracking as TrackingConfig | undefined;
  const scripts = config.scripts as ScriptsConfig | undefined;

  // 1. Interstitial enabled but no delivery script
  if (ads?.interstitial === true) {
    const ic = ads.interstitial_config;
    const hasUrl = typeof ic?.script_url === 'string' && ic.script_url.length > 0;
    const hasInline = typeof ic?.script_inline === 'string' && ic.script_inline.trim().length > 0;
    if (!hasUrl && !hasInline) {
      warnings.push(
        `[${siteId}] ads_config.interstitial is true but interstitial_config has no script_url or script_inline — interstitial will not render`,
      );
    }
  }

  // 2. Ad placements wiped (empty array after merge)
  if (ads && Array.isArray(ads.ad_placements) && ads.ad_placements.length === 0) {
    warnings.push(
      `[${siteId}] ads_config.ad_placements is empty — no ad slots will render. Check if an override layer set ad_placements: []`,
    );
  }

  // 3. All tracking IDs null
  if (tracking) {
    const ids = [tracking.ga4, tracking.gtm, tracking.google_ads, tracking.facebook_pixel];
    const customs = Array.isArray(tracking.custom) ? tracking.custom : [];
    if (ids.every((v) => v === null || v === undefined) && customs.length === 0) {
      warnings.push(
        `[${siteId}] all tracking IDs are null — no analytics will fire`,
      );
    }
  }

  // 4. Head scripts empty (no ad SDK will load)
  if (scripts && Array.isArray(scripts.head) && scripts.head.length === 0) {
    warnings.push(
      `[${siteId}] scripts.head is empty — no SDK scripts will load. Ad widgets require header scripts.`,
    );
  }

  return warnings;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/site-worker && npx vitest run scripts/__tests__/validate-config.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Wire validation into seed-kv.ts**

In `packages/site-worker/scripts/seed-kv.ts`, add import at the top (after other imports):

```typescript
import { validateResolvedConfig } from './lib/validate-config';
```

Then after line 530 (`const { config, conditionalOverrides } = await resolveSiteConfig(siteId);`), add:

```typescript
  // Validate resolved config — warn about dangerous patterns.
  const configWarnings = validateResolvedConfig(config as unknown as Record<string, unknown>, siteId);
  if (configWarnings.length > 0) {
    console.warn('[seed-kv] ⚠️  CONFIG WARNINGS:');
    for (const w of configWarnings) console.warn(`  ${w}`);
  }
```

- [ ] **Step 6: Verify typecheck passes**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/site-worker/scripts/lib/validate-config.ts packages/site-worker/scripts/__tests__/validate-config.test.ts packages/site-worker/scripts/seed-kv.ts
git commit -m "feat(site-worker): add config validation warnings to seed-kv

Validates resolved config after merge and warns about dangerous
patterns: empty ad_placements, interstitial enabled without script,
all tracking null, no head scripts. Warnings are logged during
seeding so operators notice overrides silently wiping ads config.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Re-create clean fb-pixel override

The deleted fb-pixel override had dangerous `ads_config` fields (`interstitial: false`, `ad_placements: []`) that wiped group-level ads for all targeted sites. Re-create it with ONLY the Facebook pixel tracking field — no ads_config, no scripts, no theme.

**Files:**
- The override is created via the dashboard API (PUT to `/api/overrides/fb-pixel`), which commits to the network repo. Since we can't call the API from here, we commit directly to the network repo.
- Create: `~/Documents/ATL-content-network/atomic-labs-network/overrides/config/fb-pixel.yaml`

- [ ] **Step 1: Create the clean fb-pixel override YAML**

Write to the network repo at `overrides/config/fb-pixel.yaml`. Include ONLY tracking — no ads_config, scripts, theme, or legal fields. Empty objects `{}` and arrays `[]` are intentionally omitted to avoid the merge-layer-wipes-inherited pattern.

```yaml
override_id: fb-pixel
name: Facebook Pixel
priority: 1
targets:
  groups:
    - atl
    - ncg
  sites:
    - aliensrus
    - babyparenttrends
    - buzzsoaps
    - carsnewsinformer
    - carsnewsmag
    - chaibeseret
    - coffeeactually
    - decoratinglabs
    - decoratingmom
    - decotricksworld
    - diydecorschool
    - dogslabs
    - dramadispatch
    - eznutritiontips
    - fashionnewsbee
    - foreverhealty
    - gadgetskoala
    - gamerswiredaily
    - gamingnewsalley
    - geekystudios
    - geekytraveler
    - giantsavings
    - gigsfreaks
    - journeypeaks
    - medicalnewsalley
    - medicalnewscorner
    - mindmedications
    - mindsbit
    - muvizz
    - paleobeasts
    - popnsnap
    - sciencenewslab
    - sillycapybara
    - soccernewsreports
    - stroylab
    - thewonderkeepers
    - travelbeautytips
    - travelclearly
    - travelingfoodie2
    - travelnights
    - travelswire
    - trendscores
    - tvshowbox
    - tvshowsmag
    - useminds
    - wineoceans
    - womendivision
    - wtpop
    - yogaterritory
tracking:
  facebook_pixel: "995281758635356"
```

- [ ] **Step 2: Commit to network repo**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git add overrides/config/fb-pixel.yaml
git commit -m "config(overrides): re-create fb-pixel (tracking only)

Previous version included ads_config with interstitial: false and
ad_placements: [] which silently wiped group-level ad placements for
all targeted sites during seed-kv. This version contains ONLY the
Facebook pixel tracking ID — no ads_config fields.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 3: Push to remote**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git push origin main
```

---

### Task 4: Update CLAUDE.md with new landmine

**Files:**
- Modify: `CLAUDE.md` (Known Landmines section)

- [ ] **Step 1: Add landmine about override empty arrays**

Add to the Known Landmines list in CLAUDE.md:

```markdown
31. **Override `ad_placements: []` wipes inherited** — an override with `ad_placements: []` clears all group-level placements via `mergeAdPlacementLayers`. Only include `ads_config` in an override if you intend to change ad behavior. Tracking-only overrides must omit `ads_config` entirely.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add landmine about override ad_placements wipe

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
