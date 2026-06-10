/**
 * Cloudflare KV REST API reader for content-pipeline.
 *
 * Mirrors the getKVEntry pattern from services/dashboard/src/lib/cloudflare.ts,
 * adapted for content-pipeline's dual-account credential resolution.
 * Uses the same REST endpoint but returns unknown (JSON-parsed when possible)
 * rather than a raw string, since pipeline consumers expect structured data.
 *
 * Includes a 60-second TTL in-memory cache to avoid redundant HTTPS calls
 * when the ops dashboard polls /site-checks at high frequency.
 */

import { getAccountId, isDev1Domain } from "./cloudflare-accounts.js";

// ---------------------------------------------------------------------------
// TTL cache — module-level, survives across requests within the same process.
// Caches both successful results and null (404) results so missing keys
// don't cause repeated network calls.
// ---------------------------------------------------------------------------

const KV_CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
  value: unknown | null;
  expiresAt: number;
}

const kvCache = new Map<string, CacheEntry>();

function cacheKey(namespaceId: string, key: string): string {
  return `${namespaceId}:${key}`;
}

function getCached(namespaceId: string, key: string): { hit: true; value: unknown | null } | { hit: false } {
  const k = cacheKey(namespaceId, key);
  const entry = kvCache.get(k);
  if (entry && Date.now() < entry.expiresAt) {
    return { hit: true, value: entry.value };
  }
  // Expired or missing — evict stale entry if present.
  if (entry) kvCache.delete(k);
  return { hit: false };
}

function setCache(namespaceId: string, key: string, value: unknown | null): void {
  kvCache.set(cacheKey(namespaceId, key), {
    value,
    expiresAt: Date.now() + KV_CACHE_TTL_MS,
  });
}

/** Clear the entire KV cache. Exposed for tests. */
export function clearKVCache(): void {
  kvCache.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface KvCreds {
  accountId: string;
  token: string;
}

export function credentialsFor(domain: string): KvCreds {
  const token = isDev1Domain(domain)
    ? (process.env["DEV1_CLOUDFLARE_API_TOKEN"] ?? process.env["CLOUDFLARE_API_TOKEN"] ?? "")
    : (process.env["CLOUDFLARE_API_TOKEN"] ?? "");
  return { accountId: getAccountId(domain), token };
}

export async function getKVEntry(
  namespaceId: string,
  key: string,
  creds: KvCreds,
): Promise<unknown | null> {
  const cached = getCached(namespaceId, key);
  if (cached.hit) return cached.value;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { headers: { Authorization: `Bearer ${creds.token}` }, signal: AbortSignal.timeout(5_000) },
  );
  if (res.status === 404) {
    setCache(namespaceId, key, null);
    return null;
  }
  if (!res.ok) throw new Error(`KV read ${key}: ${res.status}`);
  const text = await res.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  setCache(namespaceId, key, value);
  return value;
}
