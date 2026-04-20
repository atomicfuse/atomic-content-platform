# Spec: Ad Placement Size Controls — Ratio + Range System

**Date:** 2026-04-20  
**Author:** Michal  
**Component:** `AdPlacementsEditor` (and sub-components)  
**Scope:** Replace free-text "Desktop Sizes" and "Mobile Sizes" inputs with structured ratio/range/custom-size controls.

---

## 1. Problem

The current ad placement editor uses plain text inputs for desktop and mobile sizes (e.g., `"728x90, 970x90"`). This is error-prone, hard to validate, and gives no guardrails to the user. We need a structured UI that generates valid size configurations while remaining flexible.

## 2. Goal

Replace each free-text size input with a structured panel containing:

1. **Aspect Ratio** — X:Y ratio selector (default 16:9)
2. **Size Range** — min/max width and min/max height number inputs
3. **Custom Size** — explicit width × height for fixed-size ad slots

The output format (the data that gets saved/rendered) must remain backward-compatible with the existing size array format so that `ad-loader.js` and the Astro build pipeline continue to work without changes.

## 3. UI Layout

Each placement card currently shows:

```
| ID | POSITION | DEVICE |
| DESKTOP SIZES (text input) | MOBILE SIZES (text input) |
```

**New layout** — replace the bottom row with two side-by-side panels:

```
┌─────────────────────────────────┬─────────────────────────────────┐
│ Desktop Sizes                   │ Mobile Sizes                    │
│                                 │                                 │
│ Ratio: [ X ] : [ Y ]           │ Ratio: [ X ] : [ Y ]           │
│        (default 16:9)           │        (default 16:9)           │
│                                 │                                 │
│ Min Width:  [____]              │ Min Width:  [____]              │
│ Max Width:  [____] (≥ min)      │ Max Width:  [____] (≥ min)      │
│ Min Height: [____]              │ Min Height: [____]              │
│ Max Height: [____] (≥ min)      │ Max Height: [____] (≥ min)      │
│                                 │                                 │
│ ── Custom Size ──               │ ── Custom Size ──               │
│ Width:  [____]                  │ Width:  [____]                  │
│ Height: [____]                  │ Height: [____]                  │
│ [+ Add Custom Size]             │ [+ Add Custom Size]             │
│                                 │                                 │
│ Rendered sizes:                 │ Rendered sizes:                 │
│ 728x90, 970x90                  │ 320x50, 300x250                │
└─────────────────────────────────┴─────────────────────────────────┘
*explain and present the explation what happens when the use put more the one size in the custom sizes

```

## 4. Data Model

### 4.1 Per-Device Size Config (new internal model)

```typescript
interface AdSizeConfig {
  ratio: {
    x: number;  // default 16
    y: number;  // default 9
  };
  range: {
    minWidth: number | null;
    maxWidth: number | null;   // must be >= minWidth when both set
    minHeight: number | null;
    maxHeight: number | null;  // must be >= minHeight when both set
  };
  customSizes: Array<{ width: number; height: number }>;
}
```

### 4.2 Placement Model (updated)

```typescript
interface AdPlacement {
  id: string;
  position: string;
  device: 'All Devices' | 'Desktop' | 'Mobile';
  desktopSizeConfig: AdSizeConfig;
  mobileSizeConfig: AdSizeConfig;
  // Legacy output — computed from config above
  desktopSizes: string;   // e.g. "728x90, 970x90"
  mobileSizes: string;    // e.g. "320x50, 300x250"
  // Sticky-specific
  allowDismiss?: boolean;
}
```

### 4.3 Output Format (backward-compatible)

The `desktopSizes` and `mobileSizes` string fields are **computed** from the config at save time. They remain the format consumed by the YAML config, `ad-loader.js`, and the Astro build.

**Computation logic:**

```
renderedSizes = customSizes.map(s => `${s.width}x${s.height}`)
```

The ratio and range fields are **stored alongside** for the UI to reconstruct the form state, but the sizes string is what gets written to YAML and used at runtime.

> **Key principle:** The ratio + range fields are editorial guidance / UI state. The `customSizes` array (and its rendered string) is the source of truth for ad serving.

## 5. Validation Rules

| Field | Rule |
|---|---|
| Ratio X, Y | Positive integers, min 1 |
| Max Width | Must be ≥ Min Width (when both are set) |
| Max Height | Must be ≥ Min Height (when both are set) |
| Custom Size width | Positive integer, min 1 |
| Custom Size height | Positive integer, min 1 |
| Custom Sizes list | At least 1 custom size required per device if the device is targeted |

Show inline validation errors below the relevant input. Do not allow save when validation fails.

## 6. Behavior Details

1. **Ratio fields** — Two small number inputs side by side with `:` separator. Changing X or Y does NOT auto-generate sizes. It's a reference/guide for the user.

2. **Range fields** — Four number inputs. Max Width's minimum value dynamically equals Min Width's current value (and same for heights). These are informational constraints the user sets to guide their custom size choices.

3. **Custom Sizes** — Each custom size is a row with width + height inputs and a delete (×) button. The `[+ Add Custom Size]` button appends a new empty row. At least one custom size is needed.

4. **Rendered sizes preview** — Below the custom sizes, show a read-only preview of the computed size string (e.g., `"728x90, 970x90"`). This updates live as custom sizes are added/edited/removed.

5. **Device targeting** — If `device` is "Desktop", the Mobile panel is disabled/grayed. If "Mobile", Desktop is disabled. If "All Devices", both panels are active.

6. **Migration of existing data** — When loading a placement that has the old free-text format (just `desktopSizes: "728x90, 970x90"`), parse the string into `customSizes` array. Leave ratio as default 16:9, leave range fields empty. This ensures backward compat.

## 7. Files to Modify

Based on the project structure (`atomic-content-platform` monorepo):

| File | Change |
|---|---|
| `AdPlacementsEditor.tsx` | Replace free-text size inputs with new `SizeConfigPanel` sub-component |
| **NEW** `SizeConfigPanel.tsx` | The ratio + range + custom sizes panel (reused for desktop & mobile) |
| Placement type definitions | Add `AdSizeConfig` interface, update `AdPlacement` |
| Config resolver / YAML writer | Ensure `desktopSizes` and `mobileSizes` strings are computed from config before write |
| `PlacementPreview.tsx` | No change needed — it already reads the size strings |
| `ad-loader.js` | **No change** — it reads the final size strings |
| Astro build pipeline | **No change** — it reads the final size strings |

## 8. What MUST NOT Break

- The YAML output format for sizes (string of `WxH, WxH`)
- `ad-loader.js` runtime behavior
- `PlacementPreview.tsx` visual preview
- Astro build pipeline reading placement configs
- Any existing placement data — must migrate gracefully
- Other placement fields (ID, position, device, allowDismiss)

## 9. Acceptance Criteria

- [ ] Each placement shows Desktop Sizes and Mobile Sizes panels side-by-side
- [ ] Ratio defaults to 16:9, both X and Y are editable
- [ ] Range fields enforce min ≤ max validation
- [ ] Custom sizes can be added, edited, removed
- [ ] Rendered sizes preview updates live
- [ ] Device targeting disables the irrelevant panel
- [ ] Existing placements load correctly (migration from string format)
- [ ] Saved output produces correct `WxH` size strings
- [ ] PlacementPreview still renders correctly
- [ ] No regressions in ad-loader.js or Astro build
