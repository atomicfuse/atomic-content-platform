/**
 * Tests for the dismissible sticky-ad close button feature.
 *
 * Spec: docs/specs/2026-04-20-sticky-ad-close-button-spec.md
 *
 * Coverage:
 *   - Config resolution: dismissible field passthrough via normaliseAdPlacements
 *   - Config resolution: missing dismissible defaults (undefined, not false)
 *   - Config resolution: dismissible survives override merge modes
 *   - Runtime (ad-loader.js): sessionStorage gate, X button injection,
 *     dismiss behavior, event emission, accessibility attributes
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { resolveConfig } from "../resolve-config.js";
import { JSDOM } from "jsdom";

const FIXTURES = join(import.meta.dirname, "fixtures");
const AD_LOADER_PATH = join(import.meta.dirname, "..", "..", "public", "ad-loader.js");

// ---------------------------------------------------------------------------
// Part 1: Config resolution — dismissible field passthrough
// ---------------------------------------------------------------------------

describe("dismissible field — config resolution", () => {
  it("T1: preserves dismissible: true on sticky-bottom placements", async () => {
    const config = await resolveConfig(FIXTURES, "dismissible-test.example.com");
    const placement = config.ads_config.ad_placements.find(
      (p) => p.id === "sticky-dismissible",
    );
    expect(placement).toBeDefined();
    expect(placement!.dismissible).toBe(true);
  });

  it("T2: preserves dismissible: false on sticky-bottom placements", async () => {
    const config = await resolveConfig(FIXTURES, "dismissible-test.example.com");
    const placement = config.ads_config.ad_placements.find(
      (p) => p.id === "sticky-no-dismiss",
    );
    expect(placement).toBeDefined();
    expect(placement!.dismissible).toBe(false);
  });

  it("T3: omits dismissible when not set in YAML (undefined, not false)", async () => {
    const config = await resolveConfig(FIXTURES, "sticky-default.example.com");
    const placement = config.ads_config.ad_placements.find(
      (p) => p.id === "sticky-default",
    );
    expect(placement).toBeDefined();
    // undefined — NOT false. This is the backwards-compat guarantee.
    expect(placement!.dismissible).toBeUndefined();
  });

  it("T4: non-sticky placements without dismissible have no dismissible key", async () => {
    const config = await resolveConfig(FIXTURES, "dismissible-test.example.com");
    const topBanner = config.ads_config.ad_placements.find(
      (p) => p.id === "top-banner",
    );
    expect(topBanner).toBeDefined();
    expect(topBanner!.dismissible).toBeUndefined();
  });

  it("T5: dismissible field appears in inlineAdConfig JSON", async () => {
    const config = await resolveConfig(FIXTURES, "dismissible-test.example.com");
    const inline = config.inlineAdConfig;
    const placement = inline.ads_config.ad_placements.find(
      (p) => p.id === "sticky-no-dismiss",
    );
    expect(placement).toBeDefined();
    expect(placement!.dismissible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Part 2: ad-loader.js runtime — JSDOM-based tests
// ---------------------------------------------------------------------------

/**
 * Creates a minimal DOM environment with a sticky-bottom slot and
 * window.__ATL_CONFIG__, then executes ad-loader.js.
 */
function createAdLoaderEnv(config: Record<string, unknown>): JSDOM {
  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div data-slot="above-content" style="display:none;"></div>
  <div data-slot="sticky-bottom" class="ad-sticky-bottom" style="min-height:50px;display:none;"></div>
</body>
</html>`;

  const dom = new JSDOM(html, {
    url: "https://coolnews-atl.example.com",
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
  });

  // Inject config before ad-loader runs
  dom.window.eval(`window.__ATL_CONFIG__ = ${JSON.stringify(config)};`);

  // Execute ad-loader.js
  const adLoaderSource = readFileSync(AD_LOADER_PATH, "utf-8");
  dom.window.eval(adLoaderSource);

  return dom;
}

/** Minimal valid config for tests */
function makeConfig(overrides: {
  dismissible?: boolean | undefined;
  interstitial?: boolean;
} = {}): Record<string, unknown> {
  const placement: Record<string, unknown> = {
    id: "sticky-ad",
    position: "sticky-bottom",
    sizes: { mobile: [[320, 50]] },
    device: "mobile",
  };
  if (overrides.dismissible !== undefined) {
    placement.dismissible = overrides.dismissible;
  }
  return {
    scripts: { head: [], body_end: [] },
    ads_config: {
      interstitial: overrides.interstitial ?? false,
      layout: "standard",
      ad_placements: [placement],
    },
  };
}

describe("ad-loader.js — sticky-bottom dismiss", () => {
  it("T6: renders close button when dismissible is undefined (default)", async () => {
    const dom = createAdLoaderEnv(makeConfig());
    // ad-loader is async — wait for it
    await new Promise((r) => setTimeout(r, 100));

    const btn = dom.window.document.querySelector(".ad-close-btn");
    expect(btn).not.toBeNull();
    dom.window.close();
  });

  it("T7: renders close button when dismissible is true", async () => {
    const dom = createAdLoaderEnv(makeConfig({ dismissible: true }));
    await new Promise((r) => setTimeout(r, 100));

    const btn = dom.window.document.querySelector(".ad-close-btn");
    expect(btn).not.toBeNull();
    dom.window.close();
  });

  it("T8: does NOT render close button when dismissible is false", async () => {
    const dom = createAdLoaderEnv(makeConfig({ dismissible: false }));
    await new Promise((r) => setTimeout(r, 100));

    const btn = dom.window.document.querySelector(".ad-close-btn");
    expect(btn).toBeNull();
    dom.window.close();
  });

  it("T9: close button has correct accessibility attributes", async () => {
    const dom = createAdLoaderEnv(makeConfig());
    await new Promise((r) => setTimeout(r, 100));

    const btn = dom.window.document.querySelector(".ad-close-btn") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.type).toBe("button");
    expect(btn.getAttribute("aria-label")).toBe("Close advertisement");
    // U+00D7 MULTIPLICATION SIGN
    expect(btn.textContent).toBe("\u00D7");
    dom.window.close();
  });

  it("T10: clicking close button hides sticky-bottom container", async () => {
    const dom = createAdLoaderEnv(makeConfig());
    await new Promise((r) => setTimeout(r, 100));

    const btn = dom.window.document.querySelector(".ad-close-btn") as HTMLButtonElement;
    const sticky = dom.window.document.querySelector('[data-slot="sticky-bottom"]') as HTMLElement;
    expect(sticky.style.display).not.toBe("none");

    btn.click();
    expect(sticky.style.display).toBe("none");
    dom.window.close();
  });

  it("T11: clicking close button sets sessionStorage flag", async () => {
    const dom = createAdLoaderEnv(makeConfig());
    await new Promise((r) => setTimeout(r, 100));

    const btn = dom.window.document.querySelector(".ad-close-btn") as HTMLButtonElement;
    btn.click();

    expect(dom.window.sessionStorage.getItem("_atl_sticky_dismissed")).toBe("1");
    dom.window.close();
  });

  it("T12: clicking close button dispatches atl:sticky-dismissed event", async () => {
    const dom = createAdLoaderEnv(makeConfig());
    await new Promise((r) => setTimeout(r, 100));

    let eventFired = false;
    dom.window.addEventListener("atl:sticky-dismissed", () => {
      eventFired = true;
    });

    const btn = dom.window.document.querySelector(".ad-close-btn") as HTMLButtonElement;
    btn.click();

    expect(eventFired).toBe(true);
    dom.window.close();
  });

  it("T13: when sessionStorage has dismiss flag, sticky-bottom stays hidden and no ad loads", async () => {
    // Pre-set the dismiss flag
    const dom = createAdLoaderEnv(makeConfig());
    dom.window.sessionStorage.setItem("_atl_sticky_dismissed", "1");

    // Re-run ad-loader with flag already set
    const adLoaderSource = readFileSync(AD_LOADER_PATH, "utf-8");
    // Clear the slot first (reset from first run)
    const sticky = dom.window.document.querySelector('[data-slot="sticky-bottom"]') as HTMLElement;
    sticky.innerHTML = "";
    sticky.style.display = "";
    dom.window.eval(adLoaderSource);
    await new Promise((r) => setTimeout(r, 100));

    expect(sticky.style.display).toBe("none");
    // No ad slot or button should be injected
    expect(sticky.querySelector(".ad-close-btn")).toBeNull();
    expect(sticky.querySelector(".ad-slot")).toBeNull();
    dom.window.close();
  });

  it("T14: sticky-bottom ad slot IS filled when not dismissed", async () => {
    const dom = createAdLoaderEnv(makeConfig());
    await new Promise((r) => setTimeout(r, 100));

    const sticky = dom.window.document.querySelector('[data-slot="sticky-bottom"]') as HTMLElement;
    // attachToSlot sets display to '' and adds the ad slot div
    expect(sticky.style.display).toBe("");
    expect(sticky.querySelector(".ad-slot")).not.toBeNull();
    dom.window.close();
  });

  it("T15: other placements (above-content) unaffected by sticky dismiss feature", async () => {
    const config = makeConfig();
    (config.ads_config as Record<string, unknown[]>).ad_placements.push({
      id: "top-banner",
      position: "above-content",
      sizes: { desktop: [[728, 90]] },
      device: "all",
    });
    const dom = createAdLoaderEnv(config);
    await new Promise((r) => setTimeout(r, 100));

    const aboveContent = dom.window.document.querySelector('[data-slot="above-content"]') as HTMLElement;
    // above-content should have been filled
    expect(aboveContent.querySelector(".ad-slot")).not.toBeNull();
    // No close button on above-content
    expect(aboveContent.querySelector(".ad-close-btn")).toBeNull();
    dom.window.close();
  });
});
