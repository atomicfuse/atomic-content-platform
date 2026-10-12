import { describe, expect, it } from "vitest";
import { isReservedSiteId } from "../reserved-site-ids";

describe("isReservedSiteId", () => {
  it("authors (portrait assets) and aggregator (Grid stories) can't be site ids", () => {
    expect(isReservedSiteId("authors")).toBe(true);
    expect(isReservedSiteId("aggregator")).toBe(true);
    expect(isReservedSiteId("Authors")).toBe(true);
    expect(isReservedSiteId("authorsdaily")).toBe(false);
  });
});
