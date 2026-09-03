# Content Aggregator v2 -- API Reference

> **Taxonomy collapse (2026-04-29):** The legacy `verticals` collection +
> `/api/verticals` route tree were merged into `categories`. Tier-1 (top-level)
> categories live in `categories` with `parent_id: null` and replace the
> "vertical" semantic — filter via `/api/categories?parent_id=null` or content
> via `?category_id=<tier-1-id>`. The `categories[]` array on a content item is
> sorted tier-1 first. Bundle rules are 2 dimensions: `category_ids[]` +
> `tag_ids[]`.

Base URL: `https://<your-domain>` (Cloud Grid deployment) or `http://content-aggregator-v2-34cd--atomic.cloudgrid.io` (local dev)

## Authentication

The dashboard API surface is unauthenticated. The three Cloud Grid cron
entrypoints — `GET /api/content/enrich`, `GET /api/content/lifecycle`,
`GET /api/sources/fetch` — are gated by a hostname-based rule:

- **Cluster-internal calls** (dialed hostname ends with `.svc.cluster.local`)
  are allowed unconditionally. Cloud Grid's cron pods hit the dashboard via
  internal cluster DNS (`dashboard-app.<ns>.svc.cluster.local`), which is not
  reachable from outside the VPC. The dialed hostname IS the authorization.
- **Public-ingress calls** (any other hostname, e.g. the public domain)
  require `?token=<CRON_SECRET>` matching the runtime env var. Comparison is
  constant-time. Missing or wrong token returns 401 `unauthorized`.

The matching `POST` handlers stay open for the dashboard's manual-trigger
buttons. `CRON_SECRET` is set via `cloudgrid secrets set CRON_SECRET=...`
and is only needed for public-ingress invocation (manual testing); cron
ticks themselves do not need it.

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

| Code                   | HTTP Status | Description                                                                                         |
| ---------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `validation_error`     | 400         | Invalid input — malformed ObjectId, unknown enum value, malformed JSON body, missing required field |
| `unauthorized`         | 401         | Missing / invalid cron token on a token-gated route                                                 |
| `not_found`            | 404         | Resource does not exist                                                                             |
| `duplicate`            | 409         | Resource with that name already exists                                                              |
| `referenced_by_bundle` | 409         | Category cannot be deleted while a bundle references it                                             |
| `health_check_failed`  | 503         | `/health` could not reach MongoDB                                                                   |
| `internal_error`       | 500         | Server error                                                                                        |

Validation behavior:

- Path/query/body ObjectIds are validated as 24-character hex; malformed values return 400.
- Enum-style query params (`status`, `content_type`, `sort`, `order`, `language`, `type`, `group`, suggestion `status`/`type`/`action`) are validated against an allow-list; unknown values return 400. Empty string (`?status=`) is treated as "not provided" so the dashboard's blank-default behavior still resolves to the route's default.
- Comma-separated multi-value enum params (e.g. `?content_type=video,article`) reject the whole request if ANY value is unknown — they don't silently filter to the valid subset.
- Malformed JSON bodies on POST/PUT/PATCH/DELETE return 400 instead of 500.

## Pagination

All list endpoints support pagination with these query parameters:

| Parameter   | Default | Max   | Description             |
| ----------- | ------- | ----- | ----------------------- |
| `page`      | `1`     | --    | Page number (1-indexed) |
| `page_size` | `20`    | `100` | Items per page          |

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

| Method | Path                     | Description                                                                      |
| ------ | ------------------------ | -------------------------------------------------------------------------------- |
| GET    | `/api/content`           | Query content items with filters, pagination, search                             |
| GET    | `/api/content/:id`       | Get a single content item                                                        |
| PATCH  | `/api/content`           | Update content items (status, taxonomy overrides)                                |
| DELETE | `/api/content/:id`       | Permanently delete a content item                                                |
| DELETE | `/api/content/bulk`      | Bulk permanent delete                                                            |
| POST   | `/api/content/enrich`    | Trigger the AI enrichment pipeline                                               |
| GET    | `/api/content/enrich`    | Cron entrypoint — runs the enrichment pipeline (token-gated; see Authentication) |
| POST   | `/api/content/lifecycle` | Run lifecycle jobs (archive, purge)                                              |
| GET    | `/api/content/lifecycle` | Cron entrypoint — runs lifecycle jobs (token-gated; see Authentication)          |

### Sources

| Method | Path                       | Description                                                                 |
| ------ | -------------------------- | --------------------------------------------------------------------------- |
| GET    | `/api/sources`             | List sources with content counts                                            |
| GET    | `/api/sources/:id`         | Get a single source by ID                                                   |
| POST   | `/api/sources`             | Create a new source                                                         |
| PUT    | `/api/sources/:id`         | Update a source                                                             |
| DELETE | `/api/sources/:id`         | Deactivate a source (soft delete)                                           |
| DELETE | `/api/sources/:id/content` | Delete all content from a source (keeps source)                             |
| POST   | `/api/sources/discover`    | Auto-discover RSS feeds from a website URL                                  |
| POST   | `/api/sources/fetch`       | Trigger content collection                                                  |
| GET    | `/api/sources/fetch`       | Cron entrypoint — runs the fetch pipeline (token-gated; see Authentication) |

### Taxonomy

| Method | Path                  | Description                                                                                                                                  |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/categories`     | List categories. `?parent_id=null` narrows to tier-1 (top-level / renamed "vertical"); `?parent_id=<id>` narrows to children of that parent. |
| POST   | `/api/categories`     | Create a category (omit `parent_id` or set to null to create a tier-1)                                                                       |
| PUT    | `/api/categories/:id` | Update a category                                                                                                                            |
| DELETE | `/api/categories/:id` | Soft-delete a category. 409 `referenced_by_bundle` if any bundle references it.                                                              |
| GET    | `/api/tags`           | List tags                                                                                                                                    |
| POST   | `/api/tags`           | Create a tag                                                                                                                                 |
| PUT    | `/api/tags/:id`       | Update a tag                                                                                                                                 |
| DELETE | `/api/tags/:id`       | Hard delete a tag (auto-strips from referencing bundles)                                                                                     |
| GET    | `/api/audiences`      | List audience types                                                                                                                          |
| POST   | `/api/audiences`      | Create an audience type                                                                                                                      |
| PUT    | `/api/audiences/:id`  | Update an audience type                                                                                                                      |
| DELETE | `/api/audiences/:id`  | Soft-delete an audience type                                                                                                                 |

All categories: https://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/categories?parent_id=null
Subcategories per category: https://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/categories?parent_id=<category_id>

### Content Bundles

| Method | Path                          | Description                                                                              |
| ------ | ----------------------------- | ---------------------------------------------------------------------------------------- | ------- |
| GET    | `/api/bundles`                | List bundles (pagination, `?active=true                                                  | false`) |
| GET    | `/api/bundles/:id`            | Get a single bundle                                                                      |
| POST   | `/api/bundles`                | Create a bundle (validates min-rule + referenced categories/tags; 409 on duplicate name) |
| PUT    | `/api/bundles/:id`            | Update a bundle (targeted inline re-evaluation on rule / active change)                  |
| DELETE | `/api/bundles/:id`            | Soft-delete (default, `active: false`) or `?hard=true` permanent                         |
| POST   | `/api/bundles/:id/reevaluate` | Force full reevaluation; refreshes `content_count` + `last_evaluated_at`                 |
| POST   | `/api/bundles/preview`        | Count matching content for a rule set (no bundle persisted)                              |

### Taxonomy Suggestions

| Method | Path                                    | Description                     |
| ------ | --------------------------------------- | ------------------------------- |
| GET    | `/api/taxonomy/suggestions`             | List AI-proposed taxonomy items |
| POST   | `/api/taxonomy/suggestions/:id/approve` | Approve or reject a suggestion  |

### System

| Method | Path            | Description                         |
| ------ | --------------- | ----------------------------------- |
| GET    | `/api/settings` | Get system settings                 |
| PUT    | `/api/settings` | Update system settings (deep merge) |
| GET    | `/api/stats`    | System metrics and enrichment cost  |
| GET    | `/health`       | Health check                        |

---

## Content

### GET /api/content

Query content items with filters, pagination, and text search. Returns consumer-clean responses (no internal fields).

**Query Parameters**

| Parameter          | Type    | Default        | Description                                                                                                                                                                             |
| ------------------ | ------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`             | integer | `1`            | Page number                                                                                                                                                                             |
| `page_size`        | integer | `20`           | Items per page (max 100)                                                                                                                                                                |
| `status`           | string  | `active`       | Filter by status: `active`, `inactive`, `archived`                                                                                                                                      |
| `content_type`     | string  | --             | Comma-separated: `article`, `video`, `social_post`, `discussion`, `trend`. 400 if any value is unknown.                                                                                 |
| `category_ids`     | string  | --             | Comma-separated category IDs. OR logic across values. To filter by tier-1 (the renamed "vertical") pass that tier-1 id.                                                                 |
| `tag_ids`          | string  | --             | Comma-separated tag IDs. OR logic across values.                                                                                                                                        |
| `bundle_id`        | string  | --             | Filter by a single bundle ID (24-hex; 400 on malformed). Automatically scoped to active bundles — an unknown or inactive bundle returns an empty result with `total_count: 0` (no 404). |
| `audience_type_id` | string  | --             | Filter by audience type ID (24-hex; 400 on malformed)                                                                                                                                   |
| `source_id`        | string  | --             | Filter by source ID (24-hex; 400 on malformed)                                                                                                                                          |
| `enriched`         | string  | `true`         | `true` (default — only enriched items) or `false` (all items including unenriched). "Golden plate" philosophy: consumers get ready-to-use content by default.                           |
| `language`         | string  | --             | ISO 639-1 language code, validated against the supported set (EN/ES/FR/DE/PT/IT/NL/RU/ZH/JA/KO/AR/HE/TR/TH). Auto-uppercased. 400 on unknown.                                           |
| `sort`             | string  | `published_at` | `published_at` \| `created_at` \| `title`. 400 on unknown.                                                                                                                              |
| `order`            | string  | `desc`         | `asc` \| `desc`. 400 on unknown.                                                                                                                                                        |
| `search`           | string  | --             | Text search across title, description, url, and exact content ID                                                                                                                        |
| `category_id`      | string  | --             | Single-value alias for `category_ids`.                                                                                                                                                  |
| `tag_id`           | string  | --             | Single-value alias for `tag_ids`.                                                                                                                                                       |

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
      "categories": [
        {
          "id": "6650a...",
          "name": "Technology & Computing",
          "iab_code": "596",
          "parent_id": null
        },
        {
          "id": "6650c...",
          "name": "Artificial Intelligence",
          "iab_code": "597",
          "parent_id": "6650a..."
        }
      ],
      "tags": [{ "id": "6650d...", "name": "machine learning" }],
      "audience_types": [
        {
          "id": "6650e...",
          "name": "Tech professionals",
          "group": "profession"
        }
      ],
      "bundles": [{ "id": "6651c...", "name": "AI for Healthcare" }]
    }
  ]
}
```

> **`bundles`** on each item includes only **active** bundle memberships. If a bundle has been deactivated or deleted, its id is stripped from the response even if it remains on the item's underlying `bundle_ids`.

**curl example**

```bash
curl "http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/content?status=active&content_type=article,video&enriched=true&page_size=10"
```

---

### GET /api/content/:id

Get a single content item by ID.

**Response** `200 OK`

Returns a single `ContentItemResponse` object (same shape as items in the list response above).

**Errors**

| Status | Code        | When              |
| ------ | ----------- | ----------------- |
| 404    | `not_found` | ID does not exist |

---

### PATCH /api/content

Update content items. Supports single-item updates and bulk status changes.

**Single item update**

```json
{
  "id": "6651a...",
  "status": "inactive",
  "category_ids": ["6650a...", "6650c..."],
  "tag_ids": ["6650d..."],
  "audience_type_ids": ["6650e..."],
  "expires_at": "2026-05-01T00:00:00.000Z"
}
```

All fields except `id` are optional. Operators override the broad-bucket assignment by including the tier-1 id (renamed "vertical") at index 0 of `category_ids`. Setting any of `category_ids`, `tag_ids`, or `audience_type_ids` flips `classification_source` to `user_override` internally.

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

| Status | Code               | When                         |
| ------ | ------------------ | ---------------------------- |
| 400    | `validation_error` | Invalid status or transition |
| 404    | `not_found`        | Content item not found       |

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

| Status | Code               | When                         |
| ------ | ------------------ | ---------------------------- |
| 400    | `validation_error` | `ids` array missing or empty |

---

### POST /api/content/enrich

Trigger the AI enrichment pipeline. Processes unenriched content items: generates content briefs, classifies with IAB Content Taxonomy 3.1 (picks one tier-1 / top-level category — the renamed "vertical" — plus one-to-three children under that tier-1), and estimates expiration. Tier-1-only classification is a retryable failure (`enrichment_error: 'classified_without_category'`); after `max_attempts` the item is marked `enrichment_status: 'failed'` and auto-purged by the lifecycle cron after `failure_retention_days`.

The matching `GET /api/content/enrich` is the Cloud Grid cron entrypoint and gated per the rules in Authentication — cluster-internal calls (Cloud Grid cron pods) bypass the token check; public-ingress callers must present `?token=<CRON_SECRET>`.

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
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/content/enrich \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 5}'
```

---

### POST /api/content/lifecycle

Run content lifecycle jobs: auto-archive expired content, archive retention-exceeded content, and purge old archived content.

Designed to be called by cron. No request body required. The matching `GET /api/content/lifecycle` is the Cloud Grid cron entrypoint and gated per the rules in Authentication — cluster-internal calls (Cloud Grid cron pods) bypass the token check; public-ingress callers must present `?token=<CRON_SECRET>`.

**Response** `200 OK`

Returns a summary of lifecycle actions taken (archived count, purged count).

---

## Sources

### GET /api/sources

List sources with pagination and content counts.

**Query Parameters**

| Parameter   | Type    | Default | Description                                                                                   |
| ----------- | ------- | ------- | --------------------------------------------------------------------------------------------- |
| `page`      | integer | `1`     | Page number                                                                                   |
| `page_size` | integer | `25`    | Items per page (max 100)                                                                      |
| `type`      | string  | --      | Filter by source type: `rss`, `youtube`, `reddit`, `social`, `google_trends`. 400 on unknown. |
| `active`    | string  | --      | `true` or `false`                                                                             |

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
      "category_ids": ["6650a..."],
      "audience_type_ids": [],
      "classification_override": null,
      "classification_filter": null,
      "auto_tags": null,
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

### GET /api/sources/:id

Fetch a single source by ID. Mirrors the per-item shape from `GET /api/sources`, plus an inline `content_count`.

**Response** `200 OK`

```json
{
  "id": "6650b...",
  "name": "TechCrunch",
  "type": "rss",
  "active": true,
  "fetch_failures": 0,
  "last_error": null,
  "created_at": "2026-04-01T10:00:00.000Z",
  "last_fetched_at": "2026-04-15T08:00:00.000Z",
  "config": { "feed_url": "https://techcrunch.com/feed/" },
  "settings": {
    "schedule": { "cron": "0 */1 * * *" },
    "max_items": 50,
    "filters": {},
    "default_expiration_days": null,
    "retention_days": null
  },
  "category_ids": ["6650a..."],
  "audience_type_ids": [],
  "classification_override": null,
  "classification_filter": null,
  "auto_tags": null,
  "enrichment": {
    "auto_summarize": true,
    "auto_classify": true,
    "auto_tag": true,
    "summary_language": null
  },
  "content_count": 42
}
```

**Errors**

| Status | Code               | Description                             |
| ------ | ------------------ | --------------------------------------- |
| 400    | `validation_error` | `id` is not a 24-character hex ObjectId |
| 404    | `not_found`        | Source not found                        |

**curl example**

```bash
curl http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/sources/6650b1234567890123456789
```

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
  "category_ids": ["6650a...", "6650c..."],
  "audience_type_ids": ["6650e..."],
  "classification_override": null,
  "classification_filter": null,
  "auto_tags": null,
  "enrichment": {
    "auto_summarize": true,
    "auto_classify": true,
    "auto_tag": true,
    "summary_language": "EN"
  }
}
```

**Required fields**: `name`, `type`, `config`

**Source-level taxonomy hint**: pass the source's tier-1 (top-level) category id at index 0 of `category_ids[]`. That tier-1 is the renamed "vertical" semantic — it's used for source-inherited bundle evaluation on ingestion (before AI classification runs) and for the dedup scoping policy on titles.

**Per-source classification gate** (all three optional, all default null = pure additive AI-only behavior):

| Field                     | Type                                                                   | Behavior                                                                                                                                                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `classification_override` | `ObjectId[]` \| `null`                                                 | When set, the AI classifier is **skipped entirely**. The supplied category ids are stamped on every enriched item with `classification_source: 'source_inherited'` (tier-1 first by operator-supplied order).                                                      |
| `classification_filter`   | `{ mode: "include" \| "exclude", category_ids: ObjectId[] }` \| `null` | Only fires when override is null. After the AI classifier runs, items are include-or-exclude-filtered by category overlap. **Rejected items are permanently deleted** (reported as `enrichment_type: 'skipped'`, `success: true` — the source's intent succeeded). |
| `auto_tags`               | `ObjectId[]` \| `null`                                                 | Additively merged into every enriched item's `tag_ids` after classification (or on its own when override is set). Deduped. Runs even on the AI path.                                                                                                               |

The handler validates that every referenced category and tag id exists. On bad refs the response is `400 validation_error` with `missing_category_ids[]` / `missing_tag_ids[]` in the error envelope (mirrors the bundle validation envelope).

**Type-specific config requirements**:

| Source Type     | Required Config Fields           |
| --------------- | -------------------------------- |
| `rss`           | `feed_url`                       |
| `youtube`       | `channel_handle` or `channel_id` |
| `reddit`        | `subreddit`                      |
| `social`        | `handle` and `platform`          |
| `google_trends` | `region`                         |

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

| Status | Code               | When                                           |
| ------ | ------------------ | ---------------------------------------------- |
| 400    | `validation_error` | Missing required fields or invalid type/config |

**curl example**

```bash
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/sources \
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
  "category_ids": ["6650a...", "6650c..."],
  "audience_type_ids": [],
  "classification_override": null,
  "classification_filter": { "mode": "exclude", "category_ids": ["6650f..."] },
  "auto_tags": ["6650g..."],
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

| Status | Code        | When             |
| ------ | ----------- | ---------------- |
| 404    | `not_found` | Source not found |

---

### DELETE /api/sources/:id

Soft-delete a source by default (sets `active: false`). The source row stays so existing content items keep a valid `source_id`.

**Query params:**

| Param                 | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `hard=true`           | Permanently remove the source row (hard delete)                            |
| `delete_content=true` | Also delete every content item from this source (independent of hard/soft) |

**Response** `200 OK`

```json
{ "success": true, "hard": false, "name": "TechCrunch", "deleted_content": 0 }
```

Combinations:

- No query → soft-delete source, content preserved.
- `?hard=true` → hard-delete source, content preserved (becomes unlinked).
- `?delete_content=true` → soft-delete source + wipe its content.
- `?hard=true&delete_content=true` → hard-delete source + wipe its content.

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

| Status | Code      | Description      |
| ------ | --------- | ---------------- |
| 404    | not_found | Source not found |

---

### POST /api/sources/discover

Auto-discover RSS feeds from a website URL. Probes the page's `<link rel="alternate" type="application/rss+xml">` tags and a small set of well-known feed paths. Used by the dashboard's "Add source" flow to suggest feed URLs from a homepage. Always returns 200 — an empty `feeds[]` means no feeds were found.

**Request Body**

```json
{ "url": "https://techcrunch.com" }
```

| Field | Type   | Required | Description                                                               |
| ----- | ------ | -------- | ------------------------------------------------------------------------- |
| `url` | string | yes      | Website URL (with or without scheme — `https://` is assumed when missing) |

**Response** `200 OK`

```json
{
  "url": "https://techcrunch.com",
  "feeds": [
    {
      "url": "https://techcrunch.com/feed/",
      "title": "TechCrunch",
      "type": "rss"
    }
  ]
}
```

**Errors**

| Status | Code               | Description                                |
| ------ | ------------------ | ------------------------------------------ |
| 400    | `validation_error` | Body is malformed JSON or `url` is missing |

**curl example**

```bash
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/sources/discover \
  -H "Content-Type: application/json" \
  -d '{"url": "https://techcrunch.com"}'
```

---

### POST /api/sources/fetch

Trigger content collection from sources. The matching `GET /api/sources/fetch` is the Cloud Grid cron entrypoint and gated per the rules in Authentication — cluster-internal calls (Cloud Grid cron pods) bypass the token check; public-ingress callers must present `?token=<CRON_SECRET>`.

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

| Status | Code        | When                                     |
| ------ | ----------- | ---------------------------------------- |
| 404    | `not_found` | Source ID not found (single source mode) |

**curl example**

```bash
# Fetch all active sources
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/sources/fetch

# Fetch a specific source
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/sources/fetch \
  -H "Content-Type: application/json" \
  -d '{"source_id": "6650b..."}'
```

---

## Categories

The taxonomy is a single-collection tree. Tier-1 (top-level / `parent_id: null`)
rows are the renamed "verticals" — 36 of them. Children carry their parent
tier-1's `_id` in `parent_id`. Total 524 rows (36 tier-1 + 488 children, of
which 466 are seeded from IAB Content Taxonomy 3.1 and 22 are operator-defined
`source_tier: 'custom'` rows filling 5 IAB-leaf tier-1s with no descendants).

### GET /api/categories

List categories.

**Query Parameters**

| Parameter   | Type    | Default | Description                                                                                                 |
| ----------- | ------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `page`      | integer | `1`     | Page number                                                                                                 |
| `page_size` | integer | `20`    | Items per page (max 100)                                                                                    |
| `parent_id` | string  | --      | `null` (literal string) narrows to tier-1; a 24-hex id narrows to children of that parent. Malformed → 400. |
| `active`    | string  | --      | `true` or `false`                                                                                           |

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
      "parent_id": "6650a...",
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

Create a category. Omit `parent_id` (or set to `null`) to create a tier-1 (top-level / renamed "vertical") row.

**Request Body**

```json
{
  "name": "Quantum Computing",
  "parent_id": "6650a...",
  "iab_code": "597-custom",
  "description": "Quantum hardware and algorithms"
}
```

**Required**: `name`. `parent_id` is optional.

**Response** `201 Created` -- returns the created category object with `parent_id`.

**Errors**

| Status | Code               | When                                                        |
| ------ | ------------------ | ----------------------------------------------------------- |
| 400    | `validation_error` | Missing name, malformed JSON body, or malformed `parent_id` |
| 404    | `not_found`        | Parent category does not exist                              |
| 409    | `duplicate`        | Category name already exists                                |

---

### PUT /api/categories/:id

Update a category. All fields optional: `name`, `iab_code`, `parent_id` (null moves to tier-1), `description`, `active`. Cycle-checked: a category cannot be its own parent.

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

| Status | Code                   | When                                        |
| ------ | ---------------------- | ------------------------------------------- |
| 404    | `not_found`            | Category id unknown                         |
| 409    | `referenced_by_bundle` | One or more bundles reference this category |

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

List tags. Tags are flat post-collapse — no parent dimension.

**Query Parameters**

| Parameter       | Type    | Default | Description                                                            |
| --------------- | ------- | ------- | ---------------------------------------------------------------------- |
| `page`          | integer | `1`     | Page number                                                            |
| `page_size`     | integer | `20`    | Items per page (max 100)                                               |
| `search`        | string  | --      | Search tag names (case-insensitive)                                    |
| `sort`          | string  | `name`  | `name` \| `usage_count` \| `created_at`                                |
| `order`         | string  | --      | `asc` \| `desc` (default `asc` for `name`, `desc` for the other sorts) |
| `include_usage` | string  | --      | Set to `true` to include `usage_count`                                 |

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
      "created_at": "2026-04-15T00:00:00.000Z"
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
{ "name": "Machine Learning" }
```

**Required**: `name`

**Response** `201 Created`

```json
{
  "id": "6650d...",
  "name": "machine learning"
}
```

**Errors**

| Status | Code               | When                                     |
| ------ | ------------------ | ---------------------------------------- |
| 400    | `validation_error` | Missing name                             |
| 409    | `duplicate`        | Tag already exists (after normalization) |

---

### PUT /api/tags/:id

Update a tag. Fields: `name`.

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

| Parameter   | Type    | Default | Description                              |
| ----------- | ------- | ------- | ---------------------------------------- |
| `page`      | integer | `1`     | Page number                              |
| `page_size` | integer | `20`    | Items per page (max 100)                 |
| `group`     | string  | --      | Filter by group (see valid groups below) |
| `active`    | string  | --      | `true` or `false`                        |

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

| Status | Code               | When                |
| ------ | ------------------ | ------------------- |
| 400    | `validation_error` | Invalid group value |

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

| Status | Code               | When                                |
| ------ | ------------------ | ----------------------------------- |
| 400    | `validation_error` | Missing name/group or invalid group |
| 409    | `duplicate`        | Name already exists                 |

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

| Parameter   | Type    | Default | Description                                               |
| ----------- | ------- | ------- | --------------------------------------------------------- |
| `page`      | integer | `1`     | Page number                                               |
| `page_size` | integer | `20`    | Items per page (max 100)                                  |
| `active`    | string  | --      | `true` → active only; `false` → inactive only; omit → all |

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
        "category_ids": ["6650a...", "6650c...", "6650f..."],
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
curl "http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/bundles?active=true"
```

---

### GET /api/bundles/:id

Get a single bundle by id.

**Response** `200 OK` -- same `BundleResponse` shape as items above.

**Errors**

| Status | Code        | When              |
| ------ | ----------- | ----------------- |
| 404    | `not_found` | Bundle id unknown |

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
    "category_ids": ["6650a...", "6650c..."],
    "tag_ids": ["6650d...", "6650e..."]
  }
}
```

**Rules shape (2 dimensions, post-collapse 2026-04-29):**

- `category_ids[]` — OR within: content must share at least one category id (a tier-1 / `parent_id:null` id matches every item that classified into that broad bucket — the renamed "vertical" semantic).
- `tag_ids[]` — OR within: content must share at least one tag id.
- AND across: if both dims are specified, BOTH must match.
- Empty array = dim ignored.

**Required**: `name`, and at least **one id total** across `rules.category_ids` + `rules.tag_ids`.

On successful create with `active !== false`, an inline re-evaluation runs immediately so `content_count` and every content item's `bundle_ids` reflect the new bundle.

**Response** `201 Created` — returns the created bundle in `BundleResponse` shape.

**Errors**

| Status | Code               | When                                                                                                                                                                   |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error` | Missing `name`, empty rules (both arrays empty), or referenced category/tag does not exist. Body includes `missing_category_ids` / `missing_tag_ids` where applicable. |
| 409    | `duplicate`        | A bundle with this name already exists                                                                                                                                 |

**curl**

```bash
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/bundles \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AI for Healthcare",
    "rules": {
      "category_ids": ["6650a...", "6650c..."],
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

| Status | Code               | When                                                                                                                                                |
| ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `validation_error` | Empty rules (both dims empty) or referenced category/tag does not exist. Body includes `missing_category_ids` / `missing_tag_ids` where applicable. |
| 404    | `not_found`        | Bundle id unknown                                                                                                                                   |
| 409    | `duplicate`        | Renaming to a name that already exists                                                                                                              |

---

### DELETE /api/bundles/:id

Delete a bundle. Soft by default; `?hard=true` for permanent removal. Both paths run a `removeOnly` re-evaluation first to strip the bundle id from every content item carrying it.

**Query Parameters**

| Parameter | Type   | Default | Description                                                                                        |
| --------- | ------ | ------- | -------------------------------------------------------------------------------------------------- |
| `hard`    | string | --      | Set to `true` to permanently delete. Default (omitted/`false`) is a soft delete (`active: false`). |

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

| Status | Code        | When              |
| ------ | ----------- | ----------------- |
| 404    | `not_found` | Bundle id unknown |

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
    "rules": {
      "category_ids": ["6650a...", "6650c..."],
      "tag_ids": ["6650d..."]
    },
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

| Status | Code        | When              |
| ------ | ----------- | ----------------- |
| 404    | `not_found` | Bundle id unknown |

---

### POST /api/bundles/preview

Count the active content items that would match a given rule set, without persisting a bundle. Powers the live preview in the dashboard form — safe to call repeatedly as the operator adjusts rules (empty rules return `0`, no validation error).

**Request Body**

```json
{
  "rules": {
    "category_ids": ["6650a...", "6650c..."],
    "tag_ids": ["6650d...", "6650e..."]
  }
}
```

Both arrays are optional; missing fields default to `[]`.

**Response** `200 OK`

```json
{ "count": 47 }
```

---

## Taxonomy Suggestions

### GET /api/taxonomy/suggestions

List AI-proposed taxonomy items awaiting human review.

**Query Parameters**

| Parameter   | Type    | Default   | Description                                                                                                                                                                                                      |
| ----------- | ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page`      | integer | `1`       | Page number                                                                                                                                                                                                      |
| `page_size` | integer | `20`      | Items per page (max 100)                                                                                                                                                                                         |
| `status`    | string  | `pending` | Filter: `pending` \| `approved` \| `rejected`. 400 on unknown.                                                                                                                                                   |
| `type`      | string  | --        | Filter: `category` \| `audience_type` \| `tag`. 400 on unknown. The legacy `vertical` type was removed in the 2026-04-29 collapse — `category` suggestions with `parent_id: null` create tier-1 rows on approve. |

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

`action` is validated against `["approve", "reject"]`. Omitting `action` defaults to `"approve"`. Any other value returns 400 `validation_error` (previously a typo silently approved).

Approve (default):

```json
{}
```

Reject:

```json
{ "action": "reject" }
```

For category suggestions, `parent_id` is optional. Null/omitted creates a **tier-1** (top-level / renamed "vertical") row; otherwise the new category is created under that parent:

```json
{ "parent_id": "6650a..." }
```

For audience_type suggestions, `group` is required:

```json
{ "group": "profession" }
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

| Status | Code               | When                                                      |
| ------ | ------------------ | --------------------------------------------------------- |
| 400    | `validation_error` | Already resolved, or missing required fields for approval |
| 404    | `not_found`        | Suggestion not found                                      |

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
  "by_top_category": {
    "Technology & Computing": 450,
    "News and Politics": 320,
    "Entertainment": 180,
    "Uncategorized": 50
  },
  "by_content_type": {
    "article": 800,
    "video": 250,
    "discussion": 100,
    "social_post": 80,
    "trend": 20,
    "unknown": 5
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
    "top_categories": 36,
    "categories": 488
  },
  "total_bundles": 8,
  "active_bundles": 6
}
```

---

## Health Check

### GET /health

Liveness + readiness probe. Pings the MongoDB connection — returns **503** if the DB can't be reached so Cloud Grid won't keep a broken pod in rotation. The AI SDK is intentionally not pinged (calling it would cost tokens per probe).

**Response** `200 OK`

```json
{ "status": "ok", "checks": { "mongodb": "ok" }, "latency_ms": 4 }
```

**Response** `503 Service Unavailable`

```json
{
  "status": "error",
  "checks": { "mongodb": "fail" },
  "error": {
    "code": "health_check_failed",
    "message": "database check failed"
  },
  "latency_ms": 5001
}
```

The error envelope is intentionally generic. Driver internals (host, replica set, auth source) are logged server-side via `console.error` but never echoed in the response — `/health` is reachable from external probes and shouldn't leak topology.

---

## Quick Start: Typical Workflow

1. **Create a source**

```bash
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hacker News",
    "type": "rss",
    "config": { "feed_url": "https://hnrss.org/frontpage" }
  }'
```

2. **Fetch content from it**

```bash
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/sources/fetch \
  -H "Content-Type: application/json" \
  -d '{"source_id": "SOURCE_ID_FROM_STEP_1"}'
```

3. **Enrich with AI** (generates content briefs, classifies, estimates expiration)

```bash
curl -X POST http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/content/enrich
```

4. **Query enriched content**

```bash
curl "http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/content?enriched=true&content_type=article&page_size=5"
```

5. **Check system stats**

```bash
curl http://content-aggregator-v2-34cd--atomic.cloudgrid.io/api/stats
```
