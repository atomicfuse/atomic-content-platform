import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(),
}));
vi.mock("@/lib/github", () => ({
  commitSiteFiles: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/articles", () => ({
  upsertArticleMeta: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("---\ntitle: Hiking\n---\nBody"),
}));

import { POST } from "../route";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";
import { commitSiteFiles } from "@/lib/github";

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3001/api/agent/commit-article", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "grid.example", staging_branch: "staging/grid.example" }] } as never);
});

describe("POST /api/agent/commit-article — Grid site guard", () => {
  it("Grid site (domain derived from articlePath): returns 409 without committing", async () => {
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { template: "grid" } } as never);

    const res = await POST(req({ articlePath: "sites/grid.example/articles/hiking.md" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Grid sites don't generate their own articles" });
    expect(vi.mocked(commitSiteFiles)).not.toHaveBeenCalled();
  });

  it("Modern site: commits unaffected", async () => {
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { base: "classic" } } as never);

    const res = await POST(req({ articlePath: "sites/grid.example/articles/hiking.md" }));

    expect(vi.mocked(commitSiteFiles)).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("committed");
  });
});
