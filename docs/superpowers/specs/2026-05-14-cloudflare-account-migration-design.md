# Cloudflare Account Migration: Dev1 to Assets @ AtomicLabs

**Date:** 2026-05-14
**Status:** Draft
**Scope:** Migrate site-worker infrastructure from Dev1 CF account to Assets @ AtomicLabs CF account, then migrate WordPress sites to the new platform.

---

## Context

### Two Cloudflare Accounts

| Account | ID | Role |
|---------|----|------|
| **Dev1@AtomicLabs** | `953511f6356ff606d84ac89bba3eff50` | Testing/dev — currently runs `atomic-site-worker`, KV, R2 |
| **Assets @ AtomicLabs** | `4a8cfd85d617b38ce1813a552132bc86` | Production — holds 45 WordPress domains, monetization Workers |

Dev1 was always the testing ground. Assets @ AtomicLabs is the real production account. The goal is to consolidate production operations onto the Assets account and gradually replace WordPress with our platform.

### Current State on Assets @ AtomicLabs

- **45 domains** — all WordPress sites, DNS/SSL/CDN managed by Cloudflare
- **`atl-streamed-lander`** — Worker on `domain.com/*` routes. Dual purpose: (1) proxy to WordPress for normal traffic, (2) serve monetization landing pages for specific slugs
- **`green-dream-b06f`** — Worker on `*domain.com/atl/*` routes (~38 domains, ~2M req/24h). Handles monetization, advertising, tracking, redirects, A/B testing
- **Existing KV**: `CACHE`, `Workers KV`, `NEXT_INC_CACHE_KV`
- **No R2 bucket** — needs to be created
- **No `atomic-site-worker`** — needs to be deployed

### Current State on Dev1

- **`atomic-site-worker`** (production) — serves `coolnews.dev` via custom domain route
- **`atomic-site-worker-staging`** — preview via `?_atl_site=<domain>` on workers.dev
- **CONFIG_KV** (prod): `a69cb2c59507482ca5e6d114babdd098`
- **CONFIG_KV_STAGING**: `4673c82cdd7f41d49e93d938fb1c6848`
- **R2 bucket**: `atl-assets-prod`
- **`financenewsbase.com`** — live site, dashboard-built, registered via CF Registrar on Dev1

### What Stays Put

- **CloudGrid** — dashboard + content-pipeline remain deployed on CloudGrid. They talk to whichever CF account's KV/R2 the env vars point at.
- **Network repo** — same structure, same branch conventions, same `dashboard-index.yaml`.
- **Config inheritance** — org/group/override/site model unchanged.

---

## Architecture

### Service Binding: `atl-streamed-lander` as Front Door

WordPress-domain traffic continues to enter through `atl-streamed-lander`. Instead of swapping Worker Routes (risky), we add a Service Binding so the lander delegates to our worker for migrated domains:

```
Request hits domain.com/*
         |
   atl-streamed-lander
         |
   Is this a monetization landing page slug?
    YES --> serve monetized lander (existing logic, untouched)
    NO  --> is this domain in the migrated set?
      NO  --> proxy to WordPress (existing logic, untouched)
      YES --> env.SITE_WORKER.fetch(request)   <-- Service Binding
```

#### Lander wrangler.toml addition

```toml
[[services]]
binding = "SITE_WORKER"
service = "atomic-site-worker"
```

#### Migrated-domains lookup

A hardcoded `Set<string>` in the lander's code. Each migration adds the domain to the set and redeploys the lander. Simple, explicit, easy to audit, instant rollback (remove from set, redeploy).

After all sites are migrated, the WordPress proxy code is removed and the set becomes unnecessary.

#### Hostname preservation

Service Binding `fetch()` preserves the original `Host` header by default. Our middleware sees `muvizz.com` (not `atomic-site-worker.workers.dev`), so the KV lookup `site:muvizz.com` works as expected.

### Route Ownership

| Route pattern | Worker | Changes? |
|---------------|--------|----------|
| `domain.com/*` | `atl-streamed-lander` | NO — stays as-is, delegates via Service Binding |
| `*domain.com/atl/*` | `green-dream-b06f` | NO — completely untouched |
| `coolnews.dev/*` | `atomic-site-worker` (direct) | YES — moves from Dev1 to Assets account |

Our worker (`atomic-site-worker`) claims **no public routes** on WordPress domains. It is only reachable via Service Binding from the lander. Exception: `coolnews.dev` gets a direct Worker Route since it has no monetization logic.

The `emit-env-configs.ts` production routes array should be `coolnews.dev/*` only (not all custom domains). WordPress domains are routed through the lander, not through our worker's route config.

---

## New Resources on Assets @ AtomicLabs

| Resource | Name | Purpose |
|----------|------|---------|
| KV namespace | `CONFIG_KV` | Production site configs, articles, shared pages |
| KV namespace | `CONFIG_KV_STAGING` | Staging/dev configs |
| R2 bucket | `atl-assets-prod` | Per-site images (logos, hero, article images) |
| Worker | `atomic-site-worker` | Astro SSR worker — no public routes (except `coolnews.dev`) |
| Worker | `atomic-site-worker-staging` | Preview via `?_atl_site=<domain>` on workers.dev |

---

## Migration Phases

### Phase 0: Infrastructure Provisioning

**One-time setup, no traffic impact.**

1. Create `CONFIG_KV` namespace on Assets account
2. Create `CONFIG_KV_STAGING` namespace on Assets account
3. Create `atl-assets-prod` R2 bucket on Assets account
4. Generate API tokens: Workers Scripts:Edit, Workers KV Storage:Edit, Zone:Read, DNS:Edit, R2:Edit
5. Deploy `atomic-site-worker` to Assets account — workers.dev only, no routes
6. Deploy `atomic-site-worker-staging` to Assets account — workers.dev only
7. Verify health: `curl https://atomic-site-worker.<subdomain>.workers.dev/_ping`

### Phase 1: Retarget Staging

**Move all staging previews to Assets account immediately.**

Staging is low-risk (no live traffic). This lets every site be previewed on the new infrastructure before it goes live there.

1. Bulk-seed all existing site data into Assets `CONFIG_KV_STAGING`
2. Upload all site assets to Assets `atl-assets-prod` R2
3. Update dashboard's staging preview URL to the Assets account's workers.dev subdomain
4. Verify staging preview works for all sites via `?_atl_site=<domain>`

### Phase 2: Throwaway Domain Test

**Prove the Service Binding wiring works end-to-end.**

1. Pick or buy a cheap throwaway domain (or use workers.dev URL)
2. Create a test site in the dashboard, seed into Assets KV (production namespace)
3. Add `SITE_WORKER` Service Binding to `atl-streamed-lander`'s wrangler config
4. Add the test domain to the hardcoded migrated-domains set
5. Deploy lander
6. Verify:
   - Site renders correctly
   - Articles load
   - Images load from R2
   - Server Islands work
   - Tracking fires
   - `/atl/*` routes still go to `green-dream-b06f`

**Rollback:** Remove domain from set, redeploy lander. Instant.

### Phase 3: Transfer `financenewsbase.com`

**First real site on the new account.**

1. **CF Registrar transfer**: push `financenewsbase.com` from Dev1 to Assets account
2. Wait for zone to be active on Assets account
3. Seed site data into Assets KV (production) + R2: config, articles, article index, shared pages, site lookup key (`site:financenewsbase.com`)
4. Add `financenewsbase.com` to lander's migrated-domains set
5. Deploy lander — traffic flows: lander -> Service Binding -> our worker
6. Verify:
   - Homepage, article pages, categories, shared pages
   - Images from R2
   - Tracking/analytics (GA4, GTM)
   - Ads (placements, interstitial, CLS heights)
   - `/atl/*` routes untouched
   - SEO: canonical URLs, meta tags, sitemap, robots.txt
7. Monitor 48-72 hours

**Rollback:** Remove from set, redeploy lander.

### Phase 4: Cutover `sync-kv.yml` + Dashboard Tokens

**Critical switch — do quickly, minimize the drift window.**

1. Seed Assets KV (production) with all remaining site data (bulk sync)
2. Update `sync-kv.yml` GitHub Actions secrets to Assets account
3. Update CloudGrid secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
4. Update dashboard `.env.local` for local dev

From this point: Dev1 KV stops getting updates. Move `coolnews.dev` promptly.

### Phase 5: Transfer `coolnews.dev`

**Move the Dev1 test site to Assets — direct Worker Route (no lander).**

1. Seed `coolnews.dev` data into Assets KV (production) + R2
2. Transfer domain from Dev1 to Assets account
3. Add `coolnews.dev/*` as a direct Worker Route on `atomic-site-worker` (via `emit-env-configs.ts`)
4. Deploy worker
5. Verify, monitor

After this: Dev1 has zero active sites.

### Phase 6: WordPress Site Migration (Repeatable)

**For each WordPress site — see full checklist below.**

Batch size: start with 1-2 sites. Increase to 5-10 at a time once the process is proven.

### Phase 7: Cleanup

After all sites are migrated:

1. Remove WordPress proxy code from `atl-streamed-lander`
2. Remove migrated-domains check (all domains go to Service Binding)
3. Update `CLAUDE.md` with new account ID, KV namespace IDs, etc.
4. Decommission Dev1 KV namespaces and R2 bucket
5. Keep Dev1 account alive but minimal (safety net)

---

## Codebase Changes

### Files that change

| File | Change |
|------|--------|
| `packages/site-worker/wrangler.toml` | New KV namespace IDs for Assets account |
| `packages/site-worker/scripts/emit-env-configs.ts` | New KV namespace IDs. Production routes = `coolnews.dev/*` only (WordPress domains routed via lander). |
| Dashboard `.env.local` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` -> Assets account |
| CloudGrid secrets | Same env vars as above |
| Network repo `sync-kv.yml` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `KV_NAMESPACE_ID` -> Assets account |
| Dashboard staging preview URL | Workers.dev subdomain changes from Dev1 to Assets |
| `CLAUDE.md` | Updated account ID, KV IDs, R2 info, deployment docs |

### Files that do NOT change

- `packages/site-worker/src/middleware.ts` — same hostname -> KV logic
- `packages/site-worker/scripts/seed-kv.ts` — reads env vars, no hardcoded account
- `packages/site-worker/scripts/lib/load-routes.ts` — same logic (but only loads `coolnews.dev` for direct routing)
- Config inheritance / resolution — unchanged
- Network repo structure — unchanged
- CloudGrid deployment for dashboard + content-pipeline — unchanged
- `green-dream-b06f` — completely untouched

### `atl-streamed-lander` changes (separate repo/deployment)

- Add `[[services]]` binding in wrangler.toml
- Add migrated-domains `Set<string>` to request handler
- Routing logic: check set -> Service Binding if migrated, else WordPress proxy

---

## Per-Site WordPress Migration Checklist

### Pre-migration

1. **Content import**
   - Run WordPress migration tool (CSV import + article migration via content-pipeline)
   - Verify URL slugs match WordPress exactly — every mismatch is a broken SEO link
   - Import categories, verify category -> article mapping
   - Upload article images to R2 (`atl-assets-prod` on Assets account)

2. **Configure site**
   - Create site in dashboard (or already exists from import)
   - Set tracking IDs: GA4, GTM, Google Ads, Facebook Pixel — copy exact values from WordPress
   - Set ads config: placements, interstitial, CLS heights — match current behavior
   - Assign to correct group(s)
   - Set `ads.txt` entries — must match WordPress `ads.txt` exactly (affects ad revenue)
   - Configure shared pages: about, contact, privacy, terms — import from WordPress

3. **Seed KV + R2**
   - `CLOUDFLARE_ACCOUNT_ID=<assets> KV_NAMESPACE_ID=<assets-prod> pnpm seed:kv <siteId>`
   - Verify: site lookup key, config, article index, all articles, shared pages, R2 assets

4. **Staging verification**
   - Preview on `atomic-site-worker-staging.<assets>.workers.dev/?_atl_site=<domain>`
   - Full walkthrough: homepage, articles, categories, shared pages
   - Images load from R2
   - Tracking fires (GA4 real-time, GTM preview mode)
   - Ads render in correct placements
   - `ads.txt` returns correct content
   - `robots.txt` and `sitemap.xml` match WordPress structure
   - Meta tags: title, description, og:image, canonical URL
   - `/atl/*` routes not intercepted

### Cutover

5. **Flip traffic**
   - Add domain to migrated-domains set in `atl-streamed-lander`
   - Deploy lander
   - Traffic: `domain.com/*` -> lander -> Service Binding -> our worker
   - `/atl/*` -> `green-dream-b06f` (unchanged)

### Post-cutover

6. **Verify live**
   - Same checks as staging, on the real domain
   - Google Search Console still sees the site
   - Google Analytics real-time shows traffic
   - Ad impressions in ad network dashboards — revenue should not drop

7. **Monitor 48 hours**
   - 404s in worker logs (`wrangler tail`)
   - Analytics for traffic drops vs WordPress baseline
   - Ad revenue for anomalies
   - Search Console for crawl errors

8. **Decommission WordPress**
   - Remove WordPress server config / DNS origin for this domain
   - The lander route stays — it still checks monetization landing pages

### SEO Safety Net

Critical URLs to preserve exactly:

- `/sitemap.xml` — our worker must serve, matching WordPress URL structure
- `/robots.txt` — same content as WordPress
- All article URLs — exact slug match
- Category pages — same URL structure or 301 redirects
- `ads.txt` — exact content match
- Canonical URLs — must point to the domain (not workers.dev)

If WordPress used date-based permalinks (`/2024/03/article-slug/`) vs our flat (`/article-slug/`): add 301 redirects in site-worker for old URL patterns. This is per-site.

---

## Rollback Strategy

| Phase | Rollback |
|-------|----------|
| Staging retarget | Swap KV IDs back to Dev1, redeploy staging worker |
| Service Binding test | Remove domain from lander set, redeploy |
| `financenewsbase.com` transfer | Remove from lander set -> site unreachable briefly (not on WP), but domain is safe on Assets account |
| WordPress site migration | Remove from lander set -> falls back to WordPress proxy. Instant. |
| Full cutover | Re-point `sync-kv.yml` + dashboard tokens to Dev1. Nuclear option. |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Service Binding adds latency | Slight increase in TTFB | CF Service Bindings are internal RPC, no network hop. Negligible (<1ms). |
| Domain transfer causes DNS downtime | `financenewsbase.com` briefly unreachable | CF-to-CF registrar transfers preserve nameservers. Monitor during transfer. |
| Lander monetization logic breaks | Revenue impact | Monetization check runs before Service Binding delegation. Untouched code path. |
| `/atl/*` routes disrupted | Revenue impact | More-specific route always wins in CF. Our worker claims `/*` at most, never `/atl/*`. |
| SEO drop from URL mismatches | Organic traffic loss | Verify slug-by-slug before cutover. 301 redirects for any mismatches. |
| `ads.txt` mismatch | Programmatic ad revenue drop | Diff WordPress `ads.txt` against our output before cutover. |
| Dual-account KV drift | Stale content on Dev1 | Minimize window — cut over `sync-kv.yml` and move `coolnews.dev` same day. |

---

## Open Items

- [ ] Assets @ AtomicLabs account ID confirmed: `4a8cfd85d617b38ce1813a552132bc86`
- [ ] `atl-streamed-lander` source code access — need to add Service Binding + migrated-domains logic
- [ ] Dashboard staging preview URL — find where the workers.dev subdomain is configured
- [ ] CF Registrar inter-account domain transfer procedure — verify exact steps
- [ ] WordPress `ads.txt` content for each site — collect before migration
- [ ] WordPress permalink structures per site — identify which need 301 redirects
- [ ] `atl-streamed-lander` monetization slug detection logic — understand to ensure no conflicts with our article slugs
