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
  const raw =
    process.env.CONTENT_API_BASE_URL ??
    process.env.CONTENT_AGGREGATOR_URL ??
    DEFAULT_BASE_URL;
  // Strip trailing /api or /api/ — CONTENT_API_BASE_URL often includes it,
  // but all callers already prepend /api/ in their paths.
  return raw.replace(/\/api\/?$/, "");
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
  /** 1-based page number for pagination. Defaults to 1. */
  page?: number;
  enriched?: boolean;
  status?: string;
  content_type?: string;
  language?: string;
  /** Content Aggregator vertical ID for filtering. */
  vertical_id?: string;
  /** Content Aggregator category IDs for filtering (OR logic). */
  category_ids?: string[];
  /** Content Aggregator tag IDs for filtering (OR logic). */
  tag_ids?: string[];
  /** Content Aggregator audience type ID for filtering. */
  audience_type_id?: string;
}

/**
 * Fetch enriched content items from the Content Aggregator v2 API.
 * Returns the full response including pagination metadata so callers
 * can paginate through results.
 */
export async function getContent(params: GetContentParams): Promise<ContentApiResponse> {
  const baseUrl = getBaseUrl();
  const url = new URL("/api/content", baseUrl);

  url.searchParams.set("enriched", String(params.enriched ?? true));
  url.searchParams.set("status", params.status ?? "active");
  url.searchParams.set("content_type", params.content_type ?? "article");
  url.searchParams.set("page_size", String(params.limit));
  url.searchParams.set("page", String(params.page ?? 1));

  if (params.language) {
    url.searchParams.set("language", params.language);
  }
  if (params.vertical_id) {
    url.searchParams.set("vertical_id", params.vertical_id);
  }
  if (params.category_ids && params.category_ids.length > 0) {
    url.searchParams.set("category_ids", params.category_ids.join(","));
  }
  if (params.tag_ids && params.tag_ids.length > 0) {
    url.searchParams.set("tag_ids", params.tag_ids.join(","));
  }
  if (params.audience_type_id) {
    url.searchParams.set("audience_type_id", params.audience_type_id);
  }

  console.log(`[api-client] GET ${url.toString()}`);

  const response = await fetchWithRetry(url.toString());
  const body = (await response.json()) as ContentApiResponse;

  body.items = body.items ?? [];
  console.log(
    `[api-client] Received ${body.items.length} items ` +
    `(page ${body.page ?? 1}/${body.total_pages ?? 1}, total: ${body.total_count ?? 0})`,
  );
  return body;
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

// ---------------------------------------------------------------------------
// Taxonomy resolution — search/create tags on the aggregator
// ---------------------------------------------------------------------------

interface TagItem {
  id: string;
  name: string;
  vertical_id?: string;
}

interface TagListResponse {
  items: TagItem[];
  total_count: number;
}

/**
 * Search for a tag by name within a vertical.
 * Returns the first exact match (case-insensitive) or undefined.
 */
async function findTag(name: string, verticalId?: string): Promise<TagItem | undefined> {
  const baseUrl = getBaseUrl();
  const url = new URL("/api/tags", baseUrl);
  url.searchParams.set("search", name.trim());
  url.searchParams.set("page_size", "20");
  if (verticalId) url.searchParams.set("vertical_id", verticalId);

  const response = await fetchWithRetry(url.toString());
  const body = (await response.json()) as TagListResponse;

  const normalizedName = name.trim().toLowerCase();
  return body.items.find((t) => t.name.toLowerCase() === normalizedName);
}

/**
 * Create a tag on the aggregator. Returns the created tag.
 * Handles 409 (duplicate) by fetching the existing tag.
 */
async function createTag(name: string, verticalId?: string): Promise<TagItem> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/api/tags`;
  const payload: Record<string, string> = { name: name.trim() };
  if (verticalId) payload.vertical_id = verticalId;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 201 || response.status === 200) {
    return (await response.json()) as TagItem;
  }

  if (response.status === 409) {
    // Duplicate — find the existing one
    const existing = await findTag(name, verticalId);
    if (existing) return existing;
    throw new Error(`Tag "${name}" reported as duplicate but could not be found`);
  }

  throw new Error(`Failed to create tag "${name}": ${response.status} ${response.statusText}`);
}

/**
 * Resolve topic names to aggregator tag IDs.
 * Searches for each topic; creates it if not found.
 * Returns an array of tag IDs.
 */
export async function resolveTopicTagIds(
  topics: string[],
  verticalId?: string,
): Promise<string[]> {
  const ids: string[] = [];

  for (const topic of topics) {
    try {
      let tag = await findTag(topic, verticalId);
      if (!tag) {
        console.log(`[api-client] Tag "${topic}" not found — creating`);
        tag = await createTag(topic, verticalId);
        console.log(`[api-client] Created tag "${topic}" → ${tag.id}`);
      }
      ids.push(tag.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[api-client] Failed to resolve tag "${topic}": ${msg}`);
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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
