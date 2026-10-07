import { describe, expect, it } from "vitest";
import { toBareDomain } from "../grid-domains";

describe("toBareDomain", () => {
  it.each([
    ["https://www.TheTruthSeeker.co.uk/a/b?c=1", "thetruthseeker.co.uk"],
    ["cnn.com", "cnn.com"],
    ["  edition.cnn.com/world ", "edition.cnn.com"],
    ["http://example.com:8080", "example.com"],
  ])("%s → %s", (input, out) => expect(toBareDomain(input)).toBe(out));
  it.each(["", "not a site", "localhost", "javascript:alert(1)"])("rejects %s", (input) => expect(toBareDomain(input)).toBeNull());
});
