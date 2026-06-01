/**
 * wizard-bundle.test.ts — Tests for the bundle creation flow in the wizard.
 *
 * Bug fixed: createBundle() only accepted HTTP 201, silently returning null
 * on 200. And createSiteAndBuildStaging() silently continued without a bundle
 * when creation failed, instead of surfacing the error to the UI.
 *
 * These tests verify:
 *  - Bundle creation succeeds with both 200 and 201 (the fix)
 *  - 409 duplicate name triggers a retry with " (2)" suffix
 *  - Non-OK responses (4xx/5xx) throw an error to the UI
 *  - Network errors throw an error to the UI
 *  - Existing-bundle mode skips creation entirely
 *  - No vertical/categories skips bundle creation entirely
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WizardFormData } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Mock all external dependencies so only the bundle-creation fetch is real
// ---------------------------------------------------------------------------

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
  workerPreviewUrl: vi.fn(
    (folder: string) => `https://staging.workers.dev/?_atl_site=${folder}`,
  ),
  KV_NAMESPACE_PROD: "prod-kv-ns",
  KV_NAMESPACE_STAGING: "staging-kv-ns",
}));

vi.mock("@/lib/remove-background", () => ({
  removeBackground: vi.fn(),
}));

vi.mock("@/lib/favicon-extractor", () => ({
  extractFaviconFromLogo: vi.fn(),
}));

vi.mock("@/lib/email-routing", () => ({
  enableEmailRouting: vi.fn(),
  createEmailRoutingRule: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Global fetch mock — controls the Content Aggregator responses
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Import the server action AFTER mocks are in place
// ---------------------------------------------------------------------------
import { createSiteAndBuildStaging } from "../wizard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal WizardFormData configured for the "create new bundle" path
 *  (bundleId is empty, verticalId + categories are set). */
function makeNewBundleFormData(
  overrides: Partial<WizardFormData> = {},
): WizardFormData {
  return {
    domain: "testsite.com",
    pagesProjectName: "testsite",
    siteName: "Test Site",
    siteTagline: "A test tagline",
    company: "ATL",
    vertical: "Technology",
    verticalId: "vert-001",
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
    audiences: ["Tech enthusiasts"],
    audienceIds: [],
    selectedCategories: [
      { id: "cat-sub-1", name: "Artificial Intelligence", iabCode: "IAB19-6" },
    ],
    selectedTags: [{ id: "tag-1", name: "machine-learning" }],
    iabVerticalCode: "IAB19",
    bundleIds: [],
    starterBundle: { enabled: true, name: "Test Site" },
    tone: "informative",
    topics: ["AI news"],
    articlesPerDay: 1,
    preferredDays: ["Monday", "Wednesday", "Friday"],
    contentGuidelines: "",
    imageGuidelines: "",
    primaryColor: "#0066cc",
    accentColor: "#ff6600",
    fontHeading: "Inter",
    fontBody: "Inter",
    scriptsVars: {},
    ...overrides,
  };
}

/** Create a mock Response object. */
function fakeResponse(
  status: number,
  body: unknown,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? "OK" : status === 201 ? "Created" : "Error",
    type: "basic",
    url: "",
    clone: () => fakeResponse(status, body),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Wizard — Bundle Creation (bug fix verification)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Test #1: HTTP 201 → bundle created, ID stored in site config
  // =========================================================================
  it("Test #1: Bundle creation succeeds with HTTP 201 — bundleId is set", async () => {
    // Arrange: aggregator returns 201 with bundle data
    mockFetch.mockResolvedValue(
      fakeResponse(201, { id: "bundle-abc", name: "Test Site" }),
    );

    const data = makeNewBundleFormData();

    // Act
    const result = await createSiteAndBuildStaging(data);

    // Assert: function completes without error and returns staging result
    expect(result).toHaveProperty("stagingUrl");
    expect(result).toHaveProperty("siteFolder", "testsite");

    // Assert: fetch was called with POST to /api/bundles
    const bundleCall = mockFetch.mock.calls[0];
    expect(bundleCall[0]).toContain("/api/bundles");
    expect(bundleCall[1].method).toBe("POST");

    // Assert: payload includes exactly the categories the form passed.
    // Post-2026-05-31: createBundle no longer auto-prepends the tier-1 (vert-001).
    // Tier-1 IDs are included only if the user explicitly picked them in the
    // new "Categories" picker. The wizard form's selectedCategories carries
    // only the user's actual picks.
    const payload = JSON.parse(bundleCall[1].body as string);
    expect(payload.rules.category_ids).toEqual(["cat-sub-1"]);
    expect(payload.rules.tag_ids).toEqual(["tag-1"]);
  });

  // =========================================================================
  // Test #2: HTTP 200 → bundle created (THE BUG FIX — previously returned null)
  // =========================================================================
  it("Test #2: Bundle creation succeeds with HTTP 200 — was broken before fix", async () => {
    // Arrange: aggregator returns 200 (some REST APIs use 200 for POST)
    mockFetch.mockResolvedValue(
      fakeResponse(200, { id: "bundle-xyz", name: "Test Site" }),
    );

    const data = makeNewBundleFormData();

    // Act: this used to fail silently (bundle returned null, site created without bundle)
    const result = await createSiteAndBuildStaging(data);

    // Assert: completes successfully
    expect(result).toHaveProperty("stagingUrl");
    expect(result.siteFolder).toBe("testsite");

    // Assert: the POST to /api/bundles was made
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const bundleCall = mockFetch.mock.calls[0];
    expect(bundleCall[0]).toContain("/api/bundles");
  });

  // =========================================================================
  // Test #3: HTTP 409 (duplicate name) → retries with " (2)" suffix
  // =========================================================================
  it("Test #3: 409 duplicate name triggers retry with ' (2)' suffix", async () => {
    // Arrange: first call returns 409, second returns 201
    mockFetch
      .mockResolvedValueOnce(fakeResponse(409, { error: "Name already exists" }))
      .mockResolvedValueOnce(fakeResponse(201, { id: "bundle-retry", name: "Test Site (2)" }));

    const data = makeNewBundleFormData();

    // Act
    const result = await createSiteAndBuildStaging(data);

    // Assert: completes successfully after retry
    expect(result).toHaveProperty("stagingUrl");

    // Assert: two fetch calls were made (original + retry)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Assert: second call has " (2)" in the name
    const retryPayload = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(retryPayload.name).toBe("Test Site (2)");
  });

  // =========================================================================
  // Test #4: Non-OK response (500) → error thrown to UI
  // =========================================================================
  it("Test #4: Aggregator returns 500 — error is thrown (not swallowed)", async () => {
    // Arrange: aggregator returns 500 server error
    mockFetch.mockResolvedValue(
      fakeResponse(500, { error: "Internal Server Error" }),
    );

    const data = makeNewBundleFormData();

    // Act & Assert: the error propagates to the caller (StepPreview catches it)
    // With starterBundle.enabled=true, the error is "Failed to create starter bundle"
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create starter bundle",
    );

    // Assert: no GitHub operations were attempted (error thrown early)
    const { commitSiteFiles } = await import("@/lib/github");
    expect(commitSiteFiles).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test #5: Aggregator returns 400 Bad Request → error thrown to UI
  // =========================================================================
  it("Test #5: Aggregator returns 400 — error is thrown with message", async () => {
    // Arrange: aggregator rejects the payload
    mockFetch.mockResolvedValue(
      fakeResponse(400, { error: "Invalid category_ids" }),
    );

    const data = makeNewBundleFormData();

    // Act & Assert: with starterBundle.enabled=true, error is "Failed to create starter bundle"
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create starter bundle",
    );
  });

  // =========================================================================
  // Test #6: Network error (fetch throws) → error thrown to UI
  // =========================================================================
  it("Test #6: Network error during bundle creation — error is thrown", async () => {
    // Arrange: fetch itself throws (DNS failure, timeout, etc.)
    mockFetch.mockRejectedValue(new Error("fetch failed: ECONNREFUSED"));

    const data = makeNewBundleFormData();

    // Act & Assert: the network error propagates as a bundle creation failure
    // With starterBundle.enabled=true, error is "Failed to create starter bundle"
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create starter bundle",
    );
  });

  // =========================================================================
  // Test #7: 409 on both attempts → error thrown
  // =========================================================================
  it("Test #7: 409 on both original and retry → error is thrown", async () => {
    // Arrange: duplicate name on both attempts
    mockFetch
      .mockResolvedValueOnce(fakeResponse(409, { error: "Name exists" }))
      .mockResolvedValueOnce(fakeResponse(409, { error: "Name (2) also exists" }));

    const data = makeNewBundleFormData();

    // Act & Assert: with starterBundle.enabled=true, error is "Failed to create starter bundle"
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create starter bundle",
    );
  });

  // =========================================================================
  // Test #8: Existing bundle subscribed — no fetch, no POST
  // =========================================================================
  // Post-2026-05-31: subscribing to an existing bundle does NOT make any HTTP
  // call (no rules fetch). The bundle id is written to brief.bundle_ids and
  // the aggregator's bundle rules drive content filtering at fetch time.
  it("Test #8: Existing bundleId subscribed — no HTTP calls (rules stay on aggregator)", async () => {
    const data = makeNewBundleFormData({
      bundleIds: ["existing-bundle-1"],
      starterBundle: { enabled: false, name: "" },
    });

    const result = await createSiteAndBuildStaging(data);
    expect(result).toHaveProperty("stagingUrl");

    // No aggregator HTTP calls at all for this path.
    expect(mockFetch).not.toHaveBeenCalled();

    // Bundle id is still written to brief.bundle_ids.
    const { commitSiteFiles } = await import("@/lib/github");
    const commitCall = vi.mocked(commitSiteFiles).mock.calls[0];
    const files = commitCall[1] as Array<{ path: string; content: string }>;
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    expect(siteYaml).toBeDefined();
    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(siteYaml!.content) as { brief: { bundle_ids: string[] } };
    expect(parsed.brief.bundle_ids).toEqual(["existing-bundle-1"]);
  });

  // Tests #8b and #8c previously asserted that a 500 / network error on the
  // per-bundle rules fetch was swallowed. That fetch is now gone (rules are
  // not materialized into the site), so those tests are obsolete and have
  // been removed. The bundle id is always written regardless of aggregator
  // availability — covered by Test #8 above.

  // =========================================================================
  // Test #9: No verticalId → bundle creation skipped entirely
  // =========================================================================
  it("Test #9: No verticalId — bundle creation skipped, site still created", async () => {
    const data = makeNewBundleFormData({
      verticalId: "",
      selectedCategories: [],
      selectedTags: [],
      starterBundle: { enabled: false, name: "" },
    });

    // Act
    const result = await createSiteAndBuildStaging(data);

    // Assert: completes successfully without any fetch calls for bundles
    expect(result).toHaveProperty("stagingUrl");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test #10: No categories → bundle creation skipped (even with verticalId)
  // =========================================================================
  it("Test #10: verticalId set but no categories — bundle creation skipped", async () => {
    const data = makeNewBundleFormData({
      selectedCategories: [],
      starterBundle: { enabled: false, name: "" },
    });

    // Act
    const result = await createSiteAndBuildStaging(data);

    // Assert: no fetch for bundle creation
    expect(result).toHaveProperty("stagingUrl");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // =========================================================================
  // Test #11: Bundle payload structure is correct
  // =========================================================================

  it("Test #11: POST payload has correct structure (name, rules, active)", async () => {
    mockFetch.mockResolvedValue(
      fakeResponse(201, { id: "bundle-check", name: "Test Site" }),
    );

    const data = makeNewBundleFormData({
      siteName: "My Cool Site",
      verticalId: "vert-tech",
      selectedCategories: [
        { id: "sub-ai", name: "AI", iabCode: "IAB19-6" },
        { id: "sub-ml", name: "Machine Learning", iabCode: "IAB19-14" },
      ],
      selectedTags: [
        { id: "tag-gpt", name: "GPT" },
        { id: "tag-llm", name: "LLM" },
      ],
      starterBundle: { enabled: true, name: "My Cool Site" },
    });

    // Act
    await createSiteAndBuildStaging(data);

    // Assert: payload matches expected structure.
    // Post-2026-05-31: category_ids contains exactly what the form picked —
    // no auto-prepend of the tier-1 (vert-tech). To get broad tier-1 coverage,
    // the user explicitly checks the tier-1 row in the new categories picker.
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(payload).toEqual({
      name: "My Cool Site",
      description: "Auto-created content bundle for My Cool Site",
      active: true,
      rules: {
        category_ids: ["sub-ai", "sub-ml"],
        tag_ids: ["tag-gpt", "tag-llm"],
      },
    });
  });

  // =========================================================================
  // Test #12: Multi-existing bundleIds — subscribed, no merge into site.yaml
  // =========================================================================
  // Post-2026-05-31: the wizard no longer fetches existing bundles to merge
  // their rules into brief.category_ids / brief.tag_ids. Bundles are the
  // source of truth for filtering; rules stay on the aggregator, referenced
  // by id via brief.bundle_ids only.
  it("Test #12: Multi-existing bundleIds — subscribed, rules NOT merged into site.yaml", async () => {
    // No GET to /api/bundles/<id> should be made — but mock defensively in
    // case the implementation falls back to it.
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/api/bundles/")) {
        return fakeResponse(200, {
          id: "x",
          name: "X",
          rules: { category_ids: ["should-not-appear-in-site-yaml"], tag_ids: ["should-not-appear-either"] },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    // Empty selectedCategories/selectedTags so the only categories/tags
    // that could land in site.yaml are from the (suppressed) bundle merge.
    const data = makeNewBundleFormData({
      bundleIds: ["b1", "b2"],
      starterBundle: { enabled: false, name: "" },
      selectedCategories: [],
      selectedTags: [],
    });

    const result = await createSiteAndBuildStaging(data);
    expect(result).toHaveProperty("stagingUrl");

    // No POST and no GETs to /api/bundles/<id> (the merge fetch is gone).
    expect(mockFetch).not.toHaveBeenCalled();

    // Inspect the committed site.yaml.
    // commitSiteFiles signature: (domain, files, message, branch) → files at [1]
    const { commitSiteFiles } = await import("@/lib/github");
    const commitCall = vi.mocked(commitSiteFiles).mock.calls[0];
    expect(commitCall).toBeDefined();
    const files = commitCall[1] as Array<{ path: string; content: string }>;
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    expect(siteYaml).toBeDefined();
    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(siteYaml!.content) as {
      bundle_id?: string;
      brief: { bundle_ids: string[]; category_ids?: string[]; tag_ids?: string[] };
    };
    // Subscriptions ARE written.
    expect(parsed.brief.bundle_ids).toEqual(["b1", "b2"]);
    expect(parsed.bundle_id).toBeUndefined();
    // Bundle rules are NOT merged into the site's loose fields.
    expect(parsed.brief.category_ids).toBeUndefined();
    expect(parsed.brief.tag_ids).toBeUndefined();
  });

  // =========================================================================
  // Test #13: Mix of existing + starter — both subscribed
  // =========================================================================
  it("Test #13: Existing + starter — both subscribed, starter ID appended", async () => {
    mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === "POST" && url.endsWith("/api/bundles")) {
        return fakeResponse(201, { id: "starter-new", name: "Test Site" });
      }
      if (url.includes("/api/bundles/b1")) {
        return fakeResponse(200, {
          id: "b1",
          name: "Bundle One",
          rules: { category_ids: ["cat-a"], tag_ids: [] },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const data = makeNewBundleFormData({
      bundleIds: ["b1"],
      starterBundle: { enabled: true, name: "Test Site" },
    });

    const result = await createSiteAndBuildStaging(data);
    expect(result).toHaveProperty("stagingUrl");

    // Exactly one POST (starter creation), and zero GETs (the existing-bundle
    // rules fetch was removed post-2026-05-31 — see Test #12).
    const postCalls = mockFetch.mock.calls.filter(
      (c) => c[1] && (c[1] as { method?: string }).method === "POST",
    );
    expect(postCalls).toHaveLength(1);
    const getCalls = mockFetch.mock.calls.filter(
      (c) => !(c[1] && (c[1] as { method?: string }).method === "POST"),
    );
    expect(getCalls).toHaveLength(0);

    // commitSiteFiles signature: (domain, files, message, branch) → files at [1]
    const { commitSiteFiles } = await import("@/lib/github");
    const commitCall = vi.mocked(commitSiteFiles).mock.calls[0];
    const files = commitCall[1] as Array<{ path: string; content: string }>;
    const siteYaml = files.find((f) => f.path.endsWith("site.yaml"));
    const { parse: parseYaml } = await import("yaml");
    const parsed = parseYaml(siteYaml!.content) as { brief: { bundle_ids: string[] } };
    expect(parsed.brief.bundle_ids).toEqual(["b1", "starter-new"]);
  });
});
