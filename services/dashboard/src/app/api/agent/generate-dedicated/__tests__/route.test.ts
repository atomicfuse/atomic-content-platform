import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(),
}));
vi.mock("@/lib/db/site-configs", () => ({
  getSiteConfig: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "../route";
import { getDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig } from "@/lib/db/site-configs";

const fetchMock = vi.fn();

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3001/api/agent/generate-dedicated", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getDashboardIndex).mockResolvedValue({ sites: [{ domain: "grid.example", staging_branch: "staging/grid.example" }] } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/agent/generate-dedicated — Grid site guard", () => {
  it("Grid site: returns 409 without calling the content-pipeline", async () => {
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { template: "grid" } } as never);

    const res = await POST(req({ siteDomain: "grid.example", userPrompt: "Write about hiking" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Grid sites don't generate their own articles" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Modern site: passes through to the content-pipeline unaffected", async () => {
    vi.mocked(getSiteConfig).mockResolvedValue({ theme: { base: "classic" } } as never);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ status: "success", slug: "hiking" }),
    });

    const res = await POST(req({ siteDomain: "grid.example", userPrompt: "Write about hiking" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
  });
});
