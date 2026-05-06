# Articles API

The site-worker exposes a public JSON API for retrieving the latest published article URLs across domains. This is useful for external integrations, widgets, and cross-site content syndication.

## Endpoint

```
GET /api/v1/articles/latest-by-domain
```

Hosted on the site-worker. In production this runs on any custom domain routed to the worker (e.g. `https://coolnews.dev/api/v1/articles/latest-by-domain`). On staging, use the workers.dev URL.

## Authentication

If the `API_SECRET` worker secret is configured, requests must include a Bearer token:

```
Authorization: Bearer <your-api-secret>
```

If `API_SECRET` is not set, the endpoint is open (useful for development/staging).

To set the secret:

```bash
wrangler secret put API_SECRET --config dist/server/wrangler.staging.json
wrangler secret put API_SECRET --config dist/server/wrangler.production.json
```

## Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `domains` | string (comma-separated) | Yes | Hostnames to fetch articles for, e.g. `coolnews.dev,financerooms.com` |
| `limit` | integer | No | Max articles per domain. Default: 10, Max: 50 |

**Note:** The `domains` parameter takes hostnames (e.g. `coolnews.dev`), not site IDs (e.g. `coolnews-atl`). The hostname must have a `site:<hostname>` entry in KV — this is created by `seed-kv` when you pass hostnames as arguments.

## Request Examples

**Single domain, default limit (10):**
```
GET /api/v1/articles/latest-by-domain?domains=coolnews.dev
```

**Multiple domains with custom limit:**
```
GET /api/v1/articles/latest-by-domain?domains=coolnews.dev,financerooms.com&limit=20
```

## Response Format

```json
{
  "coolnews.dev": {
    "domain": "coolnews.dev",
    "articles": [
      {
        "url": "https://coolnews.dev/best-thriller-movies-2026",
        "published_at": "2026-05-01T14:00:00.000Z"
      },
      {
        "url": "https://coolnews.dev/japan-overtourism-cherry-blossom",
        "published_at": "2026-04-30T10:00:00.000Z"
      }
    ]
  }
}
```

Articles are ordered by `published_at` descending (latest first). Ties are broken by slug ascending.

## Error Responses

| Status | Condition | Response |
|--------|-----------|----------|
| 400 | Missing/invalid `domains`, invalid `limit` | `{"error": {"code": "bad_request", "message": "..."}}` |
| 401 | Missing or invalid Bearer token (when API_SECRET is set) | `{"error": {"code": "unauthorized", "message": "Authentication required"}}` |
| 404 | No articles found for any requested domain | `{"error": {"code": "not_found", "message": "No articles found for requested domains"}}` |

## Caching

Successful responses include `s-maxage=60` with `stale-while-revalidate=300`, meaning Cloudflare's edge caches results for 1 minute and can serve stale for up to 5 minutes while revalidating. Error responses are not cached.

## How Hostname Mapping Works

The `domains` parameter maps to KV entries created by `seed-kv`:

1. `seed-kv coolnews-atl coolnews.dev` writes `site:coolnews.dev → { siteId: "coolnews-atl" }`
2. The API looks up `site:<hostname>` to find the siteId
3. Then fetches `article-index:<siteId>` for the article list

If a hostname has no KV entry, that domain is silently omitted from the response. If *all* domains are missing, the API returns 404.
