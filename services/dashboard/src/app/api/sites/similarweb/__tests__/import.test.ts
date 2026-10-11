import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/similarweb/store", () => ({ upsertSimilarwebStatuses: (...a: unknown[]) => upsert(...a) }));
vi.mock("@/lib/db/dashboard-index", () => ({
  getDashboardIndex: vi.fn(async () => ({ sites: [
    { domain: "scoopella", custom_domain: "scoopella.com" },
    { domain: "journeypeaks", custom_domain: "journeypeaks.com" },
  ] })),
}));

import { POST } from "../import/route";

const req = (body: unknown): Request => new Request("http://x/api/sites/similarweb/import", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/sites/similarweb/import", () => {
  beforeEach(() => upsert.mockClear());

  it("stores matched rows and reports counts", async () => {
    const csv = "domain,site,similarweb,global_rank,monthly_visits\njourneypeaks.com,journeypeaks,yes,79692,1.34M\nscoopella.com,scoopella,no,,\nx.com,x,no,,\na.com,a,unchecked,,";
    const res = await POST(req({ csv }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 2, ignored: 1, rejected: [], unknown: ["x.com"] });
    const stored = upsert.mock.calls[0]![0] as Array<{ site: string }>;
    expect(stored.map((s) => s.site)).toEqual(["journeypeaks", "scoopella"]);
  });

  it("writes nothing and returns 400 when no row is valid", async () => {
    const res = await POST(req({ csv: "url,rank\na.com,1" }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing column/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("says every row was rejected (not 'no match') when that is why nothing imported", async () => {
    const res = await POST(req({ csv: "domain,similarweb,global_rank\nscoopella.com,yes,\njourneypeaks.com,yes,abc" }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Every row was rejected (2) — check the preview for the reasons; nothing was imported");
  });
});

