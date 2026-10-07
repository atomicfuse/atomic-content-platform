import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

const req = (body: unknown): NextRequest =>
  new NextRequest("http://localhost/api/grid/pin", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

describe("POST /api/grid/pin", () => {
  it("forwards pin/unpin to the pipeline", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "ok" }) });
    const res = await POST(req({ site: "aggregator", slug: "abc", pinned: false }));
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/grid-summaries\/pin$/);
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ site: "aggregator", slug: "abc", pinned: false });
  });
  it("rejects a missing or non-boolean pinned and unsafe ids", async () => {
    expect((await POST(req({ site: "aggregator", slug: "abc" }))).status).toBe(400);
    expect((await POST(req({ site: "../x", slug: "abc", pinned: true }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("passes the pipeline's error status through", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ message: "No summary" }) });
    const res = await POST(req({ site: "aggregator", slug: "abc", pinned: true }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "No summary" });
  });
});
