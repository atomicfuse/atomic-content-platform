import { describe, it, expect } from "vitest";
import { join } from "node:path";

import {
  shouldBuildSite,
  changedOverrideIds,
  affectedSitesForOverrideChange,
} from "../detect-changed-sites.js";

const FIXTURES_MON = join(import.meta.dirname, "fixtures-mon");

// ---------------------------------------------------------------------------
// shouldBuildSite — basic rules
// ---------------------------------------------------------------------------

describe("shouldBuildSite — basic rules", () => {
  it("triggers rebuild when site's own files changed", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "sites/muvizz.com/site.yaml",
      ]),
    ).toBe(true);
  });

  it("triggers rebuild when org.yaml changed", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
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

  it("does not rebuild when only unrelated sites changed", () => {
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "sites/other.com/site.yaml",
      ]),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldBuildSite — overrides
// ---------------------------------------------------------------------------

describe("shouldBuildSite — override changes", () => {
  it("triggers rebuild when an override config changed (no target info)", () => {
    // Without overrideTargets, any override change triggers rebuild (conservative)
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "overrides/config/test-override.yaml",
      ]),
    ).toBe(true);
  });

  it("triggers rebuild when override targets this site", () => {
    const targets = new Map([
      ["test-override", { groups: [], sites: ["muvizz.com"] }],
    ]);
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "overrides/config/test-override.yaml",
      ], targets),
    ).toBe(true);
  });

  it("triggers rebuild when override targets this site's group", () => {
    const targets = new Map([
      ["test-override", { groups: ["entertainment"], sites: [] }],
    ]);
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "overrides/config/test-override.yaml",
      ], targets),
    ).toBe(true);
  });

  it("does not rebuild when override targets different site/group", () => {
    const targets = new Map([
      ["test-override", { groups: ["sports"], sites: ["other.com"] }],
    ]);
    expect(
      shouldBuildSite("muvizz.com", "entertainment", [
        "overrides/config/test-override.yaml",
      ], targets),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// changedOverrideIds
// ---------------------------------------------------------------------------

describe("changedOverrideIds", () => {
  it("extracts override ids from overrides/config/<id>.yaml", () => {
    expect(
      changedOverrideIds([
        "overrides/config/test-ads-mock.yaml",
        "overrides/config/newsletter-popup.yaml",
        "sites/foo.com/site.yaml",
      ]),
    ).toEqual(["test-ads-mock", "newsletter-popup"]);
  });

  it("returns empty array when no override configs changed", () => {
    expect(
      changedOverrideIds([
        "sites/foo.com/articles/post.md",
        "groups/travel.yaml",
      ]),
    ).toEqual([]);
  });

  it("ignores shared-page overrides (overrides/<site_id>/)", () => {
    expect(
      changedOverrideIds([
        "overrides/coolnews-atl/about.yaml",
      ]),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// affectedSitesForOverrideChange
// ---------------------------------------------------------------------------

describe("affectedSitesForOverrideChange", () => {
  it("includes sites targeted by a changed override", async () => {
    const affected = await affectedSitesForOverrideChange(FIXTURES_MON, [
      "overrides/config/test-ads-mock.yaml",
    ]);

    // test-ads-mock targets override-site.example.com directly
    expect(affected).toContain("override-site.example.com");
  });

  it("treats org.yaml change as affecting every site directory", async () => {
    const affected = await affectedSitesForOverrideChange(FIXTURES_MON, [
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

  it("includes sites whose own site.yaml changed", async () => {
    const affected = await affectedSitesForOverrideChange(FIXTURES_MON, [
      "sites/default-site.example.com/site.yaml",
    ]);

    expect(affected).toEqual(["default-site.example.com"]);
  });

  it("returns empty when nothing relevant changed", async () => {
    const affected = await affectedSitesForOverrideChange(FIXTURES_MON, [
      "groups/mon-group.yaml",
      "shared-pages/about.yaml",
    ]);

    expect(affected).toEqual([]);
  });
});
