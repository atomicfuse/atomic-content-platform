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

### Content Bundles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/bundles` | List bundles (pagination, `?active=true|false`) |
| GET | `/api/bundles/:id` | Get a single bundle |
| POST | `/api/bundles` | Create a bundle (validates min-rule + referenced categories/tags; 409 on duplicate name) |
| PUT | `/api/bundles/:id` | Update a bundle (targeted inline re-evaluation on rule / active change) |
| DELETE | `/api/bundles/:id` | Soft-delete (default, `active: false`) or `?hard=true` permanent |
| POST | `/api/bundles/:id/reevaluate` | Force full reevaluation; refreshes `content_count` + `last_evaluated_at` |
| POST | `/api/bundles/preview` | Count matching content for a rule set (no bundle persisted) |

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
| `category_ids` | string | -- | Comma-separated category IDs. OR logic across values. |
| `tag_ids` | string | -- | Comma-separated tag IDs. OR logic across values. |
| `bundle_id` | string | -- | Filter by a single bundle ID. Automatically scoped to active bundles — an unknown or inactive bundle returns an empty result with `total_count: 0` (no 404). |
| `audience_type_id` | string | -- | Filter by audience type ID |
| `source_id` | string | -- | Filter by source ID |
| `enriched` | string | `true` | `true` (default — only enriched items) or `false` (all items including unenriched). "Golden plate" philosophy: consumers get ready-to-use content by default. |
| `language` | string | -- | ISO language code (auto-uppercased) |
| `search` | string | -- | Text search across title, description, url, and exact content ID |
| `category_id` | string | -- | **Deprecated** — legacy single-value alias for `category_ids`. Accepted for one release. Prefer `category_ids`. |
| `tag_id` | string | -- | **Deprecated** — legacy single-value alias for `tag_ids`. Accepted for one release. Prefer `tag_ids`. |

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
        { "id": "6650c...", "name": "Artificial Intelligence", "iab_code": "597" }
      ],
      "tags": [
        { "id": "6650d...", "name": "machine learning" }
      ],
      "audience_types": [
        { "id": "6650e...", "name": "Tech professionals", "group": "profession" }
      ],
      "bundles": [
        { "id": "6651c...", "name": "AI for Healthcare" }
      ]
    }
  ]
}
```

> **`bundles`** on each item includes only **active** bundle memberships. If a bundle has been deactivated or deleted, its id is stripped from the response even if it remains on the item's underlying `bundle_ids`.

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

Trigger the AI enrichment pipeline. Processes unenriched content items: generates content briefs, classifies with IAB Content Taxonomy 3.1 (picks one vertical + one-to-three categories under that vertical), and estimates expiration. Vertical-only classification is a retryable failure (`enrichment_error: 'classified_without_category'`); after `max_attempts` the item is marked `enrichment_status: 'failed'` and auto-purged by the lifecycle cron after `failure_retention_days`.

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
  "total_count": 36,
  "page": 1,
  "page_size": 20,
  "total_pages": 2,
  "items": [
    {
      "id": "6650a...",
      "name": "Technology & Computing",
      "iab_code": "596",
      "description": "Software, hardware, AI, devices",
      "is_system": true,
      "active": true,
      "created_at": "2026-04-20T00:00:00.000Z"
    }
  ]
}
```

> **`iab_code`** is the canonical IAB Content Taxonomy 3.1 unique_id (case-sensitive string). Examples: `"596"` (Technology & Computing), `"JLBCU7"` (Entertainment), `"v9i3On"` (Sensitive Topics — brand-safety sink). Empty string for operator-created verticals outside the IAB namespace.

---

### POST /api/verticals

Create a vertical.

**Request Body**

```json
{
  "name": "Finance",
  "iab_code": "",
  "description": "Markets, investing, personal finance"
}
```

**Required**: `name`. **Optional**: `iab_code` (defaults to empty string for operator-created verticals).

**Response** `201 Created`

```json
{
  "id": "665aa...",
  "name": "Finance",
  "iab_code": "",
  "description": "Markets, investing, personal finance",
  "is_system": false,
  "active": true,
  "created_at": "2026-04-20T10:00:00.000Z"
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Missing name |
| 409 | `duplicate` | Name already exists |

---

### PUT /api/verticals/:id

Update a vertical. All fields optional (`name`, `iab_code`, `description`, `active`).

```json
{
  "name": "Finance & Business",
  "iab_code": "",
  "description": "Updated description",
  "active": true
}
```

**Response** `200 OK` — returns the full updated vertical object with `iab_code`.

---

### DELETE /api/verticals/:id

Soft-delete a vertical (sets `active: false`). **Returns 409 when any active bundle references this vertical** — operator must edit those bundles first.

**Response** `200 OK`

```json
{ "success": true }
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Vertical does not exist |
| 409 | `referenced_by_bundle` | At least one bundle's `rules.vertical_ids` includes this id. Payload includes `error.bundles: [{id, name}]` listing the referencing bundles. |

---

## Categories

### GET /api/categories

List categories. Seeded with 466 IAB Content Taxonomy 3.1 categories (274 canonical tier-3 + 131 tier-2 auto-lifts under tier-1s without tier-3 descendants + 61 approved tier-2 exceptions — AI, AR, VR, Robotics, Movies, Television, 51 Sports, 4 Video Gaming platforms).

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
      "iab_code": "597",
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
  "iab_code": "597-custom",
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

Blocks if the category is referenced by any content bundle — operator must edit those bundles first.

**Response** `200 OK`

```json
{ "success": true }
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Category id unknown |
| 409 | `referenced_by_bundle` | One or more bundles reference this category |

**409 body**

```json
{
  "error": {
    "code": "referenced_by_bundle",
    "message": "Category is referenced by 2 bundle(s). Edit those bundles first.",
    "bundles": [
      { "id": "6651c...", "name": "AI for Healthcare" },
      { "id": "6651d...", "name": "Fashion Events" }
    ]
  }
}
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

If the tag is referenced by any content bundle, the tag is removed from those bundles' rules and each affected bundle is re-evaluated. If stripping the tag would leave a bundle with empty rules (which would violate the min-selector invariant on subsequent saves), that bundle is auto-**deactivated** and surfaced in the response.

**Response** `200 OK`

```json
{
  "success": true,
  "stripped_from_bundles": [
    { "id": "6651c...", "name": "AI for Healthcare", "deactivated": false },
    { "id": "6651d...", "name": "Fashion Events", "deactivated": true }
  ]
}
```

`stripped_from_bundles` is omitted when no bundles referenced the tag.

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

## Content Bundles

Content bundles are operator-defined groupings that span sources. A bundle's `rules` are **categories + tags** (OR within each dimension, AND across). Membership is materialized on each content item as `bundle_ids[]` and re-evaluated automatically at ingestion, after enrichment, and on taxonomy override. Consumers only ever see **active** bundle memberships.

### GET /api/bundles

List bundles.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `page_size` | integer | `20` | Items per page (max 100) |
| `active` | string | -- | `true` → active only; `false` → inactive only; omit → all |

**Response** `200 OK`

```json
{
  "total_count": 6,
  "page": 1,
  "page_size": 20,
  "total_pages": 1,
  "items": [
    {
      "id": "6651c...",
      "name": "AI for Healthcare",
      "description": "Content about AI applications in medicine",
      "active": true,
      "rules": {
        "vertical_ids": ["6650b..."],
        "category_ids": ["6650c...", "6650f..."],
        "tag_ids": ["6650d...", "6650e..."]
      },
      "content_count": 47,
      "last_evaluated_at": "2026-04-19T15:00:00.000Z",
      "created_at": "2026-04-15T09:12:00.000Z",
      "updated_at": "2026-04-19T15:00:00.000Z"
    }
  ]
}
```

**curl**

```bash
curl "http://localhost:3000/api/bundles?active=true"
```

---

### GET /api/bundles/:id

Get a single bundle by id.

**Response** `200 OK` -- same `BundleResponse` shape as items above.

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Bundle id unknown |

---

### POST /api/bundles

Create a bundle.

**Request Body**

```json
{
  "name": "AI for Healthcare",
  "description": "Content about AI applications in medicine",
  "active": true,
  "rules": {
    "vertical_ids": ["6650b..."],
    "category_ids": ["6650c..."],
    "tag_ids": ["6650d...", "6650e..."]
  }
}
```

**Rules shape (3 dimensions):**
- `vertical_ids[]` — OR within: content must have its `vertical_id` in this set.
- `category_ids[]` — OR within: content must share at least one category id.
- `tag_ids[]` — OR within: content must share at least one tag id.
- AND across: if multiple dims are specified, ALL specified dims must match.
- Empty array = dim ignored.

**Required**: `name`, and at least **one id total** across `rules.vertical_ids` + `rules.category_ids` + `rules.tag_ids`.

On successful create with `active !== false`, an inline re-evaluation runs immediately so `content_count` and every content item's `bundle_ids` reflect the new bundle.

**Response** `201 Created` — returns the created bundle in `BundleResponse` shape (including `rules.vertical_ids`).

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Missing `name`, empty rules (all three arrays empty), or referenced vertical/category/tag does not exist. Body includes `missing_vertical_ids` / `missing_category_ids` / `missing_tag_ids` where applicable. |
| 409 | `duplicate` | A bundle with this name already exists |

**curl**

```bash
curl -X POST http://localhost:3000/api/bundles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AI for Healthcare",
    "rules": {
      "vertical_ids": ["6650b..."],
      "category_ids": ["6650c..."],
      "tag_ids": ["6650d..."]
    }
  }'
```

---

### PUT /api/bundles/:id

Update a bundle. All fields optional: `name`, `description`, `active`, `rules`.

If `rules` or `active` changes, the server runs a **targeted** re-evaluation:
- `true → false`: strips this bundle id from every content item carrying it; `content_count` → 0.
- Still-active or `false → true`: `$pull` from items that no longer match, `$addToSet` onto items that now match. Both operations are indexed and bounded to affected rows.

**Response** `200 OK` -- returns the updated bundle.

**Errors**

| Status | Code | When |
|--------|------|------|
| 400 | `validation_error` | Empty rules (all 3 dims empty) or referenced vertical/category/tag does not exist. Body includes `missing_vertical_ids` / `missing_category_ids` / `missing_tag_ids` where applicable. |
| 404 | `not_found` | Bundle id unknown |
| 409 | `duplicate` | Renaming to a name that already exists |

---

### DELETE /api/bundles/:id

Delete a bundle. Soft by default; `?hard=true` for permanent removal. Both paths run a `removeOnly` re-evaluation first to strip the bundle id from every content item carrying it.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `hard` | string | -- | Set to `true` to permanently delete. Default (omitted/`false`) is a soft delete (`active: false`). |

**Response** `200 OK`

```json
{
  "success": true,
  "deleted": "soft",
  "stripped_from_items": 47
}
```

With `?hard=true`, `deleted` is `"hard"`.

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Bundle id unknown |

---

### POST /api/bundles/:id/reevaluate

Force a full re-evaluation of the bundle against all content items. Refreshes `content_count` and `last_evaluated_at`. Useful after manual DB edits or bulk changes.

**Response** `200 OK`

```json
{
  "bundle": {
    "id": "6651c...",
    "name": "AI for Healthcare",
    "active": true,
    "rules": { "vertical_ids": ["6650b..."], "category_ids": ["6650c..."], "tag_ids": ["6650d..."] },
    "content_count": 49,
    "last_evaluated_at": "2026-04-19T18:00:00.000Z",
    "created_at": "2026-04-15T09:12:00.000Z",
    "updated_at": "2026-04-19T18:00:00.000Z"
  },
  "reevaluation": {
    "added": 3,
    "removed": 1,
    "matched_active": 49
  }
}
```

**Errors**

| Status | Code | When |
|--------|------|------|
| 404 | `not_found` | Bundle id unknown |

---

### POST /api/bundles/preview

Count the active content items that would match a given rule set, without persisting a bundle. Powers the live preview in the dashboard form — safe to call repeatedly as the operator adjusts rules (empty rules return `0`, no validation error).

**Request Body**

```json
{
  "rules": {
    "vertical_ids": ["6650b..."],
    "category_ids": ["6650c..."],
    "tag_ids": ["6650d...", "6650e..."]
  }
}
```

All three arrays are optional; missing fields default to `[]`.

**Response** `200 OK`

```json
{ "count": 47 }
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
  },
  "total_bundles": 8,
  "active_bundles": 6
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
