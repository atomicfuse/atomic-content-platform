import { describe, expect, it } from "vitest";
import { authorIdFromName, isIncomplete, parseAuthorYaml, serializeAuthor, validateAuthorInput } from "../record";
import type { AuthorRecord } from "../types";

const ELLA: AuthorRecord = {
  id: "ella-hughes", name: "Ella Hughes", tagline: "Celebrity & royals writer", bio: "Writes about royals.",
  beats: ["Celebrities", "Royals"], portrait: { kind: "generated", path: "/authors/assets/ella-hughes-abc1234567.webp" },
  links: { x: "https://x.com/ella" }, exclusive_sites: ["scoopella"],
  created_at: "2026-10-12T08:00:00.000Z", updated_at: "2026-10-12T08:00:00.000Z",
};

describe("author yaml", () => {
  it("round-trips a record", () => {
    expect(parseAuthorYaml("ella-hughes", serializeAuthor(ELLA))).toEqual(ELLA);
  });
  it("returns null for a hand-broken file or an id that doesn't match the file name", () => {
    expect(parseAuthorYaml("ella-hughes", "name: [oops")).toBeNull();
    expect(parseAuthorYaml("someone-else", serializeAuthor(ELLA))).toBeNull();
    expect(parseAuthorYaml("ella-hughes", "id: ella-hughes\n")).toBeNull();
  });
  it("fills defaults for missing optional fields", () => {
    expect(parseAuthorYaml("a-b", "id: a-b\nname: A B\n")).toMatchObject({ tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] });
  });
});

describe("authorIdFromName", () => {
  it("slugs the name and never reuses a taken id", () => {
    expect(authorIdFromName("Ella Hughes", [])).toBe("ella-hughes");
    expect(authorIdFromName("Ann-Lee", ["ann-lee"])).toBe("ann-lee-2");
    expect(authorIdFromName("Ann Lee", ["ann-lee", "ann-lee-2"])).toBe("ann-lee-3");
    expect(authorIdFromName("Zoë Ångström", [])).toBe("zoe-angstrom");
  });
});

describe("validateAuthorInput", () => {
  const base = { name: "Ella Hughes", tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] };
  it("accepts a minimal author", () => {
    expect(validateAuthorInput(base)).toMatchObject({ ok: true });
  });
  it("rejects a missing name, a non-http link and a portrait outside /authors/assets/", () => {
    expect(validateAuthorInput({ ...base, name: " " })).toMatchObject({ ok: false });
    expect(validateAuthorInput({ ...base, links: { website: "javascript:alert(1)" } })).toMatchObject({ ok: false });
    expect(validateAuthorInput({ ...base, portrait: { kind: "uploaded", path: "/scoopella/assets/x.webp" } })).toMatchObject({ ok: false });
  });
});

describe("isIncomplete", () => {
  it("missing bio or portrait", () => {
    expect(isIncomplete(ELLA)).toBe(false);
    expect(isIncomplete({ ...ELLA, portrait: null })).toBe(true);
    expect(isIncomplete({ ...ELLA, bio: " " })).toBe(true);
  });
});
