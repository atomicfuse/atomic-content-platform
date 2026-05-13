import { describe, it, expect } from "vitest";
import type { AggregatorCategory } from "../../agents/migration/category-resolver.js";
import {
  matchVertical,
  matchSubcategories,
} from "../../agents/migration/category-resolver.js";

const MOCK_VERTICALS: AggregatorCategory[] = [
  { id: "v1", name: "Style & Fashion", parent_id: null },
  { id: "v2", name: "Technology & Computing", parent_id: null },
  { id: "v3", name: "Healthy Living", parent_id: null },
];

const MOCK_SUBCATEGORIES: AggregatorCategory[] = [
  { id: "c1", name: "Hair Care", parent_id: "v1" },
  { id: "c2", name: "Makeup and Accessories", parent_id: "v1" },
  { id: "c3", name: "Nail Care", parent_id: "v1" },
  { id: "c4", name: "Skin Care", parent_id: "v1" },
];

describe("matchVertical", () => {
  it("returns exact match", () => {
    const result = matchVertical("Style & Fashion", MOCK_VERTICALS);
    expect(result).toEqual(MOCK_VERTICALS[0]);
  });

  it("returns case-insensitive match", () => {
    const result = matchVertical("healthy living", MOCK_VERTICALS);
    expect(result).toEqual(MOCK_VERTICALS[2]);
  });

  it("returns null when no match found", () => {
    const result = matchVertical("Sports", MOCK_VERTICALS);
    expect(result).toBeNull();
  });
});

describe("matchSubcategories", () => {
  it("matches multiple subcategories by name", () => {
    const result = matchSubcategories(
      ["Hair Care", "Skin Care"],
      MOCK_SUBCATEGORIES,
    );
    expect(result).toEqual([MOCK_SUBCATEGORIES[0], MOCK_SUBCATEGORIES[3]]);
  });

  it("returns empty array when no names match", () => {
    const result = matchSubcategories(
      ["Automotive", "Gardening"],
      MOCK_SUBCATEGORIES,
    );
    expect(result).toEqual([]);
  });
});
