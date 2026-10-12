import { beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({ commitSiteFiles: vi.fn(async (..._args: unknown[]) => undefined) }));
const r2 = vi.hoisted(() => ({ uploadToR2: vi.fn(async (..._args: unknown[]) => true) }));
const db = vi.hoisted(() => ({ upsertSiteConfig: vi.fn(), config: {} as Record<string, unknown> }));
const ELLA = { id: "ella-hughes", name: "Ella Hughes", tagline: "", bio: "", beats: [], verticals: [], portrait: null, links: {}, exclusive_sites: ["scoopella"], created_at: "", updated_at: "" };
const MAYA = { ...ELLA, id: "maya-ortiz", name: "Maya Ortiz", exclusive_sites: [] as string[] };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(async () => ({ sites: [{ domain: "journeypeaks", staging_branch: "staging/journeypeaks" }] })),
  updateDashboardIndexEntry: vi.fn(),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(async () => structuredClone(db.config)),
  upsertSiteConfig: db.upsertSiteConfig,
}));
vi.mock("@/lib/github", () => ({ ...github, updateSiteInIndex: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ upsertDnsTxtRecord: vi.fn(), deleteDnsTxtRecord: vi.fn() }));
vi.mock("@/lib/favicon-extractor", () => ({ extractFaviconFromLogo: vi.fn(async (b: Buffer) => b) }));
vi.mock("@/lib/remove-background", () => ({ removeBackground: vi.fn(async (b: Buffer) => b) }));
vi.mock("@/lib/r2-upload", () => ({ ...r2 }));
vi.mock("@/lib/grid-config", () => ({ applyGridConfigUpdates: vi.fn() }));
vi.mock("@/lib/authors/store", () => ({
  listAuthors: vi.fn(async () => [ELLA, MAYA]),
  readAuthor: vi.fn(async (id: string) => [ELLA, MAYA].find((a) => a.id === id) ?? null),
  updateAuthor: vi.fn(async (id: string, input: object) => ({ ...input, id })),
}));

import { POST } from "../route";

const req = (body: unknown): Parameters<typeof POST>[0] =>
  ({ json: async () => body }) as unknown as Parameters<typeof POST>[0];

beforeEach(() => {
  vi.clearAllMocks();
  db.config = { site_name: "Journey Peaks", brief: { topics: ["Hiking", "Road Trips"] } };
});

describe("saving a site's authors", () => {
  it("an unconfirmed exclusive author is refused (409) and nothing is written, not even a logo in the same request", async () => {
    const res = await POST(req({ domain: "journeypeaks", logoBase64: Buffer.from("logo").toString("base64"), faviconBase64: null, configUpdates: { authors: [{ id: "ella-hughes", topics: [] }] } }));
    expect(res.status).toBe(409);
    expect((await res.json()).exclusive).toEqual([{ id: "ella-hughes", name: "Ella Hughes", sites: ["scoopella"] }]);
    expect(github.commitSiteFiles).not.toHaveBeenCalled();
    expect(db.upsertSiteConfig).not.toHaveBeenCalled();
    expect(r2.uploadToR2).not.toHaveBeenCalled();
  });

  it("the bulk run's guard refuses a site that already has authors in git", async () => {
    db.config = { ...db.config, authors: [{ id: "maya-ortiz", topics: ["Hiking"] }] };
    const res = await POST(req({ domain: "journeypeaks", logoBase64: null, faviconBase64: null, configUpdates: { authors: [{ id: "maya-ortiz", topics: [] }], onlyIfNoAuthors: true } }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("has-authors");
    expect(github.commitSiteFiles).not.toHaveBeenCalled();
  });

  it("a valid save writes the split topics to site.yaml, mirrors to Mongo and returns them", async () => {
    const res = await POST(req({ domain: "journeypeaks", logoBase64: null, faviconBase64: null, configUpdates: { authors: [{ id: "maya-ortiz", topics: ["Hiking"] }] } }));
    expect(res.status).toBe(200);
    expect((await res.json()).authors).toEqual([{ id: "maya-ortiz", topics: ["Hiking", "Road Trips"] }]);
    const files = github.commitSiteFiles.mock.calls[0]![1] as Array<{ path: string; content: string }>;
    expect(files[0]!.content).toMatch(/authors:\n\s+- id: maya-ortiz/);
    expect(db.upsertSiteConfig).toHaveBeenCalledWith("journeypeaks", expect.objectContaining({ authors: [{ id: "maya-ortiz", topics: ["Hiking", "Road Trips"] }] }));
  });
});
