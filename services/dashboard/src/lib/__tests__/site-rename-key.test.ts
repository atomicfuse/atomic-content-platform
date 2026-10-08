import { describe, expect, it } from "vitest";
import { siteRenameKey } from "../site-rename-key";

describe("siteRenameKey", () => {
  it("moves a site's files to the new prefix", () => {
    expect(siteRenameKey("aliensrus/assets/images/some-article.webp", "aliensrus", "hiddenstorydaily"))
      .toBe("hiddenstorydaily/assets/images/some-article.webp");
  });
  it("also renames the site's default article image, which articles reference by the NEW site name", () => {
    expect(siteRenameKey("aliensrus/assets/images/aliensrus-general-article.webp", "aliensrus", "hiddenstorydaily"))
      .toBe("hiddenstorydaily/assets/images/hiddenstorydaily-general-article.webp");
  });
  it("leaves keys outside the old site's prefix alone", () => {
    expect(siteRenameKey("other/assets/logo.png", "aliensrus", "hiddenstorydaily")).toBe("other/assets/logo.png");
  });
});
