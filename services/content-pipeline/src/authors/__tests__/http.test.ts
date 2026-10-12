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
});
