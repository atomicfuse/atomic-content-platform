# `?trending` — ad-free session

**Date:** 2026-10-20
**Status:** Draft, awaiting approval
**Owner:** Asaf

## Goal

A visitor who lands on any network site with a `trending` query parameter sees no ads for the rest of that browser session on that site, on every page, while analytics and tracking pixels keep working.

## Decisions (agreed with Asaf)

| Question | Decision |
|---|---|
| Duration | Whole browser session on that site (session cookie). Navigating to other pages or articles stays ad-free. |
| Tracking | Keep GA4, GTM, Google Ads conversion and Meta pixel (`config.tracking`). Only ads are removed. |
| Trigger | `trending` must be a query-parameter **name**. Any value, or none, counts. Name match ignores case. |
| `?x=1` / `?agi=1011` | Unchanged. Those requests go to other workers before our code runs, so they are not ad-free. No `trending` traffic is planned there. |
| Scope | All sites, production and staging, current and future. No per-site or dashboard setting. |

### Trigger table

| URL | Ad-free |
|---|---|
| `/?trending` | yes |
| `/some-article?trending` | yes |
| `/?utm_source=fb&trending&x=2` | yes |
| `/?trending=1`, `/?trending=anything`, `/?trending=` | yes |
| `/?Trending`, `/?TRENDING` | yes |
| hostname contains "trending" | no |
| `/trending`, `/trending-movies-2026` (path / slug) | no |
| `/?topic=trending` (value, not name) | no |
| `/?trendingnow` (different name) | no |
| `/#trending` (fragment never reaches the server) | no |

## Architecture

Every site request (pages, Server Islands, Grid API) passes through `packages/site-worker/src/middleware.ts`, which loads the merged `ResolvedConfig` from KV and puts it on `Astro.locals.site.config`. All ad rendering reads from that object:

| Ad source | Reader |
|---|---|
| `ads_config.ad_placements` | `AdSlot.astro` (Server Island), `injectInlineAds` in article + Grid story pages, Grid `next-story` API and `listing.ts` |
| `ads_config.interstitial` / `interstitial_config` | `InterstitialLoader.astro` |
| `scripts.head/body_start/body_end/before_footer` (ad SDKs such as adsnx, digikube, mock-ad-fill) | `BaseLayout.astro`, `GridLayout.astro` |
| Article frontmatter `scripts` | `[slug]/index.astro` via `injectArticleScripts` |

So the feature is: **decide "no ads" once in middleware, and replace the request's config with an ad-stripped copy.** All readers are then covered without per-component changes, except article frontmatter scripts, which aren't part of the config and get one explicit check.

### Session persistence

On the request that carries `trending`, the middleware sets a session cookie:

```
atl_noads=1; Path=/; Secure; HttpOnly; SameSite=Lax
```

No `Max-Age`/`Expires` → it's cleared when the browser session ends. Later requests with that cookie are treated as no-ads. This automatically covers:
- clicked links and typed URLs on the same site
- Server Island fetches (`/_server-islands/*`), which are same-origin and send cookies
- the Grid `next-story` infinite-scroll fetch
- back/forward navigation

The cookie is per hostname. It doesn't carry over to other network domains.

### Caching

Every no-ads response gets `cache-control: private, no-store`, so an ad-free page is never stored in a shared cache and served to someone else. The site worker doesn't use the Cache API, and Worker responses aren't stored in Cloudflare's CDN cache. Before shipping we confirm that `atl-sites-workers-manager` (separate repo) doesn't cache HTML either.

### Alternatives considered

- **Per-component checks** (each ad component checks a flag). Rejected: many touch points, and a new ad component added later could easily forget the check.
- **Carry `?trending` on every internal link** (the existing param-propagation script). Rejected: it misses Server Island fetches, typed URLs and the back button, and it changes visible URLs.

## Components

| File | Change |
|---|---|
| `packages/site-worker/src/lib/no-ads.ts` (new) | `hasNoAdsParam(searchParams)`, `hasNoAdsCookie(cookieHeader)`, `stripAds(config)`, `NO_ADS_COOKIE_HEADER`. Pure functions. |
| `packages/site-worker/src/lib/__tests__/no-ads.test.ts` (new) | Unit tests (see Test plan). |
| `packages/site-worker/src/middleware.ts` | After conditional overrides: compute `noAds`; if true, `config = stripAds(config)`. Set `locals.site.noAds`. On the response: `private, no-store`, plus `Set-Cookie` when triggered by the param. |
| `packages/site-worker/src/env.d.ts` | Add `noAds: boolean` to `App.Locals.site`. |
| `packages/site-worker/src/lib/config.ts` | `isNoAds(astro)` helper, matching `isStagingEnv`. |
| `packages/site-worker/src/pages/[slug]/index.astro` | Skip `injectArticleScripts` when `isNoAds`. |
| `services/dashboard/public/guide/27-trending-no-ads.md` (new) + `GUIDE_PAGES` | User-facing guide page. |
| `docs/runbooks/phase-7-cache-strategy.md` | Note the no-ads `no-store` rule (the middleware comment requires the runbook to stay in sync). |

`noAds` lives on `Astro.locals` only. **Nothing is added to the KV-stored `ResolvedConfig`**, so the KV schema-evolution steps (runtime default, seed default, re-seed) don't apply and no re-seed is needed.

### `stripAds(config)`

Returns a new object; the input isn't changed.
- `ads_config.ad_placements` → `[]`
- `ads_config.interstitial` → `false`
- `scripts.head`, `scripts.body_start`, `scripts.body_end`, `scripts.before_footer` → `[]`
- Everything else unchanged, including `tracking`, `scripts_vars`, theme, `ads_txt`, `ad_placeholder_heights`.

## Data flow

```
request ─► middleware
            ├─ resolve site + config from KV (unchanged)
            ├─ apply conditional overrides (unchanged)
            ├─ noAds = hasNoAdsParam(url) || hasNoAdsCookie(Cookie header)
            ├─ noAds ? config = stripAds(config)
            ├─ template-var resolution (no-op when placements are empty)
            ├─ locals.site = { …, config, noAds }
            ├─ render (layouts / islands / APIs read the stripped config)
            └─ noAds ? cache-control: private, no-store
               param present ? Set-Cookie: atl_noads=1 (session)
```

Ordering: stripping happens **after** conditional overrides, so an override that adds placements or scripts can't bring ads back.

## Error handling

- Malformed or missing `Cookie` header → treated as "no cookie" (the existing `parseCookie` already handles this).
- `config.ads_config` or `config.scripts` missing → `stripAds` still returns valid empty arrays and `interstitial: false`.
- No new KV reads and no new failure paths: when there's no param or cookie, behaviour is identical to today.

## Edge cases

- `?trending` combined with `?_atl_site=` preview on workers.dev: both apply. The cookie is set for the shared workers.dev host, so it covers every site previewed in that browser session. Acceptable on staging.
- `?trending` combined with conditional-override params: the override is applied, then ads are stripped. The override's non-ad changes (theme, etc.) still show.
- `?x=1` / `?agi=1011`: bypass happens before our check (per decision). A cookie set earlier doesn't affect them.
- Ad HTML pasted directly into an article's markdown body isn't removed (out of scope).
- Non-ad scripts placed in `scripts.*` (e.g. a future CMP banner) would also be removed for these visitors. Documented in the guide.
- Staging already shows only mock ads; mock-ad-fill.js lives in `scripts.body_end` (group `mock-ads`), so it's removed too.
- Visitor already has the cookie and visits again with `?trending`: the cookie is re-set (harmless).

## Test plan

Unit tests (`src/lib/__tests__/no-ads.test.ts`, vitest `unit` project):
1. `hasNoAdsParam`: every row of the trigger table that can be expressed as a URL (true and false cases), including case variants and empty value.
2. `hasNoAdsCookie`: `null` header, unrelated cookies, `atl_noads=1` alone and among other cookies, `atl_noads=0` → false.
3. `stripAds`: placements emptied, interstitial false, all four script positions emptied, `tracking` and other fields deep-equal to input, input object not mutated, config with no `ads_config`/`scripts` handled.
4. `NO_ADS_COOKIE_HEADER`: includes `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, and no `Max-Age`/`Expires`.

Middleware wiring is verified locally (`pnpm dev:worker`, workerd parity) with a site from the `atl`/`mock-ads` groups:
- `/` without param → ads and scripts present, no `Set-Cookie`.
- `/?trending` → no ad slots, no interstitial loader, no head ad scripts; GA/pixel present; `Set-Cookie` and `no-store` present.
- Then click into an article (no param) → still no ads, Server Island responses render no ad divs.
- New browser session → ads return.
- Results and screenshots saved under `docs/test-results/`.

Full `pnpm test` in site-worker plus `pnpm typecheck` and `pnpm build` must pass.

## Rollout

1. Asaf tests locally → approval.
2. Commit on `asaf-dev`, PR via compare URL.
3. After merge: `pnpm deploy:staging`, check, then `pnpm deploy:production`. No KV re-seed, no `grid plug` needed (site-worker only, plus the guide page, which ships with the next dashboard deploy).
4. Production smoke: open a live site with `?trending`, click through two articles, confirm no ad network requests in DevTools.

Rollback: redeploy the previous site-worker version.

## Out of scope

- A secret value for the parameter, or rate limiting abuse.
- Making the `?x=1` / `?agi=1011` workers respect `trending`.
- Tagging individual scripts as "ad" or "non-ad".
- Removing ad HTML embedded in article markdown.
- Dashboard UI or per-site toggle.
- Analytics events marking "ad-free" sessions.
