import { describe, expect, it } from "vitest";
import { normalizeConsent, parseCountryList } from "@/lib/config-normalizers";

describe("normalizeConsent", () => {
  it("returns undefined for a missing or empty block (= inherit)", () => {
    expect(normalizeConsent(undefined)).toBeUndefined();
    expect(normalizeConsent({})).toBeUndefined();
    expect(normalizeConsent("nope")).toBeUndefined();
  });

  it("keeps only valid keys", () => {
    expect(
      normalizeConsent({
        enabled: true,
        show_to: "countries",
        countries: ["de", "FR", "bad1"],
        message: "Hi",
        privacy_url: "/p",
        extra: 1,
      }),
    ).toEqual({ enabled: true, show_to: "countries", countries: ["DE", "FR"], message: "Hi", privacy_url: "/p" });
  });

  it("drops invalid values", () => {
    expect(normalizeConsent({ enabled: "yes", show_to: "banana", countries: "DE" })).toBeUndefined();
  });
});

describe("parseCountryList", () => {
  it("upper-cases, dedupes and drops invalid codes", () => {
    expect(parseCountryList("fr, de ,DE, germany,  ,it")).toEqual(["FR", "DE", "IT"]);
  });
});
