import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractBaseUrl,
  fetchWpArticles,
  fetchWpCategories,
} from "../../agents/migration/wp-fetcher.js";
import type { WpArticle, WpCategory } from "../../agents/migration/types.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeArticle(id: number): WpArticle {
  return {
    id,
    slug: `article-${id}`,
    date: "2026-01-01T00:00:00",
    title: { rendered: `Article ${id}` },
    content: { rendered: `<p>Content ${id}</p>` },
    excerpt: { rendered: `<p>Excerpt ${id}</p>` },
    author: 1,
    featured_media: 0,
    categories: [1],
    tags: [],
  };
}

function makeCategory(id: number, name: string): WpCategory {
  return { id, name, slug: name.toLowerCase().replace(/\s+/g, "-"), parent: 0 };
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ---------------------------------------------------------------------------
// extractBaseUrl
// ---------------------------------------------------------------------------

describe("extractBaseUrl", () => {
  it("extracts base URL from a full WP REST API URL", () => {
    expect(
      extractBaseUrl("https://tvshowbox.com/wp-json/wp/v2/posts?per_page=75"),
    ).toBe("https://tvshowbox.com");
  });

  it("preserves port if present", () => {
    expect(
      extractBaseUrl("http://localhost:8080/wp-json/wp/v2/posts"),
    ).toBe("http://localhost:8080");
  });
});

// ---------------------------------------------------------------------------
// fetchWpArticles
// ---------------------------------------------------------------------------

describe("fetchWpArticles", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a single page of articles", async () => {
    const articles = [makeArticle(1), makeArticle(2)];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse(articles, { "X-WP-TotalPages": "1" }),
    );

    const result = await fetchWpArticles(
      "https://example.com/wp-json/wp/v2/posts?per_page=75",
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(1);
    expect(result[1]!.id).toBe(2);

    // Should have forced per_page=100
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("per_page=100");
    expect(calledUrl).toContain("page=1");
  });

  it("paginates across multiple pages", async () => {
    const page1 = [makeArticle(1), makeArticle(2)];
    const page2 = [makeArticle(3)];

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        jsonResponse(page1, { "X-WP-TotalPages": "2" }),
      )
      .mockResolvedValueOnce(
        jsonResponse(page2, { "X-WP-TotalPages": "2" }),
      );

    const result = await fetchWpArticles(
      "https://example.com/wp-json/wp/v2/posts",
    );

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const url2 = vi.mocked(globalThis.fetch).mock.calls[1]![0] as string;
    expect(url2).toContain("page=2");
  });

  it("throws on non-OK response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      fetchWpArticles("https://example.com/wp-json/wp/v2/posts"),
    ).rejects.toThrow("WP API error: 404 Not Found");
  });
});

// ---------------------------------------------------------------------------
// fetchWpCategories
// ---------------------------------------------------------------------------

describe("fetchWpCategories", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches categories by IDs and returns a Map", async () => {
    const cats = [makeCategory(5, "Tech"), makeCategory(12, "Travel")];

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse(cats));

    const result = await fetchWpCategories("https://example.com", [5, 12]);

    expect(result.size).toBe(2);
    expect(result.get(5)?.name).toBe("Tech");
    expect(result.get(12)?.name).toBe("Travel");

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("include=5%2C12");
    expect(calledUrl).toContain("per_page=100");
  });

  it("returns empty map for empty category IDs", async () => {
    const result = await fetchWpCategories("https://example.com", []);

    expect(result.size).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("deduplicates category IDs", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      jsonResponse([makeCategory(3, "Sports")]),
    );

    await fetchWpCategories("https://example.com", [3, 3, 3]);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(calledUrl).toContain("include=3");
    // Should only have "3" once, not "3,3,3"
    const url = new URL(calledUrl);
    expect(url.searchParams.get("include")).toBe("3");
  });
});
