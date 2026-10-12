import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorRecord } from "@/lib/authors/types";

const db: AuthorRecord[] = [];
vi.mock("@/lib/authors/store", () => ({
  listAuthors: vi.fn(async () => db),
  readAuthor: vi.fn(async (id: string) => db.find((a) => a.id === id) ?? null),
  createAuthor: vi.fn(async (input: Omit<AuthorRecord, "id" | "created_at" | "updated_at">) => { const a = { ...input, id: "maya-ortiz", created_at: "t", updated_at: "t" }; db.push(a); return a; }),
  updateAuthor: vi.fn(async (id: string, input: Omit<AuthorRecord, "id" | "created_at" | "updated_at">) => ({ ...input, id, created_at: "t", updated_at: "u" })),
  deleteAuthor: vi.fn(async () => undefined),
}));
const gitSites = new Map<string, string>();
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(async () => ({ sites: [...gitSites.keys()].map((domain) => ({ domain })) })),
}));
vi.mock("@/lib/github", () => ({
  readFileContent: vi.fn(async (path: string) => {
    const site = path.split("/")[1]!;
    const raw = gitSites.get(site);
    if (raw === "THROW") throw new Error("rate limited");
    return raw ?? null;
  }),
}));
const r2 = { objects: new Map<string, Buffer>() };
vi.mock("@/lib/r2-upload", () => ({
  readFromR2: vi.fn(async (k: string) => r2.objects.get(k) ?? null),
  uploadToR2: vi.fn(async () => true),
}));
vi.mock("@/lib/authors/portrait-cleanup", () => ({ deleteAuthorPortraits: vi.fn(async () => 0) }));
vi.mock("@/lib/grid-agent-url", () => ({ getAgentUrl: () => "http://pipeline" }));
vi.mock("@/lib/db/site-configs", () => ({
  listSiteConfigs: vi.fn(async () => [{ domain: "scoopella", authors: [{ id: "ella-hughes", topics: ["Royals"] }] }]),
}));

import { listSiteConfigs } from "@/lib/db/site-configs";
import { deleteAuthor } from "@/lib/authors/store";
import { deleteAuthorPortraits } from "@/lib/authors/portrait-cleanup";
import { GET as servePortrait, POST as uploadPortrait } from "../portrait/route";
import { POST as generate } from "../generate/route";
import { GET as list, POST as create } from "../route";
import { DELETE as remove, GET as one } from "../[id]/route";

const ELLA: AuthorRecord = { id: "ella-hughes", name: "Ella Hughes", tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: [], created_at: "t", updated_at: "t" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("authors API", () => {
  beforeEach(() => { db.length = 0; db.push(ELLA); vi.stubEnv("USE_MONGO_READS", "true"); vi.mocked(deleteAuthor).mockClear(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("list includes each author's connected sites", async () => {
    const body = await (await list()).json();
    expect(body.authors[0]).toMatchObject({ id: "ella-hughes", sites: [{ site: "scoopella", topics: ["Royals"] }] });
  });

  it("create validates the input", async () => {
    const bad = await create(new Request("http://x", { method: "POST", body: JSON.stringify({ author: { name: "" } }) }) as never);
    expect(bad.status).toBe(400);
    const ok = await create(new Request("http://x", { method: "POST", body: JSON.stringify({ author: { name: "Maya Ortiz" } }) }) as never);
    expect(ok.status).toBe(201);
  });

  it("read 404s an unknown id", async () => {
    expect((await one(new Request("http://x") as never, ctx("nobody"))).status).toBe(404);
  });

  it("delete refuses while sites still use the author, naming them", async () => {
    const res = await remove(new Request("http://x", { method: "DELETE" }) as never, ctx("ella-hughes"));
    expect(res.status).toBe(409);
    expect((await res.json()).sites).toEqual(["scoopella"]);
  });

  it("delete refuses (503) when the sites using the author can't be checked, instead of assuming none", async () => {
    db.push({ ...ELLA, id: "maya-ortiz", name: "Maya Ortiz" });
    vi.mocked(listSiteConfigs).mockRejectedValueOnce(new Error("no primary"));
    expect((await remove(new Request("http://x", { method: "DELETE" }) as never, ctx("maya-ortiz"))).status).toBe(503);
    expect(deleteAuthor).not.toHaveBeenCalled();
  });

  it("without Mongo reads (local dev) delete checks each site's site.yaml in git, and fails closed", async () => {
    db.push({ ...ELLA, id: "maya-ortiz", name: "Maya Ortiz" });
    vi.stubEnv("USE_MONGO_READS", "false");
    gitSites.clear();
    gitSites.set("coffeeactually", "domain: coffeeactually\nauthors:\n  - id: maya-ortiz\n");
    const used = await remove(new Request("http://x", { method: "DELETE" }) as never, ctx("maya-ortiz"));
    expect(used.status).toBe(409);
    expect((await used.json()).sites).toEqual(["coffeeactually"]);
    gitSites.set("coffeeactually", "THROW");
    expect((await remove(new Request("http://x", { method: "DELETE" }) as never, ctx("maya-ortiz"))).status).toBe(503);
    expect(deleteAuthor).not.toHaveBeenCalled();
    gitSites.set("coffeeactually", "domain: coffeeactually\n");
    expect((await remove(new Request("http://x", { method: "DELETE" }) as never, ctx("maya-ortiz"))).status).toBe(200);
  });

  it("deleting an author also removes its portrait files", async () => {
    db.push({ ...ELLA, id: "maya-ortiz", name: "Maya Ortiz" });
    expect((await remove(new Request("http://x", { method: "DELETE" }) as never, ctx("maya-ortiz"))).status).toBe(200);
    expect(deleteAuthorPortraits).toHaveBeenCalledWith("maya-ortiz");
  });

  it("generate proxy adds the library's names to takenNames (except the name being replaced)", async () => {
    db.push({ ...ELLA, id: "maya-ortiz", name: "Maya Ortiz" });
    const sent: Array<Record<string, unknown>> = [];
    global.fetch = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init!.body)));
      return new Response(JSON.stringify({ status: "ok", value: "x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ part: "name", draft: { name: "Maya Ortiz" }, siteContext: {}, takenNames: [] }) });
    expect((await generate(req as never)).status).toBe(200);
    expect(sent[0]!.takenNames).toEqual(["Ella Hughes"]);
  });

  it("portrait serve sends nosniff", async () => {
    r2.objects.set("authors/assets/ella-hughes-abc.webp", Buffer.from("x"));
    const req = { nextUrl: new URL("http://x/api/authors/portrait?path=/authors/assets/ella-hughes-abc.webp") };
    const res = await servePortrait(req as never);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("portrait upload refuses an oversized body before reading it", async () => {
    const formData = vi.fn();
    const req = { headers: new Headers({ "content-length": String(20 * 1024 * 1024) }), formData };
    const res = await uploadPortrait(req as never);
    expect(res.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });
});

