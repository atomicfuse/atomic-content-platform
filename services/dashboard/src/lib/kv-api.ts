import { getKvNamespaces } from "@/lib/constants";
import { getCredentials } from "@/lib/cloudflare";

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
