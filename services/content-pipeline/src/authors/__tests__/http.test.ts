import { describe, expect, it } from "vitest";
import { parseGenerateBody } from "../http.js";

describe("parseGenerateBody", () => {
  it("accepts a valid request and defaults the optional parts", () => {
    expect(parseGenerateBody('{"part":"bio","draft":{"name":"Maya Ortiz"}}')).toEqual({
      part: "bio", draft: { name: "Maya Ortiz" }, siteContext: {}, takenNames: [],
    });
  });
  it("rejects an unknown part, a portrait without a valid author id, and bad JSON", () => {
    expect(() => parseGenerateBody('{"part":"logo"}')).toThrow(/part/);
    expect(() => parseGenerateBody('{"part":"portrait","draft":{"name":"Maya Ortiz"}}')).toThrow(/authorId/);
    expect(() => parseGenerateBody('{"part":"portrait","authorId":"../x","draft":{}}')).toThrow(/authorId/);
    expect(() => parseGenerateBody("nope")).toThrow(/JSON/);
  });
  it("portrait style: realistic by default, illustrated when asked, anything else refused", () => {
    expect(parseGenerateBody('{"part":"portrait","authorId":"maya-ortiz","draft":{}}').portraitStyle).toBe("realistic");
    expect(parseGenerateBody('{"part":"portrait","authorId":"maya-ortiz","portraitStyle":"illustrated","draft":{}}').portraitStyle).toBe("illustrated");
    expect(() => parseGenerateBody('{"part":"portrait","authorId":"maya-ortiz","portraitStyle":"anime","draft":{}}')).toThrow(/portraitStyle/);
  });
});
