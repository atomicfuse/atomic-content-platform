# Site Builder Flow

The site builder turns network-repo YAML + markdown into a deployable static site. The pipeline has two phases — **build time** (Astro, runs in CI) and **runtime** (browser, runs on every visit) — and the split is deliberate. Config that must be right from first paint is baked into HTML. Anything that can wait a few frames is handled by a lightweight runtime loader.

## Inputs

```
atomic-labs-network (data repo)            atomic-content-platform (code repo)
───────────────────────────────            ──────────────────────────────────────
network.yaml                               packages/site-builder   (Astro app)
org.yaml                                   packages/shared-types   (interfaces)
monetization/<id>.yaml
groups/<id>.yaml
sites/<domain>/site.yaml
sites/<domain>/articles/*.md
sites/<domain>/assets/**
overrides/<domain>/<page>.yaml
```

Both repos are checked out by the GitHub Actions workflow. The builder reads from whichever network-repo branch fired the workflow (main → production, `staging/<domain>` → preview).

## End-to-End Pipeline

```
network repo commit (main or staging/<domain>)
        │
        ▼
GitHub Actions: Deploy Sites workflow
        │
        │  paths filter matches:
        │    sites/**, groups/**, monetization/**, overrides/**,
        │    org.yaml, network.yaml
        │
        ▼
detect job — for each site in sites/*/, decide "rebuild?"
        │
        │   Build triggers per site:
        │     • sites/<domain>/** changed     → rebuild that site
        │     • overrides/<domain>/** changed → rebuild that site
        │     • org.yaml changed              → rebuild all sites
        │     • network.yaml changed          → rebuild all sites
        │     • groups/<group>.yaml changed   → rebuild sites in that group
        │     • monetization/<id>.yaml changed → rebuild sites using that profile
        │                                        (explicit or via org default)
        │
        ▼
deploy job (matrix, one per site)
        │
        ├── resolve-config.ts
        │     merges org → monetization → group → site
        │     resolves {{placeholders}}, normalizes sizes, dedups ads.txt
        │     → ResolvedConfig (single JSON)
        │
        ├── generate-monetization-json.ts
        │     extracts runtime-only fields from ResolvedConfig
        │     → dist/m/<domain>.json    (same-origin fallback)
        │
        ├── generate-ads-txt.ts
        │     writes the cascaded + dedup ads.txt
        │     → dist/ads.txt
        │
        ├── Astro build
        │     pages, layouts, components (see "Build Time" below)
        │     → dist/**/*.html + dist/_astro/**
        │
        ▼
wrangler pages deploy dist --project-name=<domain> --branch=<ref>
        │
        ▼
Cloudflare Pages  →  production URL (if main) or preview URL (if staging/)
```

## Build Time (Astro)

Build time is where everything that must be right from first paint gets baked in. The Astro layer produces **no** ad divs, **no** ad network scripts, and **no** runtime monetization logic. What it does produce:

| Output | Source | Why build-time |
|--------|--------|----------------|
| Theme colors as CSS variables on `<html>` | `ResolvedConfig.theme` | Colors must be available before first paint |
| Fonts (`<link>` preload + `@font-face`) | `ResolvedConfig.theme` | Same — avoid FOUT |
| Inline GA4 / GTM snippet in `<head>` | `ResolvedConfig.tracking.ga4`, `.gtm` | Analytics must start counting from first byte |
| `window.__ATL_MONETIZATION__` inline | `ResolvedConfig.monetizationJson` | Lets ad-loader work with zero network round-trips |
| `data-p-index` on every `<p>` inside the article | `ArticleLayout.astro` | Needed to anchor in-content ads to specific paragraphs |
| `data-slot="<id>"` structural anchors | Ad placements from resolved config | Tells ad-loader where to inject ad divs |
| `data-ad-placeholder` reserved boxes with fixed heights | Placement sizes | Prevents CLS when ads load in |
| `/ads.txt` at domain root | Cascaded + dedup ads.txt entries | Required by ad network policies |
| Static article HTML, sitemap, RSS, OG images | Markdown + templates | Standard static-site output |

The one thing Astro does **not** output: anything ad-network specific. No `data-ad-id`, no `data-sizes-desktop`, no `class="ad-slot"`, no `<script src="gpt.js">`. Those all come from the runtime layer. This separation means switching ad providers or adjusting sizes never needs a code change to the Astro templates.

### Inline Monetization JSON

`BaseLayout.astro` reads `monetizationJson` from the resolved config and emits it inline (XSS-safe) in the `<head>`:

```html
<script>
  window.__ATL_MONETIZATION__ = {"domain":"coolnews-atl","monetization_id":"test-ads", ... };
</script>
<script src="/ad-loader.js" defer></script>
```

The inline object is the **single source of truth** for the runtime. The separate `/m/<domain>.json` file and CDN mirror exist only as fallbacks (see below).

## Runtime (Browser)

The runtime is a small vanilla JS script — `ad-loader.js` — served from the site origin. It runs on every page load.

```
ad-loader.js boots
        │
        ▼
Resolve monetization config — 4-tier fallback
   Tier 1: window.__ATL_MONETIZATION__           ← inline (normal path)
   Tier 2: fetch /m/<domain>.json                ← same-origin static file
   Tier 3: fetch <cdnBase>/m/<domain>.json       ← platform CDN
   Tier 4: JSON.parse(localStorage._atl_m)       ← last known good
        │
        ▼
For every <ad-placeholder> anchor in the page:
        │
        ├── match placement by id (placement id === data-slot)
        ├── check device filter (desktop / mobile / all) vs current viewport
        ├── create an <ins class="ad-container"> with proper min-height (CLS safe)
        └── hand off to provider plugin:
              • provider=mock    → mock-ad-fill.js paints a placeholder box
              • provider=alpha   → alpha-ads.js   (real network SDK)
              • provider=google  → gpt.js         (real network SDK)
        │
        ▼
Provider plugin requests creatives and renders into the prepared container
```

Because the placeholders are reserved at build time with the correct heights, filling them later is visually seamless — no layout shift, no "pop-in".

### Why `test-ads` Is Useful

`test-ads` uses `provider: mock`, which means `ad-loader.js` hands off to `mock-ad-fill.js`. That script paints a visible labeled box at every placement ("320x50 mobile anchor", "336x280 in-content #1", …) so you can verify placement logic end-to-end without a real ad network. Flip the site's `monetization:` field to a real profile and the same HTML structurally just works — only the runtime provider swaps.

## What Triggers What

Most changes produce a targeted rebuild. A few touch every site.

| Change | Rebuild scope |
|--------|---------------|
| Edit an article (`sites/<domain>/articles/*.md`) | That one site |
| Edit `sites/<domain>/site.yaml` | That one site |
| Edit `overrides/<domain>/...` | That one site |
| Edit `groups/<id>.yaml` | All sites in that group |
| Edit `monetization/<id>.yaml` | All sites whose effective profile == `<id>` |
| Edit `org.yaml` | All sites |
| Edit `network.yaml` | All sites |
| Touch `sites/<domain>/.build-trigger` | That one site (used by the dashboard as an explicit "rebuild me" signal) |

Rebuilds are fast because the site is static. There is no per-article regeneration step — a config change that affects visuals only re-runs Astro with the same markdown inputs.

## Deploy Topology

Each site maps to its own Cloudflare Pages project. The wrangler step:

```
PROJECT=<domain with dots → dashes>
BRANCH=<the branch that fired the workflow>
wrangler pages deploy dist --project-name=$PROJECT --branch=$BRANCH
```

- Push to `main` → deploys to the Pages project's production branch → the custom domain (e.g. `coolnews.dev`).
- Push to `staging/<domain>` → deploys to a preview branch → the Pages preview URL (e.g. `staging-coolnews-atl.coolnews-atl.pages.dev`).

Monetization profile YAMLs live on `main` only. Staging builds read whatever snapshot exists on the staging branch, so live rebuilds always reflect the latest dashboard edit while staging is insulated until you explicitly sync.

## Debugging a Build

Common questions and where to look:

| Question | Where to look |
|----------|---------------|
| "Did my change trigger a workflow?" | GitHub → Actions → Deploy Sites — filter by commit SHA |
| "Did the detect step pick my site?" | The workflow log prints `→ Will build: <site>` per site that matched |
| "What does the resolved config look like?" | Run `pnpm build` locally with `SITE_DOMAIN=<domain> NETWORK_DATA_PATH=...` — intermediate resolved JSON is logged |
| "Are my ads actually inline?" | View source on the built page — search for `__ATL_MONETIZATION__` |
| "Is the runtime loader picking them up?" | Browser DevTools → Console — `ad-loader.js` logs which tier supplied the config |
| "Is the site still on the old config?" | Check the build SHA shown in the Pages deployment — compare with the monetization commit |

See **Config Inheritance & Groups** for the upstream merge rules and **Monetization Flow** for the dashboard-level edit path.
