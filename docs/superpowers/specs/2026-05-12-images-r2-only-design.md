# Article Images Direct to R2 — Design Spec

**Date:** 2026-05-12

**Goal:** Stop storing generated article images in Git. Upload them directly to R2 from the content pipeline, and clean up R2 images when articles are deleted.

---

## Problem

Generated article images (~100-300KB WebP each) are committed to the network repo's Git alongside articles. seed-kv then uploads them from Git to R2, which is the actual serving source. Git is an unnecessary intermediate that bloats the repo over time. Every generated article adds a binary blob that inflates clone/fetch sizes.

## Solution

1. Content pipeline uploads images directly to R2 instead of including them in the Git commit.
2. seed-kv skips `assets/images/` during R2 upload (images are already in R2).
3. Article deletion cleans up the associated R2 image.

## Scope

**In scope:**
- Content pipeline: upload image buffer to R2 via S3-compatible API, skip image in Git commit
- seed-kv: skip `assets/images/` files during R2 upload
- Article deletion: delete R2 image when article is deleted
- Env vars: content-pipeline needs R2 credentials

**Out of scope:**
- Migrating existing images out of Git (leave them)
- Logo/favicon flow (stays in Git, low volume)
- Changing image URL format or serving logic
- Site-worker changes (already serves from R2)

---

## Data Flow — Before vs After

### Before
```
Content Pipeline → Git commit (article.md + image.webp) → seed-kv reads Git → uploads to R2 → Worker serves from R2
```

### After
```
Content Pipeline → R2 (image.webp directly)
                 → Git commit (article.md only)
                 → seed-kv (skips images, already in R2)
                 → Worker serves from R2 (unchanged)
```

---

## Component Changes

### 1. Content Pipeline — R2 Upload

**File:** `services/content-pipeline/src/lib/writer.ts`

After image generation + optimization, upload the image buffer directly to R2 before committing the article to Git. The existing `_pendingAsset` structure already has `siteDomain`, `assetPath`, and `data` (Buffer).

R2 key construction: `${siteDomain}/${assetPath}` → e.g. `coolnews-atl/assets/images/best-thriller-movies.webp`

Uses `@aws-sdk/client-s3` `PutObjectCommand` with the S3-compatible endpoint (`https://<account_id>.r2.cloudflarestorage.com`). Same SDK and approach already used by the dashboard's `cloudflare.ts`.

After successful R2 upload, the `_pendingAsset` is NOT included in the Git commit batch. Only the article markdown is committed.

**Fallback:** If R2 upload fails, log a warning but still commit the article (without featured image). The article is still valid without an image.

**Env vars needed by content-pipeline:**
- `R2_ACCESS_KEY_ID` — already exists in dashboard, needs to be added to content-pipeline
- `R2_SECRET_ACCESS_KEY` — same
- `R2_BUCKET` — defaults to `atl-assets-prod`
- `CLOUDFLARE_ACCOUNT_ID` — already available (`953511f6356ff606d84ac89bba3eff50`)

### 2. Content Pipeline — Skip Image in Git Commit

**File:** `services/content-pipeline/src/lib/writer.ts`

In `writeArticleBatch()`, after uploading images to R2, filter out `pendingAssets` from the Git commit. Only pass `pendingArticles` (text files) to `commitBatch()`.

For local-mode writes (`shouldWriteLocal()`), still write images to local filesystem (dev convenience). R2 upload only in GitHub mode (when branch is specified).

### 3. seed-kv — Skip `assets/images/` Upload

**File:** `packages/site-worker/scripts/seed-kv.ts`

In `uploadAssetsToR2()`, skip files whose path starts with `assets/images/`. These are already in R2 from the content pipeline. Continue uploading other assets (logo.png, favicon.png, etc.).

### 4. Article Deletion — R2 Cleanup

**Files:**
- `services/dashboard/src/actions/sites.ts` — `deleteArticleFromStaging()` and `deleteArticlesFromStaging()`
- `services/dashboard/src/lib/cloudflare.ts` — new `deleteR2Object()` helper

When deleting articles, also delete the associated R2 image. The R2 key follows a predictable pattern: `<domain>/assets/images/<slug>.webp`.

Best-effort: R2 deletion failure is logged but doesn't block the article removal from Git. Delete from both staging and prod R2 buckets (same bucket in practice, but defensive).

For bulk deletion, delete all image objects in a single `DeleteObjectsCommand` call.

---

## Env Var Changes

Content-pipeline needs R2 credentials. Add to `cloudgrid.yaml` for the content-pipeline service:

```yaml
R2_ACCESS_KEY_ID: (from secrets)
R2_SECRET_ACCESS_KEY: (from secrets)
```

`CLOUDFLARE_ACCOUNT_ID` is already available. `R2_BUCKET` defaults to `atl-assets-prod`.

---

## Backward Compatibility

- Existing images already in Git + R2 continue to work — no migration needed
- seed-kv skipping `assets/images/` is safe because images are either already in R2 (from prior seeds) or will be uploaded directly by the pipeline
- Articles generated before this change have images in both Git and R2; after this change, only in R2
- Local dev mode (`LOCAL_NETWORK_PATH`, no branch) still writes images to filesystem for convenience
