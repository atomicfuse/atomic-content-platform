import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

const fetchMock = vi.fn();

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost:3001/api/categories${qs}`);
}

describe("GET /api/categories", () => {
  it("never requests page_size > 100 upstream (even if asked for more)", async () => {
    fetchMock.mockResolvedValueOnce(ok({ items: [], total_pages: 1 }));
    await GET(req("?page_size=500"));
    const url = String(fetchMock.mock.calls[0][0]);
    const ps = Number(url.match(/page_size=(\d+)/)![1]);
    expect(ps).toBeLessThanOrEqual(100);
  });

  it("forwards ?ids= for id-resolution mode", async () => {
    fetchMock.mockResolvedValueOnce(ok({ items: [{ id: "a", name: "Pets" }] }));
    await GET(req("?ids=a,b"));
    expect(String(fetchMock.mock.calls[0][0])).toContain("ids=a%2Cb");
  });

  it("surfaces upstream error status with an empty items shape", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) } as Response);
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });
});
