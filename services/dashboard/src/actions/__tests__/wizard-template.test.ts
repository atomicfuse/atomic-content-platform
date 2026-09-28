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

async function siteYamlThemeFor(data: WizardFormData): Promise<Record<string, unknown>> {
  await createSiteAndBuildStaging(data);
  const { commitSiteFiles } = await import("@/lib/github");
  const files = vi.mocked(commitSiteFiles).mock.calls.at(-1)![1] as Array<{ path: string; content: string }>;
  const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
  expect(siteYaml).toBeDefined();
  const { parse: parseYaml } = await import("yaml");
  const parsed = parseYaml(siteYaml!.content) as { theme: Record<string, unknown> };
  return parsed.theme;
}

describe("createSiteAndBuildStaging — F1 template choice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes theme.template: grid when the wizard's Grid template is chosen", async () => {
    const theme = await siteYamlThemeFor(makeFormData({ template: "grid" }));
    expect(theme.template).toBe("grid");
    expect(theme.base).toBe("default");
  });

  it("never writes theme.template for the Modern (default) choice — byte-identical to pre-F1 output", async () => {
    const theme = await siteYamlThemeFor(makeFormData({ template: "modern" }));
    expect(theme.template).toBeUndefined();
    expect("template" in theme).toBe(false);
  });

  it("omits theme.template when the wizard data predates this field (template undefined)", async () => {
    const theme = await siteYamlThemeFor(makeFormData());
    expect(theme.template).toBeUndefined();
    expect("template" in theme).toBe(false);
  });
});
