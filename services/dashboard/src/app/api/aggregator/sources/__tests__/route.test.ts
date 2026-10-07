import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/aggregator/sources", () => {
  it("returns sorted unique source names", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ name: "InStyle" }, { name: "Conspiracy" }, { name: "InStyle" }, { name: " " }] }) });
    const res = await GET();
    expect(await res.json()).toEqual({ sources: ["Conspiracy", "InStyle"] });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/api\/sources\?page_size=200$/);
  });
  it("returns an empty list when the aggregator fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    const res = await GET();
    expect(await res.json()).toEqual({ sources: [] });
  });
});
