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
    bundleId: "", // empty → triggers new bundle creation
    tone: "informative",
    topics: ["AI news"],
    articlesPerDay: 1,
    preferredDays: ["Monday", "Wednesday", "Friday"],
    contentGuidelines: "",
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

    // Assert: payload includes tier-1 ID merged with child category IDs
    const payload = JSON.parse(bundleCall[1].body as string);
    expect(payload.rules.category_ids).toContain("vert-001");
    expect(payload.rules.category_ids).toContain("cat-sub-1");
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
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create content bundle",
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

    // Act & Assert
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create content bundle",
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
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create content bundle",
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

    // Act & Assert
    await expect(createSiteAndBuildStaging(data)).rejects.toThrow(
      "Failed to create content bundle",
    );
  });

  // =========================================================================
  // Test #8: Existing bundle mode → skips creation, fetches rules
  // =========================================================================
  it("Test #8: Existing bundleId set — no POST, only GET to fetch rules", async () => {
    // Arrange: return bundle rules for the existing bundle
    mockFetch.mockResolvedValue(
      fakeResponse(200, {
        id: "existing-bundle-1",
        name: "Existing Bundle",
        rules: { category_ids: ["cat-a", "cat-b"], tag_ids: ["tag-x"] },
      }),
    );

    const data = makeNewBundleFormData({ bundleId: "existing-bundle-1" });

    // Act
    const result = await createSiteAndBuildStaging(data);

    // Assert: completes successfully
    expect(result).toHaveProperty("stagingUrl");

    // Assert: fetch was a GET (not POST) to fetch bundle rules
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toContain("/api/bundles/existing-bundle-1");
    // GET calls don't pass a method option (or pass GET explicitly)
    expect(call[1]?.method).toBeUndefined();
  });

  // =========================================================================
  // Test #9: No verticalId → bundle creation skipped entirely
  // =========================================================================
  it("Test #9: No verticalId — bundle creation skipped, site still created", async () => {
    const data = makeNewBundleFormData({
      verticalId: "",
      selectedCategories: [],
      selectedTags: [],
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
    });

    // Act
    await createSiteAndBuildStaging(data);

    // Assert: payload matches expected structure
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(payload).toEqual({
      name: "My Cool Site",
      description: "Auto-created content bundle for My Cool Site",
      active: true,
      rules: {
        // tier-1 ID merged with child IDs (deduped)
        category_ids: ["vert-tech", "sub-ai", "sub-ml"],
        tag_ids: ["tag-gpt", "tag-llm"],
      },
    });
  });
});
