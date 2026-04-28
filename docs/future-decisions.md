# Future Decisions

Decisions we've explicitly deferred. Revisit when the triggering condition arrives.
Each entry: **what**, **trigger to revisit**, **default if we forget**.

---

## Ad SDK loading strategy — hybrid vs full Server Islands

**Decision context.** During the Phase 4 design (Server Islands for ads + pixels) on 2026-04-23 we chose to put **everything** in Server Islands — the slot markup, the ad-loader script, and any network-specific snippets. This is safe today because `packages/site-builder/public/ad-loader.js` only renders mock ads; there is no ad revenue to protect.

**Why defer the "real SDK" question.** Some ad networks (AdSense, some header-bidding setups, Taboola's `trc_*` loaders, Google Publisher Tags) need their SDK script in the initial HTML (pre-hydration, sometimes pre-DOM-ready) for viewability counting, lazy-load priming, or early auction kickoff. Putting their SDK inside a `server:defer` island delays loading past first paint and can measurably degrade:
- Viewability (SDK isn't there when viewability observer would have started).
- Revenue per mille (late auction start = some bidders time out).
- Prebid.js bid-back rates.

**Revisit when any of these conditions becomes true.**
1. **First real ad network integration commits** (PR touches a non-mock ad network SDK in `packages/site-worker/src/components/AdSlot.astro`, or introduces `trc_*`, `googletag`, `adsense`, `apstag`, `pbjs` symbols).
2. **Cloudflare Web Analytics or a third-party reports a Core Web Vitals regression** coinciding with live-ad enablement (LCP, CLS, INP degraded on article pages).
3. **Ad network's onboarding requires a specific script placement pattern** (e.g. "Add this before your closing `</head>`") that conflicts with island-only loading.

**Revisit action.** Move specific SDK loaders into `BaseLayout.astro` (pre-hydration), keep only per-slot rendering inside Server Islands. This is the "hybrid" pattern originally noted in `migration-plan.md` Q9.

**Default if forgotten.** Keep Server-Island-only. It will work correctly for mock ads indefinitely, and will degrade gracefully for networks that don't care about early load. Fix on the first revenue anomaly — noticeable quickly via the ad-impressions-parity check in Phase 7's post-cutover monitoring.

---

## Per-site article search (Pagefind replacement)

**Decision context.** Current `site-builder` runs `pagefind --site dist` after `astro build`, producing a fully client-side search index from the built HTML. Under Workers with on-demand article rendering, there's no static `dist/` for pagefind to crawl.

**Revisit when.** A user asks for search on a Worker-served site, OR any site's search usage crosses 1% of sessions (check via GA4 `search` event).

**Revisit action.** Choose between:
- Periodic crawler: hourly/daily job builds a pagefind index from KV content and stores it in R2 (or a KV value if small enough). Client fetches index on `/search` like today.
- D1 full-text: SQLite FTS5 with the article corpus; Worker route handles the query. Better for larger corpora.
- Offload to third-party (Algolia, Typesense). Quick but a recurring cost.

**Default if forgotten.** The `/search` route returns a static "Search coming soon" page. Users can still navigate via category listings.

---

## Theme sharing extraction (Phase 2 Step 2b specific)

**Decision context.** Plan Phase 2 extracts `packages/site-builder/themes/modern/` + shared layouts into `packages/site-theme-modern` consumed by both the old and new apps. Risk: Astro 5.7 (`site-builder`) vs Astro 6 (`site-worker`) may have subtle incompatibilities in the extracted component surface.

**Revisit when.** Phase 2 Step 2b finishes OR any Astro-version incompatibility shows up during extraction.

**Revisit action.** If incompatibilities surface, fall back to **duplicating** `themes/modern/` into `site-worker/src/themes/modern/` for the migration window, plan a deduplication pass post-Phase 8.

**Default if forgotten.** Duplication stays; neither app has reason to touch the other's theme until we add a second theme variant, which is itself a follow-up.

---

## Article storage — re-evaluate when corpus grows

**Decision context.** 2026-04-23: chose Option A — markdown-in-repo → synced to KV. Works fine for current ~20 articles per site.

**Revisit when.** Any site crosses **5 000 articles**, OR KV write volume during a full re-sync exceeds the Workers Paid KV write limit in a single CI run, OR content-pipeline's `@atomic-platform/content-pipeline` commit cadence approaches GitHub's rate limits on the network repo.

**Revisit action.** Evaluate the Option B / Option C choice from `migration-plan.md` Q2 (R2 bucket, or D1 with FTS).

**Default if forgotten.** At 5 000 articles per site × N sites, sync times become noticeable but not broken. The trigger for action will be CI workflow duration > 5 minutes for a single-site sync.
