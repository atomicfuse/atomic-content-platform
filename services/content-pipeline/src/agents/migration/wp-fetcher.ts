import type { WpArticle, WpCategory } from "./types.js";

const USER_AGENT = "Mozilla/5.0 (compatible; AtomicBot/1.0)";
const TIMEOUT_MS = 30_000;

/**
 * Extract the base URL (scheme + host) from a full WP REST API URL.
 * E.g. "https://tvshowbox.com/wp-json/wp/v2/posts?per_page=75" → "https://tvshowbox.com"
 */
export function extractBaseUrl(apiUrl: string): string {
  const parsed = new URL(apiUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Fetch articles from a WP REST API posts endpoint, handling pagination.
 *
 * Respects the `per_page` param from the URL if present (useful for testing
 * with a small batch). Falls back to 100 per page and paginates all pages.
 */
export async function fetchWpArticles(postsApiUrl: string): Promise<WpArticle[]> {
  const url = new URL(postsApiUrl);
  const userLimit = url.searchParams.has("per_page")
    ? parseInt(url.searchParams.get("per_page")!, 10)
    : null;

  const perPage = userLimit ?? 100;
  url.searchParams.set("per_page", String(perPage));

  const articles: WpArticle[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    url.searchParams.set("page", String(page));

    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`WP API error: ${response.status} ${response.statusText} for ${url.toString()}`);
    }

    const pageArticles = (await response.json()) as WpArticle[];
    articles.push(...pageArticles);

    if (page === 1) {
      const header = response.headers.get("X-WP-TotalPages");
      totalPages = header ? parseInt(header, 10) : 1;
    }

    // If the user explicitly set per_page, only fetch that first page
    if (userLimit !== null) break;

    page++;
  } while (page <= totalPages);

  return articles;
}

/**
 * Fetch WP categories by their IDs and return a Map<id, WpCategory>.
 * Uses the ?include=1,2,3 parameter to batch-fetch.
 */
export async function fetchWpCategories(
  baseUrl: string,
  categoryIds: number[],
): Promise<Map<number, WpCategory>> {
  const map = new Map<number, WpCategory>();
  if (categoryIds.length === 0) return map;

  const unique = [...new Set(categoryIds)];
  const url = new URL(`${baseUrl}/wp-json/wp/v2/categories`);
  url.searchParams.set("include", unique.join(","));
  url.searchParams.set("per_page", "100");

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`WP API error: ${response.status} ${response.statusText} for ${url.toString()}`);
  }

  const categories: WpCategory[] = await response.json() as WpCategory[];
  for (const cat of categories) {
    map.set(cat.id, cat);
  }

  return map;
}
