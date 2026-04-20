import { describe, it, expect } from "vitest";
import { normalizeAdsConfig } from "../config-normalizers";

// ---------------------------------------------------------------------------
// T31 — Old string-format placement loads correctly
// ---------------------------------------------------------------------------
describe("T31 — Old string-format migration", () => {
  it("converts string sizes to tuples and hydrates config", () => {
    const result = normalizeAdsConfig({
      interstitial: false,
      layout: "standard",
      ad_placements: [
        {
          id: "top-ad",
          position: "above-content",
          device: "all",
          sizes: ["728x90", "970x90"],
        },
      ],
    });
    expect(result.ad_placements).toHaveLength(1);
    const p = result.ad_placements[0];
    expect(p.sizes.desktop).toEqual([
      [728, 90],
      [970, 90],
    ]);
    // mobile gets same sizes for device="all"
    expect(p.sizes.mobile).toEqual([
      [728, 90],
      [970, 90],
    ]);
    // Hydrated size config from migrated tuples
    expect(p.desktopSizeConfig).toBeDefined();
    expect(p.desktopSizeConfig!.customSizes).toEqual([
      { width: 728, height: 90 },
      { width: 970, height: 90 },
    ]);
    expect(p.desktopSizeConfig!.ratio).toEqual({ x: 16, y: 9 });
  });
});

// ---------------------------------------------------------------------------
// T32 — Old single-size string migrates
// ---------------------------------------------------------------------------
describe("T32 — Single string size migration", () => {
  it("converts single string size", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "side",
          position: "sidebar",
          sizes: ["300x250"],
        },
      ],
    });
    expect(result.ad_placements[0].sizes.desktop).toEqual([[300, 250]]);
    expect(result.ad_placements[0].desktopSizeConfig!.customSizes).toEqual([
      { width: 300, height: 250 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// T33 — Empty sizes migrate gracefully
// ---------------------------------------------------------------------------
describe("T33 — Empty sizes migration", () => {
  it("undefined sizes produce empty config", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "empty",
          position: "above-content",
        },
      ],
    });
    const p = result.ad_placements[0];
    expect(p.sizes).toEqual({});
    expect(p.desktopSizeConfig!.customSizes).toEqual([]);
  });

  it("empty array sizes produce empty config", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "empty",
          position: "above-content",
          sizes: [],
        },
      ],
    });
    const p = result.ad_placements[0];
    expect(p.desktopSizeConfig!.customSizes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T34 — Migrated placement round-trip (tuple format preserved)
// ---------------------------------------------------------------------------
describe("T34 — Tuple format round-trip", () => {
  it("tuple-format sizes pass through unchanged", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "existing",
          position: "above-content",
          device: "all",
          sizes: { desktop: [[728, 90], [970, 250]], mobile: [[320, 50]] },
        },
      ],
    });
    expect(result.ad_placements[0].sizes.desktop).toEqual([
      [728, 90],
      [970, 250],
    ]);
    expect(result.ad_placements[0].sizes.mobile).toEqual([[320, 50]]);
  });
});

// ---------------------------------------------------------------------------
// Fluid sizes through normalizer
// ---------------------------------------------------------------------------
describe("fluid size migration through normalizer", () => {
  it("tuple [0, 250] hydrates as fluid-width", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "sticky",
          position: "sticky-bottom",
          device: "all",
          sizes: { desktop: [[0, 250]], mobile: [[0, 90]] },
        },
      ],
    });
    expect(result.ad_placements[0].desktopSizeConfig!.customSizes).toEqual([
      { width: 0, height: 250 },
    ]);
    expect(result.ad_placements[0].mobileSizeConfig!.customSizes).toEqual([
      { width: 0, height: 90 },
    ]);
  });

  it("string '0x250' parses as fluid-width tuple", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "sticky",
          position: "sticky-bottom",
          sizes: ["0x250"],
        },
      ],
    });
    expect(result.ad_placements[0].sizes.desktop).toEqual([[0, 250]]);
    expect(result.ad_placements[0].desktopSizeConfig!.customSizes).toEqual([
      { width: 0, height: 250 },
    ]);
  });

  it("string '300x0' parses as fluid-height tuple", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "sidebar",
          position: "sidebar",
          sizes: ["300x0"],
        },
      ],
    });
    expect(result.ad_placements[0].sizes.desktop).toEqual([[300, 0]]);
  });

  it("string '0x0' is filtered out as invalid", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "bad",
          position: "above-content",
          sizes: ["0x0", "728x90"],
        },
      ],
    });
    // '0x0' should be filtered, only '728x90' remains
    expect(result.ad_placements[0].sizes.desktop).toEqual([[728, 90]]);
  });
});

// ---------------------------------------------------------------------------
// E08 — Migrate old string containing "0x250"
// ---------------------------------------------------------------------------
describe("E08 — Old string 0x250 migration", () => {
  it("fluid string size migrates correctly", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "banner",
          position: "sticky-bottom",
          sizes: ["0x250"],
        },
      ],
    });
    const p = result.ad_placements[0];
    expect(p.desktopSizeConfig!.customSizes[0]).toEqual({
      width: 0,
      height: 250,
    });
  });
});

// ---------------------------------------------------------------------------
// Device field normalization
// ---------------------------------------------------------------------------
describe("device field normalization", () => {
  it("normalizes 'devices' to 'device'", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "ad",
          position: "above-content",
          devices: "mobile",
          sizes: [[320, 50]],
        },
      ],
    });
    expect(result.ad_placements[0].device).toBe("mobile");
  });

  it("defaults to 'all' when no device field", () => {
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "ad",
          position: "above-content",
          sizes: [[728, 90]],
        },
      ],
    });
    expect(result.ad_placements[0].device).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// Persisted size config hydration
// ---------------------------------------------------------------------------
describe("persisted AdSizeConfig hydration", () => {
  it("uses persisted desktopSizeConfig over migration", () => {
    const persistedConfig = {
      ratio: { x: 4, y: 3 },
      range: { minWidth: 300, maxWidth: 1000, minHeight: null, maxHeight: null },
      customSizes: [{ width: 728, height: 90 }],
    };
    const result = normalizeAdsConfig({
      ad_placements: [
        {
          id: "ad",
          position: "above-content",
          device: "all",
          sizes: { desktop: [[728, 90]] },
          desktopSizeConfig: persistedConfig,
        },
      ],
    });
    expect(result.ad_placements[0].desktopSizeConfig).toEqual(persistedConfig);
  });
});

// ---------------------------------------------------------------------------
// General normalizeAdsConfig
// ---------------------------------------------------------------------------
describe("normalizeAdsConfig defaults", () => {
  it("returns defaults for undefined input", () => {
    const result = normalizeAdsConfig(undefined);
    expect(result.interstitial).toBe(false);
    expect(result.layout).toBe("standard");
    expect(result.ad_placements).toEqual([]);
  });

  it("returns defaults for empty object", () => {
    const result = normalizeAdsConfig({});
    expect(result.interstitial).toBe(false);
    expect(result.layout).toBe("standard");
    expect(result.ad_placements).toEqual([]);
  });
});
