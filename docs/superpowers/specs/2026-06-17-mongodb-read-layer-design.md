# MongoDB Read Layer Design

## Problem

The dashboard reads all data from Git (GitHub API). At scale (100 sites, 300 articles each), this means ~30,000 API calls to list article metadata — well beyond GitHub's 5,000/hr rate limit. In-memory caches are fragile (process restart = cold start, missed invalidation = stale data). The `review_counts` MongoDB counter drifts from actual article statuses in Git because increment/decrement tracking is inherently fragile.

## Solution

Use MongoDB as the dashboard's read layer. Git remains the write/persistence layer (articles as `.md` for KV sync, configs as `.yaml` for version control). Every mutation dual-writes to Git first, then MongoDB. The dashboard reads only from MongoDB.

## Architecture

**Current:**
```
Dashboard  ──reads──>  GitHub API  ──>  Git repo
Pipeline   ──reads──>  GitHub API  ──>  Git repo
seed-kv    ──reads──>  Git repo    ──>  KV + R2
```

**New:**
```
Dashboard  ──reads──>  MongoDB
Dashboard  ──writes─>  Git + MongoDB
Pipeline   ──writes─>  Git + MongoDB
seed-kv    ──reads──>  Git repo  ──>  KV + R2  (unchanged)
```

## MongoDB Collections

### New collections

| Collection | Key | Contents |
|-----------|-----|----------|
| `articles` | `{ domain, slug, branch }` | Frontmatter fields only: title, status, quality_score, featured_image, publish_date, tags, source_url, videos, scripts, author, type, description. NOT the markdown body. |
| `site_configs` | `{ domain }` | Parsed site.yaml: site_name, author, groups, brief (schedule, topics, quality_threshold), active flag, theme, tracking, etc. |
| `dashboard_index` | `{ domain }` | Per-site: domain, status, staging_branch, custom_domain, zone_id, created_at. Also stores history[] for permanently deleted sites. |
| `org_config` | singleton (`_id: "org"`) | Parsed org.yaml fields. |
| `group_configs` | `{ groupId }` | Parsed group YAML. |
| `override_configs` | `{ overrideId }` | Parsed override YAML. |
| `scheduler_config` | singleton (`_id: "scheduler"`) | enabled, run_at_hours, timezone. |

### Deleted collections

| Collection | Reason |
|-----------|--------|
| `review_counts` | Replaced by `db.articles.countDocuments({ domain, status: "review" })`. No more counter drift. |

### Existing collections (unchanged)

`generation_events`, `site_stats`, `image_gen_events`, `weekly_summaries`, `cost_events`, `site_costs` — these already live in MongoDB and are unaffected.

## Indexes

```
articles:        { domain: 1, branch: 1 }          — list by site
articles:        { domain: 1, branch: 1, status: 1 } — review count, status filter
articles:        { domain: 1, slug: 1, branch: 1 }  — unique, single article lookup
dashboard_index: { domain: 1 }                      — unique
dashboard_index: { status: 1 }                      — filter by status
site_configs:    { domain: 1 }                      — unique
group_configs:   { groupId: 1 }                     — unique
override_configs:{ overrideId: 1 }                  — unique
```

## Write Order (Consistency Model)

Every mutation follows this order:

```
1. Write to Git (commit)    ← if fails: abort, return error to user
2. Write to MongoDB          ← if fails: log warning, continue (soft failure)
3. Return success
```

- **Git failure = hard failure.** Nothing is written, user sees error. Both systems consistent.
- **MongoDB failure = soft failure.** Git has the data (site works, KV sync works). Dashboard may show stale data until next successful dual-write or reconcile.

MongoDB is never the source of truth. Git is. A stale MongoDB is a cosmetic issue; a stale Git breaks production sites.

## Dual-Write Mutation Points

### Phase 1: Articles

| Mutation | Code location | MongoDB operation |
|----------|--------------|-------------------|
| Scheduler generates articles | `content-pipeline/queue/content-generation.ts` `writeArticleBatch()` | `insertMany` article docs |
| Dashboard "Generate" button | Same queue path | Same |
| Dedicated article generation | `content-pipeline/agents/content-generation/dedicated-agent.ts` `runDedicatedGeneration()` | `insertOne` article doc (calls `writeArticleBatch()`) |
| Article regeneration | `content-pipeline/agents/article-regeneration/index.ts` `regenerateArticle()` | `updateOne` article doc (revised content, updated quality_score) |
| WordPress import | `content-pipeline/agents/migration/` | `insertMany` article docs |
| Article editor save | `dashboard/api/articles/[domain]/[slug]/route.ts` | `updateOne` article doc (frontmatter fields that changed) |
| Article upload (image + markdown) | `dashboard/api/articles/upload/route.ts` | `updateOne` article doc (sets `featured_image` after R2 upload) |
| Commit article (local→Git sync) | `dashboard/api/agent/commit-article/route.ts` | `upsertOne` article doc (parse frontmatter from committed file) |
| Article delete from Content tab | `dashboard/actions/sites.ts` `deleteArticleFromStaging()` / `deleteArticlesFromStaging()` | `deleteOne` / `deleteMany` article docs |
| Review approve | `dashboard/actions/review.ts` | `updateOne` set `status: "published"` |
| Review reject (delete) | `dashboard/actions/review.ts` | `deleteOne` article doc |
| Videos panel save | `dashboard/api/articles/[domain]/[slug]/videos/route.ts` | `updateOne` set `videos` |
| Scripts panel save | `dashboard/api/articles/[domain]/[slug]/scripts/route.ts` | `updateOne` set `scripts` |
| Image callback (n8n) | `content-pipeline/n8n-image.ts` | `updateOne` set `featured_image` |
| Auto-publish (staging→main) | `scheduler-flow.ts` `autoPublishSite()` | Bulk copy: insert article docs with `branch: "main"`, then delete staging docs for published articles |
| Auto-publish staging reset | `scheduler-flow.ts` `autoPublishSite()` | After staging branch reset, `deleteMany({ domain, branch: stagingBranch })` — staging articles are stale post-reset |
| Site soft delete (trash) | `dashboard/actions/sites.ts` | Keep article docs (restore needs them) |
| Site permanent delete | `dashboard/actions/sites.ts` | `deleteMany({ domain })` across all branches |
| Article copy (cross-site) | `dashboard/api/articles/copy/route.ts` | `insertMany` into target site |

**Note on article editor save:** The editor saves full markdown to Git. The MongoDB dual-write only needs to parse and store the frontmatter fields — the body is never stored in MongoDB. If the editor modifies frontmatter (title, status, etc.), those changes propagate to MongoDB.

### Phase 2: Site configs

`site_configs` stores the **staging branch** version of `site.yaml`. This is what the dashboard reads for site detail pages, brief editing, and group management. The production version (on `main`) is only consumed by `seed-kv` and is not cached in MongoDB.

| Mutation | Code location | MongoDB operation |
|----------|--------------|-------------------|
| Site config save | `dashboard/api/sites/save` | `updateOne` site_configs |
| Brief update | `dashboard/api/sites/[domain]/brief` | `updateOne` site_configs |
| Group membership change | `dashboard/api/groups/[groupId]/sites/route.ts` POST | `updateOne` site_configs (update `groups` array) |
| Wizard (new site) | `dashboard/actions/wizard.ts` | `insertOne` site_configs |
| Site deletion | `dashboard/actions/sites.ts` | `deleteOne` site_configs (permanent) |
| Auto-publish staging reset | `scheduler-flow.ts` `autoPublishSite()` | No-op: staging config is re-created from main, but site_configs doc remains valid (config doesn't change during publish) |

### Phase 3: Dashboard index

| Mutation | Code location | MongoDB operation |
|----------|--------------|-------------------|
| Wizard (new site) | `dashboard/actions/wizard.ts` | `insertOne` dashboard_index |
| Status change (promote to Live) | `dashboard/actions/wizard.ts` | `updateOne` status |
| Attach/detach custom domain | `dashboard/actions/wizard.ts` | `updateOne` custom_domain, zone_id |
| `updateSiteEntry` (general metadata) | `dashboard/actions/sites.ts` | `updateOne` dashboard_index (any field: status, domain, custom_domain, etc.) |
| Soft delete | `dashboard/actions/sites.ts` `deleteSiteEntry()` | `updateOne` status → "deleted" |
| Permanent delete | `dashboard/actions/sites.ts` `permanentlyDeleteSite()` | `updateOne` add to history[], remove from active docs |
| Restore from trash | `dashboard/actions/sites.ts` | `updateOne` status → "Staging" |

### Phase 4: Configs (org, groups, overrides, scheduler)

| Mutation | Code location | MongoDB operation |
|----------|--------------|-------------------|
| Org config save | `dashboard/api/settings/org` PUT | `updateOne` org_config |
| Group config create/update | `dashboard/api/groups/[groupId]` PUT | `upsertOne` group_configs |
| Group config delete | `dashboard/api/groups/[groupId]` DELETE | `deleteOne` group_configs |
| Override config create/update | `dashboard/api/overrides/[id]` PUT | `upsertOne` override_configs |
| Override config delete | `dashboard/api/overrides/[id]` DELETE | `deleteOne` override_configs |
| Scheduler config save | `dashboard/api/scheduler` | `updateOne` scheduler_config |

## review_counts Migration

The `review_counts` collection and all code that reads/writes it gets removed. Replaced by direct queries on the `articles` collection.

**Prerequisite:** This migration happens as part of Phase 1 (articles), after the `articles` collection is populated (backfill complete) and all article mutation points have dual-writes. Until then, `review_counts` continues to operate as-is.

### Code to remove

| File | What to remove |
|------|---------------|
| `content-pipeline/src/stats/recorder.ts` | Lines 151-161: `$inc` on `review_counts` after article generation |
| `content-pipeline/src/stats/weekly-summary.ts` | `decrementReviewCount()` function (entire function) |
| `content-pipeline/src/stats/weekly-summary.ts` | `getWeeklySummary()`: replace `reviewCounts.find()` with `articles.countDocuments({ domain, status: "review" })` |
| `content-pipeline/src/agents/content-generation/index.ts` | `/review-counts/decrement` HTTP endpoint handler |
| `dashboard/src/actions/review.ts` | Fire-and-forget POST to `/review-counts/decrement` |
| `content-pipeline/src/stats/types.ts` | `ReviewCount` interface, `reviewCounts` from `COLLECTIONS` |

### Code to add

`getWeeklySummary()` changes from:
```typescript
const reviewDocs = await db.collection("review_counts").find({}).toArray();
const reviewMap = new Map(reviewDocs.map(d => [d._id, d.count]));
```
To:
```typescript
const reviewPipeline = [
  { $match: { status: "review", branch: { $regex: /^staging\// } } },
  { $group: { _id: "$domain", count: { $sum: 1 } } },
];
const reviewDocs = await db.collection("articles").aggregate(reviewPipeline).toArray();
const reviewMap = new Map(reviewDocs.map(d => [d._id, d.count]));
```

**Note:** The `branch` filter ensures only staging articles are counted for review. Articles on `main` have already been published and should not appear in the review queue. The regex matches `staging/<domain>` branches.

## Dashboard MongoDB Connection

**New file:** `services/dashboard/src/lib/mongo.ts`

Same pattern as content-pipeline: lazy memoized `getMongoDb()`. Reuses `MONGODB_URL` env var.

**Env var setup:** `MONGODB_URL` is already set for `content-pipeline` in CloudGrid. It must also be added to the `dashboard` service: `cloudgrid secrets set atomic-content-platform MONGODB_URL=<url>` (or verify it's already inherited as a shared secret). For local dev, add to `services/dashboard/.env.local`.

**New file:** `services/dashboard/src/lib/db.ts`

Read helpers that replace Git-read functions:

```
getArticlesMeta(domain, branch): ArticleMeta[]
getArticleMeta(domain, slug, branch): ArticleMeta | null
countArticlesByStatus(domain, branch, status): number
getSiteConfig(domain): SiteConfig | null
listSiteConfigs(): SiteConfig[]
getDashboardIndex(): DashboardIndexEntry[]
getSchedulerConfig(): SchedulerConfig
getOrgConfig(): OrgConfig
getGroupConfig(groupId): GroupConfig | null
listGroupConfigs(): GroupConfig[]
getOverrideConfig(overrideId): OverrideConfig | null
listOverrideConfigs(): OverrideConfig[]
```

**Write helpers** in the same file:

```
upsertArticleMeta(domain, slug, branch, frontmatter): void
upsertArticlesMeta(docs: ArticleMeta[]): void          — bulk upsert for batch generation
deleteArticleMeta(domain, slug, branch): void
deleteArticlesMeta(domain, slugs: string[], branch): void  — bulk delete
deleteArticlesForSite(domain): void                     — all branches
upsertSiteConfig(domain, config): void
deleteSiteConfig(domain): void
upsertDashboardIndexEntry(domain, entry): void
updateDashboardIndexEntry(domain, update: Partial<DashboardIndexEntry>): void
upsertGroupConfig(groupId, config): void
deleteGroupConfig(groupId): void
upsertOverrideConfig(overrideId, config): void
deleteOverrideConfig(overrideId): void
upsertOrgConfig(config): void
upsertSchedulerConfig(config): void
```

## Backfill Script

**New file:** `services/content-pipeline/src/scripts/backfill-mongo.ts`

Run once to populate MongoDB from Git. Idempotent (`updateOne` with `upsert: true`).

Steps:
1. Read `dashboard-index.yaml` → upsert into `dashboard_index` (one doc per site)
2. For each active site: read `site.yaml` from staging branch → upsert into `site_configs`
3. For each active site: list articles, parse frontmatter of each `.md` → bulk upsert into `articles`
4. Read `org.yaml` → upsert into `org_config`
5. List `groups/` directory → upsert each into `group_configs`
6. List `overrides/config/` directory → upsert each into `override_configs`
7. Read `scheduler/config.yaml` → upsert into `scheduler_config`
8. Drop `review_counts` collection

**Cost:** ~30,000 Git reads for 100 sites x 300 articles. One-time, acceptable.

**Invocation:** `npx tsx src/scripts/backfill-mongo.ts` (requires `GITHUB_TOKEN`, `NETWORK_REPO`, `MONGODB_URL`).

## Reconcile Safety Net

**New endpoint:** `GET /reconcile-mongo` on the content-pipeline.

### Articles reconcile

Lightweight comparison: for each active site, compare `db.articles.countDocuments({ domain, branch })` against Git tree file count (1 API call per site — tree listing only). Sites with mismatched counts trigger a full re-backfill of that site's articles.

### Config reconcile

Compare `dashboard_index` docs against `dashboard-index.yaml` on Git. Remove orphaned MongoDB docs for sites that no longer exist in Git (e.g. failed permanent deletes where MongoDB cleanup failed). Also verify `site_configs`, `group_configs`, `override_configs` doc counts against their Git directory listings.

### Invocation

Manual (dashboard button or curl), or scheduled daily via CloudGrid cron. Protected by `CACHE_INVALIDATE_SECRET` bearer token (same pattern as existing cache invalidation endpoint). Runs synchronously — returns a JSON report of what was checked and what was re-backfilled.

**Response schema:**
```json
{
  "articles": { "checked": 100, "mismatched": 2, "rebackfilled": ["site-a", "site-b"] },
  "configs": { "checked": 4, "mismatched": 0, "rebackfilled": [] },
  "orphaned": { "removed": 1, "domains": ["deleted-site"] }
}
```

**Cost per run:** ~1 + N API calls (N = number of active sites) for the article comparison step. Config comparison is ~5 API calls total (one per config directory). Only mismatched entities incur full re-reads.

## Site Deletion Handling

### Soft delete (trash)

1. Git operations (disconnect domain, delete main files, remove KV) ← hard fail
2. MongoDB: update `dashboard_index` doc status → "deleted" ← soft fail
3. Keep `articles` and `site_configs` docs (needed for restore)

### Permanent delete

1. Git operations (destroy staging branch, KV, R2) ← hard fail
2. MongoDB: `deleteMany` articles for domain (all branches), `deleteOne` site_configs, update `dashboard_index` (add to `history[]` array, keep doc for audit trail — do NOT delete the doc) ← soft fail

### Restore from trash

1. Git operations (staging branch + R2 still intact) ← hard fail
2. MongoDB: update `dashboard_index` doc status → "Staging" ← soft fail

If MongoDB cleanup fails during delete, orphaned docs remain. The reconcile job detects these by comparing against Git's `dashboard-index.yaml` and removes them.

## Migration Phases

### Phase 1: Articles metadata (highest impact)

1. Add `articles` collection + indexes
2. Add dual-write to all article mutation paths (6-8 code locations)
3. Run backfill script (articles only)
4. Switch dashboard article-list reads from Git to MongoDB
5. Replace `review_counts` with `articles.countDocuments` query
6. Drop `review_counts` collection
7. Remove `decrementReviewCount`, `/review-counts/decrement` endpoint, fire-and-forget POST in review.ts
8. Remove `articlesCache`, `articleCountCache` from dashboard's `github.ts`

### Phase 2: Site configs

1. Add `site_configs` collection + indexes
2. Add dual-write to site config mutation paths
3. Run backfill (site configs only)
4. Switch dashboard site config reads from Git to MongoDB
5. Remove `siteConfigCache` from dashboard's `github.ts`

### Phase 3: Dashboard index

1. Add `dashboard_index` collection + indexes
2. Add dual-write to dashboard index mutation paths
3. Run backfill
4. Switch dashboard site list reads from Git to MongoDB
5. Remove `dashboardIndexCache` from dashboard's `github.ts`

### Phase 4: Org, groups, overrides, scheduler config

1. Add remaining collections + indexes
2. Add dual-write to config mutation paths
3. Run backfill
4. Switch dashboard config reads from Git to MongoDB

### Post-migration cleanup

- Remove unused Git-read functions from `dashboard/src/lib/github.ts`
- Remove `treeCacheStore` and related caching infrastructure
- Remove `invalidateSiteCaches()` calls (no longer needed — MongoDB writes are immediate)
- Keep `readFileContent()` for the article editor (full markdown body still read from Git)

## What Stays on Git

- Full article markdown body (read by article editor, needed by seed-kv for KV sync)
- All YAML files (needed by seed-kv for config resolution)
- `scheduler/history.json` (audit log)
- Binary assets → R2 (already there)

## What Gets Read from MongoDB

- Article metadata (list views, review queue, counts, status checks)
- Site configs (site detail page, group pages, settings)
- Dashboard index (sites list, status, custom domains)
- Org/group/override/scheduler configs (settings pages)
- Review counts (derived from articles collection, no separate counter)
