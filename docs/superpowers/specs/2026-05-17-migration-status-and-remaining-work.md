# Migration Status & Remaining Work

**Date:** 2026-05-17
**Status:** Living document — updated as phases complete

---

## Two Parallel Migrations

The platform has two concurrent migration tracks:

1. **Pages to Workers** — consolidate per-site Cloudflare Pages builds into a single multi-tenant Astro 6 + Workers app (`site-worker`)
2. **WordPress to Platform** — migrate ~50 WordPress sites from `atl-streamed-lander` proxy to our platform, importing their content

Both converge on the same target: every site served by `atomic-site-worker` on the Assets @ AtomicLabs Cloudflare account.

---

## Current Infrastructure

### Two Cloudflare Accounts

| Account | ID | What lives here |
|---------|----|-----------------|
| **Dev1 @ AtomicLabs** | `953511f6356ff606d84ac89bba3eff50` | Legacy: `financenewsbase.com`, `coolnews.dev` (muvizzcom). Has its own `atomic-site-worker` + staging Worker, KV namespaces, R2 bucket. |
| **Assets @ AtomicLabs** | `4a8cfd85d617b38ce1813a552132bc86` | Production: `atomic-site-worker` + staging Worker, KV namespaces. Also hosts all 45 WordPress domains, `atl-streamed-lander`, `green-dream-b06f`, `atl-query-handler-t`. |

### Workers on Each Account

**Dev1:**
| Worker | Purpose |
|--------|---------|
| `atomic-site-worker` | Production worker for Dev1 legacy sites (financenewsbase.com, coolnews.dev) |
| `atomic-site-worker-staging` | Staging preview for Dev1 sites via `?_atl_site=` |

**Assets:**
| Worker | Purpose |
|--------|---------|
| `atomic-site-worker` | Production worker for all non-Dev1 sites. Custom Domains registered here. |
| `atomic-site-worker-staging` | Staging preview for all non-Dev1 sites via `?_atl_site=` |
| `atl-streamed-lander` | Front door for WordPress domains. Routes `domain.com/*`. Proxies to WordPress or serves monetization landing pages. |
| `green-dream-b06f` | Monetization/tracking/redirects. Routes `*domain.com/atl/*` (~38 domains, ~2M req/24h). |
| `atl-query-handler-t` | Query parameter handler. Bound via Service Binding from `atomic-site-worker` (`QUERY_HANDLER`). Handles `?x=1` requests. |

### Sites in the Platform (dashboard-index.yaml)

| Site ID | Status | Custom Domain | Account | Notes |
|---------|--------|---------------|---------|-------|
| `muvizzcom` | Live | `coolnews.dev` | Dev1 | Legacy Dev1 site |
| `financenewsbase` | Live | `financenewsbase.com` | Dev1 | Legacy Dev1 site |
| `travelswire` | Live | `travelswire.com` | Assets | Newest site, fully on Assets |
| `chaibeseret` | Staging | (none) | Assets | No custom domain yet |
| `wtpop` | Staging | (none) | Assets | No custom domain yet |

### Dual-Account Routing (completed 2026-05-17)

The dashboard and CI (`sync-kv.yml`) route Cloudflare API calls to the correct account based on site ID:

- `DEV1_SITE_IDS`: `financenewsbase`, `muvizzcom`
- `DEV1_CUSTOM_DOMAINS`: `financenewsbase.com`, `coolnews.dev`

All API calls (KV, R2, DNS, Workers, email routing) check `isDev1Domain()` and use the appropriate credentials. This is temporary — once Dev1 sites are transferred to Assets, the routing is removed.

---

## Workers Custom Domains vs Workers Routes

Our platform uses **Workers Custom Domains**. The old WordPress setup uses **Workers Routes**. Understanding the difference is important for the migration.

### Workers Custom Domains (what we use)

- **One domain = one Worker**. When you register `travelswire.com` as a Custom Domain on `atomic-site-worker`, Cloudflare auto-creates the DNS record and SSL certificate.
- **Account-level**. Tied to the Worker deployment, not to a zone.
- **Auto-managed DNS**. No manual DNS record creation needed.
- **Clean API lifecycle**. `registerWorkerCustomDomain()` / `deregisterWorkerCustomDomain()` — the dashboard manages these programmatically.
- **No pattern matching**. The Worker receives all requests for that domain. Internal routing (homepage vs article vs assets) is handled by Astro's router inside the Worker.

### Workers Routes (what WordPress uses)

- **Zone-level**. Routes are configured on a DNS zone, not on a Worker.
- **Pattern matching**. Supports glob patterns like `wtpop.com/*` or `*wtpop.com/atl/*`. This enables different Workers to handle different URL paths on the same domain.
- **Manual DNS**. You must separately manage the DNS record.
- **Priority-based**. When multiple route patterns match, the most specific wins.

### Why WordPress needs Routes

The WordPress setup splits traffic across two Workers on the same domain:

```
wtpop.com/*         -->  atl-streamed-lander   (main traffic: WP proxy + monetization landers)
*wtpop.com/atl/*    -->  green-dream-b06f      (ads, tracking, redirects, A/B testing)
```

Routes are the only mechanism that allows this path-based splitting. Custom Domains can't do it — they give the entire domain to one Worker.

### Why we use Custom Domains

Our Worker handles all paths internally via Astro routing. No path-based splitting needed. Custom Domains are simpler to manage programmatically, auto-handle DNS + SSL, and are Cloudflare's recommended approach for new projects.

### During migration

When a WordPress site migrates to our platform, its Routes stay in place but the lander delegates to our Worker via Service Binding (see below). After migration completes, the Routes can optionally be cleaned up — the lander becomes unnecessary for fully migrated domains.

---

## What's Done

### Pages to Workers Migration (Phases 0-5 of original plan)

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Baseline measurements | Done |
| Phase 1 | Scaffold Astro 6 + Workers app | Done |
| Phase 2 | Port modern theme, homepage + article routes | Done |
| Phase 3 | KV + middleware, runtime site resolution | Done |
| Phase 4 | Server Islands for ads + pixels | Done |
| Phase 5 | GitHub -> KV sync CI (`sync-kv.yml`) | Done |

The `site-worker` package is fully operational. Five sites are in the platform. Three have custom domains and serve live traffic.

### Cloudflare Account Migration (from 2026-05-14 spec)

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Infrastructure provisioning (KV + R2 on Assets) | Done |
| Phase 1 | Retarget staging to Assets | Done |
| Phase 2 | Service Binding proof-of-concept | Done (travelswire.com `?x=1` -> `atl-query-handler-t`) |

### Dual-Account Credential Routing (2026-05-17)

All 11 tasks completed:
- Dashboard routes CF API calls to correct account per site
- `sync-kv.yml` seeds Dev1 KV for Dev1 sites, Assets KV for everything else
- CloudGrid secrets configured for both accounts
- `financenewsbase.com` confirmed live on Dev1 Worker
- `wtpop` and `chaibeseret` R2 images copied from Dev1 to Assets

### Query Handler Service Binding (2026-05-17)

- `atl-query-handler-t` Worker created on Assets account
- `QUERY_HANDLER` Service Binding added to `atomic-site-worker` (both staging + production)
- Middleware intercepts `?x=1` and forwards to bound service
- `load-routes.ts` filters Dev1 custom domains from production route emission
- Verified: `travelswire.com/?x=1` -> "Hello Gilad"

---

## What's Left

### Track 1: Dev1 -> Assets Consolidation

These phases migrate the two Dev1 legacy sites to the Assets account, eliminating the dual-account complexity.

#### Phase 3: Transfer `financenewsbase.com` to Assets

**Status:** Not started

1. Transfer `financenewsbase.com` zone from Dev1 to Assets account (CF Registrar inter-account transfer)
2. Wait for zone to activate on Assets
3. Seed financenewsbase data into Assets KV (production) — config, articles, article index, shared pages, site lookup keys
4. Copy R2 assets if not already on Assets bucket (article images already copied 2026-05-17)
5. Register `financenewsbase.com` as Worker Custom Domain on Assets `atomic-site-worker`
6. Verify: homepage, articles, images, tracking, ads
7. Remove `financenewsbase` from `DEV1_SITE_IDS` / `DEV1_CUSTOM_DOMAINS` in `constants.ts`
8. Remove `financenewsbase` from `DEV1_SITES` in `sync-kv.yml`
9. Remove from `DEV1_CUSTOM_DOMAINS` in `load-routes.ts`
10. Monitor 48 hours

**Rollback:** Re-register on Dev1, re-add to Dev1 sets.

#### Phase 4: Transfer `coolnews.dev` (muvizzcom) to Assets

**Status:** Not started

Same steps as Phase 3 but for `coolnews.dev` / `muvizzcom`. After this:
- Dev1 has zero active sites
- All dual-account routing code can be removed
- `DEV1_SITE_IDS`, `DEV1_CUSTOM_DOMAINS`, `isDev1Domain()`, `getKvNamespaces()`, `getWorkerStagingUrl()` — all removable
- `DEV1_*` env vars removed from CloudGrid secrets + `.env.local`
- `sync-kv.yml` `DEV1_SITES` branching removed

#### Phase 5: Dev1 Decommission

**Status:** Not started

1. Delete Dev1 KV namespaces (prod + staging)
2. Delete Dev1 R2 bucket (if separate from Assets — currently shared `atl-assets-prod`)
3. Remove all `DEV1_*` code from dashboard `constants.ts`, `cloudflare.ts`
4. Remove dual-account branching from `sync-kv.yml`
5. Remove `DEV1_CUSTOM_DOMAINS` from `load-routes.ts`
6. Keep Dev1 CF account alive but minimal (safety net)
7. Update `CLAUDE.md` — remove all Dev1 references

---

### Track 2: WordPress Site Migration

~45 WordPress domains on the Assets account need to migrate from the `atl-streamed-lander` WordPress proxy to our platform.

#### Service Binding Architecture

Traffic continues entering through `atl-streamed-lander` (its Routes are untouched). A Service Binding delegates migrated domains to our Worker:

```
Request -> domain.com/*
    |
atl-streamed-lander
    |
Is this a monetization landing page slug?
    YES -> serve monetized lander (existing logic, untouched)
    NO  -> is this domain in the migrated set?
        NO  -> proxy to WordPress (existing logic, untouched)
        YES -> env.SITE_WORKER.fetch(request)   <-- Service Binding
```

The `green-dream-b06f` Worker (`*domain.com/atl/*`) is completely untouched throughout.

**Lander changes required:**
1. Add `[[services]]` binding: `SITE_WORKER` -> `atomic-site-worker`
2. Add hardcoded `migrated-domains` `Set<string>` to request handler
3. Check set before WordPress proxy — delegate via Service Binding if migrated

Per-domain rollback: remove from set, redeploy lander. Instant.

#### Per-Site Migration Checklist

For each WordPress site:

**1. Content Import**
- Run WordPress migration tool (CSV import + article ingestion via content-pipeline)
- Fetch articles from WP REST API
- Convert HTML -> Markdown (turndown + Claude cleanup)
- Generate hero images (Gemini)
- Upload images to R2
- Commit articles to `staging/<domain>` branch
- Verify URL slugs match WordPress exactly (SEO-critical)

**2. Configure Site**
- Create site in dashboard (or already exists from CSV import)
- Set tracking IDs: GA4, GTM, Google Ads, Facebook Pixel — copy exact values from WordPress
- Set ads config: placements, interstitial, CLS heights — match current behavior
- Set `ads.txt` entries — must match WordPress `ads.txt` exactly
- Configure shared pages: about, contact, privacy, terms
- Assign to correct group(s)

**3. Seed KV + R2**
```bash
CLOUDFLARE_ACCOUNT_ID=4a8cfd85d617b38ce1813a552132bc86 \
  pnpm seed:kv <siteId> <hostname> [<custom_domain>]
```
- Verify: site lookup key, config, article index, all articles, shared pages

**4. Staging Verification**
- Preview on `atomic-site-worker-staging.accounts-4a8.workers.dev/?_atl_site=<domain>`
- Full walkthrough: homepage, articles, categories, shared pages
- Images load from R2
- Tracking fires (GA4 real-time, GTM preview mode)
- Ads render in correct placements
- `ads.txt`, `robots.txt`, `sitemap.xml` match WordPress
- Meta tags: title, description, og:image, canonical URL

**5. Flip Traffic**
- Add domain to `migrated-domains` set in `atl-streamed-lander`
- Deploy lander
- Traffic: lander -> Service Binding -> our Worker
- `/atl/*` routes -> `green-dream-b06f` (unchanged)

**6. Post-Cutover Monitoring (48 hours)**
- 404s in Worker logs (`wrangler tail`)
- GA4 real-time traffic
- Ad impressions in ad network dashboards
- Google Search Console crawl errors
- Revenue comparison vs WordPress baseline

**7. Decommission WordPress for this domain**
- Remove WordPress server config / DNS origin
- Lander route stays (monetization landing pages still served by lander)

#### WordPress Migration Pipeline Status

The content-pipeline migration module design is complete (`docs/plans/2026-05-12-wp-migration-design.md`). Implementation plan has 15 tasks (`docs/plans/2026-05-12-wp-migration-plan.md`). None have been implemented yet.

**Pipeline architecture:**
```
CSV row
  -> parse site metadata (name, domain, colors, tracking, logo/favicon URLs)
  -> create sites/<domain>/ on staging/<domain> branch
  -> generate site.yaml + brief
  -> fetch articles from WP REST API (paginated)
  -> per article:
       HTML -> turndown -> Markdown
       Claude Sonnet cleanup (shortcodes, categories, descriptions)
       Gemini 2.0 Flash hero image generation
       upload image to R2
       assemble .md with frontmatter
  -> commit all articles to staging branch
  -> sync-kv.yml fires automatically
```

**Cost estimate:** ~$4.27 per site (75 articles avg), ~$213 total for 50 sites.

**Recommended rollout:**
- Week 1: 1 pilot site (monitor 7 days)
- Week 2: 5 sites (monitor 3 days each)
- Week 3: 15 sites (staggered, 5/day)
- Week 4: 29 remaining sites (10/day)
- Week 5: Stabilization

#### SEO Safety Requirements

URLs to preserve exactly per site:
- `/sitemap.xml` — must serve, matching WordPress structure
- `/robots.txt` — same content
- All article URLs — exact slug match
- Category pages — same structure or 301 redirects
- `ads.txt` — exact content match
- Canonical URLs — must point to the domain (not workers.dev)

If WordPress used date-based permalinks (`/2024/03/article-slug/`) vs our flat (`/article-slug/`): add 301 redirects for old URL patterns. This is per-site.

---

### Track 3: Remaining Pages to Workers Cleanup

#### Phase 6: DNS Cutover for Pilot Site

The original migration plan (Phases 6-8) was written for `scienceworld` as pilot and `coolnews-atl` as second site. Those specific sites no longer exist in the same form — `coolnews-atl` became `muvizzcom` and is already live on Dev1. But the phase structure applies to any new site getting its first Custom Domain.

**Current status:** Three sites already have Custom Domains and serve live traffic (`financenewsbase.com`, `coolnews.dev`, `travelswire.com`). Phases 6-7 are effectively complete for these sites.

#### Phase 8: Decommission Old Pages Projects

**Status:** Already done. `packages/site-builder` was removed. `deploy.yml` workflow disabled. No Pages projects remain.

---

### Track 4: Open Items

| Item | Owner | Status |
|------|-------|--------|
| `atl-streamed-lander` source code access | Needs access to add Service Binding + migrated-domains logic | Blocked |
| WordPress `ads.txt` content per site | Collect before migration | Not started |
| WordPress permalink structures per site | Identify which need 301 redirects | Not started |
| `atl-streamed-lander` monetization slug detection | Understand to avoid conflicts with article slugs | Not started |
| CF Registrar inter-account domain transfer | Verify exact procedure for Dev1 -> Assets | Not started |
| WordPress migration pipeline implementation | 15 tasks in plan, 0 implemented | Not started |
| Legacy Workers Routes cleanup | After all WordPress sites migrated, remove Routes from zones | Future |

---

## Architecture Diagrams

### Current state: Platform site (e.g. travelswire.com)

```
travelswire.com (Workers Custom Domain)
    |
atomic-site-worker  (Assets account)
    |
    |-- normal request -> Astro SSR (homepage, article, shared page)
    |                       reads from CONFIG_KV + R2
    |
    |-- ?x=1 -> QUERY_HANDLER Service Binding -> atl-query-handler-t
```

### Current state: WordPress site (e.g. wtpop.com)

```
wtpop.com/* (Workers Route)
    |
atl-streamed-lander  (Assets account)
    |
    |-- monetization slug -> serve lander page
    |-- normal request -> proxy to WordPress server

*wtpop.com/atl/* (Workers Route, higher specificity)
    |
green-dream-b06f  (Assets account)
    |
    |-- ads, tracking, redirects, A/B testing
```

### Target state: Migrated WordPress site (e.g. wtpop.com after migration)

```
wtpop.com/* (Workers Route — UNCHANGED)
    |
atl-streamed-lander  (Assets account)
    |
    |-- monetization slug -> serve lander page (UNCHANGED)
    |-- wtpop.com in migrated-domains set?
        YES -> env.SITE_WORKER.fetch(request)  (Service Binding)
                    |
               atomic-site-worker
                    |
                    |-- Astro SSR from CONFIG_KV + R2
                    |-- ?x=1 -> QUERY_HANDLER -> atl-query-handler-t

*wtpop.com/atl/* (Workers Route — UNCHANGED)
    |
green-dream-b06f  (UNCHANGED)
```

### Final state: All sites migrated, lander simplified

```
wtpop.com (Workers Custom Domain — Routes removed)
    |
atomic-site-worker  (direct, no lander intermediary)
    |
    |-- Astro SSR from CONFIG_KV + R2
    |-- ?x=1 -> QUERY_HANDLER -> atl-query-handler-t

(atl-streamed-lander still exists for /atl/* monetization,
 or removed entirely if green-dream-b06f handles it directly)
```

---

## Summary: Priority Order

1. **WordPress migration pipeline** — implement the 15-task plan to enable batch site import
2. **Pilot WordPress migration** — pick 1 site, end-to-end: import, configure, seed, verify, flip
3. **Batch WordPress migration** — remaining ~44 sites in weekly batches
4. **Dev1 -> Assets zone transfers** — move `financenewsbase.com` and `coolnews.dev`
5. **Dev1 decommission** — remove dual-account code
6. **Legacy Routes cleanup** — remove WordPress-era Workers Routes from zone configs
