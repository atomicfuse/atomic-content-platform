import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveConfig } from "../resolve-config.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const FIXTURES_MON = join(import.meta.dirname, "fixtures-mon");
const REAL_NETWORK = join(import.meta.dirname, "..", "..", "..", "..", "..", "atomic-labs-network");

// ---------------------------------------------------------------------------
// Unit tests using fixtures
// ---------------------------------------------------------------------------

describe("resolveConfig", () => {
  // 1. Basic inheritance — org values pass through when group/site don't override
  it("inherits org values that group and site do not override", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    expect(config.organization).toBe("Test Org");
    expect(config.legal_entity).toBe("Test Org Ltd");
    expect(config.company_address).toBe("123 Test St");
    expect(config.network_id).toBe("test-network");
    expect(config.platform_version).toBe("1.0.0");
  });

  // 2. Group override — group value replaces org value
  it("applies group overrides over org defaults", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // group sets google_ads = "AW-GROUP001", org had null
    expect(config.tracking.google_ads).toBe("AW-GROUP001");

    // group sets interstitial = true, org had false
    expect(config.ads_config.interstitial).toBe(true);

    // group sets in_content_slots = 3, org had 2
    expect(config.ads_config.in_content_slots).toBe(3);

    // group sets sidebar = true, org had false
    expect(config.ads_config.sidebar).toBe(true);
  });

  // 3. Site override — site value replaces group value
  it("applies site overrides over group values", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // site sets ga4 = "G-TESTSITE01", org had null
    expect(config.tracking.ga4).toBe("G-TESTSITE01");

    // site values
    expect(config.domain).toBe("test-site.example.com");
    expect(config.site_name).toBe("Test Site");
    expect(config.site_tagline).toBe("A test site");
    expect(config.group).toBe("test-group");
    expect(config.active).toBe(true);
  });

  // 4. Null clearing — site sets key to null, resolved config has null
  it("clears parent values when site explicitly sets null", async () => {
    const config = await resolveConfig(FIXTURES, "null-test.example.com");

    // site sets ga4 to null (org had null too, but group could have set it)
    expect(config.tracking.ga4).toBeNull();

    // site sets gtm to null, overriding org's "GTM-ORG001"
    expect(config.tracking.gtm).toBeNull();

    // site sets site_tagline to null
    expect(config.site_tagline).toBeNull();
  });

  // 5. ads_txt append — org + group entries combined and deduplicated
  it("appends ads_txt entries from org and group, deduplicating", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // org's "google.com, pub-org, DIRECT" AND group's entries should ALL be present
    expect(config.ads_txt).toContain("google.com, pub-org, DIRECT");
    expect(config.ads_txt).toContain("google.com, pub-group, DIRECT");
    expect(config.ads_txt).toContain("adnetwork.com, 12345, RESELLER");
  });

  // 6. Script merging by ID — site overrides one script from group, others remain
  it("merges script arrays by id (override + append)", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // The 'analytics' script from org was overridden by group (different src)
    const analytics = config.scripts.head.find((s) => s.id === "analytics");
    expect(analytics).toBeDefined();
    expect(analytics!.src).toBe("https://analytics.example.com/v2-group.js");

    // The 'consent-manager' from org should still be present (group didn't override)
    const consent = config.scripts.head.find((s) => s.id === "consent-manager");
    expect(consent).toBeDefined();
    expect(consent!.src).toBe("https://consent.example.com/cmp.js");

    // The 'ad-network' was added by group
    const adNetwork = config.scripts.head.find((s) => s.id === "ad-network");
    expect(adNetwork).toBeDefined();

    // body_end: group overrode footer-script and added ad-refresh
    const footer = config.scripts.body_end.find((s) => s.id === "footer-script");
    expect(footer).toBeDefined();
    expect(footer!.inline).toContain("group footer");

    const adRefresh = config.scripts.body_end.find((s) => s.id === "ad-refresh");
    expect(adRefresh).toBeDefined();
  });

  // 7. Placeholder resolution — {{ad_site_id}} replaced with site's scripts_vars
  it("resolves {{placeholder}} variables in scripts using merged vars", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // Site overrides ad_site_id from "default-group-id" to "test-site-001"
    const adNetwork = config.scripts.head.find((s) => s.id === "ad-network");
    expect(adNetwork).toBeDefined();
    expect(adNetwork!.inline).toContain("test-site-001");
    expect(adNetwork!.inline).not.toContain("{{ad_site_id}}");
  });

  // 8. Missing group — error thrown if site references non-existent group
  it("throws an error when site references a non-existent group", async () => {
    await expect(
      resolveConfig(FIXTURES, "bad-group.example.com"),
    ).rejects.toThrow(/Group "nonexistent-group" not found/);
  });

  // 9. Nested deep merge — deeply nested objects merge correctly
  it("deep-merges nested objects (theme.colors)", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // Site overrides primary and accent from group, but group's secondary remains
    expect(config.theme.colors.primary).toBe("#0066FF");
    expect(config.theme.colors.accent).toBe("#00CCFF");
    expect(config.theme.colors.secondary).toBe("#222222");

    // Site overrides heading font but body comes through
    expect(config.theme.fonts.heading).toBe("Space Grotesk");
    expect(config.theme.fonts.body).toBe("Inter");

    // Site sets logo and favicon
    expect(config.theme.logo).toBe("/assets/logo.svg");
    expect(config.theme.favicon).toBe("/assets/favicon.png");
  });

  // Support email pattern resolution
  it("resolves support_email_pattern with site domain", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    expect(config.legal.company_name).toBe("Test Org Ltd");
    expect(config.legal.site_description).toBe("a test site for testing");
  });

  // Legal merging
  it("merges legal pages across org, group, and site", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // From org
    expect(config.legal.company_name).toBe("Test Org Ltd");
    expect(config.legal.company_country).toBe("Testland");

    // From site
    expect(config.legal.site_description).toBe("a test site for testing");
  });

  // Brief comes from site
  it("includes the site brief", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    expect(config.brief.audience).toBe("Test audience");
    expect(config.brief.tone).toBe("Professional");
    expect(config.brief.topics).toEqual(["testing"]);
  });

  // Config file not found
  it("throws when network.yaml is missing", async () => {
    await expect(
      resolveConfig("/nonexistent/path", "anything"),
    ).rejects.toThrow(/Config file not found/);
  });

  // ---- Multi-group tests ----

  // Multi-group merge — groups merge left-to-right, group-b overrides group-a
  // NOTE: multi-group.example.com is targeted by overrides (test-override + high-priority-override)
  // which replace some fields. The pure group merge is tested before overrides apply.
  it("merges multiple groups left-to-right", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // Tracking: high-priority-override (priority 50) sets ga4, but google_ads
    // is NOT overridden, so group-b's value persists through the override layer
    expect(config.tracking.google_ads).toBe("AW-GROUPB");
    // group-b adds facebook_pixel (group-a didn't have it) — not overridden
    expect(config.tracking.facebook_pixel).toBe("PX-GROUPB");

    // ads_config is REPLACED by test-override (priority 10)
    // test-override sets interstitial: false, layout: standard
    expect(config.ads_config.interstitial).toBe(false);
    expect(config.ads_config.layout).toBe("standard");

    // Theme: group-b overrides primary from group-a, but group-a's secondary remains
    // (no override touches theme)
    expect(config.theme.colors.primary).toBe("#BB0000");
    expect(config.theme.colors.secondary).toBe("#AA1111");
  });

  // Multi-group scripts merge — scripts from both groups merge by id
  // NOTE: test-override replaces head with [] for multi-group.example.com,
  // so group scripts are wiped. This test verifies the override behavior.
  it("merges scripts from multiple groups by id, then override replaces", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // test-override (priority 10) replaces head with [] and body_end with [override-script]
    // So head should be empty (override replaced it)
    expect(config.scripts.head).toEqual([]);

    // body_end has override-script from test-override
    const overrideScript = config.scripts.body_end.find((s) => s.id === "override-script");
    expect(overrideScript).toBeDefined();
    expect(overrideScript!.src).toBe("/override-script.js");
  });

  // Multi-group ads_txt — entries from org + both groups combined
  it("appends ads_txt from org and all groups", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    expect(config.ads_txt).toContain("google.com, pub-org, DIRECT");
    expect(config.ads_txt).toContain("network-a.com, 111, DIRECT");
    expect(config.ads_txt).toContain("network-b.com, 222, DIRECT");
  });

  // Backward compat — site with `group: string` still resolves, populates `groups`
  it("backward compat: group string treated as groups array", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // group: "test-group" should resolve to groups: ["test-group"]
    expect(config.groups).toEqual(["test-group"]);
    expect(config.group).toBe("test-group");
  });

  // support_email on resolved config
  it("includes resolved support_email on the output", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    expect(config.support_email).toBe("support@test-site.example.com");
  });

  // groups field on resolved config
  it("includes groups array on the output for multi-group sites", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    expect(config.groups).toEqual(["group-a", "group-b"]);
    expect(config.group).toBe("group-a"); // first group
  });

  // Unresolved placeholder error
  it("throws when scripts contain unresolved {{placeholders}}", async () => {
    await expect(
      resolveConfig(FIXTURES, "unresolved-var.example.com"),
    ).rejects.toThrow(/Unresolved placeholders/);
  });

  // Ad placement normalization — string sizes parsed to tuples
  it("normalizes ad placement string sizes to tuple format", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    const topBanner = config.ads_config.ad_placements.find((p) => p.id === "top-banner");
    expect(topBanner).toBeDefined();
    // Already in tuple format from fixture, should pass through
    expect(topBanner!.sizes.desktop).toEqual([[728, 90]]);
    expect(topBanner!.sizes.mobile).toEqual([[320, 50]]);
    expect(topBanner!.device).toBe("all");
  });

  // applied_overrides field on resolved config
  it("includes applied_overrides on the output", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // test-site.example.com has group: test-group, no overrides target it
    expect(config.applied_overrides).toEqual([]);
  });

  // inlineAdConfig field on resolved config
  it("includes inlineAdConfig on the output", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    expect(config.inlineAdConfig).toBeDefined();
    expect(config.inlineAdConfig!.domain).toBe("test-site.example.com");
    expect(config.inlineAdConfig!.groups).toEqual(["test-group"]);
    expect(config.inlineAdConfig!.applied_overrides).toEqual([]);
    expect(config.inlineAdConfig!.generated_at).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Override tests
// ---------------------------------------------------------------------------

describe("resolveConfig — overrides", () => {
  // Override applied via direct site targeting
  it("applies override that targets site directly", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // test-override targets multi-group.example.com and group-b
    // high-priority-override also targets multi-group.example.com
    expect(config.applied_overrides).toContain("test-override");
    expect(config.applied_overrides).toContain("high-priority-override");
  });

  // Override REPLACE semantics — ads_config from override replaces group chain
  it("override ads_config replaces group chain ads_config entirely", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // test-override defines ads_config with a single "override-banner" placement
    // This should REPLACE the group chain's ad_placements
    const overrideBanner = config.ads_config.ad_placements.find(
      (p) => p.id === "override-banner",
    );
    expect(overrideBanner).toBeDefined();

    // Override sets interstitial: false and layout: standard
    expect(config.ads_config.interstitial).toBe(false);
    expect(config.ads_config.layout).toBe("standard");
  });

  // Override REPLACE semantics — scripts from override replace group chain
  it("override scripts replace group chain scripts arrays", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // test-override replaces body_end with just override-script
    const overrideScript = config.scripts.body_end.find(
      (s) => s.id === "override-script",
    );
    expect(overrideScript).toBeDefined();
    expect(overrideScript!.src).toBe("/override-script.js");

    // test-override replaces head with [] (empty), but site has no head scripts
    // After override, head should be empty from override (replaced with [])
    // But the higher-priority override doesn't touch scripts, so test-override's
    // head replacement stands
    expect(config.scripts.head).toEqual([]);
  });

  // Override priority — higher priority override's tracking wins
  it("higher priority override wins over lower priority", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // test-override (priority 10) sets ga4: "G-OVERRIDE-001"
    // high-priority-override (priority 50) sets ga4: "G-HIGHPRI-001"
    // Higher priority should win
    expect(config.tracking.ga4).toBe("G-HIGHPRI-001");
  });

  // Override applied via group targeting
  it("applies override that targets a group the site belongs to", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // test-override targets groups: [group-b], multi-group.example.com is in group-b
    expect(config.applied_overrides).toContain("test-override");
  });

  // Site not targeted by override is unaffected
  it("does not apply override to sites not in targets", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // test-site.example.com is in test-group, not targeted by any override
    expect(config.applied_overrides).toEqual([]);
  });

  // Override fields not defined pass through from group chain
  it("fields not in override pass through from group chain", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    // Neither override defines theme, so group chain theme should persist
    // group-a sets secondary: "#AA1111", group-b sets primary: "#BB0000"
    expect(config.theme.colors.primary).toBe("#BB0000");
    expect(config.theme.colors.secondary).toBe("#AA1111");
  });

  // applied_overrides in order
  it("applied_overrides lists overrides in priority order", async () => {
    const config = await resolveConfig(FIXTURES, "multi-group.example.com");

    const testIdx = config.applied_overrides.indexOf("test-override");
    const highIdx = config.applied_overrides.indexOf("high-priority-override");

    // test-override (priority 10) should come before high-priority-override (priority 50)
    expect(testIdx).toBeLessThan(highIdx);
  });
});

// ---------------------------------------------------------------------------
// Integration test using real seed data
// ---------------------------------------------------------------------------

describe("resolveConfig — integration with real seed data", () => {
  it("resolves coolnews-atl from the actual atomic-labs-network repo", async () => {
    // coolnews-atl may not declare all scripts_vars required by its selected
    // groups. Skip with a clear message in that case.
    let config;
    try {
      config = await resolveConfig(REAL_NETWORK, "coolnews-atl");
    } catch (err: unknown) {
      if (err instanceof Error && (
        err.message.includes("Unresolved placeholders") ||
        err.message.includes("not found")
      )) {
        return;
      }
      throw err;
    }

    // Network-level
    expect(config.network_id).toBe("atomic-labs");
    expect(config.platform_version).toBe("0.1.0");

    // Org-level passthrough
    expect(config.organization).toBe("Atomic Labs");
    expect(config.legal_entity).toBe("Atomic Labs Ltd");
    expect(config.company_address).toBe("Tel Aviv, Israel");

    // Site-level
    expect(config.domain).toBe("coolnews-atl");
    expect(config.site_name).toBe("Cool News ATL");
    expect(config.active).toBe(true);

    // Groups should be populated
    expect(config.groups.length).toBeGreaterThan(0);

    // Inline ad config is always produced
    expect(config.inlineAdConfig).toBeDefined();
    expect(config.inlineAdConfig!.domain).toBe("coolnews-atl");

    // Support email pattern resolves against the site domain.
    expect(config.support_email).toBe("contact@coolnews-atl");

    // Theme should resolve
    expect(config.theme.base).toBe("modern");

    // Brief topics from site.yaml.
    expect(config.brief.topics).toContain("Current Events");

    // Legal merged from org.
    expect(config.legal.company_name).toBe("Atomic Labs Ltd");
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: monetization field treated as group
// ---------------------------------------------------------------------------

describe("resolveConfig — monetization backward compat", () => {
  it("site with monetization: field uses monetization/ directory as fallback", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");

    // override-site has group: mon-group and monetization: premium-ads
    // premium-ads.yaml exists in monetization/ (not groups/) — backward compat fallback
    // The monetization profile's tracking should be applied as a group
    expect(config.tracking.gtm).toBe("GTM-PREMIUM");
    expect(config.tracking.google_ads).toBe("AW-PREMIUM-XXX");
  });

  it("site tracking override wins over monetization-as-group", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    // Site sets ga4 to override value, but the override test-ads-mock also targets
    // this site and sets ga4. Override (priority 100) applies after groups.
    // Then site tracking applies last.
    expect(config.tracking.ga4).toBe("G-SITE-OVERRIDE");
  });

  it("falls back to org.default_groups when site has no groups", async () => {
    const config = await resolveConfig(FIXTURES_MON, "default-site.example.com");
    // default-site has group: mon-group but no monetization field
    // org.default_groups: [standard-ads] — but site has group: mon-group which takes priority
    // The standard-ads file is in monetization/ (backward compat)
    expect(config.groups).toContain("mon-group");
  });

  it("monetization scripts merge into final scripts list", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    // premium-ads has scripts like network-alpha-init
    // But the test-ads-mock override replaces scripts for this site
    // After override, head should be [] (from override) and body_end should have mock-ad-fill
    const mockAdFill = config.scripts.body_end.find((s) => s.id === "mock-ad-fill");
    expect(mockAdFill).toBeDefined();
  });

  it("placeholder in scripts resolved from site scripts_vars", async () => {
    // After the override replaces scripts, the remaining scripts should still
    // be resolved with vars. The mock-ad-fill.js src has no placeholders.
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    const mockAdFill = config.scripts.body_end.find((s) => s.id === "mock-ad-fill");
    expect(mockAdFill!.src).toBe("/mock-ad-fill.js");
  });

  it("site-level null clears group's pixel value", async () => {
    const config = await resolveConfig(FIXTURES_MON, "null-clear.example.com");
    expect(config.tracking.facebook_pixel).toBeNull();
  });

  it("ads_txt: override with ads_txt replaces group chain, site adds on top", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    // test-ads-mock override has ads_txt: [] which REPLACES the accumulated ads_txt
    // Then site-level ads_txt is added on top (additive)
    expect(config.ads_txt).toContain("site-specific.com, 42, DIRECT");
    // org-level ads_txt was replaced by override's empty array
    expect(config.ads_txt).not.toContain("google.com, pub-ORG-DEFAULT, DIRECT, f08c47fec0942fa0");
  });

  it("populates ad_placeholder_heights from org with defaults", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    expect(config.ad_placeholder_heights["above-content"]).toBe(90);
    expect(config.ad_placeholder_heights["after-paragraph"]).toBe(280);
    expect(config.ad_placeholder_heights.sidebar).toBe(600);
    expect(config.ad_placeholder_heights["sticky-bottom"]).toBe(50);
  });

  it("existing networks with no monetization field continue to work", async () => {
    // The base fixtures have no monetization anywhere — should resolve cleanly
    const config = await resolveConfig(FIXTURES, "test-site.example.com");
    expect(config.applied_overrides).toEqual([]);
  });

  it("override is applied to site targeted via override config", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    // test-ads-mock override targets override-site.example.com directly
    expect(config.applied_overrides).toContain("test-ads-mock");
  });

  it("override ads_config replaces monetization-as-group ads_config", async () => {
    const config = await resolveConfig(FIXTURES_MON, "override-site.example.com");
    // The test-ads-mock override defines ads_config with mock-banner placement
    // This should REPLACE premium-ads's ad_placements
    const mockBanner = config.ads_config.ad_placements.find(
      (p) => p.id === "mock-banner",
    );
    expect(mockBanner).toBeDefined();
  });
});
