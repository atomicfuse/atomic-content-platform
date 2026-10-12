import { describe, expect, it } from "vitest";
import { inheritedTracking, normalizeTrackingId } from "../tracking-ids";

describe("normalizeTrackingId", () => {
  it("accepts the usual formats, trimmed and upper-cased", () => {
    expect(normalizeTrackingId("ga4", "  g-abc123xyz ")).toEqual({ ok: true, value: "G-ABC123XYZ" });
    expect(normalizeTrackingId("gtm", "gtm-k9x2l4")).toEqual({ ok: true, value: "GTM-K9X2L4" });
    expect(normalizeTrackingId("facebook_pixel", " 1234567890123 ")).toEqual({ ok: true, value: "1234567890123" });
  });
  it("explains a wrong format", () => {
    expect(normalizeTrackingId("ga4", "UA-12345-1")).toMatchObject({ ok: false, error: expect.stringMatching(/G-/) });
    expect(normalizeTrackingId("gtm", "G-ABC")).toMatchObject({ ok: false, error: expect.stringMatching(/GTM-/) });
    expect(normalizeTrackingId("facebook_pixel", "abc")).toMatchObject({ ok: false, error: expect.stringMatching(/digits/) });
    expect(normalizeTrackingId("ga4", "  ")).toMatchObject({ ok: false });
  });
});

describe("inheritedTracking", () => {
  it("is the org value overridden by the site's groups in order (later wins); empty values don't override", () => {
    const inheritance = {
      org: { tracking: { ga4: "G-ORG", gtm: "GTM-ORG" } },
      groups: [
        { id: "ready", config: { tracking: { ga4: "G-READY", gtm: null } } },
        { id: "premium-ads", config: { tracking: { ga4: "G-PREMIUM" } } },
      ],
    };
    expect(inheritedTracking(inheritance, "ga4")).toEqual({ value: "G-PREMIUM", from: "group premium-ads" });
    expect(inheritedTracking(inheritance, "gtm")).toEqual({ value: "GTM-ORG", from: "organization" });
    expect(inheritedTracking(inheritance, "facebook_pixel")).toBeNull();
    expect(inheritedTracking(null, "ga4")).toBeNull();
  });
});
