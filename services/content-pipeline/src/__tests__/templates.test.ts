import { describe, it, expect } from "vitest";
import { selectArticleType } from "../lib/templates.js";

describe("selectArticleType", () => {
  it("should return a valid article type", () => {
    const weights = { listicle: 40, standard: 30, "how-to": 20, review: 10 };
    const type = selectArticleType(weights);
    expect(Object.keys(weights)).toContain(type);
  });

  it("should always return the only type when weight is 100", () => {
    const type = selectArticleType({ listicle: 100 });
    expect(type).toBe("listicle");
  });
});
