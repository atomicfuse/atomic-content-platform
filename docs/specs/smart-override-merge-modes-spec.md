# Smart Override System — Per-Field Merge Mode

**Status:** Design revision for the FINAL spec override behavior
**Replaces:** "Override = top-level field REPLACEMENT" rule from FINAL-architecture-spec.md

---

## The Problem With Pure REPLACE

After working through real ops scenarios, pure REPLACE has four critical failure modes:

1. **"Forgot to include" trap** — Override changes one color, loses fonts/logo/other colors
2. **"Missing var" trap** — Override redefines scripts_vars, group scripts break with unresolved placeholders
3. **"Ads.txt wipeout"** — Override adds test entry, production entries gone, revenue impacted
4. **"Tracking loss"** — Override changes one tracking ID, other IDs disappear, attribution broken

The core issue: override authors almost always want to **change or add** to the group chain, not **replace** it. Pure REPLACE forces them to always specify the full block, which is error-prone.

## The New Design

An override declares **per-field merge mode**. The author's intent is explicit, the defaults are safe.

### The `_mode` directive

Inside any override field, you can add a special `_mode` key that declares how that field should combine with the group chain:

```yaml
override_id: my-override
name: "..."
priority: 10
targets:
  sites: [coolnews-atl]

tracking:
  _mode: merge               # Default if not specified. Deep merge with group chain.
  ga4: "G-TEST123"           # Only ga4 overridden, other tracking IDs inherited

ads_config:
  _mode: replace             # Explicitly replace the entire ads_config
  interstitial: false
  layout: standard
  ad_placements: [...]

ads_txt:
  _mode: add                 # Additive — these entries ADDED to group chain entries
  _values:
    - "taboola-test.com, pub-TEST, DIRECT"

scripts:
  _mode: merge_by_id         # Default for scripts. Merge by id, like group chain.
  body_end:
    - id: test-pixel         # Added (new id)
      src: "/test.js"
    - id: mock-ad-fill       # Replaces existing mock-ad-fill entry
      src: "/v2/mock-ad-fill.js"
```

### Available modes per field type

| Field | Default mode | Available modes | Notes |
|---|---|---|---|
| `tracking` | `merge` | `merge`, `replace` | merge = deep merge, only specified keys change |
| `scripts` | `merge_by_id` | `merge_by_id`, `replace`, `append` | merge_by_id = like group scripts. append = just add new entries. |
| `scripts_vars` | `merge` | `merge`, `replace` | merge = shallow merge, keys combined |
| `ads_config` | `replace` | `replace`, `merge_placements` | merge_placements = add/replace individual placements by id |
| `ads_txt` | `add` | `add`, `replace` | add = additive (default for ads.txt). replace = dangerous, rarely used. |
| `theme` | `merge` | `merge`, `replace` | merge = deep merge colors/fonts, safer |
| `legal` | `merge` | `merge`, `replace` | merge = shallow merge keys |
| `ad_placeholder_heights` | `merge` | `merge`, `replace` | merge = per-position values |

### Why these defaults?

- **`tracking: merge`** — You rarely want to nuke all tracking. Override one ID, keep the rest.
- **`scripts: merge_by_id`** — Same as groups. Add new scripts, replace specific ones by id.
- **`scripts_vars: merge`** — Add a var for the override's scripts without breaking other scripts that need existing vars.
- **`ads_config: replace`** — Ad layouts are complete sets. If you're defining ad_placements, you mean the new layout.
- **`ads_txt: add`** — Additive is the only safe default. Revenue-critical.
- **`theme: merge`** — Change a color without losing fonts/logo.
- **`legal: merge`** — Add a key without losing others.

### The new `merge_placements` mode for ads_config

When you want to add/modify specific ad placements without replacing the whole layout:

```yaml
ads_config:
  _mode: merge_placements
  ad_placements:
    # Replace existing placement by id
    - id: "top-banner"
      position: above-content
      sizes:
        desktop: [[970, 250]]    # Changed from 728x90
      device: all
    # Add new placement (id doesn't exist in group chain)
    - id: "new-mid-banner"
      position: after-paragraph-5
      sizes:
        desktop: [[300, 250]]
      device: all
```

**Behavior:**
- Existing placements in the group chain are kept
- If an override placement has the same `id` as a group placement, the override's version replaces that one entry
- If an override placement has a new `id`, it's appended to the list
- If you want to REMOVE a placement, you'd need `_mode: replace` and re-list all the ones you want to keep

### The `add` mode for ads_txt

```yaml
ads_txt:
  _mode: add
  _values:
    - "taboola-test.com, pub-TEST, DIRECT"
    - "experiment.com, 99999, RESELLER"
```

**Behavior:** These entries are ADDED to whatever the group chain produces, deduplicated.

Alternative for `ads_txt` when `_mode` is omitted (default is `add`):

```yaml
ads_txt:
  - "taboola-test.com, pub-TEST, DIRECT"
  - "experiment.com, 99999, RESELLER"
```

When the top-level value is an array and no `_mode` is specified, treat it as `add` (the safe default).

### The `_mode: merge` for tracking (worked example)

```yaml
# Group chain resolved:
tracking:
  ga4: "G-TABOOLA"
  gtm: "GTM-ABC"
  google_ads: "AW-XYZ"
  facebook_pixel: null
  custom: []

# Override:
tracking:
  _mode: merge               # Default, shown for clarity
  ga4: "G-TESTDEMO000"       # Only this changes
  # Everything else inherited

# Result:
tracking:
  ga4: "G-TESTDEMO000"       # ← from override
  gtm: "GTM-ABC"             # ← inherited
  google_ads: "AW-XYZ"       # ← inherited
  facebook_pixel: null       # ← inherited
  custom: []                 # ← inherited
```

Much safer than the current behavior where everything except ga4 would be lost.

### When to use `_mode: replace`

Only use replace when you genuinely mean "throw away the previous value entirely":

```yaml
# Totally different ad layout for a specific test
ads_config:
  _mode: replace
  interstitial: false
  layout: standard
  ad_placements:
    - id: "test-only"
      position: above-content
      sizes: { desktop: [[728, 90]] }
      device: all
```

Replace is explicit — you're saying "I know this wipes the chain, that's what I want."

### Multiple overrides with different modes

When multiple overrides target the same site, each applies in priority order, each respecting its own `_mode` per field.

```yaml
# Override A (priority 10):
tracking:
  _mode: merge
  ga4: "G-A"

# Override B (priority 20):
tracking:
  _mode: merge
  facebook_pixel: "FB-B"

# Result after both applied (merged on top of group chain):
tracking:
  ga4: "G-A"                 # from override A
  facebook_pixel: "FB-B"     # from override B
  gtm: "..."                 # from group chain (unchanged)
  google_ads: "..."          # from group chain (unchanged)
```

If Override B uses `_mode: replace`:

```yaml
# Override B (priority 20):
tracking:
  _mode: replace
  facebook_pixel: "FB-B"

# Result:
tracking:
  ga4: null                  # wiped by replace
  facebook_pixel: "FB-B"
  gtm: null
  google_ads: null
```

This is correct — B explicitly replaces, wiping A's changes and the group chain.

## Dashboard UX

The dashboard needs to make the merge mode visible and editable.

### In the override editor

Each field section has a mode selector at the top:

```
Tracking                                    [Mode: Merge ▼]
                                            ┌─────────────────┐
                                            │ ✓ Merge (default)│ ← only change what's specified
                                            │   Replace        │ ← wipe group chain, use only these
                                            └─────────────────┘

  GA4:           [ G-TEST123           ]
  GTM:           [ (inherited from group chain: GTM-ABC) ]
  Google Ads:    [ (inherited from group chain: AW-XYZ) ]
  ...
```

**When mode is "Merge":** Fields not set show their inherited value in gray italic, with an "Override" button to take control of that field.

**When mode is "Replace":** All fields shown as editable, warning banner: "Replace mode: group chain values are wiped. You must specify any field you want."

### Warnings

- Switching mode from Merge → Replace: show confirmation "Switching to Replace will wipe the group chain's values for this field. Affected fields: GTM, Google Ads."
- Saving an override with Replace mode on theme/scripts_vars: show warning "Replace mode on theme requires all theme values. Missing values will break the site."

## Implementation

### TypeScript types

```typescript
type MergeMode = 'merge' | 'replace' | 'append' | 'add' | 'merge_by_id' | 'merge_placements';

interface OverrideField<T> {
  _mode?: MergeMode;
  _values?: T;             // Only for array fields when using add/append
  // OR the field data itself for object fields
  [key: string]: unknown;
}

interface OverrideConfig {
  override_id: string;
  name: string;
  priority: number;
  targets: { groups?: string[]; sites?: string[]; };

  tracking?: Partial<TrackingConfig> & { _mode?: 'merge' | 'replace' };
  scripts?: Partial<ScriptsConfig> & { _mode?: 'merge_by_id' | 'replace' | 'append' };
  scripts_vars?: Record<string, string> & { _mode?: 'merge' | 'replace' };
  ads_config?: Partial<AdsConfig> & { _mode?: 'replace' | 'merge_placements' };
  ads_txt?: (string[] & { _mode?: 'add' | 'replace' }) | {
    _mode: 'add' | 'replace';
    _values: string[];
  };
  theme?: DeepPartial<ThemeConfig> & { _mode?: 'merge' | 'replace' };
  legal?: Record<string, string> & { _mode?: 'merge' | 'replace' };
  ad_placeholder_heights?: Partial<PlaceholderHeights> & { _mode?: 'merge' | 'replace' };
}
```

### resolve-config.ts changes

For each override field, check `_mode`:

```typescript
function applyOverrideField<T>(
  fieldName: string,
  currentValue: T,
  overrideValue: T & { _mode?: MergeMode } | undefined,
  defaultMode: MergeMode,
  mergeFn: (a: T, b: Partial<T>) => T
): T {
  if (!overrideValue) return currentValue;

  const mode = overrideValue._mode ?? defaultMode;
  const { _mode, _values, ...rest } = overrideValue;

  switch (mode) {
    case 'replace':
      return rest as T;
    case 'merge':
    case 'merge_by_id':
    case 'merge_placements':
      return mergeFn(currentValue, rest as Partial<T>);
    case 'add':
      if (Array.isArray(currentValue)) {
        const toAdd = _values ?? (rest as unknown as T[]);
        return [...new Set([...currentValue, ...toAdd])] as T;
      }
      throw new Error(`Mode 'add' only valid for array fields, got ${fieldName}`);
    default:
      throw new Error(`Unknown merge mode: ${mode}`);
  }
}
```

### Field-specific merge functions

```typescript
function mergeTracking(current: TrackingConfig, override: Partial<TrackingConfig>): TrackingConfig {
  return { ...current, ...override };  // Shallow merge, override wins keys
}

function mergeScriptsById(current: ScriptsConfig, override: Partial<ScriptsConfig>): ScriptsConfig {
  return {
    head: mergeScriptArrayById(current.head, override.head ?? []),
    body_start: mergeScriptArrayById(current.body_start, override.body_start ?? []),
    body_end: mergeScriptArrayById(current.body_end, override.body_end ?? []),
  };
}

function mergeScriptArrayById(existing: ScriptEntry[], overrides: ScriptEntry[]): ScriptEntry[] {
  const map = new Map(existing.map(s => [s.id, s]));
  for (const entry of overrides) {
    map.set(entry.id, entry);  // Replace if same id, add if new
  }
  return Array.from(map.values());
}

function mergeAdPlacements(current: AdPlacement[], overrides: AdPlacement[]): AdPlacement[] {
  const map = new Map(current.map(p => [p.id, p]));
  for (const placement of overrides) {
    map.set(placement.id, placement);
  }
  return Array.from(map.values());
}
```

## Migration Plan

### Backward compatibility

Existing overrides without `_mode` should behave sensibly. Use the DEFAULTS from the table above:
- `tracking` without `_mode` → `merge` (was: replace, BEHAVIOR CHANGE)
- `scripts` without `_mode` → `merge_by_id` (was: replace, BEHAVIOR CHANGE)
- `ads_config` without `_mode` → `replace` (same as before)
- `ads_txt` without `_mode` → `add` (was: replace, BEHAVIOR CHANGE)
- `theme` without `_mode` → `merge` (was: replace, BEHAVIOR CHANGE)
- `scripts_vars` without `_mode` → `merge` (was: replace, BEHAVIOR CHANGE)
- `legal` without `_mode` → `merge` (was: replace, BEHAVIOR CHANGE)

**Important:** The existing `overrides/config/test-ads-mock.yaml` used replace semantics implicitly. After migration, its behavior changes:
- It defines `ads_config` → still replaces (default for ads_config is replace)
- It defines `scripts` → now merges by id with group chain (BEHAVIOR CHANGE)
- It defines `tracking` → now merges with group chain (BEHAVIOR CHANGE)

**The mock ads test override should be updated** to explicitly declare `_mode: replace` for scripts and tracking if we want the old behavior, OR accept the new behavior (which is actually better — merging means the mock doesn't wipe the real tracking).

### Migration script

Add to Claude Code prompt:

```
For existing overrides, decide per field:
- Does this override INTEND to replace? → add _mode: replace explicitly
- Does this override INTEND to add/merge? → no change needed (new default is merge)

For overrides/config/test-ads-mock.yaml specifically:
- scripts: this is intended to ADD the mock-ad-fill script. Keep as merge_by_id (default).
- tracking: this is intended to OVERRIDE just GA4 for the test. Keep as merge (default).
- ads_config: this is intended to REPLACE the full ad layout. Add _mode: replace.

Update the YAML with explicit _mode where needed.
```

## Complete worked example

**Group chain (entertainment + taboola) resolved:**
```yaml
tracking:
  ga4: "G-TABOOLA"
  gtm: "GTM-ABC"
  google_ads: "AW-XYZ"
  facebook_pixel: null
  custom: []

scripts:
  head:
    - id: gpt-script
      src: "..."
    - id: alpha-init
      inline: "..."
    - id: alpha-loader
      src: "..."
  body_end:
    - id: interstitial-trigger
      inline: "..."

ads_config:
  interstitial: true
  layout: high-density
  ad_placements:
    - id: top-banner
      position: above-content
      sizes: { desktop: [[728, 90]] }
      device: all
    - id: in-content-1
      position: after-paragraph-3
      ...
    # ... 5 total placements

ads_txt:
  - "google.com, pub-XXX, DIRECT, f08c47fec0942fa0"
  - "advertising.com, 28246, DIRECT"
  - "rubiconproject.com, 19116, DIRECT"

theme:
  colors:
    primary: "#E50914"
    secondary: "#16213E"
    accent: "#B81D24"
  fonts:
    heading: "Playfair Display"
    body: "Inter"
  logo: /assets/logo.svg
```

**Override (test-ads-mock) with smart modes:**
```yaml
override_id: test-ads-mock
name: "Test Ads (Mock Demo)"
priority: 100
targets:
  sites: [coolnews-atl]

# tracking: merge mode (default) — only override ga4
tracking:
  ga4: "G-TESTDEMO000"

# scripts: merge_by_id (default) — add mock-ad-fill without removing others
scripts:
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"

# ads_config: replace mode (explicit) — mock ads replace real ad layout
ads_config:
  _mode: replace
  interstitial: false
  layout: standard
  ad_placements:
    - id: top-banner
      position: above-content
      sizes: { desktop: [[728, 90]] }
      device: all
    # ... mock placements

# ads_txt: add mode (default) — test partner added to production entries
ads_txt:
  - "test-partner.com, pub-TEST, DIRECT"
```

**Final resolved config:**
```yaml
tracking:
  ga4: "G-TESTDEMO000"         # ← from override (merge)
  gtm: "GTM-ABC"               # ← inherited (merge)
  google_ads: "AW-XYZ"         # ← inherited (merge)
  facebook_pixel: null         # ← inherited
  custom: []                   # ← inherited

scripts:
  head: [gpt-script, alpha-init, alpha-loader]     # ← inherited (merge_by_id, no changes)
  body_end: [interstitial-trigger, mock-ad-fill]   # ← merged by id (both kept)

ads_config:                    # ← REPLACED (explicit replace)
  interstitial: false
  layout: standard
  ad_placements: [...mock placements...]

ads_txt:                       # ← ADDED (default add)
  - "google.com, pub-XXX, DIRECT, f08c47fec0942fa0"
  - "advertising.com, 28246, DIRECT"
  - "rubiconproject.com, 19116, DIRECT"
  - "test-partner.com, pub-TEST, DIRECT"    # ← added

theme: { ...full theme from group... }      # ← unchanged, override didn't touch
```

This is much safer than pure REPLACE:
- Marketing still has GTM and Google Ads conversion tracking
- Ad partner SDKs still load (gpt, alpha-init, alpha-loader)
- Real production ads.txt entries still present
- Only the ad layout is swapped for mock ads

## Implementation phases (for Claude Code)

### Phase 1: Update types
**[atomic-content-platform]** Update `OverrideConfig` interface to support `_mode` on each field. Define `MergeMode` type.

### Phase 2: Rewrite override merge logic
**[atomic-content-platform]** Update `resolve-config.ts`:
- Read `_mode` from each override field
- Use default modes from the table above if _mode not specified
- Implement field-specific merge functions (tracking, scripts, scripts_vars, ads_config, ads_txt, theme, legal, ad_placeholder_heights)
- Each mode has its own logic

### Phase 3: Update existing overrides
**[atomic-labs-network]** Review `overrides/config/test-ads-mock.yaml`:
- Add `_mode: replace` to `ads_config`
- tracking stays default (merge) — now only ga4 changes
- scripts stays default (merge_by_id) — mock-ad-fill added, others kept

### Phase 4: Update dashboard
**[atomic-content-platform]** In the override editor:
- Add mode selector (dropdown) at the top of each field section
- Show inherited values when mode is merge
- Warning banners when switching to replace
- Confirmation dialog on save if replace mode is set

### Phase 5: Unit tests
Update all override tests to cover:
- Default modes per field
- Explicit replace
- Merge mode for tracking, theme, scripts_vars, legal
- merge_by_id for scripts (add new + replace by id)
- merge_placements for ad_placements
- add mode for ads_txt
- Multiple overrides with different modes
- Priority ordering with mixed modes

### Phase 6: Documentation
Update the in-app guide at `services/dashboard/public/guide/` with a new page explaining merge modes.

## QA

### Test 1: tracking merge (default)
Override defines `tracking: { ga4: "NEW" }`. Result: gtm and google_ads inherited.

### Test 2: tracking replace
Override defines `tracking: { _mode: replace, ga4: "NEW" }`. Result: only ga4, other tracking null.

### Test 3: scripts merge_by_id
Group has [gpt, alpha-init]. Override has [mock-fill]. Result: [gpt, alpha-init, mock-fill].

### Test 4: scripts merge_by_id with same id
Group has [mock-fill v1]. Override has [mock-fill v2]. Result: [mock-fill v2].

### Test 5: ads_config replace
Override defines `ads_config: { _mode: replace, ad_placements: [...1 item] }`. Result: 1 placement only.

### Test 6: ads_config merge_placements
Group has 5 placements. Override has 1 with same id as existing. Result: 5 placements, one updated.

### Test 7: ads_txt add
Group ads_txt has 3 entries. Override adds 1. Result: 4 entries.

### Test 8: ads_txt replace
Override defines `ads_txt: { _mode: replace, _values: ["only-one"] }`. Result: 1 entry.

### Test 9: theme merge
Override defines `theme: { colors: { primary: "red" } }`. Result: primary replaced, other colors/fonts/logo inherited.

### Test 10: Mock ads demo still works
After migration, test-ads-mock override on coolnews-atl:
- Mock ads still visible (ads_config replaced)
- mock-ad-fill.js loads (scripts merged)
- Debug panel shows override active
- Real tracking (gtm, google_ads) still works in background
- ads.txt still has real entries
