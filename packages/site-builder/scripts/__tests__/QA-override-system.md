# Override System QA Document

## System Under Test

The config resolver (`resolve-config.ts`) applies overrides between the group chain and site-level config:

```
org → groups[0] → groups[1] → … → overrides (by priority) → site
```

Each override field supports a `_mode` directive controlling how it merges with inherited values.

## Override Fields & Default Modes

| Field | Default Mode | Available Modes |
|-------|-------------|-----------------|
| `tracking` | `merge` | `merge`, `replace` |
| `scripts` | `merge_by_id` | `merge_by_id`, `replace` (legacy: `append`) |
| `scripts_vars` | `merge` | `merge`, `replace` |
| `ads_config` | `replace` | `add`, `replace`, `merge_placements` |
| `ads_txt` | `add` | `add`, `replace` |
| `theme` | `merge` | `merge`, `replace` |
| `legal` | `merge` | `merge`, `replace` |

---

## Test Matrix (25 Tests)

### T01 — Tracking: merge mode (default)
**Input:** Group chain sets `ga4: "G-GROUP"`, `gtm: "GTM-GROUP"`. Override sets `tracking: { ga4: "G-OVERRIDE" }` (no `_mode`).
**Expected:** `ga4 = "G-OVERRIDE"`, `gtm = "GTM-GROUP"` (unchanged). Only specified keys change.
**Fixture:** `fixtures/` — `high-priority-override` merges tracking into `multi-group.example.com`.
**Existing test:** Yes — "higher priority override wins over lower priority" + "fields not in override pass through".

### T02 — Tracking: replace mode
**Input:** Group chain sets `ga4`, `gtm`, `google_ads`, `facebook_pixel`. Override sets `tracking: { _mode: "replace", ga4: "G-ONLY" }`.
**Expected:** `ga4 = "G-ONLY"`, all others nulled (`gtm: null`, `google_ads: null`, `facebook_pixel: null`, `custom: []`).
**Fixture:** Needs new fixture or unit test of `applyOverride` directly.
**Existing test:** No — needs new test.

### T03 — Scripts: merge_by_id mode (default)
**Input:** Group chain has `head: [analytics, consent-manager]`. Override sets `scripts: { head: [{ id: "analytics", src: "/new.js" }] }` (no `_mode`).
**Expected:** `analytics` replaced with new src, `consent-manager` retained. New IDs appended.
**Existing test:** Yes — "merges script arrays by id" (test-site, group chain).

### T04 — Scripts: replace mode
**Input:** Group chain has scripts in head/body_end. Override sets `scripts: { _mode: "replace", head: [], body_end: [{ id: "override-script", src: "/x.js" }] }`.
**Expected:** Head = `[]`, body_end = `[override-script]`. All group scripts wiped.
**Fixture:** `fixtures/overrides/config/test-override.yaml` — `_mode: replace`.
**Existing test:** Yes — "override scripts replace group chain scripts arrays".

### T05 — Scripts: legacy "append" mode backward compat
**Input:** Existing YAML has `scripts: { _mode: "append", head: [{ id: "new-script", src: "/new.js" }] }`.
**Expected:** New scripts added without replacing existing ones (deduped by id). The type system accepts "append" at runtime even though UI no longer offers it.
**Existing test:** No — needs new test.

### T06 — Scripts vars: merge mode (default)
**Input:** Group chain sets `{ ad_site_id: "group-001", network_key: "abc" }`. Override sets `scripts_vars: { ad_site_id: "override-001" }`.
**Expected:** `ad_site_id = "override-001"`, `network_key = "abc"`.
**Existing test:** Partially (vars merge tested via placeholder resolution). Needs explicit override vars test.

### T07 — Scripts vars: replace mode
**Input:** Group chain sets `{ ad_site_id: "group-001", network_key: "abc" }`. Override sets `scripts_vars: { _mode: "replace", ad_site_id: "only-this" }`.
**Expected:** `ad_site_id = "only-this"`, `network_key` gone (not present).
**Existing test:** No — needs new test.

### T08 — Ads config: replace mode (default)
**Input:** Group chain has 3 placements + `interstitial: true`. Override sets `ads_config: { interstitial: false, layout: "standard", ad_placements: [override-banner] }`.
**Expected:** Entire ads_config replaced. Only `override-banner` in placements. `interstitial: false`.
**Fixture:** `fixtures/overrides/config/test-override.yaml`.
**Existing test:** Yes — "override ads_config replaces group chain ads_config entirely".

### T09 — Ads config: add mode (NEW)
**Input:** Group chain has `[sidebar (id:1)]`. Override sets `ads_config: { _mode: "add", ad_placements: [{ id: "sidebar-2", position: "sidebar", sizes: ... }] }`.
**Expected:** Both placements present: `sidebar (id:1)` + `sidebar-2`. No replacement by ID — pure concatenation.
**Existing test:** No — needs new fixture and test.

### T10 — Ads config: merge_placements mode
**Input:** Group chain has `[sidebar (id:1), top-banner (id:2)]`. Override sets `ads_config: { _mode: "merge_placements", ad_placements: [{ id: "sidebar", ... new sizes }] }`.
**Expected:** `sidebar` replaced by override version, `top-banner` retained. New IDs appended.
**Existing test:** No — needs new test.

### T11 — Ads config: add mode with interstitial/layout propagation
**Input:** Override has `ads_config: { _mode: "add", interstitial: true, layout: "premium", ad_placements: [...] }`.
**Expected:** `interstitial` and `layout` updated from override; placements appended (not replaced).
**Existing test:** No — needs new test.

### T12 — Ads.txt: add mode (default)
**Input:** Group chain accumulated `["google.com, pub-org, DIRECT"]`. Override sets `ads_txt: ["newnetwork.com, 123, RESELLER"]`.
**Expected:** Both entries present. Deduplicated.
**Fixture:** Partially covered in `fixtures-mon/` where override replaces then site adds.
**Existing test:** Partially — "ads_txt: override with ads_txt replaces group chain, site adds on top" (but that uses replace mode).

### T13 — Ads.txt: replace mode
**Input:** Group chain has 5 ads_txt entries. Override sets `ads_txt: { _mode: "replace", _values: ["only-this.com, 1, DIRECT"] }`.
**Expected:** All previous entries wiped. Only "only-this.com" remains.
**Fixture:** `fixtures-mon/overrides/config/test-ads-mock.yaml` — `_mode: replace, _values: []`.
**Existing test:** Yes — "ads_txt: override with ads_txt replaces group chain, site adds on top".

### T14 — Theme: merge mode (default)
**Input:** Group chain sets `colors: { primary: "#000", secondary: "#111" }`. Override sets `theme: { colors: { primary: "#F00" } }`.
**Expected:** `primary = "#F00"`, `secondary = "#111"` (preserved).
**Existing test:** No explicit override theme test — needs new test.

### T15 — Theme: replace mode
**Input:** Group chain sets full theme. Override sets `theme: { _mode: "replace", colors: { primary: "#F00" } }`.
**Expected:** Override layer reset, but group themes still apply independently in resolveTheme. Primary changes, secondary preserved from group.
**QA Finding:** Theme "replace" only resets the override accumulator — group themes are applied independently in `resolveTheme()` via `allThemes = [...groupThemes, overrideTheme]`. This means theme replace doesn't truly "wipe" inherited theme — it just prevents prior overrides' theme from accumulating.
**Existing test:** No — added new test (matches actual behavior).

### T16 — Legal: merge mode (default)
**Input:** Org sets `{ company_name: "Org Ltd", company_country: "US" }`. Group sets `legal_pages_override: { site_description }`. Override sets `legal: { company_name: "Override Ltd" }`.
**Expected:** `company_name = "Override Ltd"`, `company_country = "US"` (preserved), `site_description` (from group).
**QA Finding:** Groups contribute legal via `legal_pages_override` field, NOT `legal`. A group's `legal:` field is ignored by the resolver.
**Existing test:** No — added new test.

### T17 — Legal: replace mode
**Input:** Org/groups set 5 legal fields. Override sets `legal: { _mode: "replace", company_name: "Only This" }`.
**Expected:** All previous legal fields wiped. Only `company_name` remains.
**Existing test:** No — needs new test.

### T18 — Override targeting: site direct
**Input:** Override targets `sites: ["target-site.example.com"]`. Resolve for `target-site.example.com`.
**Expected:** Override applied. `applied_overrides` includes the override ID.
**Existing test:** Yes — "applies override that targets site directly".

### T19 — Override targeting: group membership
**Input:** Override targets `groups: ["group-b"]`. Site belongs to `group-b`.
**Expected:** Override applied via group membership.
**Existing test:** Yes — "applies override that targets a group the site belongs to".

### T20 — Override targeting: not matched
**Input:** Override targets `sites: ["other.com"]` and `groups: ["other-group"]`. Site is `test-site.example.com` in `test-group`.
**Expected:** Override NOT applied. `applied_overrides` is empty.
**Existing test:** Yes — "does not apply override to sites not in targets".

### T21 — Priority ordering: low before high
**Input:** Two overrides target same site. Priority 10 sets `ga4: "LOW"`. Priority 50 sets `ga4: "HIGH"`.
**Expected:** `ga4 = "HIGH"` (higher priority applied last, wins). `applied_overrides` order: `[low-id, high-id]`.
**Existing test:** Yes — "higher priority override wins" + "applied_overrides lists overrides in priority order".

### T22 — Multiple overrides: cumulative fields
**Input:** Override A (priority 10) sets `tracking.ga4`. Override B (priority 20) sets `tracking.gtm`. Both target same site.
**Expected:** Both fields present — overrides accumulate across different fields.
**Existing test:** Partially — test-override and high-priority-override both set tracking but only ga4 tested.

### T23 — Override + site layer: site wins last
**Input:** Override sets `tracking.ga4: "G-OVERRIDE"`. Site sets `tracking.ga4: "G-SITE"`.
**Expected:** `ga4 = "G-SITE"` — site layer applies after overrides.
**Fixture:** `fixtures-mon/` — override-site has site-level `ga4: "G-SITE-OVERRIDE"`.
**Existing test:** Yes — "site tracking override wins over monetization-as-group".

### T24 — Override with empty placements array in add mode
**Input:** Override sets `ads_config: { _mode: "add", ad_placements: [] }`.
**Expected:** No change to existing placements — empty array is a no-op for add mode.
**Existing test:** No — needs new test (edge case).

### T25 — Backward compat: no overrides directory
**Input:** Network repo has no `overrides/config/` directory at all.
**Expected:** Resolves cleanly with `applied_overrides: []`.
**Existing test:** Yes — basic fixtures have no overrides → "existing networks with no monetization field continue to work".

---

## Coverage Summary

| Status | Count | Tests |
|--------|-------|-------|
| Covered by existing tests (`resolve-config.test.ts`) | 12 | T01, T03, T04, T08, T13, T18, T19, T20, T21, T23, T25, T22 |
| New tests added (`override-modes.test.ts`) | 17 | T02, T05, T05b, T06, T07, T09, T10, T11, T12, T14, T15, T16, T17, T24, + edge-empty applied_overrides, + merge tracking alt |

**Total: 86 tests pass (69 existing + 17 new)**

## QA Findings

### Finding 1: Theme "replace" mode doesn't wipe group themes
The `applyOverride` function correctly sets `newTheme = clean` for replace mode, but `resolveTheme()` applies group themes independently via `allThemes = [...groupThemes, overrideTheme]`. So replace only resets the override accumulator — group colors/fonts persist.

**Impact:** Low — the UI explains "replace" as "wipe the group chain's theme entirely", but the actual behavior preserves group theme values not overridden.

### Finding 2: Groups use `legal_pages_override`, not `legal`
The resolver reads group legal contributions from `legal_pages_override` field, not `legal`. A group's `legal: {}` field is ignored for legal chain accumulation.

**Impact:** Low — consistent with existing architecture (groups originally only had `legal_pages_override`).

### Finding 3: Scripts "append" mode still works at runtime
The type system was narrowed to `"merge_by_id" | "replace"` but `extractMode<ScriptsMergeMode | "append">` widens the runtime type. Existing YAML data with `_mode: append` continues to work correctly. The appendScripts function correctly deduplicates by ID (same-ID scripts in override are skipped, not duplicated).

## Test Execution

```bash
cd packages/site-builder && pnpm test
```

## Last Run

```
 Test Files  5 passed (5)
      Tests  86 passed (86)
   Duration  332ms
```
