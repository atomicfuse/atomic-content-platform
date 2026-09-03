# Bulk Image Generation API

**Date:** 2026-05-26
**Status:** Approved

## Problem

Articles are created with a default general image (`/assets/images/{site-slug}-general-article.webp`). The n8n image generation pipeline replaces these asynchronously, but failures, timeouts, or missing n8n configuration leave articles with the default image indefinitely.

Currently, regenerating images requires clicking through the dashboard one article at a time. There is no way to bulk-trigger image generation for all articles still using the default image.

## Solution

A new `POST /bulk-generate-images` endpoint on the content-pipeline service. It scans articles for general images, then fires `triggerN8nImage()` webhooks in batches of 3 with a 3-minute pause between batches. This prevents overloading n8n (each image takes ~46s to generate). The existing callback pipeline (n8n -> dashboard proxy -> content-pipeline -> R2 + Git) handles the rest unchanged.

A thin dashboard proxy forwards requests from `POST /api/agent/bulk-generate-images` to the content-pipeline.

## API Specification

### Endpoint

```
POST /bulk-generate-images
```

**Content-pipeline** (port 5000 locally, `http://content-pipeline-app` in CloudGrid).
**Dashboard proxy** at `POST /api/agent/bulk-generate-images`.

### Authentication

`X-API-Key` header validated against `BULK_IMAGE_API_KEY` environment variable. Returns 401 if missing or invalid.

### Request Body

```json
{
  "scope": "site",
  "domain": "travelswire",
  "dry_run": false
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `scope` | `"site"` \| `"all"` | Yes | `"site"` processes one site, `"all"` processes every active site in `dashboard-index.yaml`. |
| `domain` | `string` | When `scope="site"` | The site ID (folder name in `sites/`). Ignored when `scope="all"`. |
| `dry_run` | `boolean` | No (default `false`) | When `true`, returns the list of articles that would be queued without firing any webhooks. |

### Response (200)

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

| Field | Description |
|-------|-------------|
| `queued` | Number of articles that will have image generation triggered. |
| `skipped` | Number of articles skipped (missing title, unreadable frontmatter, etc.). |
| `skipped_reasons` | Array of `{ domain, slug, reason }` for each skipped article. |
| `batch_size` | Number of webhooks fired per batch (3). |
| `batch_pause_seconds` | Pause between batches in seconds (180 = 3 minutes). |
| `total_batches` | `ceil(queued / batch_size)`. |
| `estimated_total_seconds` | `(total_batches - 1) * batch_pause_seconds`. Time for all batches to be dispatched (excludes n8n processing time). |
| `articles` | Full list of articles queued (or that would be queued in dry_run mode). |

### Error Responses

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "scope is required" }` | Missing or invalid `scope`. |
| 400 | `{ "error": "domain is required when scope is site" }` | `scope="site"` without `domain`. |
| 401 | `{ "error": "Invalid or missing API key" }` | Bad or missing `X-API-Key` header. |
| 409 | `{ "error": "Bulk image generation already in progress", "queued_remaining": 23, "current_batch": 3, "total_batches": 10 }` | A previous bulk job is still processing batches. |
| 404 | `{ "error": "Site not found: badsite" }` | `domain` not in `dashboard-index.yaml`. |
| 503 | `{ "error": "N8N_IMAGE_WEBHOOK_URL not configured" }` | n8n webhook URL not set (non-dry-run only). Dry runs are allowed without n8n. |

## Internal Flow

### 1. Scan Phase (synchronous, within request)

1. Validate auth (`X-API-Key` vs `BULK_IMAGE_API_KEY`).
2. If not `dry_run`: check `N8N_IMAGE_WEBHOOK_URL` is configured, return 503 if missing. (Dry runs skip this check.)
3. Check concurrency guard. If a bulk job is already running, return 409.
4. Read `dashboard-index.yaml` from network repo (GitHub API, main branch).
5. Determine target sites:
   - `scope="site"`: single site matching `domain`.
   - `scope="all"`: all sites with `status: Live`, `status: Staging`, `status: Ready`, or `status: WordPress`.
6. For each target site, list article files from the staging branch (`staging/{domain}`), falling back to main. Record which branch each article was found on.
7. Read each article's frontmatter via GitHub API. Cache the full frontmatter + content in memory for reuse in the queue phase (avoids double-reading).
8. Filter to articles where `isGeneralImage(featuredImage, domain)` returns `true`. This matches both the `{domain}-general-article` pattern AND articles with no `featuredImage` at all (undefined/empty).
9. Skip articles missing a `title` (required for n8n prompt). Record in `skipped_reasons`.
10. Build the response payload.

**GitHub API rate limit note:** Each site requires 1 directory listing + N article reads (one per article to check frontmatter). For `scope="all"` across many sites this can consume significant API quota. The endpoint logs the total API calls made. For large networks (50+ sites), prefer `scope="site"` and iterate externally.

### 2. Queue Phase (background, after response)

If `dry_run` is `false` and `queued > 0`:

1. Set concurrency guard flag with remaining count = `queued`.
2. Start a background loop that processes the article queue **in batches of 3**:
   - Take the next batch (up to 3 articles) from the queue.
   - For each article in the batch:
     - Read site brief from Git (for `vertical` and `image_guidelines`). Article content is already cached from the scan phase.
     - Extract `description` and `summary` (first 500 chars of body) from cached content.
     - Call `triggerN8nImage()` with:
       - `request_id`: generated UUID
       - `callback_url`: `IMAGE_CALLBACK_URL` env var (same as existing `/trigger-image`)
       - `job_id`: empty string (no BullMQ job for bulk operations)
       - `site_domain`: the site's domain
       - `slug`: the article slug
       - `branch`: the branch where the article was found (`staging/{domain}` or `main`)
       - `article`: `{ title, description, summary, vertical, image_guidelines }`
     - Decrement the concurrency guard remaining counter.
   - Log: `"Batch {n}/{total}: fired {count} webhooks, {remaining} remaining"`.
   - If more articles remain, **wait 3 minutes** before the next batch.
3. On completion (queue empty) or unrecoverable error, clear the concurrency guard.
4. Log summary: `"Bulk image generation complete: {triggered} triggered, {failed} failed"`.

**Batching rationale:** Each n8n image generation takes ~46 seconds. Firing 3 at once keeps n8n busy without overloading it. The 3-minute pause ensures the previous batch has finished processing before the next one starts.

### 3. Callback Phase (existing, no changes)

The existing pipeline handles callbacks:

1. n8n generates image (~46s per image).
2. n8n POSTs callback to `POST /api/agent/image-callback` (dashboard proxy).
3. Dashboard proxy forwards to `POST /image-callback` (content-pipeline).
4. Content-pipeline: validate -> optimize -> upload to R2 -> update Git frontmatter.

No modifications to the callback flow. The `branch` field in the trigger payload ensures callbacks write to the correct branch.

## General Image Detection

An article uses the general image if:

1. Its `featuredImage` field is `undefined`, `null`, or empty string, **OR**
2. Its `featuredImage` contains `general-article` (catches both `{domain}-general-article` and any variant).

The dashboard already has `isGeneralImage()` in `src/lib/general-image-utils.ts` with this behavior. The content-pipeline needs its own copy since it cannot import from the dashboard.

## Concurrency Guard

An in-memory object tracking bulk job state:

```typescript
let bulkJob: {
  inProgress: boolean;
  remaining: number;
  currentBatch: number;
  totalBatches: number;
} = { inProgress: false, remaining: 0, currentBatch: 0, totalBatches: 0 };
```

- **Set** when a non-dry-run bulk job starts queuing.
- **Decremented** after each webhook trigger (success or failure) within a batch.
- **Cleared** when all batches complete or on unrecoverable error.
- **Not persisted** — a process restart clears it (acceptable; webhooks already fired are idempotent via the callback pipeline).
- **Known limitation:** Only one bulk job can run at a time, even across different sites. This is intentional for the initial implementation to keep n8n load predictable.

## Files Changed

| File | Change |
|------|--------|
| `services/content-pipeline/src/agents/content-generation/bulk-image.ts` | **New.** Scan logic, throttled queue runner, `isGeneralImage()`, concurrency guard. |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Add `POST /bulk-generate-images` route handler. |
| `services/content-pipeline/src/lib/config.ts` | Add `bulkImageApiKey` to `AgentConfig`, read from `BULK_IMAGE_API_KEY` env var. |
| `services/dashboard/src/app/api/agent/bulk-generate-images/route.ts` | **New.** Thin proxy to content-pipeline (same pattern as `/api/agent/generate-image`). Dashboard `/api/` routes bypass NextAuth — this is intentional since auth is handled by the API key on the content-pipeline side. |
| `services/dashboard/public/guide/bulk-image-api.md` | **New.** User-facing API documentation. |
| `services/dashboard/src/app/guide/page.tsx` | Register new guide page in `GUIDE_PAGES` array. |

## Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `BULK_IMAGE_API_KEY` | content-pipeline | Required for non-dry-run requests. Shared secret for authenticating bulk requests. Added to `AgentConfig` via `loadConfig()`. |
| `N8N_IMAGE_WEBHOOK_URL` | content-pipeline | Existing. Must be set for webhooks to fire. Returns 503 if missing on non-dry-run requests. |
| `IMAGE_CALLBACK_URL` | content-pipeline | Existing. Callback URL passed to each n8n trigger. Defaults to `https://sites-platform-e297--atomic.cloudgrid.io/api/agent/image-callback`. |

The dashboard proxy does not validate the API key itself — it forwards the `X-API-Key` header to the content-pipeline, which validates it.

## Usage Examples

### Dry run for a single site

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"scope": "site", "domain": "travelswire", "dry_run": true}'
```

### Generate images for a single site

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"scope": "site", "domain": "travelswire"}'
```

### Generate images for all sites

```bash
curl -X POST http://localhost:5000/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"scope": "all"}'
```

### Via dashboard proxy (production)

```bash
curl -X POST https://sites-platform-e297--atomic.cloudgrid.io/api/agent/bulk-generate-images \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-key" \
  -d '{"scope": "site", "domain": "wineoceans"}'
```

## Edge Cases

- **No articles with general images**: Returns 200 with `queued: 0`, empty `articles` array. No background job started.
- **n8n webhook URL not configured (non-dry-run)**: Returns 503 before scanning.
- **n8n webhook URL not configured (dry run)**: Proceeds normally — dry runs don't need n8n.
- **Site has no articles at all**: Returns 200 with `queued: 0`.
- **Article with no `featuredImage` field**: Treated as having a general image (included in the queue).
- **Individual webhook failure**: Logged and counted, remaining counter decremented, queue continues. The final log summary includes the failure count.
- **Process restart during queue processing**: Webhooks already sent continue through the callback pipeline. Remaining unqueued articles are lost — user can re-run the endpoint. The concurrency guard clears on restart.
- **Duplicate runs**: If the same article gets `triggerN8nImage()` called twice, n8n generates two images. The last callback to complete wins (overwrites in R2 and Git). Harmless but wasteful — the concurrency guard prevents this in normal usage.
- **GitHub API rate limits**: For `scope="all"` across many sites, the scan phase makes 1 + N API calls per site (directory listing + one read per article). Monitor via logged call counts. Prefer `scope="site"` for large networks.
