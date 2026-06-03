import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WizardFormData } from "@/types/dashboard";

vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
  readDashboardIndex: vi.fn().mockResolvedValue({ sites: [] }),
  writeDashboardIndex: vi.fn().mockResolvedValue(undefined),
  readSiteConfig: vi.fn(),
  updateSiteInIndex: vi.fn().mockResolvedValue(undefined),
  addSitesToIndex: vi.fn().mockResolvedValue(undefined),
  createBranch: vi.fn().mockResolvedValue(undefined),
  mergeBranchToMain: vi.fn(),
  deleteBranch: vi.fn(),
  branchExists: vi.fn().mockResolvedValue(false),
  triggerWorkflowViaPush: vi.fn().mockResolvedValue(undefined),
  readFileBase64: vi.fn(),
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

import { createSiteAndBuildStaging } from "../wizard";

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
    themeColors: {},
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
    contentGuidelines: "",
    imageGuidelines: "",
    primaryColor: "#000",
    accentColor: "#fff",
    fontHeading: "Inter",
    fontBody: "Inter",
    scriptsVars: {},
    ...overrides,
  };
}

describe("createSiteAndBuildStaging — per-topic wizard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes brief.theme + brief.topics_v2 to site.yaml and never writes bundle_ids", async () => {
    const data = makeFormData();
    const result = await createSiteAndBuildStaging(data);
    expect(result).toHaveProperty("stagingUrl");

    const { commitSiteFiles } = await import("@/lib/github");
    const files = vi.mocked(commitSiteFiles).mock.calls[0]![1] as Array<{ path: string; content: string }>;
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    expect(siteYaml).toBeDefined();

    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(siteYaml!.content) as { brief: Record<string, unknown>; bundle_id?: string };
    expect(parsed.brief.theme).toBe("Travel and food tourism");
    expect(parsed.brief.topics_v2).toBeDefined();
    expect((parsed.brief.topics_v2 as unknown[]).length).toBe(1);
    expect(parsed.brief.bundle_ids).toBeUndefined();
    expect(parsed.brief.bundle_id).toBeUndefined();
    expect(parsed.bundle_id).toBeUndefined();
  });

  it("omits brief.topics_v2 when the wizard passes an empty topics_v2", async () => {
    const data = makeFormData({ topics_v2: [] });
    await createSiteAndBuildStaging(data);
    const { commitSiteFiles } = await import("@/lib/github");
    const files = vi.mocked(commitSiteFiles).mock.calls[0]![1] as Array<{ path: string; content: string }>;
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(siteYaml!.content) as { brief: Record<string, unknown> };
    expect(parsed.brief.topics_v2).toBeUndefined();
  });
});
