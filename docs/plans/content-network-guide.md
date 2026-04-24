# Content Network on Astro + Cloudflare — A Simple Guide

## What we're building

A content network where:
- **One GitHub repo** holds all sites' configuration (monetization, pixels, template choice) and optionally content
- **One Astro app** renders all sites
- **Cloudflare** hosts everything — static where possible, dynamic where needed
- **Changing a site's template or monetization requires zero rebuild** — just a config update

The goal: treat each site as **data**, not code. Sites differ by config, not by codebase.

---

## The core concept

Three questions drive the architecture:

| Question | Answer |
|---|---|
| Where does the site's identity come from? | The **hostname** of the incoming request |
| Where does the site's config live? | A **config file in GitHub** (source of truth), mirrored to **Cloudflare KV** (runtime lookup) |
| What runs at build time vs. request time? | Article shells are **cached at the edge**. Monetization and template decisions happen **per request** via Astro Server Islands. |

This lets us change monetization layout or switch templates by updating config — the cached article body stays warm, only the dynamic bits re-render.

---

## The key Astro + Cloudflare primitives we use

**Astro Server Islands** — components marked with `server:defer` render on every request, even inside statically cached pages. This is how monetization stays fresh without invalidating article cache.

**Astro Middleware** — runs on every request, resolves hostname → siteId → config. This is how one app serves many sites.

**Astro hybrid rendering** — most pages are static HTML cached at the edge; specific routes (`prerender = false`) render on demand through a Worker. We get static performance for content and dynamic flexibility for config-driven layout.

**Cloudflare Workers + Pages** — static assets served from edge cache, Worker handles dynamic routes and server island fragments. One deployment.

**Cloudflare KV** — per-site config (template choice, monetization layout, pixels) lives here. Reads are edge-local and fast (~5-10ms).

**GitHub as source of truth** — all configs live in the repo. A CI pipeline syncs them to KV on merge. Humans edit in GitHub, runtime reads from KV.

---

## The repo structure

```
content-network/
├── sites/                          ← source of truth for all sites
│   ├── tech-daily/
│   │   ├── site.json               ← identity, domain, locale
│   │   ├── template.json           ← which template + theme
│   │   ├── monetization.json       ← ad positions, provider
│   │   └── pixels.json             ← analytics, tracking
│   ├── lifestyle-hub/
│   │   ├── site.json
│   │   ├── template.json
│   │   ├── monetization.json
│   │   └── pixels.json
│   └── finance-weekly/
│       └── ...
│
├── app/                            ← the single Astro app
│   ├── src/
│   │   ├── middleware.ts
│   │   ├── config/
│   │   │   └── loaders.ts          ← KV readers
│   │   ├── components/
│   │   │   ├── AdSlot.astro        ← server island
│   │   │   ├── PixelLoader.astro   ← server island
│   │   │   └── templates/
│   │   │       ├── EditorialLayout.astro
│   │   │       ├── MagazineLayout.astro
│   │   │       └── LongFormLayout.astro
│   │   └── pages/
│   │       └── articles/[slug].astro
│   ├── astro.config.mjs
│   └── wrangler.toml
│
└── scripts/
    └── sync-to-kv.ts               ← CI: reads sites/*/*.json, writes to KV
```

**Why this layout:** humans work in `sites/` via pull requests. The Astro app in `app/` reads from KV at runtime, never from the filesystem. This separation means adding a site is a PR, not a deploy.

---

## Example config files (in GitHub)

**`sites/tech-daily/site.json`**
```json
{
  "siteId": "tech-daily",
  "hostname": "tech.yournetwork.com",
  "name": "Tech Daily",
  "locale": "en-US",
  "contentSource": "tech"
}
```

**`sites/tech-daily/template.json`**
```json
{
  "template": "magazine",
  "theme": {
    "primaryColor": "#0066cc",
    "fontFamily": "Inter"
  }
}
```

**`sites/tech-daily/monetization.json`**
```json
{
  "provider": "adsense",
  "layouts": {
    "article": {
      "header": true,
      "afterParagraph": 3,
      "sidebar": true,
      "footer": false
    },
    "category": {
      "header": true,
      "afterParagraph": null,
      "sidebar": true,
      "footer": true
    },
    "homepage": {
      "header": false,
      "afterParagraph": null,
      "sidebar": false,
      "footer": true
    }
  }
}
```

Note the **per-page-type monetization**: article pages, category pages, and the homepage can each have a different ad layout. This is one of the main things the server island pattern enables cleanly.

**`sites/tech-daily/pixels.json`**
```json
{
  "googleAnalytics": "G-XXXXXXXX",
  "metaPixel": "123456789",
  "customPixels": []
}
```

---

## Step-by-step: how it works at request time

### Request comes in: `https://tech.yournetwork.com/articles/gpu-benchmarks`

**Step 1 — Middleware resolves the site**
```typescript
// src/middleware.ts
export const onRequest = defineMiddleware(async (context, next) => {
  const hostname = context.url.hostname;
  const site = await context.locals.runtime.env.CONFIG_KV
    .get(`site:${hostname}`, 'json');
  context.locals.site = site;
  return next();
});
```

**Step 2 — Page loads configs in parallel**
```typescript
// inside [slug].astro or the layout
const site = Astro.locals.site;
const env = Astro.locals.runtime.env;

const [template, monetization, pixels] = await Promise.all([
  env.CONFIG_KV.get(`template:${site.siteId}`, 'json'),
  env.CONFIG_KV.get(`monetization:${site.siteId}`, 'json'),
  env.CONFIG_KV.get(`pixels:${site.siteId}`, 'json'),
]);
```

**Step 3 — Template router picks the layout**
```astro
---
const TemplateComponent = {
  editorial: EditorialLayout,
  magazine: MagazineLayout,
  longform: LongFormLayout,
}[template.template];

// Pick the right monetization layout for this page type
const monetizationForPage = monetization.layouts.article;
---

<TemplateComponent 
  article={article}
  monetization={monetizationForPage}
  theme={template.theme}
/>
```

**Step 4 — Template places ad slots based on monetization config**
```astro
---
// MagazineLayout.astro
const { article, monetization } = Astro.props;
---

{monetization.header && (
  <AdSlot position="header" server:defer />
)}

<article>
  {article.paragraphs.map((p, i) => (
    <>
      <p>{p}</p>
      {monetization.afterParagraph === i + 1 && (
        <AdSlot position="inline" server:defer />
      )}
    </>
  ))}
</article>

{monetization.sidebar && (
  <aside><AdSlot position="sidebar" server:defer /></aside>
)}
```

**Step 5 — Cloudflare caches the HTML shell**
- Article body + layout structure cached at edge for 1 hour
- Server island fragments (`AdSlot`) render per request

**Step 6 — Server islands render ads fresh on every request**
- Ad slot fetches latest monetization config from KV
- Applies geo-targeting from `cf-ipcountry` header
- Returns HTML fragment, browser slots it in

---

## Step-by-step: how you make changes

### Change 1: Add a new article

```bash
# Content flows into your content source (D1, Sanity, Contentful, markdown, etc.)
# NO GitHub change needed for content itself
# NO rebuild
```

First request to the new URL renders via Worker and caches. Done.

---

### Change 2: Switch tech-daily from magazine to longform template

**In GitHub:**
```diff
  // sites/tech-daily/template.json
  {
-   "template": "magazine",
+   "template": "longform",
    "theme": { ... }
  }
```

**On merge, CI runs `sync-to-kv.ts`:**
```typescript
// scripts/sync-to-kv.ts
import { readFile } from 'fs/promises';

for (const siteDir of sitesChanged) {
  const template = JSON.parse(await readFile(`sites/${siteDir}/template.json`));
  await wrangler.kv.put(`template:${siteDir}`, JSON.stringify(template));
}

// Purge cached HTML for that hostname
await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ hosts: ['tech.yournetwork.com'] }),
});
```

No Astro rebuild. No redeploy. Next request to tech.yournetwork.com renders with longform template.

---

### Change 3: Move the ad from header to footer on article pages

**In GitHub:**
```diff
  // sites/tech-daily/monetization.json
  {
    "provider": "adsense",
    "layouts": {
      "article": {
-       "header": true,
+       "header": false,
        "afterParagraph": 3,
        "sidebar": true,
-       "footer": false
+       "footer": true
      }
    }
  }
```

**On merge, CI writes to KV. No cache purge needed** — server islands read the new config on the very next request. Article HTML shells stay cached.

This is the magic moment: **the cache stays warm, only the ad layout changes**. On a 100K-article site, this is the difference between seconds and hours.

---

### Change 4: Add a new site to the network

**In GitHub:**
```bash
mkdir sites/gaming-news
# create site.json, template.json, monetization.json, pixels.json
```

**DNS:** Point `gaming.yournetwork.com` → Cloudflare.

**CI** syncs the new configs to KV. 

No Astro rebuild. First request to the new hostname resolves via middleware → new siteId → renders. Done.

---

## What triggers a rebuild vs. what doesn't

| Change | Rebuild? | Why |
|---|---|---|
| Add / edit article content | ❌ | On-demand rendering |
| Change monetization layout | ❌ | KV + server islands |
| Switch template (existing one) | ❌ | KV + cache purge |
| Update pixels / analytics | ❌ | KV + server islands |
| Add a new site | ❌ | KV + DNS only |
| Add a **new template variant** (code) | ✅ | Astro build needed |
| Add a **new page type** (code) | ✅ | Astro build needed |
| Change a shared component | ✅ | Astro build needed |

The test: **is the change data or code?** Data = KV update. Code = rebuild and deploy.

---

## Why this design works for 10K → 100K article sites

1. **Build time stays bounded.** The Astro app builds in minutes regardless of article count because articles aren't statically generated — they render on demand.

2. **Cache does the heavy lifting.** 95%+ of traffic hits Cloudflare's edge cache, never touching the Worker.

3. **Config changes are cheap.** Server islands mean we can refresh dynamic bits without invalidating static content. One-character config change doesn't purge 100K HTML files.

4. **Source of truth is Git.** Every config change is a PR — reviewable, reversible, auditable. KV is a runtime mirror, not a source of truth.

5. **Per-page-type monetization works naturally.** Because the monetization config is keyed by page type (`article`, `category`, `homepage`), each template just reads the right slice and places its server islands accordingly.

---

## Summary: the mental model

```
GitHub repo  ──(CI sync)──>  Cloudflare KV  ──(request)──>  Astro Worker
    │                              │                              │
    │                              │                              │
 source of                     runtime store                  picks template,
  truth                      (edge-local reads)            renders shell,
                                                           defers ad slots
                                                                   │
                                                                   ▼
                                                          Cloudflare edge cache
                                                          (HTML shells) +
                                                          Server Islands
                                                          (live ads/pixels)
```

Humans edit JSON in GitHub. Machines serve billions of requests from cache. Dynamic bits stay fresh via server islands. Nothing needs a full rebuild except actual code changes.
