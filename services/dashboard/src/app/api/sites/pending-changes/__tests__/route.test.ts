import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { DashboardSiteEntry } from "@/types/dashboard";

const getDashboardIndexMock = vi.fn();
const compareMock = vi.fn();
const octokitCtorMock = vi.fn();

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: (...args: unknown[]) => getDashboardIndexMock(...args),
}));

// Octokit is fully mocked: no request can reach GitHub from this file.
vi.mock("@octokit/rest", () => ({
  Octokit: class {
    repos = {
      compareCommitsWithBasehead: (...args: unknown[]) => compareMock(...args),
    };
    constructor(opts: unknown) {
      octokitCtorMock(opts);
    }
  },
}));

function makeSite(overrides: Partial<DashboardSiteEntry> = {}): DashboardSiteEntry {
  return {
    domain: "coolnews",
    company: "ATL",
    vertical: "News",
    status: "Live",
    site_id: "site_123",
    exclusivity: null,
    ob_epid: null,
    ga_info: null,
    cf_apo: false,
    fixed_ad: false,
    last_updated: "2026-01-01T00:00:00Z",
    created_at: "2025-06-15T00:00:00Z",
    pages_project: null,
    pages_subdomain: null,
    zone_id: null,
    staging_branch: "staging/coolnews",
    preview_url: null,
    saved_previews: null,
    custom_domain: null,
    ...overrides,
  };
}

function req(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/sites/pending-changes${query}`);
}

/** Compare response keyed by basehead's staging branch. */
function compareReturning(filesByBranch: Record<string, Array<{ filename: string; status: string }>>): void {
  compareMock.mockImplementation(async (args: { basehead: string }) => {
    const branch = args.basehead.replace("main...", "");
    const files = filesByBranch[branch];
    if (!files) throw new Error(`unexpected compare for ${branch}`);
    return { data: { files, ahead_by: files.length } };
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  getDashboardIndexMock.mockReset();
  compareMock.mockReset();
  octokitCtorMock.mockReset();
  process.env.GITHUB_TOKEN = "test-token";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/sites/pending-changes", () => {
  it("returns 500 with a clear message when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    getDashboardIndexMock.mockResolvedValue({ sites: [makeSite()] });
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/GITHUB_TOKEN/);
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("only scans Live/Ready sites with a staging branch, using main...<staging_branch>", async () => {
    getDashboardIndexMock.mockResolvedValue({
      sites: [
        makeSite({ domain: "live-one", status: "Live", staging_branch: "staging/live-one" }),
        makeSite({ domain: "ready-one", status: "Ready", staging_branch: "staging/ready-one" }),
        makeSite({ domain: "staging-one", status: "Staging", staging_branch: "staging/staging-one" }),
        makeSite({ domain: "no-branch", status: "Live", staging_branch: null }),
      ],
    });
    compareReturning({
      "staging/live-one": [{ filename: "sites/live-one/site.yaml", status: "modified" }],
      "staging/ready-one": [{ filename: "sites/ready-one/articles/x.md", status: "added" }],
    });
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    const baseheads = compareMock.mock.calls.map((c) => (c[0] as { basehead: string }).basehead).sort();
    expect(baseheads).toEqual(["main...staging/live-one", "main...staging/ready-one"]);
    expect(compareMock.mock.calls[0]?.[0]).toMatchObject({
      owner: "atomicfuse",
      repo: "atomic-labs-network",
    });
    expect(body.sites.map((s: { domain: string }) => s.domain)).toEqual(["live-one", "ready-one"]);
    expect(body.sites[0]).toMatchObject({ domain: "live-one", status: "Live", modified: 1, added: 0, removed: 0 });
    expect(typeof body.scannedAt).toBe("string");
    expect(body.errors).toEqual([]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("omits sites with no files under sites/<domain>/ (cross-domain-only changes count as none)", async () => {
    getDashboardIndexMock.mockResolvedValue({
      sites: [
        makeSite({ domain: "has-changes", staging_branch: "staging/has-changes" }),
        makeSite({ domain: "clean", staging_branch: "staging/clean" }),
        makeSite({ domain: "cross", staging_branch: "staging/cross" }),
      ],
    });
    compareReturning({
      "staging/has-changes": [{ filename: "sites/has-changes/articles/gone.md", status: "removed" }],
      "staging/clean": [],
      "staging/cross": [{ filename: "sites/someone-else/site.yaml", status: "modified" }],
    });
    const { GET } = await import("../route");
    const body = await (await GET(req())).json();
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0]).toMatchObject({ domain: "has-changes", removed: 1, deletedArticles: ["gone"] });
  });

  it("puts a failing compare in errors while the other sites still succeed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getDashboardIndexMock.mockResolvedValue({
      sites: [
        makeSite({ domain: "ok-one", staging_branch: "staging/ok-one" }),
        makeSite({ domain: "broken", staging_branch: "staging/broken" }),
        makeSite({ domain: "ok-two", staging_branch: "staging/ok-two" }),
      ],
    });
    compareMock.mockImplementation(async (args: { basehead: string }) => {
      if (args.basehead.endsWith("broken")) throw new Error("Not Found");
      const domain = args.basehead.replace("main...staging/", "");
      return { data: { files: [{ filename: `sites/${domain}/site.yaml`, status: "modified" }] } };
    });
    const { GET } = await import("../route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sites.map((s: { domain: string }) => s.domain)).toEqual(["ok-one", "ok-two"]);
    expect(body.errors).toEqual([{ domain: "broken", message: "Not Found" }]);
  });

  it("runs at most 5 compares at the same time", async () => {
    const sites = Array.from({ length: 12 }, (_, i) =>
      makeSite({ domain: `site-${i}`, staging_branch: `staging/site-${i}` }),
    );
    getDashboardIndexMock.mockResolvedValue({ sites });
    let inFlight = 0;
    let maxInFlight = 0;
    compareMock.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { data: { files: [] } };
    });
    const { GET } = await import("../route");
    await GET(req());
    expect(compareMock).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("supports ?domain= to re-check a single site", async () => {
    getDashboardIndexMock.mockResolvedValue({
      sites: [
        makeSite({ domain: "target", staging_branch: "staging/target" }),
        makeSite({ domain: "other", staging_branch: "staging/other" }),
      ],
    });
    compareReturning({
      "staging/target": [{ filename: "sites/target/site.yaml", status: "modified" }],
      "staging/other": [{ filename: "sites/other/site.yaml", status: "modified" }],
    });
    const { GET } = await import("../route");
    const body = await (await GET(req("?domain=target"))).json();
    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(body.sites.map((s: { domain: string }) => s.domain)).toEqual(["target"]);
  });

  it("?domain= returns 404 for an unknown site and an empty list for an ineligible one", async () => {
    getDashboardIndexMock.mockResolvedValue({
      sites: [makeSite({ domain: "wip", status: "Staging", staging_branch: "staging/wip" })],
    });
    const { GET } = await import("../route");
    const missing = await GET(req("?domain=nope"));
    expect(missing.status).toBe(404);
    const ineligible = await (await GET(req("?domain=wip"))).json();
    expect(ineligible.sites).toEqual([]);
    expect(compareMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/sites/pending-changes ?domain= eligibility flag", () => {
  it("reports eligible: false for a site that is no longer Ready/Live or lost its branch, true otherwise", async () => {
    getDashboardIndexMock.mockResolvedValue({
      sites: [
        makeSite({ domain: "demoted", status: "Staging" }),
        makeSite({ domain: "branchless", staging_branch: null }),
        makeSite({ domain: "fine", staging_branch: "staging/fine" }),
      ],
    });
    compareReturning({ "staging/fine": [] });
    const { GET } = await import("../route");
    expect((await (await GET(req("?domain=demoted"))).json()).eligible).toBe(false);
    expect((await (await GET(req("?domain=branchless"))).json()).eligible).toBe(false);
    const fine = await (await GET(req("?domain=fine"))).json();
    expect(fine.eligible).toBe(true);
    expect(fine.sites).toEqual([]);
    // Full scans don't carry the flag.
    expect("eligible" in (await (await GET(req())).json())).toBe(false);
  });
});
