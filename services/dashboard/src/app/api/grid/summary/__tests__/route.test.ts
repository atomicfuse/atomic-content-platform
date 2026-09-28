import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockReadFileContent = vi.fn();
vi.mock("@/lib/github", () => ({ readFileContent: (...a: unknown[]): unknown => mockReadFileContent(...a) }));

import { GET } from "../route";

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost:3001/api/grid/summary${qs}`);
}

beforeEach(() => mockReadFileContent.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("GET /api/grid/summary", () => {
  it("a missing file → exists: false", async () => {
    mockReadFileContent.mockResolvedValueOnce(null);
    const res = await GET(req("?site=src&slug=a1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
    expect(mockReadFileContent).toHaveBeenCalledWith("grid-summaries/src/a1.md", "main");
  });

  it("a GitHub read failure → 502 { error: 'Could not read summary' }", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockReadFileContent.mockRejectedValueOnce(new Error("GitHub rate limited"));
    const res = await GET(req("?site=src&slug=a1"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not read summary" });
    expect(errorSpy).toHaveBeenCalled();
  });
});
