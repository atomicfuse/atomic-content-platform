import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WizardFormData } from "@/types/dashboard";

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn().mockResolvedValue({ sites: [] }),
  upsertDashboardIndexEntry: vi.fn().mockResolvedValue(undefined),
  updateDashboardIndexEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(),
  upsertSiteConfig: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
  writeDashboardIndex: vi.fn().mockResolvedValue(undefined),
  updateSiteInIndex: vi.fn().mockResolvedValue(undefined),
  addSitesToIndex: vi.fn().mockResolvedValue(undefined),
  createBranch: vi.fn().mockResolvedValue(undefined),
  mergeBranchToMain: vi.fn(),
  deleteBranch: vi.fn(),
  branchExists: vi.fn().mockResolvedValue(false),
  triggerWorkflowViaPush: vi.fn().mockResolvedValue(undefined),
  readFileBase64: vi.fn(),
  readFileContent: vi.fn(),
  commitNetworkFiles: vi.fn().mockResolvedValue(undefined),
  copySiteTreeToMain: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/cloudflare", () => ({
  listZones: vi.fn(),
  registerWorkerCustomDomain: vi.fn(),
  deregisterWorkerCustomDomain: vi.fn(),
  putKVEntry: vi.fn(),
  deleteKVEntry: vi.fn(),
  getKVEntry: vi.fn(),
  listKVKeys: vi.fn(),
  bulkPutKV: vi.fn(),
}));
vi.mock("@/lib/constants", () => ({
  workerPreviewUrl: vi.fn((f: string) => `https://staging.workers.dev/?_atl_site=${f}`),
  KV_NAMESPACE_PROD: "prod",
  KV_NAMESPACE_STAGING: "staging",
}));
vi.mock("@/lib/remove-background", () => ({
  removeBackground: vi.fn().mockImplementation(async (buf: Buffer) => buf),
}));
vi.mock("@/lib/favicon-extractor", () => ({ extractFaviconFromLogo: vi.fn() }));
vi.mock("@/lib/r2-upload", () => ({ uploadToR2: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/email-routing", () => ({ enableEmailRouting: vi.fn(), createEmailRoutingRule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/general-image", () => ({
  generateAndUploadDefaultSiteImage: vi.fn().mockResolvedValue({ success: true }),
}));

import { createSiteAndBuildStaging, generateLogoPreview } from "../wizard";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";

function makeFormData(overrides: Partial<WizardFormData> = {}): WizardFormData {
  return {
    domain: "testsite.com",
    pagesProjectName: "testsite",
    siteName: "Test Site",
    siteTagline: "A test",
    company: "ATL",
    vertical: "Travel",
    verticalId: "v1",
    iabVerticalCode: "IAB20",
    groups: [],
    themePreset: "default",
    themeColors: { primary: "#101010", surface: "#f0f0f0" },
    themeLayout: {
      hero: { enabled: true, count: 3 },
      must_reads: { enabled: true, count: 4 },
      whats_new: { enabled: true, count: 4 },
      more_on: { enabled: true, page_size: 8 },
      sidebar_topics: { auto: true, explicit: [] },
      load_more: { page_size: 12 },
    },
    audiences: ["Travelers"],
    audienceIds: [],
    theme: "Travel and food tourism",
    topics_v2: [
      { name: "Destinations", source: { type: "filter", category_ids: ["c1"], tag_ids: ["t1"] }, schedule: { articles_per_week: 2, preferred_days: ["Mon"] } },
    ],
    tone: "informative",
    topics: ["Destinations"],
    articlesPerDay: 1,
    preferredDays: ["Monday"],
    contentGuidelines: "Be concise",
    imageGuidelines: "",
    primaryColor: "#101010",
    accentColor: "#fff",
    fontHeading: "Inter",
    fontBody: "Inter",
    scriptsVars: {},
    ...overrides,
  };
}

/** Fake image response shape from the Gemini generateContent endpoint. */
function fakeGeminiImageResponse(): { ok: true; json: () => Promise<unknown> } {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("fake-png").toString("base64") } }],
          },
        },
      ],
    }),
  };
}

describe("logo generation picks the right background colour", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue(fakeGeminiImageResponse());
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalKey;
  });

  describe("wizard create (createSiteAndBuildStaging)", () => {
    it("Grid site: prompts Gemini with the surface colour as the header background", async () => {
      await createSiteAndBuildStaging(makeFormData({ template: "grid", grid: { topics: [{ label: "Health", verticals: ["Health & Wellness"] }] } }));

      const fetchMock = vi.mocked(global.fetch);
      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = body.contents[0]!.parts[0]!.text;
      expect(prompt).toContain("solid #f0f0f0 background");
      expect(prompt).not.toContain("solid #101010 background");
    });

    it("Modern site: prompts Gemini with the primary colour as the header background (today's behaviour)", async () => {
      await createSiteAndBuildStaging(makeFormData({ template: "modern" }));

      const fetchMock = vi.mocked(global.fetch);
      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = body.contents[0]!.parts[0]!.text;
      expect(prompt).toContain("solid #101010 background");
      expect(prompt).not.toContain("solid #f0f0f0 background");
    });
  });

  describe("generateLogoPreview", () => {
    beforeEach(() => {
      vi.mocked(getDashboardIndex).mockResolvedValue({
        sites: [{ domain: "grid.example", staging_branch: "staging/grid.example" }],
      } as never);
    });

    it("Grid site: prompts Gemini with the surface colour as the header background", async () => {
      vi.mocked(getSiteConfig).mockResolvedValue({
        site_name: "Grid Example",
        theme: { template: "grid", colors: { primary: "#101010", surface: "#f0f0f0" } },
      } as never);

      await generateLogoPreview("grid.example", { generateFooterVariant: false });

      const fetchMock = vi.mocked(global.fetch);
      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = body.contents[0]!.parts[0]!.text;
      expect(prompt).toContain("solid #f0f0f0 background");
      expect(prompt).not.toContain("solid #101010 background");
    });

    it("Modern site: prompts Gemini with the primary colour as the header background", async () => {
      vi.mocked(getSiteConfig).mockResolvedValue({
        site_name: "Modern Example",
        theme: { colors: { primary: "#101010", surface: "#f0f0f0" } },
      } as never);

      await generateLogoPreview("grid.example", { generateFooterVariant: false });

      const fetchMock = vi.mocked(global.fetch);
      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = body.contents[0]!.parts[0]!.text;
      expect(prompt).toContain("solid #101010 background");
      expect(prompt).not.toContain("solid #f0f0f0 background");
    });
  });
});
