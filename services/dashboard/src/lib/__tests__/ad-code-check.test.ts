import { describe, expect, it } from "vitest";
import { adCodeWarnings } from "../ad-code-check";

describe("adCodeWarnings", () => {
  it("passes when the loader names a div declared in the snippet", () => {
    expect(adCodeWarnings(`<div id="feed-card"></div>\n<script>_sf_loadWidget("feed-card", {qs: "x"});</script>`)).toEqual([]);
  });
  it("flags a loader id with no matching element", () => {
    const warnings = adCodeWarnings(`<div id="feed-card"></div>\n<script>_sf_loadWidget("widget1", {qs: "x"});</script>`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('_sf_loadWidget("widget1")');
  });
  it("checks _atl_loadWidget too, and ignores code without loader calls", () => {
    expect(adCodeWarnings(`<script>window._atl_loadWidget('atl-x', {})</script>`)).toHaveLength(1);
    expect(adCodeWarnings('<script>window.x = 1</script>')).toEqual([]);
    expect(adCodeWarnings(undefined)).toEqual([]);
  });
});
