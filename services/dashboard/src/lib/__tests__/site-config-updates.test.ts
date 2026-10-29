import { describe, it, expect } from "vitest";
import {
  snapshotSections,
  collectChangedSections,
  applyAdsTxtAndLegal,
  applyConsent,
  SAVED_SECTIONS,
} from "../site-config-updates";

const BASE = {
  tracking: { ga4: null },
  scripts: { head: [] },
  scripts_vars: {},
  ads_config: { layout: "standard" },
  ads_txt: [] as string[],
  legal: {} as Record<string, string>,
};

describe("collectChangedSections", () => {
  it("returns nothing when no section changed", () => {
    expect(collectChangedSections(BASE, snapshotSections(BASE))).toEqual({});
  });

  it("includes ads_txt when it changed", () => {
    const initial = snapshotSections(BASE);
    const form = { ...BASE, ads_txt: ["google.com, pub-1, DIRECT, f08c47fec0942fa0"] };
    expect(collectChangedSections(form, initial)).toEqual({ ads_txt: form.ads_txt });
  });

  it("includes legal when it changed", () => {
    const initial = snapshotSections(BASE);
    const form = { ...BASE, legal: { company_name: "Atomic Labs" } };
    expect(collectChangedSections(form, initial)).toEqual({ legal: form.legal });
  });

  it("still detects the original four sections", () => {
    const initial = snapshotSections(BASE);
    const form = { ...BASE, tracking: { ga4: "G-1" }, ads_config: { layout: "dense" } };
    expect(Object.keys(collectChangedSections(form, initial)).sort()).toEqual(["ads_config", "tracking"]);
  });
});

describe("applyAdsTxtAndLegal", () => {
  it("sets ads_txt, trimming lines and dropping blanks and duplicates", () => {
    const site: Record<string, unknown> = { domain: "a.com" };
    applyAdsTxtAndLegal(site, { ads_txt: ["  a.com, 1, DIRECT ", "", "a.com, 1, DIRECT", "b.com, 2, RESELLER"] });
    expect(site.ads_txt).toEqual(["a.com, 1, DIRECT", "b.com, 2, RESELLER"]);
  });

  it("removes ads_txt when the list is empty so org/group entries still apply", () => {
    const site: Record<string, unknown> = { ads_txt: ["old"] };
    applyAdsTxtAndLegal(site, { ads_txt: ["   "] });
    expect(site).not.toHaveProperty("ads_txt");
  });

  it("sets legal without blank values", () => {
    const site: Record<string, unknown> = {};
    applyAdsTxtAndLegal(site, { legal: { company_name: "Atomic", company_country: "  " } });
    expect(site.legal).toEqual({ company_name: "Atomic" });
  });

  it("removes legal when every value is blank", () => {
    const site: Record<string, unknown> = { legal: { company_name: "Old" } };
    applyAdsTxtAndLegal(site, { legal: { company_name: "" } });
    expect(site).not.toHaveProperty("legal");
  });

  it("leaves sections that were not sent untouched", () => {
    const site: Record<string, unknown> = { ads_txt: ["keep"], legal: { company_name: "Keep" }, tracking: { ga4: "G" } };
    applyAdsTxtAndLegal(site, {});
    expect(site).toEqual({ ads_txt: ["keep"], legal: { company_name: "Keep" }, tracking: { ga4: "G" } });
  });
});

describe("consent section", () => {
  it("is a saved section that collectChangedSections picks up", () => {
    expect(SAVED_SECTIONS).toContain("consent");
    const initial = snapshotSections({ consent: undefined });
    expect(collectChangedSections({ consent: { enabled: true } }, initial)).toEqual({ consent: { enabled: true } });
    // Reset to inherit: undefined would vanish from the JSON body, so it is sent as null.
    const was = snapshotSections({ consent: { enabled: true } });
    expect(collectChangedSections({ consent: undefined }, was)).toEqual({ consent: null });
  });

  it("applyConsent replaces the block, and an empty value removes it (inherit)", () => {
    const site: Record<string, unknown> = { consent: { enabled: true, message: "old" } };
    applyConsent(site, { consent: { enabled: false } });
    expect(site.consent).toEqual({ enabled: false });
    applyConsent(site, { consent: {} });
    expect(site).not.toHaveProperty("consent");
    site.consent = { enabled: true };
    applyConsent(site, { consent: undefined });
    expect(site.consent).toEqual({ enabled: true });
  });

  it("applyConsent removes the block when the request explicitly clears it with null", () => {
    const site: Record<string, unknown> = { consent: { enabled: true } };
    applyConsent(site, { consent: null });
    expect(site).not.toHaveProperty("consent");
  });
});
