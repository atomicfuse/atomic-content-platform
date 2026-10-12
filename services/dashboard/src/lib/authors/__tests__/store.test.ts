import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
/** Paths the (stale) directory listing doesn't show yet, though the file exists on main. */
const unlisted = new Set<string>();
vi.mock("@/lib/github", () => ({
  listNetworkDirectory: vi.fn(async (dir: string) => [...files.keys()].filter((p) => p.startsWith(`${dir}/`) && !unlisted.has(p)).map((p) => ({ name: p.split("/").pop()!, type: "file", path: p }))),
  readFileContent: vi.fn(async (p: string) => { if (files.get(p) === "THROW") throw new Error("rate limited"); return files.get(p) ?? null; }),
  commitNetworkFiles: vi.fn(async (f: Array<{ path: string; content: string }>) => { for (const x of f) files.set(x.path, String(x.content)); }),
  deleteNetworkFile: vi.fn(async (p: string) => { files.delete(p); }),
}));

import { listNetworkDirectory } from "@/lib/github";
import { createAuthor, deleteAuthor, listAuthors, readAuthor, updateAuthor, _resetAuthorCache } from "../store";

const input = { name: "Ann Lee", tagline: "", bio: "", beats: [], portrait: null, links: {}, exclusive_sites: [] };

describe("author store (network repo authors/*.yaml)", () => {
  beforeEach(() => { files.clear(); unlisted.clear(); _resetAuthorCache(); vi.mocked(listNetworkDirectory).mockClear(); });

  it("create → list → read; the same name twice gets a new id, never overwrites", async () => {
    const a = await createAuthor(input);
    const b = await createAuthor({ ...input, name: "Ann-Lee" });
    expect([a.id, b.id]).toEqual(["ann-lee", "ann-lee-2"]);
    expect((await listAuthors()).map((x) => x.id).sort()).toEqual(["ann-lee", "ann-lee-2"]);
    expect((await readAuthor("ann-lee"))?.name).toBe("Ann Lee");
  });

  it("skips a hand-broken file instead of failing the whole list", async () => {
    await createAuthor(input);
    files.set("authors/broken.yaml", "name: [oops");
    _resetAuthorCache();
    expect((await listAuthors()).map((x) => x.id)).toEqual(["ann-lee"]);
  });

  it("update keeps id and created_at, bumps updated_at; delete removes the file", async () => {
    const a = await createAuthor(input);
    const u = await updateAuthor(a.id, { ...input, tagline: "Film writer" });
    expect(u).toMatchObject({ id: a.id, created_at: a.created_at, tagline: "Film writer" });
    await deleteAuthor(a.id);
    expect(await readAuthor(a.id)).toBeNull();
  });

  it("never overwrites a hand-broken file whose id a new author would take", async () => {
    files.set("authors/ann-lee.yaml", "name: [oops");
    const a = await createAuthor(input);
    expect(a.id).toBe("ann-lee-2");
    expect(files.get("authors/ann-lee.yaml")).toBe("name: [oops");
  });

  it("never overwrites a file the directory listing doesn't show yet (another dashboard just wrote it)", async () => {
    await listAuthors();
    files.set("authors/ann-lee.yaml", "id: ann-lee\nname: Ann Lee\n");
    unlisted.add("authors/ann-lee.yaml");
    const a = await createAuthor(input);
    expect(a.id).toBe("ann-lee-2");
    expect(files.get("authors/ann-lee.yaml")).toBe("id: ann-lee\nname: Ann Lee\n");
  });

  it("writes keep the cached list current without re-listing the whole library", async () => {
    const a = await createAuthor(input);
    await listAuthors();
    const calls = vi.mocked(listNetworkDirectory).mock.calls.length;
    await updateAuthor(a.id, { ...input, tagline: "Film writer" });
    const b = await createAuthor({ ...input, name: "Bo Kim" });
    expect((await listAuthors()).map((x) => [x.id, x.tagline])).toEqual([["ann-lee", "Film writer"], ["bo-kim", ""]]);
    await deleteAuthor(b.id);
    expect((await listAuthors()).map((x) => x.id)).toEqual(["ann-lee"]);
    expect(vi.mocked(listNetworkDirectory).mock.calls.length - calls).toBeLessThanOrEqual(1);
  });

  it("one file that can't be read (rate limit) is skipped; the rest of the list still loads", async () => {
    await createAuthor(input);
    files.set("authors/flaky.yaml", "THROW");
    _resetAuthorCache();
    expect((await listAuthors()).map((x) => x.id)).toEqual(["ann-lee"]);
  });
});
