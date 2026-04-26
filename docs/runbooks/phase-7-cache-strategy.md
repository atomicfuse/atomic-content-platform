# Cache strategy — site-worker (Phase 7 prerequisite)

> **Read this before binding the production Worker to a real revenue
> domain.** The decisions below trade content freshness against edge
> hit rate; the wrong call shows up as either stale ads or expensive
> origin traffic.

## Why this matters

The Phase 6 multi-tenant demo (KV write → next request renders different
tenant) worked partly because the Worker had **no caching configured at
all**. Every request ran middleware + KV reads + island fetches.

For real production, that's both wasteful (every request runs the full
SSR path) and expensive (KV reads beyond the free tier are ~$0.50 / 1M).
We need an edge-cache layer — but it has to respect the migration's core
promise: *config + content changes propagate without a rebuild and
without a manual purge for routine edits*.

## The four cache layers

| Layer | What it caches | Where the rules live | Purge mechanism |
|-------|----------------|----------------------|-----------------|
| **Browser** | Per-user cache, follows `Cache-Control max-age` | Page response headers | User-side; a hard refresh bypasses |
| **Cloudflare edge** | Across all users at the colo, follows `Cache-Control s-maxage` | Page response headers + zone Cache Rules | `wrangler cache purge` / API / dashboard |
| **CF Workers KV** | KV's own ~60 s eventual-consistency layer | N/A (CF-managed) | Wait it out; not directly purgeable |
| **Astro Server Islands** | None — by design | `Cache-Control: no-store` set in middleware | N/A |

Today's middleware (`packages/site-worker/src/middleware.ts:applyCacheHeaders`)
is the source of truth for the first column. Any change here MUST update
this runbook so the two stay in sync.

## The TTL matrix

The middleware classifies each request and emits one of these directives:

| Route class | Pattern | `Cache-Control` |
|-------------|---------|-----------------|
| Health check | `/_ping` | `no-store` |
| Server Islands | `/_server-islands/*` | `private, no-store` |
| Homepage | `/` | `public, max-age=30, s-maxage=60, stale-while-revalidate=600` |
| Article / shared page | `/<slug>` (single segment) | `public, max-age=60, s-maxage=300, stale-while-revalidate=600` |
| ads.txt / sitemap.xml | exact paths | `public, max-age=60, s-maxage=600, stale-while-revalidate=3600` |
| Static assets `/<siteId>/assets/*` | served by ASSETS binding | CF default (~24 h, tied to file hash) |
| Anything else | — | no explicit Cache-Control; CF defaults apply |

### Why these specific numbers

- **Server Islands `no-store`**: ad placements, tracking IDs, and pixels
  all read live from KV in the island. Caching their HTML output would
  freeze the very thing the migration was meant to make instant. Worth
  the per-request KV read cost.
- **Homepage `s-maxage=60`**: the homepage aggregates the article index;
  new articles need to surface quickly. 60 s edge cache means a publish
  on `staging/<site>` is visible within ~90 s end-to-end (KV
  propagation + cache TTL).
- **Article `s-maxage=300`**: article bodies rarely change after publish.
  5 minute edge cache cuts KV reads to ~12 / hour per article in the hot
  set. Article body changes need to either wait 5 min OR a purge for
  that URL.
- **`stale-while-revalidate=600`** on shells: if the cached entry is
  past its `s-maxage`, the edge can keep serving the stale version for
  another 10 min while it revalidates in the background. This protects
  origin under load spikes.
- **Static assets**: the bundled `/<siteId>/assets/<path>` URLs are
  served by the CF ASSETS binding, which uses ETag/content-hash caching.
  No headers needed.

## What changing what costs

| Operator action | Time-to-live | Notes |
|-----------------|--------------|-------|
| Edit ad placement / tracking ID in YAML | < 90 s globally (KV) | Zero edge purge needed. Server Islands are `no-store` so the next request to any page reads the new value. |
| Publish a new article | ~ 90 s (KV) + 60 s (homepage cache) | Article URL itself: first request misses cache, hits Worker, serves fresh. Homepage links to it: visible after edge TTL expires. |
| Edit an article body | ~ 90 s (KV) + 5 min (article cache) | Article cache is the bottleneck. Either wait OR purge that URL. |
| Switch tenant on a hostname (`site:<host>` KV) | ~ 90 s (KV) + 60 s (homepage cache) + 5 min (per article) | Equivalent to a soft DNS cutover. For Phase 6 demo we waited 30 s and it worked because no caching was configured. |
| Switch a site's `template` (when templates exist) | Pure-data: KV update; HTML shells re-render with new layout on next request. No purge needed. |
| Deploy a new Worker version | ~ instant (CF rolling deploy) | Old cached responses keep serving until their TTL — that's the point of the cache. |

## When to purge manually

Only when waiting for natural TTL expiry isn't acceptable. Examples:

- **Legal correction on an article**: typo in a public statement. Purge
  that URL specifically; let the homepage cache age out naturally.
- **Bad config pushed**: someone wrote a wrong tracking ID. Re-fix the
  YAML, sync KV, and purge the homepage + a couple of recently-edited
  article URLs to drop the brief stale window.
- **Hostname switch**: when `site:<hostname>` is changed in KV (e.g. tenant
  swap), purge the entire hostname's cached pages.

### How to purge

By URL (most common):
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"files": ["https://<hostname>/<slug>", "https://<hostname>/"]}'
```

By hostname (whole site cache):
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hosts": ["<hostname>"]}'
```

By prefix (all assets under a path):
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/purge_cache" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prefixes": ["<hostname>/coolnews-atl/assets/"]}'
```

> **Note:** all three forms require a real **zone** — these endpoints
> don't work against `*.workers.dev` URLs. That's fine because Phase 7
> cutover binds the Worker to a real zone (e.g. `coolnews.dev`).

## How "force rebuild" maps to this world

The legacy site-builder's `.build-trigger` file pattern (touch a marker
file → CI rebuilds + redeploys the Pages project) collapses two
concepts into one: **invalidate cache** and **rebuild output**.

Under the new model these split:

- *Rebuild* — only matters when the Worker code or static assets change.
  No content edit triggers it. CI runs `wrangler deploy` only when
  `packages/site-worker/**` or `package.json` changes.
- *Invalidate cache* — purge call to the relevant zone. The dashboard's
  Phase 8 "Force rebuild" button will be rewired to issue this purge
  against the site's `zone_id` from `dashboard-index.yaml` (already a
  backlog item).

## Edge cases worth remembering

1. **KV eventual consistency is global, not regional.** A KV write
   completes locally fast but other CF colos might lag for up to ~60 s.
   Do not measure success by curl-from-one-region; check from at least
   two geographies, or wait the full propagation window.

2. **Server Islands inherit page cache headers in some configs.** The
   middleware explicitly sets `private, no-store` on island responses
   AFTER the page handler runs, but if a page handler sets stronger
   headers itself, those win (the middleware respects an explicit
   `Cache-Control` already on the response). If you ever change an
   island to long-cacheable, do it deliberately — don't rely on
   middleware to undo it.

3. **`stale-while-revalidate` requires the resource to be in cache
   already.** Cold hits don't get SWR; they pay the full origin cost.
   So the first request after a deploy or purge is always a miss.

4. **Article slug regex matches shared pages too.** `/about`, `/privacy`,
   etc. are caught by the `/<slug>` pattern. That's intentional — they
   render via PageLayout but their content rarely changes, so the same
   TTL works.

5. **Cache and KV propagation aren't synchronised.** Worst case
   sequence: KV propagates in 60s; edge cache TTL is 300s; user sees
   stale content for up to 360s after the YAML push. Acceptable for
   non-urgent edits; not acceptable for legal corrections — purge.

## Pre-Phase-7 checklist

Before flipping a real zone (`coolnews.dev`) to the Worker:

- [ ] Confirm middleware emits the headers above (curl-test post-deploy).
- [ ] Confirm CF zone has no conflicting Cache Rules. The simplest setup
  is "let origin-headers decide" — if CF zone has aggressive Cache
  Rules they'll override the Worker. Inspect via dashboard → Caching →
  Cache Rules.
- [ ] Capture a baseline of cache hit rate on the existing Pages project
  to compare against. Phase 7 success = ≥ baseline + better edit-to-live
  latency.
- [ ] Document `wrangler cache purge` invocation in the on-call doc.
- [ ] Add a synthetic monitor that hits `/_ping` every 60 s — if it
  starts getting cached anywhere, you've got a config drift.

## Future work (not blocking Phase 7)

- **Per-page-type cache rules from KV**: today the TTL matrix is
  hardcoded in `applyCacheHeaders`. A nicer model is to read TTLs from
  `site-config:<siteId>.cache_policy` so each site can tune. Defer until
  a site asks for it.
- **CF Cache Reserve**: bigger, longer-tail edge cache. Worth it if KV
  reads grow noticeable. Requires plan upgrade.
- **Smart purge from the dashboard**: when the dashboard saves a YAML
  change, also POST a purge for the affected URLs. Removes the natural
  TTL wait for editorial flows. Plan task; not in current scope.
