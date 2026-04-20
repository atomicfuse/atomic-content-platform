# Ad Placement Size Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-text Desktop/Mobile Sizes inputs in the ad placement editor with structured panels containing aspect ratio, size range, and custom sizes with live preview.

**Architecture:** A new `AdSizeConfig` interface holds editing state (ratio, range, customSizes). A reusable `SizeConfigPanel` component renders the structured UI. The existing `sizes: { desktop: number[][], mobile: number[][] }` field stays as the computed output — kept in sync by converting `customSizes` to tuples on each edit. Migration from old format (number tuples only) to new format (with config) happens in the config normalizer. New config fields are persisted to YAML alongside `sizes` so the form state survives round-trips. Downstream consumers (`PlacementPreview`, `ad-loader.js`, `resolve-config.ts`) read `sizes` and ignore the new fields — zero breakage.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS v4, Vitest (new for dashboard)

**Spec:** `docs/superpowers/specs/ad-placement-size-controls-spec.md`

### Spec Deviations

1. **Field format:** The spec defines `desktopSizes`/`mobileSizes` as `"WxH, WxH"` string fields. The existing codebase uses `sizes: { desktop: number[][], mobile: number[][] }` everywhere (AdsConfigForm, PlacementPreview, resolve-config, ad-loader). We keep the existing `sizes` format to avoid breaking downstream consumers. The "WxH" string is only used for display in the rendered-sizes preview.
2. **YAML persistence of UI state:** `desktopSizeConfig` and `mobileSizeConfig` are written to YAML alongside `sizes`. This is intentional per spec section 4.3 ("stored alongside for the UI to reconstruct form state"). The site-builder's `normaliseAdPlacements()` constructs output explicitly with only known fields, so these extra fields are harmlessly ignored.
3. **PlacementPreview import coupling:** `PlacementPreview.tsx` imports `AdPlacement` from `AdsConfigForm.tsx`. Adding optional `desktopSizeConfig`/`mobileSizeConfig` fields is safe — the component only accesses `sizes`, `id`, `position`, `device`, and `dismissible`. No changes needed to PlacementPreview.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `services/dashboard/vitest.config.ts` | Create | Minimal vitest config for dashboard unit tests |
| `services/dashboard/package.json` | Modify | Add vitest devDep + `test` / `test:watch` scripts |
| `services/dashboard/src/components/settings/ad-size-config.ts` | Create | `AdSizeConfig` + `SizeConfigErrors` types; pure functions: `createDefaultSizeConfig`, `sizeTuplesToConfig`, `configToSizeTuples`, `formatConfigSizes`, `validateSizeConfig`, `hasErrors`, `validatePlacementConfigs` |
| `services/dashboard/src/components/settings/__tests__/ad-size-config.test.ts` | Create | Unit tests for all pure functions above |
| `services/dashboard/src/components/settings/SizeConfigPanel.tsx` | Create | Reusable panel: ratio inputs, range inputs (2×2 grid), custom sizes list (add/remove), live rendered-sizes preview, inline validation errors, disabled state |
| `services/dashboard/src/components/settings/AdsConfigForm.tsx` | Modify | Add `desktopSizeConfig?` / `mobileSizeConfig?` to `AdPlacement`; replace text inputs (lines 270-299) with `<SizeConfigPanel>`; update `addPlacement` to include default configs; remove unused `updateSizes`, `formatSizes`, `parseSizes`; export `validatePlacementConfigs` for parent save gating |
| `services/dashboard/src/lib/config-normalizers.ts` | Modify | In `normalizeAdsConfig`, hydrate `desktopSizeConfig` / `mobileSizeConfig` from YAML or migrate from `sizes` |

**Files NOT modified** (per spec constraints):
- `components/shared/PlacementPreview.tsx` — reads `sizes` which we keep computed ✓
- `ad-loader.js` — reads final sizes from built site ✓
- Astro templates, `resolve-config.ts`, `resolve-monetization.ts` ✓
- `/api/sites/save/route.ts` — auto-stringifies all fields to YAML ✓
- `packages/shared-types/src/ads.ts` — local interface extensions only ✓

---

## Task 1: Set Up Dashboard Test Infrastructure

**Files:**
- Create: `services/dashboard/vitest.config.ts`
- Modify: `services/dashboard/package.json`

- [ ] **Step 1: Add vitest dev dependency**

Run:
```bash
cd services/dashboard && pnpm add -D vitest
```

- [ ] **Step 2: Create vitest.config.ts**

Create `services/dashboard/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 3: Add test scripts to package.json**

Add to `services/dashboard/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify setup works**

Run:
```bash
cd services/dashboard && pnpm test
```
Expected: exits cleanly with "No test files found" or similar — confirms vitest infra works.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/vitest.config.ts services/dashboard/package.json pnpm-lock.yaml
git commit -m "chore(dashboard): add vitest test infrastructure"
```

---

## Task 2: Create Types and Pure Functions (TDD)

**Files:**
- Create: `services/dashboard/src/components/settings/ad-size-config.ts`
- Create: `services/dashboard/src/components/settings/__tests__/ad-size-config.test.ts`

- [ ] **Step 1: Write the full test file**

Create `services/dashboard/src/components/settings/__tests__/ad-size-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createDefaultSizeConfig,
  sizeTuplesToConfig,
  configToSizeTuples,
  formatConfigSizes,
  validateSizeConfig,
  validatePlacementConfigs,
  hasErrors,
} from "../ad-size-config";

describe("createDefaultSizeConfig", () => {
  it("returns 16:9 ratio, null ranges, empty customSizes", () => {
    const config = createDefaultSizeConfig();
    expect(config.ratio).toEqual({ x: 16, y: 9 });
    expect(config.range).toEqual({
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
    });
    expect(config.customSizes).toEqual([]);
  });
});

describe("sizeTuplesToConfig", () => {
  it("converts number[][] to AdSizeConfig with default ratio and empty range", () => {
    const config = sizeTuplesToConfig([
      [728, 90],
      [970, 250],
    ]);
    expect(config.ratio).toEqual({ x: 16, y: 9 });
    expect(config.range).toEqual({
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
    });
    expect(config.customSizes).toEqual([
      { width: 728, height: 90 },
      { width: 970, height: 250 },
    ]);
  });

  it("returns default config for undefined input", () => {
    const config = sizeTuplesToConfig(undefined);
    expect(config.customSizes).toEqual([]);
    expect(config.ratio).toEqual({ x: 16, y: 9 });
  });

  it("returns default config for empty array", () => {
    const config = sizeTuplesToConfig([]);
    expect(config.customSizes).toEqual([]);
  });
});

describe("configToSizeTuples", () => {
  it("converts customSizes to number[][]", () => {
    const config = sizeTuplesToConfig([
      [728, 90],
      [300, 250],
    ]);
    expect(configToSizeTuples(config)).toEqual([
      [728, 90],
      [300, 250],
    ]);
  });

  it("filters out zero-width entries", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [
      { width: 728, height: 90 },
      { width: 0, height: 50 },
    ];
    expect(configToSizeTuples(config)).toEqual([[728, 90]]);
  });

  it("filters out zero-height entries", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [
      { width: 728, height: 0 },
      { width: 300, height: 250 },
    ];
    expect(configToSizeTuples(config)).toEqual([[300, 250]]);
  });

  it("returns empty array for empty customSizes", () => {
    expect(configToSizeTuples(createDefaultSizeConfig())).toEqual([]);
  });
});

describe("formatConfigSizes", () => {
  it("formats customSizes as 'WxH, WxH' string", () => {
    const config = sizeTuplesToConfig([
      [728, 90],
      [970, 250],
    ]);
    expect(formatConfigSizes(config)).toBe("728x90, 970x250");
  });

  it("returns empty string for no valid sizes", () => {
    expect(formatConfigSizes(createDefaultSizeConfig())).toBe("");
  });

  it("skips zero-dimension entries", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [
      { width: 728, height: 90 },
      { width: 0, height: 0 },
    ];
    expect(formatConfigSizes(config)).toBe("728x90");
  });

  it("handles single size", () => {
    const config = sizeTuplesToConfig([[320, 50]]);
    expect(formatConfigSizes(config)).toBe("320x50");
  });
});

describe("validateSizeConfig", () => {
  it("returns empty errors for valid config with sizes", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    const errors = validateSizeConfig(config);
    expect(hasErrors(errors)).toBe(false);
  });

  it("errors when maxWidth < minWidth", () => {
    const config = sizeTuplesToConfig([[400, 200]]);
    config.range.minWidth = 500;
    config.range.maxWidth = 300;
    const errors = validateSizeConfig(config);
    expect(errors.rangeWidth).toBe("Max Width must be ≥ Min Width");
    expect(hasErrors(errors)).toBe(true);
  });

  it("errors when maxHeight < minHeight", () => {
    const config = sizeTuplesToConfig([[400, 200]]);
    config.range.minHeight = 500;
    config.range.maxHeight = 200;
    const errors = validateSizeConfig(config);
    expect(errors.rangeHeight).toBe("Max Height must be ≥ Min Height");
    expect(hasErrors(errors)).toBe(true);
  });

  it("errors when no valid custom sizes exist", () => {
    const config = createDefaultSizeConfig();
    const errors = validateSizeConfig(config);
    expect(errors.customSizes).toBe("At least one custom size is required");
    expect(hasErrors(errors)).toBe(true);
  });

  it("errors when only zero-dimension sizes exist", () => {
    const config = createDefaultSizeConfig();
    config.customSizes = [{ width: 0, height: 0 }];
    const errors = validateSizeConfig(config);
    expect(errors.customSizes).toBe("At least one custom size is required");
  });

  it("no range error when only one bound is set", () => {
    const config = sizeTuplesToConfig([[600, 300]]);
    config.range.minWidth = 500;
    // maxWidth is null — no error
    const errors = validateSizeConfig(config);
    expect(errors.rangeWidth).toBeUndefined();
  });

  it("no range error when max equals min", () => {
    const config = sizeTuplesToConfig([[500, 300]]);
    config.range.minWidth = 500;
    config.range.maxWidth = 500;
    const errors = validateSizeConfig(config);
    expect(errors.rangeWidth).toBeUndefined();
  });

  it("errors when ratio x < 1", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    config.ratio.x = 0;
    const errors = validateSizeConfig(config);
    expect(errors.ratio).toBe("Ratio values must be positive integers (≥ 1)");
  });

  it("errors when ratio y < 1", () => {
    const config = sizeTuplesToConfig([[728, 90]]);
    config.ratio.y = -1;
    const errors = validateSizeConfig(config);
    expect(errors.ratio).toBeDefined();
  });

  it("can have multiple errors simultaneously", () => {
    const config = createDefaultSizeConfig();
    config.range.minWidth = 800;
    config.range.maxWidth = 400;
    config.range.minHeight = 600;
    config.range.maxHeight = 200;
    // No custom sizes either
    const errors = validateSizeConfig(config);
    expect(errors.rangeWidth).toBeDefined();
    expect(errors.rangeHeight).toBeDefined();
    expect(errors.customSizes).toBeDefined();
  });
});

describe("validatePlacementConfigs", () => {
  it("returns true for valid placements", () => {
    const valid = validatePlacementConfigs([
      {
        device: "all",
        desktopSizeConfig: sizeTuplesToConfig([[728, 90]]),
        mobileSizeConfig: sizeTuplesToConfig([[320, 50]]),
      },
    ]);
    expect(valid).toBe(true);
  });

  it("returns false when active desktop panel has no custom sizes", () => {
    const valid = validatePlacementConfigs([
      {
        device: "all",
        desktopSizeConfig: createDefaultSizeConfig(), // no custom sizes
        mobileSizeConfig: sizeTuplesToConfig([[320, 50]]),
      },
    ]);
    expect(valid).toBe(false);
  });

  it("ignores disabled desktop panel (device=mobile)", () => {
    const valid = validatePlacementConfigs([
      {
        device: "mobile",
        desktopSizeConfig: createDefaultSizeConfig(), // invalid but disabled
        mobileSizeConfig: sizeTuplesToConfig([[320, 50]]),
      },
    ]);
    expect(valid).toBe(true);
  });

  it("ignores disabled mobile panel (device=desktop)", () => {
    const valid = validatePlacementConfigs([
      {
        device: "desktop",
        desktopSizeConfig: sizeTuplesToConfig([[728, 90]]),
        mobileSizeConfig: createDefaultSizeConfig(), // invalid but disabled
      },
    ]);
    expect(valid).toBe(true);
  });
});

describe("round-trip: sizeTuplesToConfig → configToSizeTuples", () => {
  it("preserves data through round-trip", () => {
    const original = [
      [728, 90],
      [970, 250],
      [300, 600],
    ];
    const config = sizeTuplesToConfig(original);
    const result = configToSizeTuples(config);
    expect(result).toEqual(original);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd services/dashboard && pnpm test
```
Expected: FAIL — module `../ad-size-config` not found.

- [ ] **Step 3: Create ad-size-config.ts with all functions**

Create `services/dashboard/src/components/settings/ad-size-config.ts`:

```typescript
/** Per-device size configuration for the structured ad placement editor. */
export interface AdSizeConfig {
  ratio: { x: number; y: number };
  range: {
    minWidth: number | null;
    maxWidth: number | null;
    minHeight: number | null;
    maxHeight: number | null;
  };
  customSizes: Array<{ width: number; height: number }>;
}

/** Validation errors for a single size config panel. */
export interface SizeConfigErrors {
  ratio?: string;
  rangeWidth?: string;
  rangeHeight?: string;
  customSizes?: string;
}

/** Create a default empty AdSizeConfig (16:9 ratio, no range, no custom sizes). */
export function createDefaultSizeConfig(): AdSizeConfig {
  return {
    ratio: { x: 16, y: 9 },
    range: {
      minWidth: null,
      maxWidth: null,
      minHeight: null,
      maxHeight: null,
    },
    customSizes: [],
  };
}

/** Migrate old number[][] size tuples to AdSizeConfig. Defaults: 16:9 ratio, empty range. */
export function sizeTuplesToConfig(
  sizes: number[][] | undefined,
): AdSizeConfig {
  const config = createDefaultSizeConfig();
  if (!sizes || sizes.length === 0) return config;
  config.customSizes = sizes.map(([w, h]) => ({ width: w, height: h }));
  return config;
}

/** Compute number[][] from AdSizeConfig's customSizes (filters out incomplete entries). */
export function configToSizeTuples(config: AdSizeConfig): number[][] {
  return config.customSizes
    .filter((s) => s.width > 0 && s.height > 0)
    .map((s) => [s.width, s.height]);
}

/** Format customSizes as display string "WxH, WxH". */
export function formatConfigSizes(config: AdSizeConfig): string {
  return config.customSizes
    .filter((s) => s.width > 0 && s.height > 0)
    .map((s) => `${s.width}x${s.height}`)
    .join(", ");
}

/** Validate a size config. Returns object with error messages for invalid fields. Empty = valid. */
export function validateSizeConfig(config: AdSizeConfig): SizeConfigErrors {
  const errors: SizeConfigErrors = {};

  if (config.ratio.x < 1 || config.ratio.y < 1) {
    errors.ratio = "Ratio values must be positive integers (≥ 1)";
  }

  const { minWidth, maxWidth, minHeight, maxHeight } = config.range;

  if (
    minWidth !== null &&
    maxWidth !== null &&
    maxWidth < minWidth
  ) {
    errors.rangeWidth = "Max Width must be ≥ Min Width";
  }
  if (
    minHeight !== null &&
    maxHeight !== null &&
    maxHeight < minHeight
  ) {
    errors.rangeHeight = "Max Height must be ≥ Min Height";
  }

  const validSizes = config.customSizes.filter(
    (s) => s.width > 0 && s.height > 0,
  );
  if (validSizes.length === 0) {
    errors.customSizes = "At least one custom size is required";
  }

  return errors;
}

/** Check whether a SizeConfigErrors object contains any errors. */
export function hasErrors(errors: SizeConfigErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Validate all placement configs. Returns true if ALL active panels are valid. */
export function validatePlacementConfigs(
  placements: Array<{
    device: "all" | "desktop" | "mobile";
    desktopSizeConfig?: AdSizeConfig;
    mobileSizeConfig?: AdSizeConfig;
  }>,
): boolean {
  for (const p of placements) {
    if (p.device !== "mobile" && p.desktopSizeConfig) {
      if (hasErrors(validateSizeConfig(p.desktopSizeConfig))) return false;
    }
    if (p.device !== "desktop" && p.mobileSizeConfig) {
      if (hasErrors(validateSizeConfig(p.mobileSizeConfig))) return false;
    }
  }
  return true;
}
```

- [ ] **Step 4: Run tests to verify they all pass**

Run:
```bash
cd services/dashboard && pnpm test
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/components/settings/ad-size-config.ts services/dashboard/src/components/settings/__tests__/ad-size-config.test.ts
git commit -m "feat(dashboard): add AdSizeConfig types and pure functions with tests"
```

---

## Task 3: Create SizeConfigPanel Component

**Files:**
- Create: `services/dashboard/src/components/settings/SizeConfigPanel.tsx`

- [ ] **Step 1: Create SizeConfigPanel.tsx**

Create `services/dashboard/src/components/settings/SizeConfigPanel.tsx`:

```tsx
"use client";

import type React from "react";
import type { AdSizeConfig } from "./ad-size-config";
import { formatConfigSizes, validateSizeConfig } from "./ad-size-config";

interface SizeConfigPanelProps {
  label: string;
  config: AdSizeConfig;
  onChange: (config: AdSizeConfig) => void;
  disabled?: boolean;
}

const INPUT_CLS =
  "w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

export function SizeConfigPanel({
  label,
  config,
  onChange,
  disabled = false,
}: SizeConfigPanelProps): React.ReactElement {
  const errors = validateSizeConfig(config);
  const preview = formatConfigSizes(config);

  function updateRatio(field: "x" | "y", raw: string): void {
    const v = parseInt(raw, 10);
    onChange({
      ...config,
      ratio: { ...config.ratio, [field]: isNaN(v) || v < 1 ? 1 : v },
    });
  }

  function updateRange(
    field: keyof AdSizeConfig["range"],
    raw: string,
  ): void {
    const v = raw === "" ? null : parseInt(raw, 10);
    onChange({
      ...config,
      range: {
        ...config.range,
        [field]: v !== null && isNaN(v) ? null : v,
      },
    });
  }

  function addCustomSize(): void {
    onChange({
      ...config,
      customSizes: [...config.customSizes, { width: 0, height: 0 }],
    });
  }

  function updateCustomSize(
    index: number,
    field: "width" | "height",
    raw: string,
  ): void {
    const v = parseInt(raw, 10);
    const updated = config.customSizes.map((s, i) =>
      i === index ? { ...s, [field]: isNaN(v) ? 0 : Math.max(0, v) } : s,
    );
    onChange({ ...config, customSizes: updated });
  }

  function removeCustomSize(index: number): void {
    onChange({
      ...config,
      customSizes: config.customSizes.filter((_, i) => i !== index),
    });
  }

  return (
    <div
      className={`space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3${
        disabled ? " opacity-50 pointer-events-none" : ""
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {label}
      </div>

      {/* ── Aspect Ratio ── */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Aspect Ratio
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            value={config.ratio.x}
            onChange={(e): void => updateRatio("x", e.target.value)}
            disabled={disabled}
            className={`${INPUT_CLS} w-16 text-center`}
          />
          <span className="text-sm font-semibold text-[var(--text-muted)]">
            :
          </span>
          <input
            type="number"
            min={1}
            value={config.ratio.y}
            onChange={(e): void => updateRatio("y", e.target.value)}
            disabled={disabled}
            className={`${INPUT_CLS} w-16 text-center`}
          />
        </div>
        {errors.ratio && (
          <p className="text-[10px] text-red-400 mt-1">{errors.ratio}</p>
        )}
      </div>

      {/* ── Size Range ── */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Size Range
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Min Width
            </span>
            <input
              type="number"
              min={0}
              value={config.range.minWidth ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("minWidth", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Max Width
            </span>
            <input
              type="number"
              min={0}
              value={config.range.maxWidth ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("maxWidth", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Min Height
            </span>
            <input
              type="number"
              min={0}
              value={config.range.minHeight ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("minHeight", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Max Height
            </span>
            <input
              type="number"
              min={0}
              value={config.range.maxHeight ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("maxHeight", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
        </div>
        {errors.rangeWidth && (
          <p className="text-[10px] text-red-400 mt-1">{errors.rangeWidth}</p>
        )}
        {errors.rangeHeight && (
          <p className="text-[10px] text-red-400 mt-1">{errors.rangeHeight}</p>
        )}
      </div>

      {/* ── Custom Sizes ── */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Custom Sizes
        </label>
        {config.customSizes.map((size, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={size.width || ""}
              placeholder="W"
              onChange={(e): void =>
                updateCustomSize(i, "width", e.target.value)
              }
              disabled={disabled}
              className={`${INPUT_CLS} w-20`}
            />
            <span className="text-xs text-[var(--text-muted)]">&times;</span>
            <input
              type="number"
              min={1}
              value={size.height || ""}
              placeholder="H"
              onChange={(e): void =>
                updateCustomSize(i, "height", e.target.value)
              }
              disabled={disabled}
              className={`${INPUT_CLS} w-20`}
            />
            <button
              type="button"
              onClick={(): void => removeCustomSize(i)}
              disabled={disabled}
              className="rounded px-1.5 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Remove size"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addCustomSize}
          disabled={disabled}
          className="text-xs font-semibold text-cyan hover:text-cyan/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          + Add Custom Size
        </button>
        {errors.customSizes && (
          <p className="text-[10px] text-red-400 mt-1">
            {errors.customSizes}
          </p>
        )}
      </div>

      {/* ── Rendered Sizes Preview ── */}
      {preview && (
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Rendered Sizes
          </label>
          <div className="rounded bg-[var(--bg-elevated)] px-2 py-1.5 text-xs font-mono text-[var(--text-secondary)]">
            {preview}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run:
```bash
cd services/dashboard && pnpm typecheck
```
Expected: Clean — no errors in new file.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/settings/SizeConfigPanel.tsx
git commit -m "feat(dashboard): add SizeConfigPanel component for structured ad sizes"
```

---

## Task 4: Update AdsConfigForm to Use SizeConfigPanel

**Files:**
- Modify: `services/dashboard/src/components/settings/AdsConfigForm.tsx`

**Context:** This file currently has:
- Lines 5-17: Local `AdPlacementSizes` and `AdPlacement` interfaces
- Lines 108-116: `updateSizes` callback (uses `parseSizes` to parse text input)
- Lines 270-300: Two `<input type="text">` for Desktop/Mobile Sizes
- Lines 534-537: `formatSizes()` helper (formats `number[][]` → display string)
- Lines 539-550: `parseSizes()` helper (parses text input → `number[][]`)

- [ ] **Step 1: Add imports at top of file**

After the existing `import { useCallback } from "react";` on line 3, add:

```typescript
import { SizeConfigPanel } from "./SizeConfigPanel";
import type { AdSizeConfig } from "./ad-size-config";
import {
  createDefaultSizeConfig,
  configToSizeTuples,
  sizeTuplesToConfig,
  validatePlacementConfigs,
} from "./ad-size-config";
```

Also re-export `validatePlacementConfigs` for parent forms to use for save gating:
```typescript
export { validatePlacementConfigs } from "./ad-size-config";
```

- [ ] **Step 2: Update AdPlacement interface**

Replace lines 10-17 (the `AdPlacement` interface) with:

```typescript
export interface AdPlacement {
  id: string;
  position: string;
  sizes: AdPlacementSizes;
  device: "all" | "desktop" | "mobile";
  /** Whether visitors can dismiss this ad. Only meaningful for sticky-bottom. Default: true. */
  dismissible?: boolean;
  /** Structured desktop size config for the editor UI. */
  desktopSizeConfig?: AdSizeConfig;
  /** Structured mobile size config for the editor UI. */
  mobileSizeConfig?: AdSizeConfig;
}
```

- [ ] **Step 3: Update addPlacement to include default configs**

In the `addPlacement` callback (~line 77), update the `newPlacement` to include config defaults:

```typescript
  const addPlacement = useCallback((): void => {
    const newPlacement: AdPlacement = {
      id: "",
      position: "above-content",
      device: "all",
      sizes: {},
      desktopSizeConfig: createDefaultSizeConfig(),
      mobileSizeConfig: createDefaultSizeConfig(),
    };
    onChange({ ...value, ad_placements: [...value.ad_placements, newPlacement] });
  }, [value, onChange]);
```

- [ ] **Step 4: Delete the updateSizes callback**

Remove lines 108-116 (the entire `updateSizes` useCallback block):

```typescript
  // DELETE THIS BLOCK:
  const updateSizes = useCallback(
    (placementIndex: number, device: keyof AdPlacementSizes, sizesStr: string): void => {
      const placement = value.ad_placements[placementIndex];
      const parsed = parseSizes(sizesStr);
      const newSizes = { ...placement.sizes, [device]: parsed.length > 0 ? parsed : undefined };
      updatePlacement(placementIndex, { sizes: newSizes });
    },
    [value, updatePlacement],
  );
```

- [ ] **Step 5: Replace size text inputs with SizeConfigPanel**

Replace lines 270-300 (the `{/* Sizes */}` comment through the closing `</div>` of the grid) with:

```tsx
            {/* Size Config Panels */}
            <div className="grid grid-cols-2 gap-3">
              <SizeConfigPanel
                label="Desktop Sizes"
                config={
                  placement.desktopSizeConfig ??
                  sizeTuplesToConfig(placement.sizes.desktop)
                }
                onChange={(cfg): void => {
                  const tuples = configToSizeTuples(cfg);
                  updatePlacement(index, {
                    desktopSizeConfig: cfg,
                    sizes: {
                      ...placement.sizes,
                      desktop: tuples.length > 0 ? tuples : undefined,
                    },
                  });
                }}
                disabled={placement.device === "mobile"}
              />
              <SizeConfigPanel
                label="Mobile Sizes"
                config={
                  placement.mobileSizeConfig ??
                  sizeTuplesToConfig(placement.sizes.mobile)
                }
                onChange={(cfg): void => {
                  const tuples = configToSizeTuples(cfg);
                  updatePlacement(index, {
                    mobileSizeConfig: cfg,
                    sizes: {
                      ...placement.sizes,
                      mobile: tuples.length > 0 ? tuples : undefined,
                    },
                  });
                }}
                disabled={placement.device === "desktop"}
              />
            </div>
```

- [ ] **Step 6: Delete unused formatSizes and parseSizes helper functions**

Remove `formatSizes` (lines 534-537) and `parseSizes` (lines 539-550). These were only used by the text inputs we just replaced.

**Do NOT remove** `formatPlacementSizes` (~line 348) — it's used by the inline `PreviewSlot` component and operates on `placement.sizes` directly.

- [ ] **Step 7: Verify no TypeScript errors**

Run:
```bash
cd services/dashboard && pnpm typecheck
```
Expected: Clean.

- [ ] **Step 8: Run unit tests**

Run:
```bash
cd services/dashboard && pnpm test
```
Expected: All pass (existing tests unaffected).

- [ ] **Step 9: Commit**

```bash
git add services/dashboard/src/components/settings/AdsConfigForm.tsx
git commit -m "feat(dashboard): replace free-text size inputs with SizeConfigPanel"
```

**Note on save gating:** The spec says "Do not allow save when validation fails." The `validatePlacementConfigs` function is now exported from `AdsConfigForm.tsx` for any parent component (e.g., `UnifiedConfigForm`) to call before allowing save. The inline validation errors in `SizeConfigPanel` give immediate visual feedback. If the parent form needs to disable its Save button, import `validatePlacementConfigs` and check `validatePlacementConfigs(value.ad_placements)` — returns `false` when any active panel has validation errors. This is a separate, targeted change to the parent form if needed.

---

## Task 5: Update Config Normalizer for Migration

**Files:**
- Modify: `services/dashboard/src/lib/config-normalizers.ts`

**Context:** The `normalizeAdsConfig` function (lines 44-77) currently builds `AdPlacement` objects from raw YAML. We need to hydrate the new `desktopSizeConfig` / `mobileSizeConfig` fields:
- If the YAML already has these fields → pass them through
- If the YAML only has old-format `sizes` → migrate via `sizeTuplesToConfig`

- [ ] **Step 1: Add import**

At the top of `config-normalizers.ts`, add:

```typescript
import type { AdSizeConfig } from "@/components/settings/ad-size-config";
import { sizeTuplesToConfig } from "@/components/settings/ad-size-config";
```

- [ ] **Step 2: Update the return statement in normalizeAdsConfig**

In the `placements.map(...)` callback, replace the return statement (lines 68-74) with:

```typescript
      // Hydrate size config: use persisted config or migrate from sizes
      const rawDesktopCfg = p.desktopSizeConfig as AdSizeConfig | undefined;
      const rawMobileCfg = p.mobileSizeConfig as AdSizeConfig | undefined;

      return {
        id: (p.id as string) ?? "",
        position: (p.position as string) ?? "",
        device: (p.devices ?? p.device ?? "all") as "all" | "desktop" | "mobile",
        sizes,
        ...(dismissible !== undefined && { dismissible }),
        desktopSizeConfig: rawDesktopCfg ?? sizeTuplesToConfig(sizes.desktop),
        mobileSizeConfig: rawMobileCfg ?? sizeTuplesToConfig(sizes.mobile),
      };
```

- [ ] **Step 3: Verify no TypeScript errors**

Run:
```bash
cd services/dashboard && pnpm typecheck
```
Expected: Clean.

- [ ] **Step 4: Run all tests**

Run:
```bash
cd services/dashboard && pnpm test
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/lib/config-normalizers.ts
git commit -m "feat(dashboard): hydrate size config in normalizer with old-format migration"
```

---

## Task 6: Full Verification

- [ ] **Step 1: Run monorepo-wide typecheck**

Run:
```bash
pnpm typecheck
```
Expected: Clean across all packages (dashboard, content-pipeline, site-builder, shared-types).

- [ ] **Step 2: Run all tests**

Run:
```bash
pnpm test
```
Expected: All pass across all packages.

- [ ] **Step 3: Manual UI verification**

Start local dev:
```bash
cloudgrid dev
```

Open the dashboard at `http://localhost:3001` and navigate to a site → Settings → Config → Ads Config.

Verify against the spec acceptance criteria:

1. **New placement** → Click "Add Placement" → both Desktop Sizes and Mobile Sizes panels appear side-by-side with default 16:9 ratio, empty ranges, and empty custom sizes
2. **Add custom sizes** → Click "+ Add Custom Size" → enter 728 × 90 → preview shows "728x90" → add another 970 × 250 → preview shows "728x90, 970x250"
3. **Existing placement migration** → Open a site that already has ad placements with old-format sizes → panels show parsed custom sizes from the old `sizes` field
4. **Device "Desktop"** → Select "Desktop" from device dropdown → Mobile Sizes panel is grayed out / non-interactive
5. **Device "Mobile"** → Select "Mobile" → Desktop Sizes panel is grayed out
6. **Device "All Devices"** → Select "All Devices" → both panels are active
7. **Range validation** → Set Min Width = 500, Max Width = 300 → inline error "Max Width must be ≥ Min Width" appears
8. **Range validation height** → Set Min Height = 400, Max Height = 200 → inline error appears
9. **Custom sizes validation** → Delete all custom sizes from an active panel → inline error "At least one custom size is required" appears
10. **PlacementPreview** → Verify the placement preview section below still renders correctly with the correct sizes
11. **Save + reload** → Click Save → reload the page → verify the config round-trips (sizes preserved, ratio/range preserved)
12. **YAML output** → Check the saved YAML in the network repo → confirm `sizes: { desktop: [[728, 90], ...], mobile: [...] }` format is intact
13. **No console errors** → Open browser DevTools → confirm no JS errors

- [ ] **Step 4: Commit any fixups if needed**

If any issues found during verification, fix and commit:
```bash
git commit -m "fix(dashboard): [describe fix]"
```

---

## Data Flow Summary

```
                    ┌─────────────────────┐
                    │   YAML (site.yaml)  │
                    │  sizes: { desktop:  │
                    │   [[728,90]], ... }  │
                    │  desktopSizeConfig:  │  ← NEW: persisted UI state
                    │   { ratio, range,   │
                    │     customSizes }   │
                    └─────────┬───────────┘
                              │ load
                    ┌─────────▼───────────┐
                    │ normalizeAdsConfig() │
                    │  if no config →      │
                    │  migrate from sizes  │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │   AdsConfigForm      │
                    │  ┌───────┬───────┐  │
                    │  │Desktop│Mobile │  │  ← SizeConfigPanel × 2
                    │  │ Panel │ Panel │  │
                    │  └───┬───┴───┬───┘  │
                    │      │       │       │
                    │  on edit:            │
                    │  sizes.desktop =     │  ← computed from customSizes
                    │    configToSizeTuples│
                    └─────────┬───────────┘
                              │ save (unchanged pipeline)
                    ┌─────────▼───────────┐
                    │ stringifyYaml(obj)   │  ← save route: no changes needed
                    └─────────┬───────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   PlacementPreview     resolve-config       ad-loader.js
   reads sizes ✓        reads sizes ✓        reads sizes ✓
   ignores config ✓     ignores config ✓     ignores config ✓
```
