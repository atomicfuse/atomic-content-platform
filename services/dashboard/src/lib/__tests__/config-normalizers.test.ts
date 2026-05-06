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

// ---------------------------------------------------------------------------
// Interstitial config normalizer tests
// ---------------------------------------------------------------------------
describe("interstitial config normalization", () => {
  it("I01 — returns default interstitial config when not present", () => {
    const result = normalizeAdsConfig(undefined);
    expect(result.interstitial_config).toEqual({
      script_url: "",
      trigger: { type: "delay", delay_seconds: 5, scroll_percent: 50 },
      frequency: { type: "once_per_session", max_per_session: 1 },
      page_types: ["all"],
      close_delay_seconds: 3,
    });
  });

  it("I02 — returns default interstitial config for empty ads_config", () => {
    const result = normalizeAdsConfig({});
    expect(result.interstitial_config.script_url).toBe("");
    expect(result.interstitial_config.trigger.type).toBe("delay");
    expect(result.interstitial_config.frequency.type).toBe("once_per_session");
    expect(result.interstitial_config.page_types).toEqual(["all"]);
  });

  it("I03 — normalizes full interstitial config from YAML", () => {
    const result = normalizeAdsConfig({
      interstitial: true,
      interstitial_config: {
        script_url: "https://cdn.example.com/interstitial.js",
        trigger: { type: "scroll", scroll_percent: 75 },
        frequency: { type: "custom", max_per_session: 3 },
        page_types: ["article", "homepage"],
      },
    });
    expect(result.interstitial).toBe(true);
    expect(result.interstitial_config.script_url).toBe("https://cdn.example.com/interstitial.js");
    expect(result.interstitial_config.trigger.type).toBe("scroll");
    expect(result.interstitial_config.trigger.scroll_percent).toBe(75);
    expect(result.interstitial_config.frequency.type).toBe("custom");
    expect(result.interstitial_config.frequency.max_per_session).toBe(3);
    expect(result.interstitial_config.page_types).toEqual(["article", "homepage"]);
  });

  it("I04 — fills defaults for partial trigger config", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://example.com/ad.js",
        trigger: { type: "delay" },
        frequency: {},
      },
    });
    expect(result.interstitial_config.trigger.delay_seconds).toBe(5);
    expect(result.interstitial_config.trigger.scroll_percent).toBe(50);
    expect(result.interstitial_config.frequency.type).toBe("once_per_session");
    expect(result.interstitial_config.frequency.max_per_session).toBe(1);
  });

  it("I05 — fills defaults for missing trigger and frequency objects", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://example.com/ad.js",
      },
    });
    expect(result.interstitial_config.trigger).toEqual({
      type: "delay",
      delay_seconds: 5,
      scroll_percent: 50,
    });
    expect(result.interstitial_config.frequency).toEqual({
      type: "once_per_session",
      max_per_session: 1,
    });
  });

  it("I06 — defaults page_types to ['all'] when missing", () => {
    const result = normalizeAdsConfig({
      interstitial_config: { script_url: "https://x.com/a.js" },
    });
    expect(result.interstitial_config.page_types).toEqual(["all"]);
  });

  it("I07 — preserves exit_intent trigger type", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        trigger: { type: "exit_intent" },
      },
    });
    expect(result.interstitial_config.trigger.type).toBe("exit_intent");
  });

  it("I08 — preserves once_per_day frequency type", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        frequency: { type: "once_per_day" },
      },
    });
    expect(result.interstitial_config.frequency.type).toBe("once_per_day");
  });

  it("I09 — preserves custom max_per_session value", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        frequency: { type: "custom", max_per_session: 5 },
      },
    });
    expect(result.interstitial_config.frequency.max_per_session).toBe(5);
  });

  it("I10 — preserves category-only page_types", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        page_types: ["category"],
      },
    });
    expect(result.interstitial_config.page_types).toEqual(["category"]);
  });

  it("I11 — preserves delay_seconds value", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        trigger: { type: "delay", delay_seconds: 30 },
      },
    });
    expect(result.interstitial_config.trigger.delay_seconds).toBe(30);
  });

  it("I12 — interstitial false with config still normalizes config", () => {
    const result = normalizeAdsConfig({
      interstitial: false,
      interstitial_config: {
        script_url: "https://x.com/a.js",
        trigger: { type: "scroll", scroll_percent: 80 },
        frequency: { type: "once_per_day" },
        page_types: ["homepage", "article"],
      },
    });
    expect(result.interstitial).toBe(false);
    expect(result.interstitial_config.script_url).toBe("https://x.com/a.js");
    expect(result.interstitial_config.trigger.scroll_percent).toBe(80);
  });

  it("I13 — preserves multiple page_types", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        page_types: ["article", "category", "homepage"],
      },
    });
    expect(result.interstitial_config.page_types).toHaveLength(3);
    expect(result.interstitial_config.page_types).toContain("article");
    expect(result.interstitial_config.page_types).toContain("category");
    expect(result.interstitial_config.page_types).toContain("homepage");
  });

  it("I14 — non-array page_types falls back to ['all']", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        page_types: "article",
      },
    });
    expect(result.interstitial_config.page_types).toEqual(["all"]);
  });

  it("I15 — interstitial_config is independent of ad_placements", () => {
    const result = normalizeAdsConfig({
      interstitial: true,
      interstitial_config: {
        script_url: "https://x.com/a.js",
        trigger: { type: "delay", delay_seconds: 10 },
      },
      ad_placements: [
        { id: "top", position: "above-content", device: "all", sizes: { desktop: [[728, 90]] } },
      ],
    });
    expect(result.interstitial).toBe(true);
    expect(result.interstitial_config.script_url).toBe("https://x.com/a.js");
    expect(result.ad_placements).toHaveLength(1);
    expect(result.ad_placements[0].id).toBe("top");
  });

  it("I16 — defaults close_delay_seconds to 3 when missing", () => {
    const result = normalizeAdsConfig({
      interstitial_config: { script_url: "https://x.com/a.js" },
    });
    expect(result.interstitial_config.close_delay_seconds).toBe(3);
  });

  it("I17 — preserves explicit close_delay_seconds value", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        close_delay_seconds: 5,
      },
    });
    expect(result.interstitial_config.close_delay_seconds).toBe(5);
  });

  it("I18 — preserves close_delay_seconds of 0", () => {
    const result = normalizeAdsConfig({
      interstitial_config: {
        script_url: "https://x.com/a.js",
        close_delay_seconds: 0,
      },
    });
    expect(result.interstitial_config.close_delay_seconds).toBe(0);
  });
});
