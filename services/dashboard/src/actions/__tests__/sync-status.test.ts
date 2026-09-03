import { describe, it, expect } from "vitest";

import { computeCorrectStatus } from "@/lib/site-status";
import type { SiteStatus } from "@/types/dashboard";

function site(overrides: {
  staging_branch?: string | null;
  status?: SiteStatus;
  custom_domain?: string | null;
}): { staging_branch: string | null; status: SiteStatus; custom_domain: string | null } {
  return {
    staging_branch: "staging/example",
    status: "Ready",
    custom_domain: null,
    ...overrides,
  };
}

describe("computeCorrectStatus — Cloudflare sync self-heal", () => {
  it("promotes a stuck-Ready site with a custom domain to Live (DogsLabs case)", () => {
    const result = computeCorrectStatus(
      site({ status: "Ready", custom_domain: "dogslabs.com" }),
      true,
      true,
    );
    expect(result).toBe("Live");
  });

  it("keeps a Live site with a custom domain Live", () => {
    expect(
      computeCorrectStatus(site({ status: "Live", custom_domain: "dogslabs.com" }), true, true),
    ).toBe("Live");
  });

  it("keeps Staging sticky even when a custom domain is present (unpublish intent wins)", () => {
    expect(
      computeCorrectStatus(site({ status: "Staging", custom_domain: "dogslabs.com" }), true, true),
    ).toBe("Staging");
  });

  it("keeps Ready when there is a staging branch and no domain", () => {
    expect(computeCorrectStatus(site({ status: "Ready" }), true, true)).toBe("Ready");
  });

  it("keeps Live when there is a staging branch and no domain (legacy behavior)", () => {
    expect(computeCorrectStatus(site({ status: "Live" }), false, true)).toBe("Live");
  });

  it("promotes a branchless site with a custom domain to Live", () => {
    expect(
      computeCorrectStatus(
        site({ staging_branch: null, status: "Ready", custom_domain: "x.com" }),
        false,
        false,
      ),
    ).toBe("Live");
  });

  it("falls back to Ready when only a Cloudflare zone exists", () => {
    expect(computeCorrectStatus(site({ staging_branch: null }), true, false)).toBe("Ready");
  });

  it("falls back to Staging when only a site config exists", () => {
    expect(computeCorrectStatus(site({ staging_branch: null }), false, true)).toBe("Staging");
  });

  it("returns null (orphaned) when nothing exists", () => {
    expect(computeCorrectStatus(site({ staging_branch: null }), false, false)).toBeNull();
  });
});
