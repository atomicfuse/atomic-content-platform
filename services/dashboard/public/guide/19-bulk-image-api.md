# Bulk Image Generation API

Trigger AI image generation for all articles that still use the default site image. Works per-site or across all sites.

## How It Works

1. The API scans articles and identifies those using the default general image (`{site}-general-article.webp`) or with no image at all.
2. For each matching article, it triggers the n8n image generation pipeline.
3. Images are generated in **batches of 3** with a **3-minute pause** between batches to avoid overloading n8n.
4. The API returns immediately after scanning. Image generation happens in the background.
5. Generated images go through the standard pipeline: n8n generates → optimize → upload to R2 → update article in Git.

## Authentication

All requests require an `X-API-Key` header. The key must match the `BULK_IMAGE_API_KEY` environment variable on the content-pipeline service.

**To set or view the key:**

```bash
# Set the key (production)
cloudgrid secrets set atomic-content-platform BULK_IMAGE_API_KEY=your-secret-key-here

# For local dev, add to services/content-pipeline/.env
BULK_IMAGE_API_KEY=your-secret-key-here
```

Ask your admin for the current key value, or generate a new one with `openssl rand -hex 32`.

## Endpoints

### Content Pipeline (direct)

```
POST http://localhost:5000/bulk-generate-images
```

### Dashboard Proxy (production)

```
POST https://sites-platform-e297.atomic.cloudgrid.io/api/agent/bulk-generate-images
```

## Request

```json
{
  "scope": "site",
  "domain": "travelswire",
  "dry_run": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `"site"` or `"all"` | Yes | Process one site or all active sites |
| `domain` | string | When scope=site | Site ID (e.g. `travelswire`, `wineoceans`) |
| `dry_run` | boolean | No (default: false) | Preview which articles would be queued without triggering generation |

## Response

```json
{
  "dry_run": false,
  "scope": "site",
  "domain": "travelswire",
  "queued": 47,
  "skipped": 3,
  "skipped_reasons": [
    { "domain": "travelswire", "slug": "broken-article", "reason": "missing title" }
  ],
  "batch_size": 3,
  "batch_pause_seconds": 180,
  "total_batches": 16,
  "estimated_total_seconds": 2700,
  "articles": [
    { "domain": "travelswire", "slug": "best-travel-gear-2026", "title": "Best Travel Gear 2026" }
  ]
}
```

## Examples

### Dry run (preview)

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"scope": "site", "domain": "travelswire", "dry_run": true}'
```

### Generate for one site

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"scope": "site", "domain": "travelswire"}'
```

### Generate for all sites

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{"scope": "all"}'
```

## Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Missing or invalid request fields |
| 401 | Invalid or missing API key |
| 404 | Site not found |
| 409 | Another bulk job is already running |
| 503 | n8n webhook URL not configured (non-dry-run only) |

## Notes

- Only one bulk job can run at a time. If a job is running, you'll get a 409 with progress info.
- Dry runs work even when n8n is not configured — useful for previewing scope.
- Each image takes ~46 seconds for n8n to generate. A batch of 3 articles queues in seconds, then the API waits 3 minutes before the next batch.
- The existing n8n callback pipeline handles everything after the webhook fires — no changes needed.
