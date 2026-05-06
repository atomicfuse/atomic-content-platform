import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  siteLookupKey,
  articleIndexKey,
  type SiteLookup,
  type ArticleIndexEntry,
} from '../../../../lib/kv-schema';
import { isVisibleArticle } from '../../../../utils/article-status';

export const prerender = false;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Hostname validation: basic check for a plausible domain. */
function isValidHostname(h: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(h);
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
    },
  });
}

/**
 * GET /api/v1/articles/latest-by-domain
 *
 * Returns the latest N article URLs for each requested domain.
 *
 * Query params:
 *   domains  (required) — comma-separated list of hostnames
 *   limit    (optional) — max articles per domain, default 10, max 50
 *
 * Auth: Bearer token in Authorization header, checked against API_SECRET.
 */
export const GET: APIRoute = async ({ request }) => {
  // ---------- Auth ----------
  const apiSecret = (env as unknown as Record<string, unknown>).API_SECRET as string | undefined;
  if (apiSecret) {
    const auth = request.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || token !== apiSecret) {
      return jsonError(401, 'unauthorized', 'Authentication required');
    }
  }

  // ---------- Parse params ----------
  const url = new URL(request.url);
  const domainsParam = url.searchParams.get('domains');
  if (!domainsParam || !domainsParam.trim()) {
    return jsonError(400, 'bad_request', 'Missing required parameter: domains');
  }

  const domains = domainsParam
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  if (domains.length === 0) {
    return jsonError(400, 'bad_request', 'Missing required parameter: domains');
  }

  for (const d of domains) {
    if (!isValidHostname(d)) {
      return jsonError(400, 'bad_request', `Invalid domain: ${d}`);
    }
  }

  const limitParam = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit < 1) {
      return jsonError(400, 'bad_request', 'limit must be a positive integer');
    }
    if (limit > MAX_LIMIT) {
      return jsonError(400, 'bad_request', `limit must not exceed ${MAX_LIMIT}`);
    }
  }

  // ---------- Resolve domains → articles ----------
  const result: Record<
    string,
    { domain: string; articles: { url: string; published_at: string }[] }
  > = {};

  // Deduplicate domains
  const uniqueDomains = [...new Set(domains)];

  // Batch: resolve all hostname → siteId lookups in parallel
  const lookups = await Promise.all(
    uniqueDomains.map((d) => env.CONFIG_KV.get<SiteLookup>(siteLookupKey(d), 'json')),
  );

  // Build siteId → hostname(s) mapping + collect siteIds to fetch
  const siteIdToHostnames = new Map<string, string[]>();
  for (let i = 0; i < uniqueDomains.length; i++) {
    const lookup = lookups[i];
    if (!lookup) continue;
    const existing = siteIdToHostnames.get(lookup.siteId) ?? [];
    existing.push(uniqueDomains[i]!);
    siteIdToHostnames.set(lookup.siteId, existing);
  }

  // Fetch article indexes for all resolved siteIds in parallel
  const siteIds = [...siteIdToHostnames.keys()];
  const indexResults = await Promise.all(
    siteIds.map((sid) =>
      env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(sid), 'json'),
    ),
  );

  // For each siteId, sort articles and build response per hostname
  for (let i = 0; i < siteIds.length; i++) {
    const siteId = siteIds[i]!;
    const articles = indexResults[i] ?? [];
    const hostnames = siteIdToHostnames.get(siteId) ?? [];

    // Filter to visible + sort by publishDate desc, then slug asc for ties
    const sorted = articles
      .filter((a) => isVisibleArticle(a.status))
      .sort((a, b) => {
        const timeDiff =
          new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.slug.localeCompare(b.slug);
      })
      .slice(0, limit);

    for (const hostname of hostnames) {
      result[hostname] = {
        domain: hostname,
        articles: sorted.map((a) => ({
          url: `https://${hostname}/articles/${a.slug}`,
          published_at: a.publishDate,
        })),
      };
    }
  }

  // 404 if no articles found for any requested domain
  if (Object.keys(result).length === 0) {
    return jsonError(404, 'not_found', 'No articles found for requested domains');
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
