import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getAllCategories,
  getTopTags,
  resolveTagNames,
  resolveCategoryNames,
} from "@/lib/reference-data";

/** Build a paginated aggregator response page. */
function page(
  items: Array<Record<string, unknown>>,
  pageNum: number,
  totalPages: number,
  totalCount: number,
): Response {
  return {
    ok: true,
    json: async () => ({
      total_count: totalCount,
      page: pageNum,
      page_size: 100,
      total_pages: totalPages,
      items,
    }),
  } as unknown as Response;
}

function cat(id: string, name: string): Record<string, unknown> {
  return { id, name, iab_code: "", parent_id: null };
}
function tag(id: string, name: string, usage = 0): Record<string, unknown> {
  return { id, name, usage_count: usage };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAllCategories", () => {
  it("paginates page=1..total_pages at page_size=100 and returns all items", async () => {
    const p1 = Array.from({ length: 100 }, (_, i) => cat(`c${i}`, `Cat ${i}`));
    const p2 = Array.from({ length: 24 }, (_, i) => cat(`c${100 + i}`, `Cat ${100 + i}`));
    fetchMock
      .mockResolvedValueOnce(page(p1, 1, 2, 124))
      .mockResolvedValueOnce(page(p2, 2, 2, 124));

    const result = await getAllCategories();

    expect(result).toHaveLength(124);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // every request stays within the documented max page_size of 100
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      const m = url.match(/page_size=(\d+)/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeLessThanOrEqual(100);
    }
  });

  it("returns [] when the first page request fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 } as Response);
    const result = await getAllCategories();
    expect(result).toEqual([]);
  });
});

describe("getTopTags", () => {
  it("requests usage_count desc and returns at most `limit` tags", async () => {
    const p1 = Array.from({ length: 100 }, (_, i) => tag(`t${i}`, `tag ${i}`, 100 - i));
    const p2 = Array.from({ length: 100 }, (_, i) => tag(`t${100 + i}`, `tag ${100 + i}`, 0));
    fetchMock
      .mockResolvedValueOnce(page(p1, 1, 95, 9437))
      .mockResolvedValueOnce(page(p2, 2, 95, 9437));

    const result = await getTopTags(150);

    expect(result.length).toBeLessThanOrEqual(150);
    expect(result.length).toBeGreaterThan(0);
    const firstUrl = String(fetchMock.mock.calls[0][0]);
    expect(firstUrl).toContain("sort=usage_count");
    expect(firstUrl).toContain("order=desc");
    expect(firstUrl).toContain("include_usage=true");
    // never fetches the whole 9437-tag taxonomy
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("resolveTagNames", () => {
  it("returns {} without fetching when ids is empty", async () => {
    const result = await resolveTagNames([]);
    expect(result).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves ids to names via ?ids= and maps only requested ids", async () => {
    fetchMock.mockResolvedValueOnce(
      page([tag("a", "cats"), tag("b", "dogs")], 1, 1, 2),
    );
    const result = await resolveTagNames(["a", "b"]);
    expect(result).toEqual({ a: "cats", b: "dogs" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("ids=a,b");
  });

  it("is robust if the endpoint over-returns (ignored ?ids=) — keeps only requested ids", async () => {
    fetchMock.mockResolvedValueOnce(
      page([tag("a", "cats"), tag("b", "dogs"), tag("z", "zebra")], 1, 1, 3),
    );
    const result = await resolveTagNames(["a"]);
    expect(result).toEqual({ a: "cats" });
  });
});

describe("resolveCategoryNames", () => {
  it("resolves category ids to names via ?ids=", async () => {
    fetchMock.mockResolvedValueOnce(
      page([cat("p", "Pets"), cat("f", "Personal Finance")], 1, 1, 2),
    );
    const result = await resolveCategoryNames(["p", "f"]);
    expect(result).toEqual({ p: "Pets", f: "Personal Finance" });
  });
});
