import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveConfig } from "../resolve-config.js";

const FIX = join(import.meta.dirname, "fixtures-qa");

// ---------------------------------------------------------------------------
// A. Org Config Tests (10)
// ---------------------------------------------------------------------------

describe("QA — A. Org config as root defaults", () => {
  // A1
  it("A1: org tracking passes through when no group/site overrides", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    expect(c.tracking.ga4).toBe("G-ORG");
    expect(c.tracking.gtm).toBe("GTM-ORG");
  });

  // A2
  it("A2: org scripts pass through unchanged", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    const orgAnalytics = c.scripts.head.find((s) => s.id === "org-analytics");
    expect(orgAnalytics).toBeDefined();
    expect(orgAnalytics!.src).toBe("https://analytics.example.com/org.js");
    expect(orgAnalytics!.async).toBe(true);
  });

  // A3
  it("A3: org ads_config is baseline when nothing overrides", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    const orgBanner = c.ads_config.ad_placements.find((p) => p.id === "org-banner");
    expect(orgBanner).toBeDefined();
    expect(orgBanner!.position).toBe("above-content");
  });

  // A4
  it("A4: org ads_txt entries are baseline", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    expect(c.ads_txt).toContain("google.com, pub-org, DIRECT");
  });

  // A5
  it("A5: org legal values pass through", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    expect(c.legal.company_name).toBe("QA Org Ltd");
    expect(c.legal.company_country).toBe("US");
  });

  // A6
  it("A6: org theme defaults apply (default_theme, default_fonts)", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    expect(c.theme.base).toBe("modern");
    expect(c.theme.fonts.heading).toBe("Arial");
    expect(c.theme.fonts.body).toBe("Helvetica");
  });

  // A7
  it("A7: support_email_pattern resolves with site domain", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    expect(c.support_email).toBe("support@org-only.test");
  });

  // A8
  it("A8: org scripts_vars resolve placeholders in scripts", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    const footer = c.scripts.body_end.find((s) => s.id === "org-footer");
    expect(footer).toBeDefined();
    expect(footer!.inline).toContain("org-value");
    expect(footer!.inline).not.toContain("{{org_var}}");
  });

  // A9
  it("A9: org ad_placeholder_heights pass through", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    expect(c.ad_placeholder_heights["above-content"]).toBe(100);
    expect(c.ad_placeholder_heights["after-paragraph"]).toBe(280);
    expect(c.ad_placeholder_heights.sidebar).toBe(500);
    expect(c.ad_placeholder_heights["sticky-bottom"]).toBe(50);
  });

  // A10
  it("A10: org null tracking fields are preserved", async () => {
    const c = await resolveConfig(FIX, "org-only.test");
    expect(c.tracking.google_ads).toBeNull();
    expect(c.tracking.facebook_pixel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B. Group Config Tests (10)
// ---------------------------------------------------------------------------

describe("QA — B. Group config merge behavior", () => {
  // B1
  it("B1: single group overrides org tracking field", async () => {
    const c = await resolveConfig(FIX, "single-group.test");
    // org: gtm="GTM-ORG", alpha: gtm="GTM-ALPHA"
    expect(c.tracking.gtm).toBe("GTM-ALPHA");
  });

  // B2
  it("B2: single group leaves unset org fields intact", async () => {
    const c = await resolveConfig(FIX, "single-group.test");
    // org: ga4="G-ORG", alpha doesn't set ga4
    expect(c.tracking.ga4).toBe("G-ORG");
  });

  // B3
  it("B3: group ad_placements replace org ad_placements entirely", async () => {
    const c = await resolveConfig(FIX, "single-group.test");
    const alpha = c.ads_config.ad_placements.find((p) => p.id === "alpha-banner");
    const org = c.ads_config.ad_placements.find((p) => p.id === "org-banner");
    expect(alpha).toBeDefined();
    expect(org).toBeUndefined();
  });

  // B4
  it("B4: group ads_txt appends to org (additive, deduplicated)", async () => {
    const c = await resolveConfig(FIX, "single-group.test");
    expect(c.ads_txt).toContain("google.com, pub-org, DIRECT");
    expect(c.ads_txt).toContain("net-alpha.com, 111, DIRECT");
  });

  // B5
  it("B5: multi-group — later group overrides earlier group", async () => {
    const c = await resolveConfig(FIX, "multi-group.test");
    // alpha: google_ads="AW-ALPHA", beta: google_ads="AW-BETA"
    expect(c.tracking.google_ads).toBe("AW-BETA");
  });

  // B6
  it("B6: multi-group — earlier group field persists if later group doesn't set it", async () => {
    const c = await resolveConfig(FIX, "multi-group.test");
    // alpha: facebook_pixel="PX-ALPHA", beta: no facebook_pixel
    expect(c.tracking.facebook_pixel).toBe("PX-ALPHA");
  });

  // B7
  it("B7: multi-group — ads_txt entries from all groups combined", async () => {
    const c = await resolveConfig(FIX, "multi-group.test");
    expect(c.ads_txt).toContain("google.com, pub-org, DIRECT");
    expect(c.ads_txt).toContain("net-alpha.com, 111, DIRECT");
    expect(c.ads_txt).toContain("net-beta.com, 222, DIRECT");
  });

  // B8
  it("B8: multi-group — scripts merge by ID across groups", async () => {
    const c = await resolveConfig(FIX, "multi-group.test");

    // org-analytics: beta's version wins (last group to define it)
    const orgAnalytics = c.scripts.head.find((s) => s.id === "org-analytics");
    expect(orgAnalytics).toBeDefined();
    expect(orgAnalytics!.src).toBe("https://analytics.example.com/beta.js");

    // Both unique scripts present
    expect(c.scripts.head.find((s) => s.id === "alpha-script")).toBeDefined();
    expect(c.scripts.head.find((s) => s.id === "beta-script")).toBeDefined();
  });

  // B9
  it("B9: multi-group — theme deep merges left-to-right", async () => {
    const c = await resolveConfig(FIX, "multi-group.test");
    // alpha: primary="#AA0000", secondary="#AA1111"
    // beta: primary="#BB0000" (no secondary)
    expect(c.theme.colors.primary).toBe("#BB0000");
    expect(c.theme.colors.secondary).toBe("#AA1111");
  });

  // B10
  it("B10: three groups cascade — last group wins on conflicts", async () => {
    const c = await resolveConfig(FIX, "three-groups.test");
    // alpha: gtm="GTM-ALPHA", gamma: gtm="GTM-C" (beta has no gtm)
    expect(c.tracking.gtm).toBe("GTM-C");
  });
});

// ---------------------------------------------------------------------------
// C. Override Config Tests (12)
// ---------------------------------------------------------------------------

describe("QA — C. Override targeting, merge modes, and priority", () => {
  // C1
  it("C1: override applied via direct site targeting", async () => {
    const c = await resolveConfig(FIX, "override-merge.test");
    expect(c.applied_overrides).toContain("merge-override");
  });

  // C2
  it("C2: override applied via group targeting", async () => {
    const c = await resolveConfig(FIX, "override-group-target.test");
    // group-target-override targets qa-group-beta; site belongs to qa-group-beta
    expect(c.applied_overrides).toContain("group-target-override");
  });

  // C3
  it("C3: override NOT applied to non-targeted site", async () => {
    const c = await resolveConfig(FIX, "single-group.test");
    // single-group.test is in qa-group-alpha only; no override targets it
    expect(c.applied_overrides).toEqual([]);
  });

  // C4
  it("C4: override tracking merge mode (default) — merges keys", async () => {
    const c = await resolveConfig(FIX, "override-merge.test");
    // merge-override sets ga4="G-OVERRIDE" (merge mode, default)
    expect(c.tracking.ga4).toBe("G-OVERRIDE");
    // gtm inherited from alpha (override didn't touch it)
    expect(c.tracking.gtm).toBe("GTM-ALPHA");
  });

  // C5
  it("C5: override tracking replace mode — wipes and replaces", async () => {
    const c = await resolveConfig(FIX, "override-replace.test");
    // replace-override: _mode=replace, ga4="G-REPLACE-ONLY"
    expect(c.tracking.ga4).toBe("G-REPLACE-ONLY");
    expect(c.tracking.gtm).toBeNull();
    expect(c.tracking.google_ads).toBeNull();
    expect(c.tracking.facebook_pixel).toBeNull();
  });

  // C6
  it("C6: override scripts replace mode — wipes inherited scripts", async () => {
    const c = await resolveConfig(FIX, "override-replace.test");
    // replace-override: _mode=replace, head=[replace-script], body_end=[]
    expect(c.scripts.head).toHaveLength(1);
    expect(c.scripts.head[0].id).toBe("replace-script");
    expect(c.scripts.head[0].src).toBe("/replace.js");
    // body_end wiped (was org-footer from org)
    expect(c.scripts.body_end).toHaveLength(0);
  });

  // C7
  it("C7: override scripts merge_by_id mode — merges by script ID", async () => {
    const c = await resolveConfig(FIX, "override-merge.test");
    // Inherited: [{id: org-analytics, src: alpha.js}, {id: alpha-script}]
    // Override merge_by_id: [{id: org-analytics, src: override.js}, {id: override-script}]

    // org-analytics replaced by override's version (same id)
    const analytics = c.scripts.head.find((s) => s.id === "org-analytics");
    expect(analytics).toBeDefined();
    expect(analytics!.src).toBe("https://analytics.example.com/override.js");

    // alpha-script preserved (override didn't touch it)
    expect(c.scripts.head.find((s) => s.id === "alpha-script")).toBeDefined();

    // override-script added
    expect(c.scripts.head.find((s) => s.id === "override-script")).toBeDefined();
  });

  // C8
  it("C8: override ads_config replaces entire ads config (default mode)", async () => {
    const c = await resolveConfig(FIX, "override-replace.test");
    // replace-override: ads_config with override-banner
    const overrideBanner = c.ads_config.ad_placements.find((p) => p.id === "override-banner");
    expect(overrideBanner).toBeDefined();
    expect(c.ads_config.interstitial).toBe(false);
    // alpha-banner gone (replaced)
    expect(c.ads_config.ad_placements.find((p) => p.id === "alpha-banner")).toBeUndefined();
  });

  // C9
  it("C9: override ads_txt add mode — appends entries", async () => {
    const c = await resolveConfig(FIX, "override-merge.test");
    // Inherited: org + alpha ads_txt
    expect(c.ads_txt).toContain("google.com, pub-org, DIRECT");
    expect(c.ads_txt).toContain("net-alpha.com, 111, DIRECT");
    // merge-override: plain array → add mode
    expect(c.ads_txt).toContain("override-extra.com, 555, DIRECT");
  });

  // C10
  it("C10: override ads_txt replace mode — wipes and replaces", async () => {
    const c = await resolveConfig(FIX, "override-replace.test");
    // replace-override: _mode=replace, _values=["override-only.com, 1, DIRECT"]
    expect(c.ads_txt).toContain("override-only.com, 1, DIRECT");
    expect(c.ads_txt).not.toContain("google.com, pub-org, DIRECT");
    expect(c.ads_txt).not.toContain("net-alpha.com, 111, DIRECT");
  });

  // C11
  it("C11: higher priority override wins over lower priority", async () => {
    const c = await resolveConfig(FIX, "override-priority.test");
    // low-priority (10): ga4="G-LOW", high-priority (50): ga4="G-HIGH"
    expect(c.tracking.ga4).toBe("G-HIGH");
  });

  // C12
  it("C12: applied_overrides lists IDs in priority order (low → high)", async () => {
    const c = await resolveConfig(FIX, "override-priority.test");
    const lowIdx = c.applied_overrides.indexOf("low-priority");
    const highIdx = c.applied_overrides.indexOf("high-priority");
    expect(lowIdx).toBeGreaterThanOrEqual(0);
    expect(highIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeLessThan(highIdx);
  });
});

// ---------------------------------------------------------------------------
// D. Combination / Cross-Layer Tests (10)
// ---------------------------------------------------------------------------

describe("QA — D. Cross-layer combination tests", () => {
  // D1
  it("D1: full chain tracking — org → group → override → site", async () => {
    const c = await resolveConfig(FIX, "combo-full-chain.test");
    // org: G-ORG → alpha: (no ga4) → beta: (no ga4)
    // merge-override (20): G-OVERRIDE → group-target (25): G-GROUP-TARGET
    // combo-site (50): (no ga4) → site: G-SITE
    // Site wins last
    expect(c.tracking.ga4).toBe("G-SITE");
  });

  // D2
  it("D2: site null clears an override value", async () => {
    const c = await resolveConfig(FIX, "combo-full-chain.test");
    // combo-site-override (50) sets gtm="GTM-COMBO-OVERRIDE"
    // site sets gtm: null → clears it
    expect(c.tracking.gtm).toBeNull();
  });

  // D3
  it("D3: group changes ad placement, override doesn't touch ads, site sees group's placement", async () => {
    const c = await resolveConfig(FIX, "override-merge.test");
    // org: [org-banner] → alpha: [alpha-banner] (replaces org)
    // merge-override: no ads_config → alpha-banner persists
    // site: no ads_config → alpha-banner persists
    const alpha = c.ads_config.ad_placements.find((p) => p.id === "alpha-banner");
    expect(alpha).toBeDefined();
    expect(alpha!.position).toBe("sidebar");
    expect(c.ads_config.ad_placements.find((p) => p.id === "org-banner")).toBeUndefined();
  });

  // D4
  it("D4: site ad_placements replace group chain's placements entirely", async () => {
    const c = await resolveConfig(FIX, "combo-ads-cascade.test");
    // After groups: alpha-banner is the last placement source
    // After overrides: merge-override has no ads_config → alpha-banner persists
    // Site defines [site-ad] → replaces alpha-banner entirely
    const siteAd = c.ads_config.ad_placements.find((p) => p.id === "site-ad");
    expect(siteAd).toBeDefined();
    expect(c.ads_config.ad_placements.find((p) => p.id === "alpha-banner")).toBeUndefined();
    // But other ads_config fields from group chain persist
    expect(c.ads_config.layout).toBe("high-density"); // from beta
  });

  // D5
  it("D5: scripts accumulate across org → group → override (merge_by_id)", async () => {
    const c = await resolveConfig(FIX, "combo-scripts-merge.test");
    // org: [org-analytics] → alpha: [org-analytics(replaced), alpha-script]
    // → beta: [org-analytics(replaced), beta-script]
    // → merge-override merge_by_id: [org-analytics(replaced), override-script]
    // Result: org-analytics, alpha-script, beta-script, override-script
    const ids = c.scripts.head.map((s) => s.id);
    expect(ids).toContain("org-analytics");
    expect(ids).toContain("alpha-script");
    expect(ids).toContain("beta-script");
    expect(ids).toContain("override-script");
  });

  // D6
  it("D6: ads_txt accumulates across org + groups + override (add) + site", async () => {
    const c = await resolveConfig(FIX, "combo-ads-cascade.test");
    // org + alpha + beta + merge-override (add) + site
    expect(c.ads_txt).toContain("google.com, pub-org, DIRECT");
    expect(c.ads_txt).toContain("net-alpha.com, 111, DIRECT");
    expect(c.ads_txt).toContain("net-beta.com, 222, DIRECT");
    expect(c.ads_txt).toContain("override-extra.com, 555, DIRECT");
    expect(c.ads_txt).toContain("site-ads.com, 99, DIRECT");
  });

  // D7
  it("D7: placeholder resolution uses merged vars from all layers", async () => {
    const c = await resolveConfig(FIX, "combo-scripts-merge.test");
    // override-script: "init('{{org_var}}', '{{group_var}}', '{{shared_var}}')"
    // Vars: org_var=org-value (org), group_var=combo-group-val (site), shared_var=combo-shared (site)
    const script = c.scripts.head.find((s) => s.id === "override-script");
    expect(script).toBeDefined();
    expect(script!.inline).toContain("org-value");
    expect(script!.inline).toContain("combo-group-val");
    expect(script!.inline).toContain("combo-shared");
    expect(script!.inline).not.toContain("{{");
  });

  // D8
  it("D8: theme merges across all layers", async () => {
    const c = await resolveConfig(FIX, "combo-full-chain.test");
    // org defaults → alpha (primary=#AA0000, secondary=#AA1111) → beta (primary=#BB0000, accent=#BBB)
    // → site (primary=#CCC, logo=/logo.svg)
    expect(c.theme.base).toBe("modern");
    expect(c.theme.colors.primary).toBe("#CCC");
    expect(c.theme.colors.secondary).toBe("#AA1111");
    expect(c.theme.colors.accent).toBe("#BBB");
    expect(c.theme.logo).toBe("/logo.svg");
    expect(c.theme.fonts.heading).toBe("Arial");
    expect(c.theme.fonts.body).toBe("Helvetica");
  });

  // D9
  it("D9: legal merges across org → group → site", async () => {
    const c = await resolveConfig(FIX, "combo-full-chain.test");
    // org: company_name, company_country=US
    // alpha legal_pages_override: company_country=UK
    // site: site_description
    expect(c.legal.company_name).toBe("QA Org Ltd");
    expect(c.legal.company_country).toBe("UK");
    expect(c.legal.site_description).toBe("Full chain test");
  });

  // D10
  it("D10: group-targeting + site-targeting overrides both apply", async () => {
    const c = await resolveConfig(FIX, "combo-full-chain.test");
    // merge-override (20, site targeting) + group-target-override (25, qa-group-beta)
    // + combo-site-override (50, site targeting)
    expect(c.applied_overrides).toContain("merge-override");
    expect(c.applied_overrides).toContain("group-target-override");
    expect(c.applied_overrides).toContain("combo-site-override");
    expect(c.applied_overrides).toHaveLength(3);
  });
});
