/**
 * Content Aggregator v2 typed HTTP client.
 *
 * Fetches enriched content items and settings from the Content Aggregator API.
 * Retries 3x with exponential backoff on failure.
 * CRITICAL: always passes page_size — never fetches unbounded.
 */

import type { ContentItem, ContentApiResponse, AggregatorSettings } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://content-aggregator-cloudgrid.apps.cloudgrid.io";
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function getBaseUrl(): string {
  return (
    process.env.CONTENT_API_BASE_URL ??
    process.env.CONTENT_AGGREGATOR_URL ??
    DEFAULT_BASE_URL
  );
}

// ---------------------------------------------------------------------------
// Retry utility
// ---------------------------------------------------------------------------

async function fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) return response;

      // Don't retry 4xx — those are client errors
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`API error ${response.status}: ${response.statusText}`);
      }

      lastError = new Error(`API error ${response.status}: ${response.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < retries - 1) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(`[api-client] Retry ${attempt + 1}/${retries} in ${backoff}ms: ${lastError?.message}`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new Error("fetchWithRetry: unknown error");
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

export interface GetContentParams {
  /** Maximum number of items to return. Always passed as page_size. */
  limit: number;
  enriched?: boolean;
  status?: string;
  content_type?: string;
  vertical?: string;
  language?: string;
}

/**
 * Fetch enriched content items from the Content Aggregator v2 API.
 * Always passes page_size to avoid unbounded fetches.
 */
export async function getContent(params: GetContentParams): Promise<ContentItem[]> {
  const baseUrl = getBaseUrl();
  const url = new URL("/api/content", baseUrl);

  url.searchParams.set("enriched", String(params.enriched ?? true));
  url.searchParams.set("status", params.status ?? "active");
  url.searchParams.set("content_type", params.content_type ?? "article");
  url.searchParams.set("page_size", String(params.limit));

  if (params.vertical) {
    url.searchParams.set("vertical", params.vertical);
  }
  if (params.language) {
    url.searchParams.set("language", params.language);
  }

  console.log(`[api-client] GET ${url.toString()}`);

  const response = await fetchWithRetry(url.toString());
  const body = (await response.json()) as ContentApiResponse;

  console.log(`[api-client] Received ${body.data.length} items (total: ${body.total})`);
  return body.data;
}

/**
 * Fetch a single content item by ID.
 */
export async function getContentById(id: string): Promise<ContentItem> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/content/${encodeURIComponent(id)}`;

  console.log(`[api-client] GET ${url}`);

  const response = await fetchWithRetry(url);
  return (await response.json()) as ContentItem;
}

/**
 * Fetch aggregator settings (classification config, enrichment config).
 */
export async function getSettings(): Promise<AggregatorSettings> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/settings`;

  console.log(`[api-client] GET ${url}`);

  const response = await fetchWithRetry(url);
  return (await response.json()) as AggregatorSettings;
}
