# Content Aggregator v2 -- API Reference

Base URL: `https://<your-domain>` (Cloud Grid deployment) or `http://localhost:3000` (local dev)

## Authentication

No authentication is currently required. All endpoints are open.

## Error Format

All errors follow a consistent structure:

```json
{
  "error": {
    "code": "validation_error",
    "message": "name is required"
  }
}
```

Common error codes:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `validation_error` | 400 | Invalid input or failed validation |
| `not_found` | 404 | Resource does not exist |
| `duplicate` | 409 | Resource with that name already exists |
| `internal_error` | 500 | Server error |

## Pagination

All list endpoints support pagination with these query parameters:

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `page` | `1` | -- | Page number (1-indexed) |
| `page_size` | `20` | `100` | Items per page |

Paginated responses include:

```json
{
  "total_count": 150,
  "page": 1,
  "page_size": 20,
  "total_pages": 8,
  "items": [...]
}
```

---

## Endpoint Summary

### Content

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/content` | Query content items with filters, pagination, search |
| GET | `/api/content/:id` | Get a single content item |
| PATCH | `/api/content` | Update content items (status, taxonomy overrides) |
| DELETE | `/api/content/:id` | Permanently delete a content item |
| DELETE | `/api/content/bulk` | Bulk permanent delete |
| POST | `/api/content/enrich` | Trigger the AI enrichment pipeline |
| POST | `/api/content/lifecycle` | Run lifecycle jobs (archive, purge) |

### Sources

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sources` | List sources with content counts |
| POST | `/api/sources` | Create a new source |
| PUT | `/api/sources/:id` | Update a source |
| DELETE | `/api/sources/:id` | Deactivate a source (soft delete) |
| DELETE | `/api/sources/:id/content` | Delete all content from a source (keeps source) |
| POST | `/api/sources/fetch` | Trigger content collection |

### Taxonomy

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/verticals` | List verticals |
| POST | `/api/verticals` | Create a vertical |
| PUT | `/api/verticals/:id` | Update a vertical |
| DELETE | `/api/verticals/:id` | Soft-delete a vertical |
| GET | `/api/categories` | List categories |
| POST | `/api/categories` | Create a category |
| PUT | `/api/categories/:id` | Update a category |
| DELETE | `/api/categories/:id` | Soft-delete a category |
| GET | `/api/tags` | List tags |
| POST | `/api/tags` | Create a tag |
| PUT | `/api/tags/:id` | Update a tag |
| DELETE | `/api/tags/:id` | Hard delete a tag |
| GET | `/api/audiences` | List audience types |
| POST | `/api/audiences` | Create an audience type |
| PUT | `/api/audiences/:id` | Update an audience type |
| DELETE | `/api/audiences/:id` | Soft-delete an audience type |

### Taxonomy Suggestions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/taxonomy/suggestions` | List AI-proposed taxonomy items |
| POST | `/api/taxonomy/suggestions/:id/approve` | Approve or reject a suggestion |

### System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get system settings |
| PUT | `/api/settings` | Update system settings (deep merge) |
| GET | `/api/stats` | System metrics and enrichment cost |
| GET | `/health` | Health check |

---

## Content

### GET /api/content

Query content items with filters, pagination, and text search. Returns consumer-clean responses (no internal fields).

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `20` | Items per page (max 100) |
| `status` | string | `active` | Filter by status: `active`, `inactive`, `archived` |
| `content_type` | string | -- | Comma-separated: `article`, `video`, `social_post`, `discussion`, `trend` |
| `vertical_id` | string | -- | Filter by vertical ID |
| `category_id` | string | -- | Filter by category ID |
| `tag_id` | string | -- | Filter by tag ID |
| `audience_type_id` | string | -- | Filter by audience type ID |
| `source_id` | string | -- | Filter by source ID |
| `enriched` | string | `true` | `true` (default — only enriched items) or `false` (all items including unenriched). "Golden plate" philosophy: consumers get ready-to-use content by default. |
| `language` | string | -- | ISO language code (auto-uppercased) |
| `search` | string | -- | Text search across title, description, url, and exact content ID |

**Response** `200 OK`

```json
{
  "query": {
    "status": "active"
  },
  "total_count": 42,
  "total_returned": 20,
  "page": 1,
  "page_size": 20,
  "total_pages": 3,
  "items": [
    {
      "id": "6651a...",
      "url": "https://example.com/article",
      "title": "Article Title",
      "description": "A short description",
      "author": "Jane Doe",
      "thumbnail": {
        "type": "image",
        "url": "https://example.com/thumb.jpg"
      },
      "published_at": "2026-04-10T12:00:00.000Z",
      "created_at": "2026-04-10T12:05:00.000Z",
      "expires_at": "2026-04-17T12:00:00.000Z",
      "content_type": "article",
      "language": "EN",
      "status": "active",
      "summary": "What happened: ... Why it matters: ... Content opportunity: ...",
      "enriched": true,
      "source": {
        "id": "6650b...",
        "name": "TechCrunch",
        "type": "rss"
      },
      "vertical": {
        "id": "6650a...",
        "name": "Technology"
      },
      "categories": [
        { "id": "6650c...", "name": "Artificial Intelligence", "iab_code": "IAB19-40" }
      ],
      "tags": [
        { "id": "6650d...", "name": "machine learning" }
      ],
      "audience_types": [
        { "id": "6650e...", "name": "Tech professionals", "group": "profession" }
      ]
    }
  ]
}
```

**curl example**

```bash
curl "http://localhost:3000/api/content?status=active&content_type=article,video&enriched=true&page_size=10"
```

---

### GET /api/content/:id

Get a single content item by ID.

**Response** `200 OK`

Returns a single `ContentItemResponse` object (same shape as items in the list response above).

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | ID does not exist |

---

### PATCH /api/content

Update content items. Supports single-item updates and bulk status changes.

**Single item update**

```json
{
  "id": "6651a...",
  "status": "inactive",
  "vertical_id": "6650a...",
  "category_ids": ["6650c..."],
  "tag_ids": ["6650d..."],
  "audience_type_ids": ["6650e..."],
  "expires_at": "2026-05-01T00:00:00.000Z"
}
```

All fields except `id` are optional. Setting `vertical_id` or `category_ids` also sets `classification_source` to `user_override` internally.

**Response** `200 OK`

```json
{
  "success": true,
  "id": "6651a...",
  "status": "inactive"
}
```

**Bulk status update**

```json
{
  "ids": ["6651a...", "6651b..."],
  "status": "archived"
}
```

**Status transitions**: `active` -> `inactive` -> `archived`, `active` -> `archived`, `inactive` -> `active`, `archived` -> `active`. Invalid transitions return a 400 error.

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Invalid status or transition |
| 404 | `not_found` | Content item not found |

---

### DELETE /api/content/:id

Permanently delete a content item.

**Response** `200 OK`

```json
{ "success": true }
```

---

### DELETE /api/content/bulk

Bulk permanent delete.

**Request Body**

```json
{
  "ids": ["6651a...", "6651b...", "6651c..."]
}
```

**Response** `200 OK`

```json
{
  "success": true,
  "deleted_count": 3
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | `ids` array missing or empty |

---

### POST /api/content/enrich

Trigger the AI enrichment pipeline. Processes unenriched content items: generates content briefs, classifies with IAB taxonomy, and estimates expiration.

**Request Body** (optional)

```json
{
  "batch_size": 10
}
```

If omitted, uses the system default batch size (configured in settings).

**Response** `200 OK`

Returns an enrichment summary with counts of processed, succeeded, and failed items.

**curl example**

```bash
curl -X POST http://localhost:3000/api/content/enrich \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 5}'
```

---

### POST /api/content/lifecycle

Run content lifecycle jobs: auto-archive expired content, archive retention-exceeded content, and purge old archived content.

Designed to be called by cron. No request body required.

**Response** `200 OK`

Returns a summary of lifecycle actions taken (archived count, purged count).

---

## Sources

### GET /api/sources

List sources with pagination and content counts.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `25` | Items per page (max 100) |
| `type` | string | -- | Filter by source type: `rss`, `youtube`, `reddit`, `social`, `google_trends` |
| `active` | string | -- | `true` or `false` |

**Response** `200 OK`

```json
{
  "total_count": 5,
  "page": 1,
  "page_size": 25,
  "total_pages": 1,
  "content_counts": {
    "6650b...": 42,
    "6650f...": 18
  },
  "items": [
    {
      "id": "6650b...",
      "name": "TechCrunch",
      "type": "rss",
      "active": true,
      "fetch_failures": 0,
      "last_error": null,
      "created_at": "2026-04-01T10:00:00.000Z",
      "last_fetched_at": "2026-04-15T08:00:00.000Z",
      "config": {
        "feed_url": "https://techcrunch.com/feed/"
      },
      "settings": {
        "schedule": { "cron": "0 */1 * * *", "description": "Every hour" },
        "max_items": 50,
        "filters": {
          "require_image": false,
          "require_description": false,
          "keywords": [],
          "exclude_keywords": [],
          "language": null
        },
        "default_expiration_days": null,
        "retention_days": null
      },
      "vertical_id": "6650a...",
      "category_ids": [],
      "audience_type_ids": [],
      "enrichment": {
        "auto_summarize": true,
        "auto_classify": true,
        "auto_tag": true,
        "summary_language": null
      }
    }
  ]
}
```

The `content_counts` object maps source IDs to the number of content items from each source.

---

### POST /api/sources

Create a new source.

**Request Body**

```json
{
  "name": "TechCrunch",
  "type": "rss",
  "config": {
    "feed_url": "https://techcrunch.com/feed/"
  },
  "settings": {
    "schedule": { "cron": "0 */2 * * *", "description": "Every 2 hours" },
    "max_items": 30,
    "filters": {
      "require_image": true,
      "keywords": ["AI", "startup"]
    },
    "default_expiration_days": 14
  },
  "vertical_id": "6650a...",
  "category_ids": ["6650c..."],
  "audience_type_ids": ["6650e..."],
  "enrichment": {
    "auto_summarize": true,
    "auto_classify": true,
    "auto_tag": true,
    "summary_language": "EN"
  }
}
```

**Required fields**: `name`, `type`, `config`

**Type-specific config requirements**:

| Source Type | Required Config Fields |
|------------|----------------------|
| `rss` | `feed_url` |
| `youtube` | `channel_handle` or `channel_id` |
| `reddit` | `subreddit` |
| `social` | `handle` and `platform` |
| `google_trends` | `region` |

**Response** `201 Created`

```json
{
  "id": "6650b...",
  "name": "TechCrunch",
  "type": "rss",
  "active": true,
  "config": { "feed_url": "https://techcrunch.com/feed/" },
  "settings": { "..." },
  "enrichment": { "..." },
  "created_at": "2026-04-15T10:00:00.000Z"
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Missing required fields or invalid type/config |

**curl example**

```bash
curl -X POST http://localhost:3000/api/sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "TechCrunch",
    "type": "rss",
    "config": { "feed_url": "https://techcrunch.com/feed/" }
  }'
```

---

### PUT /api/sources/:id

Update a source. Supports partial updates with deep merge for `settings` and `enrichment`.

**Request Body** (all fields optional)

```json
{
  "name": "TechCrunch (Updated)",
  "active": true,
  "vertical_id": "6650a...",
  "category_ids": ["6650c..."],
  "audience_type_ids": [],
  "settings": {
    "schedule": { "cron": "0 */4 * * *", "description": "Every 4 hours" },
    "max_items": 25
  },
  "enrichment": {
    "auto_tag": false
  }
}
```

**Response** `200 OK`

Returns the full updated source object.

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Source not found |

---

### DELETE /api/sources/:id

Deactivate a source (sets `active: false`). Does not delete.

**Response** `200 OK`

```json
{ "success": true, "name": "TechCrunch" }
```

---

### DELETE /api/sources/:id/content

Delete all content items from a source while keeping the source itself.

**Response** `200 OK`

```json
{
  "success": true,
  "source_id": "6650b...",
  "source_name": "TechCrunch",
  "deleted_count": 42
}
```

**Errors**

| Status | Code | Description |
|--------|------|-------------|
| 404 | not_found | Source not found |

---

### POST /api/sources/fetch

Trigger content collection from sources.

**Request Body Variants**

Fetch a single source:
```json
{ "source_id": "6650b..." }
```

Fetch multiple sources:
```json
{ "source_ids": ["6650b...", "6650f..."] }
```

Fetch all active sources (empty body or no body):
```json
{}
```

**Response** `200 OK`

Returns a fetch summary with per-source results (items found, new items ingested, duplicates skipped).

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Source ID not found (single source mode) |

**curl example**

```bash
# Fetch all active sources
curl -X POST http://localhost:3000/api/sources/fetch

# Fetch a specific source
curl -X POST http://localhost:3000/api/sources/fetch \
  -H "Content-Type: application/json" \
  -d '{"source_id": "6650b..."}'
```

---

## Verticals

### GET /api/verticals

List verticals.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `20` | Items per page (max 100) |
| `active` | string | -- | `true` or `false` |

**Response** `200 OK`

```json
{
  "total_count": 9,
  "page": 1,
  "page_size": 20,
  "total_pages": 1,
  "items": [
    {
      "id": "6650a...",
      "name": "Technology",
      "description": "Tech, software, hardware, AI, gadgets",
      "is_system": true,
      "active": true,
      "created_at": "2026-04-01T00:00:00.000Z"
    }
  ]
}
```

---

### POST /api/verticals

Create a vertical.

**Request Body**

```json
{
  "name": "Finance",
  "description": "Markets, investing, personal finance"
}
```

**Required**: `name`

**Response** `201 Created`

```json
{
  "id": "665aa...",
  "name": "Finance",
  "description": "Markets, investing, personal finance",
  "is_system": false,
  "active": true,
  "created_at": "2026-04-15T10:00:00.000Z"
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Missing name |
| 409 | `duplicate` | Name already exists |

---

### PUT /api/verticals/:id

Update a vertical. All fields optional.

```json
{
  "name": "Finance & Business",
  "description": "Updated description",
  "active": true
}
```

**Response** `200 OK` -- returns the full updated vertical object.

---

### DELETE /api/verticals/:id

Soft-delete a vertical (sets `active: false`).

**Response** `200 OK`

```json
{ "success": true }
```

---

## Categories

### GET /api/categories

List categories. Seeded with ~130 IAB categories.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `20` | Items per page (max 100) |
| `vertical_id` | string | -- | Filter by parent vertical |
| `active` | string | -- | `true` or `false` |

**Response** `200 OK`

```json
{
  "total_count": 20,
  "page": 1,
  "page_size": 20,
  "total_pages": 1,
  "items": [
    {
      "id": "6650c...",
      "name": "Artificial Intelligence",
      "iab_code": "IAB19-40",
      "vertical_id": "6650a...",
      "description": "",
      "is_system": true,
      "active": true,
      "created_at": "2026-04-01T00:00:00.000Z"
    }
  ]
}
```

---

### POST /api/categories

Create a category.

**Request Body**

```json
{
  "name": "Quantum Computing",
  "vertical_id": "6650a...",
  "iab_code": "IAB19-50",
  "description": "Quantum hardware and algorithms"
}
```

**Required**: `name`, `vertical_id`

**Response** `201 Created` -- returns the created category object.

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Missing name or vertical_id |
| 404 | `not_found` | Vertical does not exist |
| 409 | `duplicate` | Category name already exists |

---

### PUT /api/categories/:id

Update a category. All fields optional: `name`, `iab_code`, `vertical_id`, `description`, `active`.

**Response** `200 OK` -- returns the full updated category object.

---

### DELETE /api/categories/:id

Soft-delete a category (sets `active: false`).

**Response** `200 OK`

```json
{ "success": true }
```

---

## Tags

### GET /api/tags

List tags.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `20` | Items per page (max 100) |
| `vertical_id` | string | -- | Filter by vertical |
| `search` | string | -- | Search tag names (case-insensitive) |
| `include_usage` | string | -- | Set to `true` to include `usage_count` |

**Response** `200 OK`

```json
{
  "total_count": 85,
  "page": 1,
  "page_size": 20,
  "total_pages": 5,
  "items": [
    {
      "id": "6650d...",
      "name": "machine learning",
      "vertical_id": "6650a..."
    }
  ]
}
```

With `include_usage=true`, each item also includes `"usage_count": 12`.

---

### POST /api/tags

Create a tag. Names are auto-lowercased and trimmed.

**Request Body**

```json
{
  "name": "Machine Learning",
  "vertical_id": "6650a..."
}
```

**Required**: `name`

**Response** `201 Created`

```json
{
  "id": "6650d...",
  "name": "machine learning",
  "vertical_id": "6650a..."
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Missing name |
| 409 | `duplicate` | Tag already exists (after normalization) |

---

### PUT /api/tags/:id

Update a tag. Fields: `name`, `vertical_id`.

**Response** `200 OK` -- returns the updated tag object.

---

### DELETE /api/tags/:id

Hard delete a tag (permanently removed).

**Response** `200 OK`

```json
{ "success": true }
```

---

## Audience Types

### GET /api/audiences

List audience types. Seeded with 80+ entries across 10 groups.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `20` | Items per page (max 100) |
| `group` | string | -- | Filter by group (see valid groups below) |
| `active` | string | -- | `true` or `false` |

**Valid groups**: `age`, `generation`, `life_stage`, `profession`, `education`, `family`, `income`, `lifestyle`, `digital`, `interests`

**Response** `200 OK`

```json
{
  "total_count": 82,
  "page": 1,
  "page_size": 20,
  "total_pages": 5,
  "items": [
    {
      "id": "6650e...",
      "name": "Tech professionals",
      "group": "profession",
      "description": "Software engineers, IT specialists",
      "is_system": true,
      "active": true,
      "created_at": "2026-04-01T00:00:00.000Z"
    }
  ]
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Invalid group value |

---

### POST /api/audiences

Create an audience type.

**Request Body**

```json
{
  "name": "Content Creators",
  "group": "profession",
  "description": "YouTubers, bloggers, podcasters"
}
```

**Required**: `name`, `group`

**Response** `201 Created` -- returns the created audience type object.

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Missing name/group or invalid group |
| 409 | `duplicate` | Name already exists |

---

### PUT /api/audiences/:id

Update an audience type. Fields: `name`, `group`, `description`, `active`.

**Response** `200 OK` -- returns the full updated audience type object.

---

### DELETE /api/audiences/:id

Soft-delete an audience type (sets `active: false`).

**Response** `200 OK`

```json
{ "success": true }
```

---

## Taxonomy Suggestions

### GET /api/taxonomy/suggestions

List AI-proposed taxonomy items awaiting human review.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `20` | Items per page (max 100) |
| `status` | string | `pending` | Filter: `pending`, `approved`, `rejected` |
| `type` | string | -- | Filter: `vertical`, `category`, `audience_type`, `tag` |

**Response** `200 OK`

```json
{
  "total_count": 3,
  "page": 1,
  "page_size": 20,
  "total_pages": 1,
  "items": [
    {
      "id": "665bb...",
      "type": "category",
      "suggested_name": "Autonomous Vehicles",
      "source_content_id": "6651a...",
      "confidence": 0.45,
      "status": "pending",
      "resolved_taxonomy_id": null,
      "created_at": "2026-04-14T15:00:00.000Z",
      "resolved_at": null
    }
  ]
}
```

---

### POST /api/taxonomy/suggestions/:id/approve

Approve or reject a taxonomy suggestion. Approving creates the taxonomy item automatically.

**Request Body**

Approve (default):
```json
{}
```

Reject:
```json
{ "action": "reject" }
```

For category suggestions, `vertical_id` is required:
```json
{ "vertical_id": "6650a..." }
```

For audience_type suggestions, `group` is required:
```json
{ "group": "profession" }
```

For tag suggestions, `vertical_id` is optional:
```json
{ "vertical_id": "6650a..." }
```

**Response** `200 OK`

```json
{
  "success": true,
  "status": "approved",
  "created_id": "665cc..."
}
```

Or for rejection:

```json
{
  "success": true,
  "status": "rejected"
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Already resolved, or missing required fields for approval |
| 404 | `not_found` | Suggestion not found |

---

## System Settings

### GET /api/settings

Get the full system settings object. Auto-initializes with defaults on first call.

**Response** `200 OK`

```json
{
  "_id": "...",
  "key": "global",
  "prompts": {
    "summarize": {
      "text_factual": { "system": "...", "user": "..." },
      "text_general": { "system": "...", "user": "..." },
      "video_transcript": { "system": "...", "user": "..." },
      "video_metadata": { "system": "...", "user": "..." },
      "short_form": { "system": "...", "user": "..." }
    },
    "classify": { "system": "...", "user": "..." }
  },
  "classification": {
    "confidence_threshold": 0.6,
    "default_auto_classify": true,
    "factual_tags": ["news", "announcement", "breaking"]
  },
  "deduplication": {
    "title_similarity_threshold": 0.85,
    "dedup_window_hours": 48,
    "min_words_for_fuzzy": 5
  },
  "enrichment": {
    "batch_size": 20,
    "concurrency": 3,
    "max_attempts": 3,
    "content_fetch_timeout_ms": 10000,
    "max_content_length": 8000,
    "max_transcript_length": 12000
  },
  "fetching": {
    "max_fetch_failures": 5,
    "concurrency": 5
  },
  "lifecycle": {
    "default_retention_days": 90,
    "default_expiration_days": 7,
    "archive_purge_days": 30,
    "archive_check_interval": "0 2 * * *"
  },
  "updated_at": "2026-04-15T10:00:00.000Z",
  "updated_by": null
}
```

---

### PUT /api/settings

Update system settings. Uses deep merge -- only send the fields you want to change.

**Request Body** (partial update example)

```json
{
  "enrichment": {
    "batch_size": 50,
    "concurrency": 5
  },
  "lifecycle": {
    "default_expiration_days": 14
  },
  "updated_by": "admin"
}
```

Updatable sections: `prompts`, `classification`, `deduplication`, `enrichment`, `fetching`, `lifecycle`.

**Response** `200 OK` -- returns the full updated settings object.

---

## Stats

### GET /api/stats

System metrics including content counts, source health, enrichment costs, and taxonomy coverage.

**Response** `200 OK`

```json
{
  "total_content": 1250,
  "created_today": 45,
  "active_sources": 8,
  "total_sources": 10,
  "failing_sources": 1,
  "dedup_rate": 13.0,
  "by_vertical": {
    "Technology": 450,
    "News": 320,
    "Entertainment": 180,
    "Uncategorized": 50
  },
  "by_content_type": {
    "article": 800,
    "video": 250,
    "discussion": 100,
    "social_post": 80,
    "trend": 20
  },
  "by_category": {
    "Artificial Intelligence": 120,
    "International News": 95,
    "Video Gaming": 60
  },
  "enrichment_cost_today": 0.025,
  "enrichment_cost_total": 1.85,
  "enrichment": {
    "enriched_count": 1100,
    "unenriched_count": 150,
    "enrichment_rate": 88.0,
    "cost_today": 0.025,
    "cost_total": 1.85,
    "tokens_today": { "input": 50000, "output": 12000 },
    "tokens_total": { "input": 2500000, "output": 600000 },
    "cost_by_day": [
      { "date": "2026-04-09", "cost": 0.003, "items": 15 },
      { "date": "2026-04-10", "cost": 0.005, "items": 22 }
    ]
  },
  "taxonomy": {
    "verticals": 9,
    "categories": 130
  }
}
```

---

## Health Check

### GET /health

Simple health check endpoint.

**Response** `200 OK`

```json
{ "status": "ok" }
```

---

## Quick Start: Typical Workflow

1. **Create a source**

```bash
curl -X POST http://localhost:3000/api/sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hacker News",
    "type": "rss",
    "config": { "feed_url": "https://hnrss.org/frontpage" }
  }'
```

2. **Fetch content from it**

```bash
curl -X POST http://localhost:3000/api/sources/fetch \
  -H "Content-Type: application/json" \
  -d '{"source_id": "SOURCE_ID_FROM_STEP_1"}'
```

3. **Enrich with AI** (generates content briefs, classifies, estimates expiration)

```bash
curl -X POST http://localhost:3000/api/content/enrich
```

4. **Query enriched content**

```bash
curl "http://localhost:3000/api/content?enriched=true&content_type=article&page_size=5"
```

5. **Check system stats**

```bash
curl http://localhost:3000/api/stats
```
