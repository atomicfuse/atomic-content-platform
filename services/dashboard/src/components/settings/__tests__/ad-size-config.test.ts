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
        desktopSizeConfig: createDefaultSizeConfig(),
        mobileSizeConfig: sizeTuplesToConfig([[320, 50]]),
      },
    ]);
    expect(valid).toBe(false);
  });

  it("ignores disabled desktop panel (device=mobile)", () => {
    const valid = validatePlacementConfigs([
      {
        device: "mobile",
        desktopSizeConfig: createDefaultSizeConfig(),
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
        mobileSizeConfig: createDefaultSizeConfig(),
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
