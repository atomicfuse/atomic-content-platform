# Aggregator change request: batch id→name resolution (`?ids=`)

**Date:** 2026-06-28
**For:** content-aggregator-v2 team (separate repo)
**Requested by:** atomic-content-platform (dashboard topics taxonomy fix)
**Type:** Additive, backward-compatible. No breaking changes.

## Why
Consumers that store taxonomy references (the platform stores `category_ids`/`tag_ids` per topic) must turn those ids back into names. Today there is **no id→name resolution**: no `GET /api/tags/:id` or `GET /api/categories/:id`, and no id filter on the list endpoints. With `page_size` capped at 100 and ~9,400+ tags, resolving a topic's handful of ids means scanning ~95 pages. This is the root scaling problem on the consumer side.

## What to add
A comma-separated `ids` filter on the two taxonomy list endpoints — mirroring the existing `category_ids`/`tag_ids` filtering already on `GET /api/content`.

### `GET /api/tags?ids=<id1>,<id2>,...`
- Returns the tags whose `_id` is in the list (OR / set membership).
- Each id validated as 24-hex; **any malformed id → `400 validation_error`** (consistent with existing ObjectId validation).
- **Unknown ids are silently omitted** (not 404) — a deleted/renamed tag simply doesn't come back. This is the desired resolution semantic.
- Response: same paginated shape `{ total_count, page, page_size, total_pages, items }`.
- Composes with `include_usage=true`. When `ids` is present, `search`/`sort` may be ignored (resolution mode).
- Suggested guard: cap the id list (e.g. ≤ 200 ids per request) → `400` if exceeded.

### `GET /api/categories?ids=<id1>,<id2>,...`
- Same semantics; returns matching category items (`id, name, iab_code, parent_id, ...`).

## Acceptance
- `GET /api/tags?ids=<known>,<unknown>` → 200, items contains only the known one.
- `GET /api/tags?ids=<malformed>` → 400 `validation_error`.
- `GET /api/categories?ids=<tier1-id>` → 200, returns that tier-1 with `name`.
- Backward compatible: omitting `ids` behaves exactly as today.

## Consumer usage (atomic-content-platform)
- Topic modal resolves a topic's selected `category_ids` + `tag_ids` in **one request each** → no raw IDs, no full-taxonomy scan, scales to any taxonomy size.
- Names are also persisted on the topic as defense-in-depth (survive aggregator rename/delete).
