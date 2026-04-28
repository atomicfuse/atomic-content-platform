# Migration Baselines (Phase 0)

**Purpose.** Numbers to compare against post-cutover. The migration is only "successful" if these move in the right direction.

**Captured:** 2026-04-23 (planning session answers).
**Plan reference:** `docs/migration-plan.md` Phase 0.

---

## Deploy time — full-build-and-upload for one site

| Site | Trigger | Duration | Source |
|------|---------|----------|--------|
| `coolnews-atl` | `wrangler pages deploy` via `deploy.yml` (commit `ea7a0d9`, Production/`main`) | **52 s** | User-reported, run at 2026-04-23 ~16:05 UTC. Cloudflare deployment id `2fea74cc-394e-4cf2-97ad-02ebd71ea15a` on the Dev1 account (`953511f6...`). |
| `scienceworld` | — | **Not captured** | Pending — suggest running a `workflow_dispatch` with `force_all: false` after any trivial `sites/scienceworld/**` edit, then noting the duration from the Actions log. |

**Post-migration target:** Phase 6 (pilot DNS cutover) — first "deploy" under Workers is really a KV sync + (optional) Worker re-deploy. Break out:
- KV sync per-site — expect under 5 s (bulk put for a small article set).
- Worker code deploy — only on code change, not on config/article change. Expect 10-30 s from push to live.
- **Config-only edit round-trip should drop to ~10 s (sync + one KV write).**

## Artefact size per site

Not captured in this session — to capture, add `echo "=== dist size ===" && du -sh dist` as a step in `deploy.yml` before the `wrangler pages deploy`. Backlog item.

## Article count per site

From local working tree (approximate):

| Site | Article count | Notes |
|------|---------------|-------|
| `coolnews-atl` | ~20 markdown files in `sites/coolnews-atl/articles/` on `staging/coolnews-atl` branch | Small corpus — fits easily into KV. |
| `scienceworld` | Unknown locally | Lives on `staging/scienceworld` branch (not checked out here). User to confirm when this branch is next active. |
| `muvizz.com` | Small handful | Not in `dashboard-index.yaml`; likely defunct / test site. |

**Post-migration:** KV individual value limit = 25 MB. An average markdown article is well under 100 KB. Even at 100× current size, KV handles it. The only growth concern is `article-index:<siteId>` which is one value listing all slugs — at 10 000 articles × ~200 bytes per entry = ~2 MB — still comfortably under the limit. If a site crosses 50 000 articles, shard the index by date or category.

## Config-change to production latency

Not measured yet. Represents "user clicks save in dashboard → change visible on coolnews.dev". Today's path: dashboard commits YAML → GitHub Action triggers → build per affected site → `wrangler pages deploy` → CF Pages activates. Expected 60-120 s per site in the detected set, plus any queueing if multiple commits stack.

**Post-migration target:** For monetization / ads / pixels edits — **< 15 s** total (no build, no shell purge, just KV write + Server Island reads on next request).

## Cloudflare Pages deployment history — pre-cutover snapshot

Captured via `wrangler pages deployment list --project-name=coolnews-atl`:

Most-recent 4 deployments (coolnews-atl):
- `2fea74cc-394e-4cf2-97ad-02ebd71ea15a` · Production · `main` · 26 min ago · (the 52 s build)
- `58273001-3b56-40c1-8ece-874601089e21` · Preview · `staging/coolnews-atl` · 3 hr ago
- `cfe500e4-e842-4256-94b0-e2880d3e2212` · Production · `main` · 3 hr ago
- `8a99999c-d0d7-4b61-b6ac-4b5c9a318c40` · Preview · `staging/coolnews-atl` · 3 hr ago

Full list can be re-fetched any time with the same `wrangler pages deployment list` command. Keep in mind Cloudflare retains a bounded number of Pages deployments (last 10 production + staging); preserve a copy of this list in Phase 6 before cutover.

## Cloudflare Pages project settings — pre-cutover snapshot

Downloaded via `wrangler pages download config <project>` on 2026-04-23:

```toml
# coolnews-atl
name = "coolnews-atl"
compatibility_date = "2026-04-13"

[env.production]
```

```toml
# scienceworld
name = "scienceworld"
compatibility_date = "2026-04-19"

[env.production]
```

**Finding — both projects have no custom settings.** No env vars, no redirects, no `_headers`, no `_redirects`, no Pages Functions, no KV bindings, no secrets set via the Pages dashboard. This **removes an entire category of migration risk** — there is nothing in the Pages project config to mis-migrate.

---

## Metrics to capture in later phases

Populate these columns when each phase completes. Keeps the "before / after" comparison grounded.

| Metric | Pre-migration | Post-migration target | Actual |
|--------|---------------|-----------------------|--------|
| Full site deploy (coolnews-atl) | 52 s | n/a (no full deploys under Workers model except code changes) | — |
| Code-change deploy (Worker) | n/a | < 30 s | — |
| Config-edit round-trip (CI sync only) | 60-120 s | < 15 s | — |
| Article publish round-trip | 60-120 s | < 20 s | — |
| Cold p95 latency, homepage | unknown | under 300 ms at edge | — |
| Worker cold-start latency | n/a | under 50 ms typical | — |
| Cache HIT ratio on `articles/*` | unknown | > 90% after warmup | — |
| Ad impressions / RPM parity (post cutover) | baseline from week before cutover | ±10% for 48 h | — |
