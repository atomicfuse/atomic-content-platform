import { getKvNamespaces } from "@/lib/constants";
import { getCredentials } from "@/lib/cloudflare";
import type { ArticleEntry } from "@/types/dashboard";

/**
 * Minimal article metadata stored in KV at `article-index:<siteId>`.
 * Mirrors `ArticleIndexEntry` from `packages/site-worker/src/lib/kv-schema.ts`.
 */
export interface KVArticleIndexEntry {
  slug: string;
  title: string;
  description?: string;
  author: string;
  publishDate: string;
  featuredImage?: string;
  tags: string[];
  type: "listicle" | "how-to" | "review" | "standard";
  status: "draft" | "review" | "published";
  featured?: ("hero" | "must-read")[];
}

// ---------------------------------------------------------------------------
// In-memory cache for KV article index — avoids ~700ms CF REST API call on
// every page load. Keyed by "domain@namespace". Cleared by
// invalidateSiteCaches() in github.ts via invalidateKVArticleCache().
// ---------------------------------------------------------------------------
const KV_CACHE_TTL = Infinity;
const kvArticleCache = new Map<string, { data: ArticleEntry[]; expiresAt: number }>();

export function invalidateKVArticleCache(domain: string): void {
  for (const key of kvArticleCache.keys()) {
    if (key.startsWith(`${domain}@`)) kvArticleCache.delete(key);
  }
}

/**
 * Read the `article-index:<domain>` key from Cloudflare KV via REST API.
 *
 * Uses `getCredentials(domain)` and `getKvNamespaces(domain)` so Dev1
 * legacy sites are automatically routed to the correct account + namespace.
 *
 * Returns `null` if credentials are missing, the key doesn't exist, or
 * the request fails — callers should treat `null` as "skip this site".
 */
export async function readArticleIndexFromKV(
  domain: string,
  namespace: "staging" | "production" = "staging",
): Promise<KVArticleIndexEntry[] | null> {
  let accountId: string;
  let token: string;
  try {
    const creds = getCredentials(domain);
    accountId = creds.accountId;
    token = creds.token;
  } catch {
    console.warn(
      `[kv-api] No credentials for domain "${domain}" — skipping KV read`,
    );
    return null;
  }

  const ns = getKvNamespaces(domain);
  const namespaceId = namespace === "production" ? ns.prod : ns.staging;
  const key = `article-index:${domain}`;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as KVArticleIndexEntry[];
  } catch {
    return null;
  }
}

/**
 * Convert KV article-index entries to the dashboard's ArticleEntry format.
 *
 * KV has all metadata the list views need (slug, title, status, type, date,
 * featuredImage). Score fields (score, scoreBreakdown, qualityNote,
 * reviewerNotes) are NOT in KV — they're only in article frontmatter.
 * The article detail page still reads from Git to get those.
 */
export function kvEntriesToArticles(entries: KVArticleIndexEntry[]): ArticleEntry[] {
  return entries.map((e) => ({
    slug: e.slug,
    title: e.title,
    type: e.type ?? "standard",
    status: e.status ?? "draft",
    publishDate: e.publishDate ?? "",
    featuredImage: e.featuredImage,
    score: undefined,
    scoreBreakdown: undefined,
    qualityNote: undefined,
    reviewerNotes: undefined,
  }));
}

/**
 * Read articles for a site: in-memory cache first, then KV (1 REST call),
 * then Git fallback (N+1 calls).
 *
 * The in-memory cache (15min TTL) eliminates the ~700ms CF REST API latency
 * on repeat visits. Cleared by invalidateSiteCaches() after mutations.
 */
export async function readArticlesWithKVFallback(
  domain: string,
  branch?: string,
  readArticlesGit?: (domain: string, branch?: string) => Promise<ArticleEntry[]>,
): Promise<ArticleEntry[]> {
  const cacheKey = `${domain}@staging`;
  const cached = kvArticleCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const kvEntries = await readArticleIndexFromKV(domain, "staging");
  if (kvEntries) {
    const articles = kvEntriesToArticles(kvEntries);
    kvArticleCache.set(cacheKey, { data: articles, expiresAt: Date.now() + KV_CACHE_TTL });
    return articles;
  }

  // KV unavailable — fall back to Git (expensive)
  if (readArticlesGit) {
    console.warn(`[kv-api] KV miss for "${domain}" — falling back to Git`);
    return readArticlesGit(domain, branch);
  }
  return [];
}
