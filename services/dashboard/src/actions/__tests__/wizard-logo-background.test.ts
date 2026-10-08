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
// Fake image bytes aren't real PNGs: measure contrast via a mock (default: readable).
vi.mock("@/lib/logo-contrast", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/logo-contrast")>()),
  logoMedianContrast: vi.fn().mockResolvedValue(12),
}));
vi.mock("@/lib/r2-upload", () => ({ uploadToR2: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/email-routing", () => ({ enableEmailRouting: vi.fn(), createEmailRoutingRule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/general-image", () => ({
  generateAndUploadDefaultSiteImage: vi.fn().mockResolvedValue({ success: true }),
}));

import { createSiteAndBuildStaging, generateLogoExtras, generateLogoPreview } from "../wizard";
import { removeBackground } from "@/lib/remove-background";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";
import { logoMedianContrast } from "@/lib/logo-contrast";

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
    delete process.env.OPENAI_API_KEY; // these tests cover the Gemini path
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

      await generateLogoPreview("grid.example");

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

      await generateLogoPreview("grid.example");

      const fetchMock = vi.mocked(global.fetch);
      expect(fetchMock).toHaveBeenCalled();
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { contents: Array<{ parts: Array<{ text: string }> }> };
      const prompt = body.contents[0]!.parts[0]!.text;
      expect(prompt).toContain("solid #101010 background");
      expect(prompt).not.toContain("solid #f0f0f0 background");
    });
  });
});

describe("logo generation — OpenAI gpt-image-2.5-sunburst first, Gemini fallback", () => {
  const originalFetch = global.fetch;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalOpenAI = process.env.OPENAI_API_KEY;
  const openaiOk = (): Response => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from("openai-png").toString("base64") }] }) }) as Response;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "gk";
    process.env.OPENAI_API_KEY = "ok";
  });
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalGemini;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalOpenAI;
  });

  it("uses OpenAI with a transparent background and the header-contrast rules (no glow), then the transparency-aware trim/resize", async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).includes("openai.com") ? openaiOk() : (fakeGeminiImageResponse() as unknown as Response)));
    global.fetch = fetchMock as unknown as typeof fetch;
    await createSiteAndBuildStaging(makeFormData());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.openai.com/v1/images/generations");
    const body = JSON.parse(init.body as string) as { model: string; background: string; prompt: string };
    expect(body.model).toBe("gpt-image-2.5-sunburst");
    expect(body.background).toBe("transparent");
    expect(body.prompt).toContain("#101010");
    expect(body.prompt).toMatch(/no glow/i);
    // removeBackground only trims/resizes/compresses an already-transparent image (see remove-background.test.ts).
    expect(vi.mocked(removeBackground)).toHaveBeenCalledWith(Buffer.from("openai-png"));
  });

  it("falls back to Gemini when OpenAI fails", async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).includes("openai.com")
      ? ({ ok: false, status: 500, json: async () => ({}) } as Response)
      : (fakeGeminiImageResponse() as unknown as Response)));
    global.fetch = fetchMock as unknown as typeof fetch;
    await createSiteAndBuildStaging(makeFormData());
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("generativelanguage.googleapis.com"))).toBe(true);
  });

  it("works with only an OpenAI key (logo preview no longer requires GEMINI_API_KEY)", async () => {
    delete process.env.GEMINI_API_KEY;
    global.fetch = vi.fn(async () => openaiOk()) as unknown as typeof fetch;
    const out = await generateLogoPreview("testsite.com");
    expect(out.logo).toBe(Buffer.from("openai-png").toString("base64"));
  });

  // CloudGrid's gateway cuts requests at ~60 s, so each server action makes at most one OpenAI call
  // per step: the logo, an optional contrast retry (asked for by the browser), then favicon + footer.
  it("preview makes exactly one OpenAI generation and no edits, and flags a faint logo", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => openaiOk());
    global.fetch = fetchMock as unknown as typeof fetch;
    vi.mocked(logoMedianContrast).mockResolvedValueOnce(1.4);
    const out = await generateLogoPreview("testsite.com");
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.includes("/images/generations"))).toHaveLength(1);
    expect(urls.some((u) => u.includes("/images/edits"))).toBe(false);
    expect(out.lowContrast).toBe(true);
    expect(out.contrast).toBeCloseTo(1.4);
  });

  it("retryForContrast asks for much stronger contrast", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => openaiOk());
    global.fetch = fetchMock as unknown as typeof fetch;
    await generateLogoPreview("testsite.com", { retryForContrast: true });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { prompt: string };
    expect(body.prompt).toMatch(/too faint/i);
  });

  it("reports which model made the logo", async () => {
    global.fetch = vi.fn(async () => openaiOk()) as unknown as typeof fetch;
    const out = await generateLogoPreview("testsite.com");
    expect(out.model).toBe("gpt-image-2.5-sunburst");
  });

  it("extras: the favicon is an OpenAI edit of the logo (simplified mark, no glow)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => openaiOk());
    global.fetch = fetchMock as unknown as typeof fetch;
    const out = await generateLogoExtras("testsite.com", Buffer.from("logo").toString("base64"), { generateFooterVariant: false });
    const edit = fetchMock.mock.calls.find(([u]) => String(u).includes("/images/edits")) as unknown as [string, RequestInit] | undefined;
    expect(edit).toBeDefined();
    const form = edit![1].body as FormData;
    expect(form.get("size")).toBe("1024x1024");
    expect(String(form.get("prompt"))).toMatch(/no glow/i);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/images/generations"))).toBe(false);
    expect(out.favicon).toBe(Buffer.from("openai-png").toString("base64"));
  });

  it("extras: the footer variant is an OpenAI edit when header and footer invert", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "inv.example", staging_branch: "staging/inv.example" }] } as never);
    vi.mocked(getSiteConfig).mockResolvedValue({
      site_name: "Inv", theme: { colors: { primary: "#ffffff", footer_bg: "#111111" } },
    } as never);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => openaiOk());
    global.fetch = fetchMock as unknown as typeof fetch;
    const out = await generateLogoExtras("inv.example", Buffer.from("logo").toString("base64"), { generateFooterVariant: true });
    const edits = fetchMock.mock.calls.filter(([u]) => String(u).includes("/images/edits")) as unknown as Array<[string, RequestInit]>;
    expect(edits.some(([, init]) => /#111111/.test(String((init.body as FormData).get("prompt"))))).toBe(true);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("generativelanguage"))).toBe(false);
    expect(out.footerLogo).toBe(Buffer.from("openai-png").toString("base64"));
  });

  it("new-site wizard: one logo generation, no edits (favicon is cropped from the logo)", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => (String(url).includes("openai.com") ? openaiOk() : (fakeGeminiImageResponse() as unknown as Response)));
    global.fetch = fetchMock as unknown as typeof fetch;
    vi.mocked(logoMedianContrast).mockResolvedValueOnce(1.4);
    await createSiteAndBuildStaging(makeFormData());
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u.includes("/images/generations"))).toHaveLength(1);
    expect(urls.some((u) => u.includes("/images/edits"))).toBe(false);
  });

  it("passes the site's tagline, topics and tone into the logo prompt (site page and new-site wizard)", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "cues.example", staging_branch: "staging/cues.example" }] } as never);
    vi.mocked(getSiteConfig).mockResolvedValue({
      site_name: "Cues", site_tagline: "Pop culture with a wink",
      brief: { topics: ["Movies", "TV"], tone: "playful" }, theme: { colors: { primary: "#101010" } },
    } as never);
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => (String(url).includes("openai.com") ? openaiOk() : (fakeGeminiImageResponse() as unknown as Response)));
    global.fetch = fetchMock as unknown as typeof fetch;
    await generateLogoPreview("cues.example");
    const previewPrompt = (JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { prompt: string }).prompt;
    expect(previewPrompt).toContain('Tagline: "Pop culture with a wink"');
    expect(previewPrompt).toContain("Covers: Movies, TV");
    expect(previewPrompt).toContain("Voice: playful");

    fetchMock.mockClear();
    await createSiteAndBuildStaging(makeFormData({ siteTagline: "Trips worth taking" }));
    const wizardPrompt = (JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as { prompt: string }).prompt;
    expect(wizardPrompt).toContain('Tagline: "Trips worth taking"');
    expect(wizardPrompt).toContain("Covers: Destinations");
    expect(wizardPrompt).toContain("Voice: informative");
  });
});

