import { describe, expect, it, vi } from "vitest";
import { applySiteAuthors, refuseIfHasAuthors } from "../site-assignment";
import type { AuthorRecord } from "../types";

const mk = (id: string, extra: Partial<AuthorRecord> = {}): AuthorRecord => ({
  id, name: id, tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [], created_at: "c", updated_at: "u", ...extra,
});

function deps(lib: AuthorRecord[]) {
  return { listAuthors: vi.fn(async () => lib), readAuthor: vi.fn(async (id: string) => lib.find((a) => a.id === id) ?? null), updateAuthor: vi.fn(async (id: string, input: Omit<AuthorRecord, "id" | "created_at" | "updated_at">) => ({ ...input, id, created_at: "c", updated_at: "u2" })) };
}

describe("applySiteAuthors", () => {
  it("normalizes and splits the unassigned topics", async () => {
    const d = deps([mk("a"), mk("b")]);
    const out = await applySiteAuthors("journeypeaks", [{ id: "a", topics: ["Hiking"] }, { id: "b", topics: ["Cruises"] }], ["Hiking", "Road Trips", "Cruises"], [], d, () => 0);
    expect(out).toEqual({ ok: true, authors: [{ id: "a", topics: ["Hiking"] }, { id: "b", topics: ["Cruises", "Road Trips"] }] });
  });

  it("refuses an unknown author (400) and an unconfirmed exclusive author (409), writing nothing", async () => {
    const d = deps([mk("ella-hughes", { name: "Ella Hughes", exclusive_sites: ["scoopella"] })]);
    expect(await applySiteAuthors("x", [{ id: "nobody", topics: [] }], [], [], d)).toMatchObject({ ok: false, status: 400 });
    expect(await applySiteAuthors("x", [{ id: "ella-hughes", topics: [] }], [], [], d)).toMatchObject({
      ok: false, status: 409, exclusive: [{ id: "ella-hughes", name: "Ella Hughes", sites: ["scoopella"] }],
    });
    expect(d.updateAuthor).not.toHaveBeenCalled();
  });

  it("a confirmed exclusive author gets this site added to their exclusive list", async () => {
    const d = deps([mk("ella-hughes", { exclusive_sites: ["scoopella"] })]);
    const out = await applySiteAuthors("popstorylab", [{ id: "ella-hughes", topics: [] }], [], ["ella-hughes"], d);
    expect(out.ok).toBe(true);
    expect(d.updateAuthor).toHaveBeenCalledWith("ella-hughes", expect.objectContaining({ exclusive_sites: ["scoopella", "popstorylab"] }));
  });

  it("an empty list clears the site's authors", async () => {
    expect(await applySiteAuthors("x", [], ["A"], [], deps([]))).toEqual({ ok: true, authors: [] });
  });
});

describe("refuseIfHasAuthors (bulk run guard)", () => {
  it("refuses (409) only when asked and the site already has authors in git", () => {
    expect(refuseIfHasAuthors([{ id: "a", topics: [] }], true)).toMatchObject({ ok: false, status: 409, code: "has-authors" });
    expect(refuseIfHasAuthors([], true)).toBeNull();
    expect(refuseIfHasAuthors([{ id: "a", topics: [] }], false)).toBeNull();
  });
});

describe("exclusive append reads the author fresh", () => {
  it("appends to the profile as it is now, not the cached list's copy", async () => {
    const cached = mk("ella-hughes", { exclusive_sites: ["scoopella"], bio: "old" });
    const d = deps([cached]);
    d.readAuthor.mockResolvedValueOnce({ ...cached, bio: "edited elsewhere" });
    await applySiteAuthors("popstorylab", [{ id: "ella-hughes", topics: [] }], [], ["ella-hughes"], d);
    expect(d.updateAuthor).toHaveBeenCalledWith("ella-hughes", expect.objectContaining({ bio: "edited elsewhere", exclusive_sites: ["scoopella", "popstorylab"] }));
  });
});

describe("an author just created (the library listing hasn't caught up yet)", () => {
  it("is confirmed by reading their file directly instead of being refused as unknown", async () => {
    const fresh = mk("layla-haddad", { exclusive_sites: ["journeypeaks"] });
    const d = deps([]);
    d.readAuthor.mockImplementation(async (id: string) => (id === "layla-haddad" ? fresh : null));
    const out = await applySiteAuthors("journeypeaks", [{ id: "layla-haddad", topics: [] }], [], [], d);
    expect(out).toEqual({ ok: true, authors: [{ id: "layla-haddad", topics: [] }] });
    expect(await applySiteAuthors("journeypeaks", [{ id: "nobody", topics: [] }], [], [], d)).toMatchObject({ ok: false, status: 400 });
  });
});

