import { describe, it, expect, vi, beforeEach } from "vitest";
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
vi.mock("@/lib/remove-background", () => ({ removeBackground: vi.fn() }));
vi.mock("@/lib/favicon-extractor", () => ({ extractFaviconFromLogo: vi.fn() }));
vi.mock("@/lib/email-routing", () => ({ enableEmailRouting: vi.fn(), createEmailRoutingRule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/general-image", () => ({
  generateAndUploadDefaultSiteImage: vi.fn().mockResolvedValue({ success: true }),
}));

import { createSiteAndBuildStaging } from "../wizard";
import { generateAndUploadDefaultSiteImage } from "@/lib/general-image";

function makeGridFormData(overrides: Partial<WizardFormData> = {}): WizardFormData {
  return {
    domain: "gridsite.com",
    pagesProjectName: "gridsite",
    siteName: "Grid Site",
    siteTagline: "",
    company: "ATL",
    vertical: "",
    verticalId: "",
    iabVerticalCode: "",
    groups: [],
    template: "grid",
    grid: { topics: [{ label: "Health", verticals: ["Health & Wellness"] }], include_sites: ["foo"] },
    card: { style: "shadow" },
    themePreset: "classic",
    themeColors: {},
    themeLayout: {
      hero: { enabled: true, count: 4 },
      must_reads: { enabled: true, count: 5 },
      whats_new: { enabled: true, count: 4 },
      more_on: { enabled: true, page_size: 8 },
      sidebar_topics: { auto: true, explicit: [] },
      load_more: { page_size: 4 },
    },
    // Leftovers from an earlier pass through the Modern content steps.
    audiences: ["Travelers"],
    audienceIds: ["a1"],
    theme: "Travel",
    topics_v2: [
      { name: "Destinations", source: { type: "filter", category_ids: ["c1"], tag_ids: ["t1"] }, schedule: { articles_per_week: 2, preferred_days: ["Mon"] } },
    ],
    tone: "informative",
    topics: ["Destinations"],
    articlesPerDay: 1,
    preferredDays: ["Monday"],
    contentGuidelines: "Be concise",
    imageGuidelines: "",
    primaryColor: "#000",
    accentColor: "#fff",
    fontHeading: "Inter",
    fontBody: "Inter",
    scriptsVars: {},
    ...overrides,
  };
}

async function committedFiles(data: WizardFormData): Promise<Array<{ path: string; content: string }>> {
  await createSiteAndBuildStaging(data);
  const { commitSiteFiles } = await import("@/lib/github");
  return vi.mocked(commitSiteFiles).mock.calls.at(-1)![1] as Array<{ path: string; content: string }>;
}

describe("createSiteAndBuildStaging — G5 Grid site", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes grid:, theme.card and the minimal brief (content leftovers dropped)", async () => {
    const files = await committedFiles(makeGridFormData());
    const { parse } = await import("yaml");
    const site = parse(files.find((f) => f.path.endsWith("site.yaml"))!.content) as Record<string, Record<string, unknown>>;

    expect(site.grid).toStrictEqual({
      topics: [{ label: "Health", verticals: ["Health & Wellness"] }],
      include_sites: ["foo"],
    });
    expect(site.theme!.template).toBe("grid");
    expect(site.theme!.card).toStrictEqual({ style: "shadow" });
    expect(site.brief).toStrictEqual({
      audiences: [],
      tone: "",
      article_types: { listicle: 40, standard: 30, "how-to": 20, review: 10 },
      topics: [],
      seo_keywords_focus: [],
      content_guidelines: [],
      review_percentage: 5,
      schedule: { articles_per_day: 0, preferred_days: [], preferred_time: "10:00" },
    });
  });

  it("keeps the explicit category as brief.vertical and the index vertical", async () => {
    const files = await committedFiles(makeGridFormData({ vertical: "News", verticalId: "v9" }));
    const { parse } = await import("yaml");
    const site = parse(files.find((f) => f.path.endsWith("site.yaml"))!.content) as { brief: Record<string, unknown> };
    expect(site.brief.vertical).toBe("News");
    expect(site.brief.vertical_id).toBe("v9");
    const { addSitesToIndex } = await import("@/lib/github");
    expect(vi.mocked(addSitesToIndex).mock.calls[0]![0][0]!.vertical).toBe("News");
  });

  it("does not use leftover topics for the default site image vertical", async () => {
    await committedFiles(makeGridFormData());
    expect(vi.mocked(generateAndUploadDefaultSiteImage)).toHaveBeenCalledWith("gridsite", "Grid Site", "general");
  });

  it("skill.md carries no leftover topics or tone", async () => {
    const files = await committedFiles(makeGridFormData());
    const skill = files.find((f) => f.path.endsWith("skill.md"))!.content;
    expect(skill).not.toContain("Destinations");
    expect(skill).not.toContain("informative");
    expect(skill).not.toContain("Travelers");
  });
});
