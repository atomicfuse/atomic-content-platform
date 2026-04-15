# Monetization Flow

A **monetization profile** is a re-usable bundle of everything that earns revenue or tracks users: analytics IDs, ad network scripts, ad placements, and `ads.txt` entries. Profiles live at the network-repo level and are shared by any number of sites — change the profile, every site using it rebuilds with the new config.

## What a Profile Contains

```yaml
# monetization/test-ads.yaml
monetization_id: test-ads
name: "Test Ads (Demo)"
provider: mock        # or "alpha", "google", etc.

tracking:
  ga4: "G-TESTDEMO000"
  gtm: null
  google_ads: null
  facebook_pixel: null
  custom: []

scripts:
  head: []
  body_start: []
  body_end:
    - id: mock-ad-fill
      src: "/mock-ad-fill.js"

scripts_vars: {}

ads_config:
  interstitial: false
  layout: standard
  ad_placements:
    - id: top-banner
      position: above-content
      device: all
      sizes:
        desktop: [[728, 90], [970, 90]]
        mobile:  [[320, 50], [320, 100]]
    - id: in-content-1
      position: after-paragraph-3
      device: all
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile:  [[300, 250]]
    - id: sidebar-sticky
      position: sidebar
      device: desktop
      sizes:
        desktop: [[300, 600], [160, 600], [300, 250]]

ads_txt: []
```

Every profile lives in `monetization/<id>.yaml` on the `main` branch of the network repo. The filename's `<id>` is the canonical profile id and is what sites reference.

## How a Site Picks a Profile

```
site.yaml.monetization  →  org.yaml.default_monetization  →  no monetization
```

Sites can override via `monetization:` in `site.yaml`. If omitted, they inherit `org.default_monetization`. You can always check the effective profile in **Sites → [domain] → Monetization** — the UI shows both the resolved profile and a source badge.

## The `test-ads` Profile (Demo Mode)

`test-ads` is a special built-in profile used for demos, QA, and first-run onboarding. It:

- Renders visible placeholder ad boxes at every placement (via `/mock-ad-fill.js`).
- Loads **no** real ad network scripts — safe for public preview URLs.
- Keeps a single GA4 ID so analytics plumbing can be verified.
- Ships with a standard placement set (top banner, one in-content, sidebar, mobile anchor).

Assign `monetization: test-ads` to any site that shouldn't serve real ads yet. Swap it out for a real profile (`premium-ads`, `standard-ads`, …) when you're ready to go live.

## End-to-End Edit Flow

Editing a profile in the dashboard is a one-click operation. Behind the scenes:

```
Dashboard → /monetization/<id>   (edit form, visual placement preview)
         │
         │  Click "Save"
         ▼
PUT /api/monetization/<id>
         │
         │  1. Serialize form → YAML
         │  2. commitNetworkFiles([{monetization/<id>.yaml}], "config(monetization): update <id>")
         │     → commits to network repo `main`
         │  3. Enumerate Live sites whose effective profile == <id>
         │     (explicit site.monetization OR org.default_monetization)
         │  4. For each Live site:
         │       triggerWorkflowViaPush("main", <domain>)
         │       → touches sites/<domain>/.build-trigger on main
         │
         ▼
GitHub Actions: Deploy Sites workflow fires on main push
         │
         │  - Detect step: CHANGED includes sites/<domain>/.build-trigger
         │    AND monetization/<id>.yaml → site rebuilds
         │  - Also detects sites that reference <id> (explicit or via
         │    org.default_monetization) when only monetization/ changes
         │
         ▼
Astro build  →  Cloudflare Pages deploy to production branch
         │
         ▼
coolnews.dev (live) serves updated tracking, scripts, and ad placements
```

The double detection (explicit build-trigger push from the dashboard + monetization-aware workflow step) is belt-and-suspenders. Manual `git push` of a `monetization/*.yaml` change still triggers the right rebuilds even without going through the dashboard.

## Where Changes Become Visible

| Change | When it shows up |
|--------|------------------|
| Dashboard "Save" on a profile | Within a few minutes — one Astro build + one Cloudflare Pages deploy per affected site |
| Tracking ID edit | Same rebuild cycle — GA4/GTM snippets are baked into `<head>` at build time |
| Ad placement rename / reposition | Same rebuild cycle — structural anchors (`data-slot`) are build-time |
| Ad sizes change | Same rebuild cycle — sizes live inside the inline monetization JSON |
| `ads.txt` entry added | Same rebuild cycle — generated at build time |
| `provider` change | Same rebuild cycle — plus a content change if switching between mock and a real network |

There is no runtime hot-swap. Every edit goes through a full site rebuild because the monetization config is embedded inline at build time (see **Site Builder Flow**).

## Inline Monetization JSON + 4-Tier Fallback

Every built page ships with an inline `window.__ATL_MONETIZATION__` object derived from the profile. This lets `ad-loader.js` run with zero network round-trips. The loader still falls back gracefully if the inline object is missing:

```
Tier 1: window.__ATL_MONETIZATION__   (inline, baked into HTML)
Tier 2: /m/<domain>.json              (same-origin CDN file)
Tier 3: <cdnBase>/m/<domain>.json     (platform CDN)
Tier 4: localStorage._atl_m           (last known good)
```

Tiers 2–4 matter if an old cached HTML is still in circulation or if a user's tab was opened before the new build landed. All four tiers produce the same shape, so the loader code is oblivious to which one answered.

## Ads.txt

`ads.txt` entries stack from every layer (org → monetization → group → site), are deduplicated, and are written to `/ads.txt` at the domain root during the site build. Ad networks that require ads.txt usually publish the exact lines they need — paste them into the monetization profile's `ads_txt:` array once, every site using that profile automatically picks them up.

## Dashboard UI

- **Monetization** (sidebar) — list of profiles with name, provider, tracking summary, placement count, and a quick "Used by N sites" link.
- **Monetization → [id]** — tabbed editor: **General**, **Tracking**, **Scripts**, **Script Vars**, **Ads Config**, **Placements** (with a live mockup preview), **Ads.txt**, plus a "Used by" panel that deep-links to each site's detail page.
- **Monetization → New** — kebab-case id + base template picker.
- **Sites → [domain] → Monetization** — shows the resolved profile for this site, source badge (explicit vs. org default), and a read-only preview of what will render.

Every inherited field in every editor shows a source badge so you can always tell whether a value came from org, monetization, group, or site.
