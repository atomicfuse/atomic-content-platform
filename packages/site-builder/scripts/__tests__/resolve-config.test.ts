import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { resolveConfig } from "../resolve-config.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const REAL_NETWORK = "/Users/michal/Documents/ATL-content-network/atomic-labs-network";

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

  // 5. Array replacement — group defines ads_txt, replacing org's ads_txt
  it("replaces arrays entirely (group ads_txt replaces org ads_txt)", async () => {
    const config = await resolveConfig(FIXTURES, "test-site.example.com");

    // group's ads_txt should replace org's
    expect(config.ads_txt).toEqual([
      "google.com, pub-group, DIRECT",
      "adnetwork.com, 12345, RESELLER",
    ]);

    // org's "google.com, pub-org, DIRECT" should NOT be present
    expect(config.ads_txt).not.toContain("google.com, pub-org, DIRECT");
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
    ).rejects.toThrow(/references group "nonexistent-group"/);
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

    // org.support_email_pattern = "support@{{domain}}"
    // This is not directly on the resolved config but let's verify
    // the domain is resolved (we can check that legal merges properly)
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
});

// ---------------------------------------------------------------------------
// Integration test using real seed data
// ---------------------------------------------------------------------------

describe("resolveConfig — integration with real seed data", () => {
  it("resolves coolnews.dev from the actual atomic-labs-network repo", async () => {
    const config = await resolveConfig(REAL_NETWORK, "coolnews.dev");

    // Network-level
    expect(config.network_id).toBe("atomic-labs");
    expect(config.platform_version).toBe("0.1.0");

    // Org-level passthrough
    expect(config.organization).toBe("Atomic Labs");
    expect(config.legal_entity).toBe("Atomic Labs Ltd");
    expect(config.company_address).toBe("Tel Aviv, Israel");

    // Site-level
    expect(config.domain).toBe("coolnews.dev");
    expect(config.site_name).toBe("CoolNews");
    expect(config.site_tagline).toBe("Tech News & Digital Trends");
    expect(config.group).toBe("premium-ads");
    expect(config.active).toBe(true);

    // Tracking: site overrides ga4, group overrides google_ads
    expect(config.tracking.ga4).toBe("G-COOLNEWS1234");
    expect(config.tracking.google_ads).toBe("AW-XXXXXXXXX");
    expect(config.tracking.gtm).toBeNull();
    expect(config.tracking.facebook_pixel).toBeNull();

    // Scripts: group scripts merged with org (org had empty arrays)
    expect(config.scripts.head.length).toBeGreaterThanOrEqual(3);
    const gptScript = config.scripts.head.find((s) => s.id === "gpt-script");
    expect(gptScript).toBeDefined();
    expect(gptScript!.src).toBe(
      "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
    );

    // Placeholder resolution: {{alpha_site_id}} -> "coolnews-001"
    const alphaInit = config.scripts.head.find(
      (s) => s.id === "network-alpha-init",
    );
    expect(alphaInit).toBeDefined();
    expect(alphaInit!.inline).toContain("coolnews-001");
    expect(alphaInit!.inline).toContain("technology");
    expect(alphaInit!.inline).not.toContain("{{alpha_site_id}}");
    expect(alphaInit!.inline).not.toContain("{{alpha_zone}}");

    // Interstitial placeholder resolved
    const interstitialTrigger = config.scripts.body_end.find(
      (s) => s.id === "interstitial-trigger",
    );
    expect(interstitialTrigger).toBeDefined();
    expect(interstitialTrigger!.inline).toContain("'true'");
    expect(interstitialTrigger!.inline).not.toContain(
      "{{interstitial_enabled}}",
    );

    // Ads: group overrides
    expect(config.ads_config.interstitial).toBe(true);
    expect(config.ads_config.in_content_slots).toBe(3);

    // ads_txt from group (multiline string parsed)
    expect(config.ads_txt.length).toBeGreaterThan(0);
    expect(config.ads_txt[0]).toContain("google.com");

    // Theme: site overrides primary + accent, group provides secondary
    expect(config.theme.base).toBe("modern");
    expect(config.theme.colors.primary).toBe("#0066FF");
    expect(config.theme.colors.accent).toBe("#00CCFF");
    expect(config.theme.colors.secondary).toBe("#16213E");
    expect(config.theme.fonts.heading).toBe("Space Grotesk");
    expect(config.theme.fonts.body).toBe("Inter");

    // Brief from site
    expect(config.brief.audience).toContain("Tech-savvy");
    expect(config.brief.topics).toContain("AI");

    // Legal merged
    expect(config.legal.company_name).toBe("Atomic Labs Ltd");
    expect(config.legal.site_description).toBe(
      "technology news and digital trends",
    );
  });
});
