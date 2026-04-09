/**
 * Content Aggregator API client.
 *
 * Replaces RSS-based sourcing with a query-driven aggregator API.
 * The agent uses the site brief (skill file) to build query parameters,
 * fetches candidate articles, and applies fallback + relevance filtering.
 */

import type { SiteBrief } from "../../types.js";
import { parseHtmlContent, type ParsedContent } from "./rss.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AggregatorArticle {
  url: string;
  title: string;
  source: string;
  image_url: string | null;
  published_date: string;
  vertical: string;
  audience_type: string;
  content_format: string;
  language: string;
  freshness: string;
  source_quality: string;
}

export interface AggregatorResponse {
  query: Record<string, unknown>;
  total_returned: number;
  articles: AggregatorArticle[];
}

export interface AggregatorQueryParams {
  vertical?: string;
  audience_type?: string;
  content_format?: string;
  freshness?: string;
  source_quality?: string;
  language?: string;
  limit?: number;
  page?: number;
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/** Valid verticals accepted by the Content Aggregator API. */
const VALID_VERTICALS = new Set([
  "Tech", "Travel", "News", "Sport", "Lifestyle",
  "Entertainment", "Food & Drink", "Animals", "Science",
]);

/** Topics that suggest news/trending content → prefer "Today" freshness. */
const NEWS_TOPICS = ["news", "breaking", "trending", "politics", "current events"];

/**
 * Map a site brief to aggregator API query parameters.
 */
export function buildQueryParams(brief: SiteBrief, limit?: number): AggregatorQueryParams {
  const params: AggregatorQueryParams = {};

  if (brief.vertical && VALID_VERTICALS.has(brief.vertical)) {
    params.vertical = brief.vertical;
  } else if (brief.vertical) {
    console.warn(`[aggregator] Unknown vertical "${brief.vertical}" — omitting from query`);
  }
  if (brief.audience_type && brief.audience_type.toLowerCase() !== "any") {
    params.audience_type = brief.audience_type;
  }

  params.language = brief.language ?? "EN";
  params.limit = limit ?? brief.schedule.articles_per_week;

  // Freshness: default "This week", but use "Today" if topics suggest news
  const hasNewsTopic = brief.topics.some((t) =>
    NEWS_TOPICS.some((n) => t.toLowerCase().includes(n)),
  );
  params.freshness = hasNewsTopic ? "Today" : "This week";

  // Source quality: default "High"
  params.source_quality = "High";

  // Content format: infer from highest-weight article_types entry
  const contentFormat = inferContentFormat(brief.article_types);
  if (contentFormat) params.content_format = contentFormat;

  return params;
}

/**
 * Map article_types weights to the best-matching aggregator content_format.
 */
function inferContentFormat(articleTypes: Record<string, number>): string | undefined {
  if (!articleTypes || Object.keys(articleTypes).length === 0) return undefined;

  const sorted = Object.entries(articleTypes).sort(([, a], [, b]) => b - a);
  const top = sorted[0]?.[0];

  const formatMap: Record<string, string> = {
    listicle: "Listicle",
    "how-to": "How-to",
    review: "Review",
    standard: "Opinion",
  };

  return top ? formatMap[top] : undefined;
}

// ---------------------------------------------------------------------------
// API fetching
// ---------------------------------------------------------------------------

/**
 * Fetch articles from the aggregator API.
 */
export async function fetchArticles(
  baseUrl: string,
  params: AggregatorQueryParams,
): Promise<AggregatorResponse> {
  const url = new URL("/api/articles", baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  console.log(`[aggregator] GET ${url.toString()}`);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Aggregator API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as AggregatorResponse;
}

/**
 * Fetch articles with progressive fallback.
 *
 * Accepts an optional set of already-known URLs to exclude. When provided,
 * the function keeps broadening filters until it finds enough NEW articles
 * (not just any articles). This prevents the "all articles already processed"
 * problem when the strict query returns only previously-seen results.
 *
 * Fallback chain:
 * 1. Full params (freshness=Today/This week, source_quality=High, content_format set)
 * 2. Relax freshness: Today → This week → Older
 * 3. Drop content_format
 * 4. Drop source_quality to Medium
 * 5. Drop audience_type
 * 6. Minimal: only vertical + language + limit
 */
export async function fetchWithFallback(
  baseUrl: string,
  brief: SiteBrief,
  limit?: number,
  existingUrls?: Set<string>,
): Promise<AggregatorArticle[]> {
  const baseParams = buildQueryParams(brief, limit);
  const seen = new Set<string>(); // track URLs across attempts to avoid duplicates
  const allArticles: AggregatorArticle[] = [];

  function collectNew(articles: AggregatorArticle[]): number {
    let added = 0;
    for (const a of articles) {
      if (!seen.has(a.url)) {
        seen.add(a.url);
        allArticles.push(a);
        added++;
      }
    }
    return added;
  }

  function hasEnoughNew(): boolean {
    if (!existingUrls) return allArticles.length > 0;
    const newCount = allArticles.filter((a) => !existingUrls.has(normalizeUrl(a.url))).length;
    return newCount >= (limit ?? 3);
  }

  // Build the fallback param chain — each step progressively relaxes filters
  const paramChain: Array<{ label: string; params: AggregatorQueryParams }> = [];

  // Step 1: full params
  paramChain.push({ label: "full params", params: { ...baseParams } });

  // Step 2: relax freshness
  const freshnessLevels = ["Today", "This week", "Older"];
  const currentIdx = freshnessLevels.indexOf(baseParams.freshness ?? "This week");
  for (let i = currentIdx + 1; i < freshnessLevels.length; i++) {
    paramChain.push({
      label: `freshness → ${freshnessLevels[i]}`,
      params: { ...baseParams, freshness: freshnessLevels[i] },
    });
  }

  // Step 3: drop content_format
  if (baseParams.content_format) {
    paramChain.push({
      label: "drop content_format",
      params: { ...baseParams, content_format: undefined, freshness: "This week" },
    });
  }

  // Step 4: drop source_quality to Medium
  paramChain.push({
    label: "source_quality → Medium",
    params: { ...baseParams, content_format: undefined, freshness: "This week", source_quality: "Medium" },
  });

  // Step 5: drop audience_type
  paramChain.push({
    label: "drop audience_type",
    params: { ...baseParams, content_format: undefined, freshness: "This week", source_quality: undefined, audience_type: undefined },
  });

  // Step 6: minimal — only vertical + language + limit
  paramChain.push({
    label: "minimal (vertical + language only)",
    params: { vertical: baseParams.vertical, language: baseParams.language, limit: baseParams.limit },
  });

  for (const step of paramChain) {
    const result = await fetchArticles(baseUrl, step.params);
    const added = collectNew(result.articles);

    if (added > 0) {
      console.log(`[aggregator] ${step.label}: +${added} articles (total: ${allArticles.length})`);
    }

    if (hasEnoughNew()) return allArticles;

    // If this step returned nothing, keep going to next fallback
    if (result.articles.length === 0 && step === paramChain[0]) {
      console.log(`[aggregator] Fallback: ${step.label} returned 0 results, broadening...`);
    }
  }

  // Return whatever we collected even if not enough
  if (allArticles.length > 0) {
    const newCount = existingUrls
      ? allArticles.filter((a) => !existingUrls.has(normalizeUrl(a.url))).length
      : allArticles.length;
    console.log(`[aggregator] Exhausted all fallbacks. Collected ${allArticles.length} articles (${newCount} new)`);
    return allArticles;
  }

  console.log("[aggregator] No articles found after all fallbacks", {
    vertical: baseParams.vertical,
    audience_type: baseParams.audience_type,
    language: baseParams.language,
  });
  return [];
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

/** Normalize a URL for dedup comparison. Strips protocol, www, query, fragment, trailing slash. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${pathname}`;
  } catch {
    return url.replace(/\/+$/, "").toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Relevance filtering
// ---------------------------------------------------------------------------

/**
 * Rank articles by topic relevance and return the best matches.
 * If filtering removes everything, returns the original list unmodified.
 */
export function filterByRelevance(
  articles: AggregatorArticle[],
  topics: string[],
): AggregatorArticle[] {
  if (topics.length === 0 || articles.length === 0) return articles;

  const lowerTopics = topics.map((t) => t.toLowerCase());

  const scored = articles.map((article) => {
    const titleLower = article.title.toLowerCase();
    const score = lowerTopics.reduce(
      (acc, topic) => acc + (titleLower.includes(topic) ? 1 : 0),
      0,
    );
    return { article, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Filter to those with at least one topic match
  const matched = scored.filter((s) => s.score > 0).map((s) => s.article);

  // If filtering removes everything, return all (the API already filtered by vertical)
  return matched.length > 0 ? matched : articles;
}

// ---------------------------------------------------------------------------
// Source content scraping
// ---------------------------------------------------------------------------

/**
 * Fetch and parse the full HTML content from a source article URL.
 * Reuses parseHtmlContent from rss.ts for consistent extraction.
 *
 * Gracefully handles failures — returns minimal content on error.
 */
export async function scrapeSourceContent(url: string): Promise<ParsedContent> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });

    if (!response.ok) {
      console.warn(`[aggregator] Failed to scrape ${url}: ${response.status}`);
      return emptyParsedContent();
    }

    const html = await response.text();

    if (!html || html.length < 200) {
      console.warn(`[aggregator] Empty/tiny response from ${url}: ${html.length} bytes`);
      return emptyParsedContent();
    }

    // Try to extract the main content area, falling back to full body
    const mainContent = extractMainContent(html);

    const parsed = parseHtmlContent(mainContent, undefined);

    if (!parsed.textBody) {
      console.warn(
        `[aggregator] No text extracted from ${url} (html: ${html.length} bytes, mainContent: ${mainContent.length} bytes)`,
      );
    }

    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[aggregator] Scrape error for ${url}: ${message}`);
    return emptyParsedContent();
  }
}

/**
 * Extract the main content from HTML — looks for <article>, <main>,
 * or falls back to the full <body>.
 */
function extractMainContent(html: string): string {
  // Use greedy matching to capture full content between outermost tags
  const articleMatch = html.match(/<article[^>]*>([\s\S]*)<\/article>/i);
  if (articleMatch) return articleMatch[1]!;

  const mainMatch = html.match(/<main[^>]*>([\s\S]*)<\/main>/i);
  if (mainMatch) return mainMatch[1]!;

  // Fall back to body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1]!;

  return html;
}

function emptyParsedContent(): ParsedContent {
  return {
    textBody: "",
    featuredImageUrl: null,
    inlineImages: [],
    youtubeEmbeds: [],
  };
}
