import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(),
}));

import { isGridSiteDomain, gridGenerationGuard } from "../grid-guard";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";

beforeEach(() => vi.clearAllMocks());

describe("isGridSiteDomain", () => {
  it("reads the staging branch when the site has one", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "s.example", staging_branch: "staging/s.example" }] } as never);
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { template: "grid" } } as never);

    expect(await isGridSiteDomain("s.example")).toBe(true);
    expect(vi.mocked(getSiteConfig)).toHaveBeenCalledWith("s.example", "staging/s.example");
  });

  it("falls back to main when the staging branch read returns null", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "s.example", staging_branch: "staging/s.example" }] } as never);
    vi.mocked(getSiteConfig)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ theme: { template: "grid" } } as never);

    expect(await isGridSiteDomain("s.example")).toBe(true);
    expect(vi.mocked(getSiteConfig)).toHaveBeenNthCalledWith(2, "s.example", undefined);
  });

  it("false for Modern sites", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "s.example", staging_branch: "staging/s.example" }] } as never);
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { base: "classic" } } as never);

    expect(await isGridSiteDomain("s.example")).toBe(false);
  });

  it("false when the site isn't found in the dashboard index", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [] } as never);
    vi.mocked(getSiteConfig).mockResolvedValue(null as never);

    expect(await isGridSiteDomain("missing.example")).toBe(false);
  });
});

describe("gridGenerationGuard", () => {
  it("returns a 409 NextResponse for a Grid site", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "s.example", staging_branch: null }] } as never);
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { template: "grid" } } as never);

    const res = await gridGenerationGuard("s.example");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
    expect(await res!.json()).toEqual({ error: "Grid sites don't generate their own articles" });
  });

  it("returns null for a Modern site", async () => {
    vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "s.example", staging_branch: null }] } as never);
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { base: "classic" } } as never);

    expect(await gridGenerationGuard("s.example")).toBeNull();
  });
});
