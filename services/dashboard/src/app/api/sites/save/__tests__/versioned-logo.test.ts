import { beforeEach, describe, expect, it, vi } from "vitest";

const github = vi.hoisted(() => ({ commitSiteFiles: vi.fn(async (..._args: unknown[]) => undefined) }));
const r2 = vi.hoisted(() => ({ uploadToR2: vi.fn(async (..._args: unknown[]) => true) }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(async () => ({ sites: [{ domain: "coffeeactually", staging_branch: "staging/coffeeactually" }] })),
  updateDashboardIndexEntry: vi.fn(),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(async () => ({ site_name: "Coffee Actually", theme: { logo: "/assets/logo.png", favicon: "/assets/favicon.png" } })),
  upsertSiteConfig: vi.fn(),
}));
vi.mock("@/lib/github", () => ({ ...github, updateSiteInIndex: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ upsertDnsTxtRecord: vi.fn(), deleteDnsTxtRecord: vi.fn() }));
vi.mock("@/lib/favicon-extractor", () => ({ extractFaviconFromLogo: vi.fn(async (b: Buffer) => Buffer.concat([b, Buffer.from("-fav")])) }));
vi.mock("@/lib/remove-background", () => ({ removeBackground: vi.fn(async (b: Buffer) => b) }));
vi.mock("@/lib/r2-upload", () => ({ ...r2 }));
vi.mock("@/lib/grid-config", () => ({ applyGridConfigUpdates: vi.fn() }));

import { POST } from "../route";

const req = (body: unknown): Parameters<typeof POST>[0] =>
  ({ json: async () => body }) as unknown as Parameters<typeof POST>[0];

beforeEach(() => vi.clearAllMocks());

describe("saving a logo never overwrites the file production uses", () => {
  it("uploads logo + favicon under content-hashed names and points staging's site.yaml at them", async () => {
    const logo = Buffer.from("new-logo").toString("base64");
    const res = await POST(req({ domain: "coffeeactually", configUpdates: null, logoBase64: logo, faviconBase64: null }));
    expect(res.status).toBe(200);
    const keys = r2.uploadToR2.mock.calls.map((c) => c[0] as string);
    expect(keys).not.toContain("coffeeactually/assets/logo.png");
    expect(keys).not.toContain("coffeeactually/assets/favicon.png");
    expect(keys.some((k) => /^coffeeactually\/assets\/logo-[0-9a-f]{10}\.png$/.test(k))).toBe(true);
    expect(keys.some((k) => /^coffeeactually\/assets\/favicon-[0-9a-f]{10}\.png$/.test(k))).toBe(true);
    const files = github.commitSiteFiles.mock.calls[0]![1] as Array<{ path: string; content: string }>;
    const yaml = files.find((f) => f.path.endsWith("site.yaml"))!.content;
    expect(yaml).toMatch(/logo: \/assets\/logo-[0-9a-f]{10}\.png/);
    expect(yaml).toMatch(/favicon: \/assets\/favicon-[0-9a-f]{10}\.png/);
  });
  it("versions the footer logo too", async () => {
    await POST(req({ domain: "coffeeactually", configUpdates: null, logoBase64: null, footerLogoBase64: Buffer.from("foot").toString("base64"), faviconBase64: null }));
    const keys = r2.uploadToR2.mock.calls.map((c) => c[0] as string);
    expect(keys).not.toContain("coffeeactually/assets/logo-footer.png");
    expect(keys.some((k) => /^coffeeactually\/assets\/logo-footer-[0-9a-f]{10}\.png$/.test(k))).toBe(true);
  });
});
