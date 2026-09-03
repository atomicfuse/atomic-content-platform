# Runbook: Post-US-migration remediation (0-article counts, dedup indexes, giantsavings topics)

**Date:** 2026-07-16
**Context:** The US server migration created a fresh MongoDB instance. Mongo is the dashboard's read layer (`USE_MONGO_READS=true`) and is populated incrementally — it never backfills itself. Investigation: `docs/audit-logs/2026-07-16-0856-six-bugs-investigation.md`.

## 1. Restore article counts (~49 sites showing 0 articles)

The data is intact in git (`staging/<domain>` branches) and KV; only Mongo is empty. **No new code needed — the tooling already exists.**

### Option A (recommended): reconcile endpoint — self-verifying, idempotent

```bash
# Against the production content-pipeline service:
curl -H "Authorization: Bearer $CACHE_INVALIDATE_SECRET" \
  https://<content-pipeline-prod-host>/reconcile-mongo
```

It compares git file counts vs Mongo per site (both `staging/<domain>` and `main`), re-upserts mismatches, prunes orphans, and returns a per-site `{gitCount, mongoCount, resynced}` report. Run it once, check the report, run again and confirm `mismatches: []`.

### Option B: targeted backfill (if the whole collection set is empty)

A fresh Mongo also lacks `dashboard_index`, `site_configs`, org/group/override configs. If the sites *list* itself is broken (not just counts), run all phases:

```bash
# Via dashboard proxy:
curl -X POST https://<dashboard-host>/api/agent/backfill-mongo \
  -H "Content-Type: application/json" \
  -d '{"phases": ["index", "site-configs", "configs", "articles"]}'

# Or CLI from a machine with env access:
cd services/content-pipeline
MONGODB_URL=... GITHUB_TOKEN=... NETWORK_REPO=atomicfuse/atomic-labs-network \
  npx tsx src/scripts/backfill-mongo.ts --phase articles
```

`backfill-mongo.ts` accepts `domains: [...]` to target only the affected sites.

### Verify

Dashboard sites list shows real counts (e.g. travelswire = 93). `GET /reconcile-mongo` returns no mismatches.

## 2. Other Mongo state silently lost (accept or rebuild)

| State | Impact | Action |
|---|---|---|
| `site_stats.topicRotation` | Round-robin cursor reset to 0 → early topics repeat for a few runs | Accept (self-corrects) |
| `generation_events` / `site_stats` | "created today/this week" tiles read 0 | Optional: `src/stats/backfill.ts` |
| Alert throttle state | Possible one-time alert re-fire burst | Accept |
| Cost events / R2 tally | Cost dashboards restart from 0 | Optional: `POST /backfill-r2` |

## 3. Rebuild dedup indexes with v2 keys (after the dedup fix deploys)

The dedup fix adds aggregator item ids + source titles to `dedup-index.json` (v2). Old v1 indexes stay valid but lack ids for pre-existing articles. After deploying the fix:

```bash
cd services/content-pipeline
NETWORK_DATA_PATH=/path/to/atomic-labs-network \
  npx tsx src/scripts/rebuild-dedup-index.ts --all
```

(Articles generated before this fix have no `source_item_id`-keyed protection unless rebuilt; the rebuild picks up `source_item_id` from frontmatter, which HAS been written since v2 pipeline launch.)

## 4. Fix giantsavings (and audit other seed-inferred sites)

giantsavings' five `topics_v2` carry cross-vertical `tag_ids` (nutrition, sleep, healthy-eating, public-health, artificial-intelligence on a personal-finance site) — the category∩tag intersection matches 0 aggregator items. Two-part remediation:

1. **Data:** edit each topic in the dashboard (Topic Edit modal) and remove/replace the wrong tags — or clear `tag_ids` entirely; categories alone match fine. (The new drop-tags fallback also unblocks generation even before the data fix, but the tags should still be corrected so narrow queries stay meaningful.)
2. **Audit:** other sites seeded around commit `f57293a` (seed-time topic inference) may have the same pollution. Grep site.yamls across staging branches for tag names that don't match the site's vertical.

## 5. Verify REDIS_URL on the migrated environment

If the dashboard's generate route can't reach Redis it silently falls back to `POST /content-generate`, which **does not commit articles or update the dedup index**. On the new US environment confirm the dashboard and pipeline share the same reachable `REDIS_URL` (see CLAUDE.md landmine #32 for the dev-mode variant of this trap).
