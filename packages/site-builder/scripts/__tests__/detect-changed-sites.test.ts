import { describe, it, expect } from "vitest";
import { join } from "node:path";

import {
  shouldBuildSite,
  changedMonetizationProfiles,
  affectedSitesForMonetizationChange,
} from "../detect-changed-sites.js";

const FIXTURES_MON = join(import.meta.dirname, "fixtures-mon");

// ---------------------------------------------------------------------------
// shouldBuildSite — monetization rule
// ---------------------------------------------------------------------------

describe("shouldBuildSite — monetization layer", () => {
  it("returns false when only monetization profiles changed", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "monetization/premium-ads.yaml",
        "monetization/standard-ads.yaml",
      ]),
    ).toBe(false);
  });

  it("still triggers a rebuild when a real site file also changed", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "monetization/premium-ads.yaml",
        "sites/muvizz.com/site.yaml",
      ]),
    ).toBe(true);
  });

  it("treats org.yaml as a full rebuild trigger (independent of monetization)", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "monetization/premium-ads.yaml",
        "org.yaml",
      ]),
    ).toBe(true);
  });

  it("triggers rebuild when the site's group config changed", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "groups/entertainment.yaml",
      ]),
    ).toBe(true);
  });

  it("does not rebuild a site when an unrelated group changed", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "groups/travel.yaml",
      ]),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// changedMonetizationProfiles
// ---------------------------------------------------------------------------

describe("changedMonetizationProfiles", () => {
  it("extracts profile ids from monetization/<id>.yaml", () => {
    expect(
      changedMonetizationProfiles([
        "monetization/premium-ads.yaml",
        "monetization/standard-ads.yaml",
        "sites/foo.com/site.yaml",
      ]),
    ).toEqual(["premium-ads", "standard-ads"]);
  });

  it("returns ['*'] when org.yaml changed (default_monetization shift)", () => {
    expect(
      changedMonetizationProfiles([
        "org.yaml",
        "monetization/premium-ads.yaml",
      ]),
    ).toEqual(["*"]);
  });

  it("returns empty array when nothing monetization-related changed", () => {
    expect(
      changedMonetizationProfiles([
        "sites/foo.com/articles/post.md",
        "groups/travel.yaml",
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// affectedSitesForMonetizationChange
// ---------------------------------------------------------------------------

describe("affectedSitesForMonetizationChange", () => {
  it("includes sites whose explicit profile matches a touched id", async () => {
    const affected = await affectedSitesForMonetizationChange(FIXTURES_MON, [
      "monetization/premium-ads.yaml",
    ]);

    // override-site.example.com has `monetization: premium-ads`
    expect(affected).toContain("override-site.example.com");
    // null-clear.example.com also picks premium-ads
    expect(affected).toContain("null-clear.example.com");
  });

  it("includes sites that inherit the touched profile from org default", async () => {
    // standard-ads is the org default in fixtures-mon/org.yaml
    const affected = await affectedSitesForMonetizationChange(FIXTURES_MON, [
      "monetization/standard-ads.yaml",
    ]);

    // default-site.example.com has no `monetization` field → inherits standard-ads
    expect(affected).toContain("default-site.example.com");
  });

  it("treats org.yaml change as affecting every site directory", async () => {
    const affected = await affectedSitesForMonetizationChange(FIXTURES_MON, [
      "org.yaml",
    ]);

    expect(affected).toEqual(
      expect.arrayContaining([
        "default-site.example.com",
        "override-site.example.com",
        "null-clear.example.com",
        "bad-profile.example.com",
      ]),
    );
  });

  it("includes sites whose own site.yaml changed (monetization may have shifted)", async () => {
    const affected = await affectedSitesForMonetizationChange(FIXTURES_MON, [
      "sites/default-site.example.com/site.yaml",
    ]);

    expect(affected).toEqual(["default-site.example.com"]);
  });

  it("returns empty when nothing monetization-relevant changed", async () => {
    const affected = await affectedSitesForMonetizationChange(FIXTURES_MON, [
      "groups/mon-group.yaml",
      "shared-pages/about.yaml",
    ]);

    expect(affected).toEqual([]);
  });
});
