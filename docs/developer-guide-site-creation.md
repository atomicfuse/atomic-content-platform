# Developer Guide — Site Creation Flow

> Everything a new developer needs to understand, debug, and modify the new-site wizard.
> Last verified: 2026-04-30 against code as of 2026-04-28.
> Stack: Next.js 15 App Router, React 19, TypeScript strict.

## What this document covers

The end-to-end path from "user clicks + New Site" to "live preview iframe in the wizard." Includes:

- **Architecture** — the two-repo / two-flow split between code (Astro app) and data (network YAML), and how the Worker bridges them
- **Sync vs async** — the three operational layers (browser UX, server action, CI + polling) and why each is shaped the way it is
- The 7 wizard steps (which are pure UI / which fire backend work)
- The single server action that does ~95% of the heavy lifting
- All the GitHub + Cloudflare API helpers it calls
- The post-wizard steps that take a site to production

Read this top-to-bottom on your first pass — the order matters. **Architecture** before **sync/async** before the code walk-through. After that, use it as a lookup — every section has the file path so you can jump straight to the code.

---

## High-level mental model

```
WIZARD UI (client)                       SERVER ACTION                 GITHUB                CI                  CLOUDFLARE
─────────────────                       ─────────────                  ──────                ──                  ──────────
Steps 0-4:   pure useState
             (no network)

Step 5: ─click "Deploy Staging"─►  createSiteAndBuildStaging
                                   ├─ build site.yaml
                                   ├─ Gemini logo (optional)
                                   ├─ git: createBranch          ────► staging/<slug>
                                   ├─ git: commitSiteFiles       ────► commit (Git Data API)
                                   ├─ git: triggerWorkflowViaPush───► .build-trigger ───►  sync-kv.yml fires
                                   ├─ git: addSitesToIndex       ────► dashboard-index.yaml         │
                                   └─ return preview URL                                            └─ pnpm seed:kv ────► KV staging + R2 staging
                                                                                                                                  │
            ◄──── poll every 5s, max 120s, until middleware stops returning 404 ───────────────────────────────────────────────────┘
            
Step 6: informational summary, no backend.

After wizard (separate user actions on Site Detail page):
- attachCustomDomain  →  CF API ───►  Worker custom domain registered + DNS auto-created
- goLive              →  git: merge staging → main  ────►  sync-kv.yml fires on main  ───►  KV prod + R2 prod
```

---

## Architecture — Astro, Git, and the Worker

> Read this BEFORE Part 0. The async model only makes sense once you've internalized the two-repo / two-flow split below.

### The single most important insight

There are **two separate things** that both happen to live in git, and most newcomers confuse them:

```
┌─────────────────────────────────────┐         ┌─────────────────────────────────────┐
│  CODE (the engine)                  │         │  DATA (what the engine renders)     │
│                                     │         │                                     │
│  Repo: atomic-content-platform      │         │  Repo: atomic-labs-network          │
│  Path: packages/site-worker/        │         │  Path: sites/, org.yaml, groups/    │
│                                     │         │                                     │
│  This is the Astro app.             │         │  This is YAML + Markdown content.   │
│                                     │         │                                     │
│  Build: `pnpm build` (Astro compiles)│        │  Build: NONE — it's just data       │
│  Deploy: `pnpm deploy:production`   │         │  "Deploy": sync-kv.yml writes to KV │
│  Frequency: weekly-ish (devs)       │         │  Frequency: daily (editors)         │
└─────────────────────────────────────┘         └─────────────────────────────────────┘
                  │                                                 │
                  │ deploys to                                      │ writes to
                  ▼                                                 ▼
        ┌─────────────────────┐                            ┌─────────────────────┐
        │  Cloudflare Worker  │ ◄──── reads at request ──── │  Cloudflare KV + R2 │
        │  atomic-site-worker │                            │                     │
        └─────────────────────┘                            └─────────────────────┘
                  │
                  │ serves
                  ▼
              The user
```

**The wizard creates DATA, not CODE.** It commits `site.yaml` to the network repo. It doesn't touch the Astro app, doesn't trigger a build, doesn't redeploy the Worker. The same Worker that's already running picks up the new site on the next request because it reads everything from KV.

That's why a new site is live in ~60 seconds without a build step.

### What Astro actually does

Astro is the framework that builds the Worker. It runs **once at build time** to produce the `_worker.js` file that Cloudflare runs. After that, the Astro framework is "compiled away" — Cloudflare just runs the JavaScript output.

#### Build time (`pnpm build` in `packages/site-worker/`)

```
         ┌──────────────────────────────────────┐
INPUT:   │  packages/site-worker/src/           │
         │  ├── pages/                          │
         │  │   ├── index.astro      ← homepage │
         │  │   ├── [slug]/          ← article  │
         │  │   ├── [siteId]/assets/ ← R2 route │
         │  │   ├── api/             ← /_ping   │
         │  │   └── category/                   │
         │  ├── middleware.ts        ← runs on  │
         │  ├── layouts/                  every │
         │  ├── components/              request│
         │  ├── themes/modern/                  │
         │  └── lib/                            │
         └──────────────────────────────────────┘
                          │
                          ▼  astro build
                          │  (compiles .astro → JS,
                          │   bundles, minifies)
                          ▼
         ┌──────────────────────────────────────┐
OUTPUT:  │  dist/                                │
         │  ├── server/                          │
         │  │   ├── _worker.js   ← THE bundle    │
         │  │   │                  Cloudflare    │
         │  │   │                  runs this     │
         │  │   ├── wrangler.json                │
         │  │   ├── wrangler.staging.json        │
         │  │   └── wrangler.production.json     │
         │  └── client/                          │
         │      ├── _astro/      ← hashed CSS/JS │
         │      ├── mock-ad-fill.js              │
         │      └── placeholder.svg              │
         └──────────────────────────────────────┘
```

Then the post-build script `emit-env-configs.ts` reads `wrangler.json` and produces per-env variants with the right KV namespace IDs, R2 bucket names, and custom-domain routes baked in.

#### Deploy time (`wrangler deploy`)

```
     dist/server/_worker.js  ─┐
     dist/server/wrangler.   │  wrangler deploy
       production.json       │  ─────────────►   Cloudflare API
     dist/client/* (assets) ─┘                  uploads code + config
                                                + claims any custom_domain
                                                routes in the wrangler.json
```

After this, the new code is running globally on Cloudflare's edge. **The Worker now handles every request** for `coolnews.dev/*` (and any other custom domains in the routes config) until the next deploy.

#### Request time — runtime

Astro is in `output: 'server'` mode (`astro.config.mjs`), so **every page renders fresh on every request**. There are no pre-built per-site HTML files anywhere.

```
   GET coolnews.dev/some-article          ◄──── browser
                │
                ▼
   Cloudflare edge (closest POP)
                │
                ▼
   Worker startup (cold ~30ms, warm ~0ms)
                │
                ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  src/middleware.ts                                             │
   │  ───────────────                                               │
   │   1. Check if /_ping → respond "ok" + bail                     │
   │   2. Check if path matches /<siteId>/assets/* → R2 endpoint    │
   │   3. Read KV: site:coolnews.dev → {siteId: "coolnews-atl"}     │
   │   4. Read KV: site-config:coolnews-atl → ResolvedConfig object │
   │   5. Set Astro.locals.site = { siteId, hostname, config }      │
   │   6. Pass to next() ──────────────────────────────────────────►│
   │                                                                │
   │  src/pages/[slug]/index.astro    (or index.astro for /)        │
   │  ──────────────────────────                                    │
   │   const config = getConfig(Astro);  // from locals             │
   │   const siteId = getSiteId(Astro);                             │
   │                                                                │
   │   // KV read: pull the article body                            │
   │   const article = await env.CONFIG_KV.get(                     │
   │     `article:${siteId}:${slug}`, 'json');                      │
   │                                                                │
   │   // Astro renders the .astro template into HTML               │
   │   return <BaseLayout>...                                       │
   │                                                                │
   │  middleware post-handler                                       │
   │  ──────────────────────                                        │
   │   apply cache-control header per route class                   │
   │   set preview cookie if applicable                             │
   └────────────────────────────────────────────────────────────────┘
                │
                ▼
   HTML response back to browser
```

**Notice what's NOT happening:**
- No file system reads (it's a Worker, no disk)
- No git access (Worker doesn't know git exists)
- No build (the build happened weeks ago, possibly)
- No per-site code path (the same `[slug].astro` handles every site's article pages)

The only thing that's per-site is the **data in KV**, which the Astro components read at render time.

### Concrete: what's inside an Astro page

The homepage (`src/pages/index.astro`) — actual code:

```astro
---
export const prerender = false;  // SSR every request, never pre-build

import BaseLayout from '../layouts/BaseLayout.astro';
import { env } from 'cloudflare:workers';     // ← Cloudflare runtime
import { getConfig, getSiteId } from '../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../lib/kv-schema';

// These come from middleware via Astro.locals
const config = getConfig(Astro);
const siteId = getSiteId(Astro);

// Pull article list from KV. This is the runtime read.
const allArticles =
  (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];

const visible = allArticles
  .filter((a) => isVisibleArticle(a.status))
  .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());
---

<BaseLayout config={config}>
  <Header config={config} />
  <HeroGrid articles={visible.slice(0, 4)} />
  <ArticleFeed articles={visible} />
  <Footer config={config} />
</BaseLayout>
```

**Three things to notice:**

1. `prerender = false` — tells Astro "don't pre-build this page, render it for every request."
2. `env.CONFIG_KV.get(...)` — that's a Cloudflare KV read. It's the only "I/O" in the page.
3. `<BaseLayout config={config}>` — Astro components compose the page. The components are compiled into JS at build time; they're NOT re-fetched per request. Only the data is.

### Why creating a site doesn't redeploy the Worker

When the wizard runs:

| Step | What changes | Does the Worker need redeploying? |
|---|---|---|
| `createBranch staging/<slug>` | New git branch in network repo | No |
| `commitSiteFiles` (site.yaml, logo, ...) | New files in network repo | No |
| `triggerWorkflowViaPush` | sync-kv.yml fires | No |
| `seed-kv.ts` runs in CI | New KV keys + R2 objects | No |
| Worker handles next request to that hostname | Reads new KV keys | No (reads on every request anyway) |
| `attachCustomDomain` | CF runtime route added | Technically no, BUT see [the known drift bug](#-known-gap-source-of-truth-drift) — next code-deploy may strip the route if not added to `emit-env-configs.ts` |

Compare to the legacy Pages flow we retired in Phase 8: every site change triggered a full Astro build + Pages deploy per site. 50 sites = 50 builds. New article in site X = rebuild site X. **All gone.**

### When you DO need to redeploy the Worker

Three scenarios, all developer-facing (not editorial):

1. **You changed Astro page code.** Edited `src/pages/index.astro` to change the homepage layout, added a new component, changed middleware logic. → `pnpm deploy:production`.
2. **You changed the data shape.** Added a new field to `ResolvedConfig` that pages read. → both update `shared-types` AND redeploy the Worker so it knows about the new field.
3. **You added a new custom domain via `attachCustomDomain`.** Currently the runtime API call works immediately, but `emit-env-configs.ts` doesn't know — next deploy may strip the domain. So for now: also commit the route to `emit-env-configs.ts` and redeploy. (See the [known drift bug](#-known-gap-source-of-truth-drift) in Part 5.)

For everything else — new site, new article, edited config, new theme color — **no redeploy needed.** That's the architecture working as designed.

### File map: Astro app vs. data

```
atomic-content-platform/                 ← THE CODE
└── packages/site-worker/
    ├── astro.config.mjs                 Astro framework config (output: 'server')
    ├── wrangler.toml                    Cloudflare bindings (KV/R2/routes)
    ├── src/
    │   ├── middleware.ts                Runs on every request: hostname → KV → config
    │   ├── pages/
    │   │   ├── index.astro              Homepage (per-request SSR)
    │   │   ├── [slug]/index.astro       Article page (per-request SSR)
    │   │   ├── [siteId]/assets/[...].ts R2 asset endpoint
    │   │   ├── api/_ping.ts             Health check
    │   │   └── category/[topic]/        Category pages
    │   ├── layouts/                     BaseLayout, ArticleLayout, etc.
    │   ├── components/                  AdSlot, SEOHead, etc.
    │   ├── themes/modern/               Theme components (Header, Footer, HeroGrid)
    │   ├── lib/
    │   │   ├── kv-schema.ts             KV key naming convention
    │   │   ├── config.ts                Astro.locals helpers
    │   │   └── preview-override.ts      ?_atl_site= handling
    │   └── shared-pages/                about.md, privacy.md templates
    └── scripts/
        ├── seed-kv.ts                   Reads network repo → writes KV/R2 (run by CI)
        └── emit-env-configs.ts          Post-build: per-env wrangler.json

atomic-labs-network/                     ← THE DATA
├── org.yaml                             Network-wide defaults (tracking, ads, theme)
├── groups/<id>.yaml                     Group config layers
├── overrides/config/<id>.yaml           Targeted exception layers
├── sites/
│   └── <slug>/
│       ├── site.yaml                    Per-site config (created by wizard)
│       ├── articles/<slug>.md           Articles (created by content-pipeline)
│       └── assets/<file>                Images (uploaded by wizard / pipeline)
├── dashboard-index.yaml                 Master site list
└── .github/workflows/sync-kv.yml        CI that bridges DATA → KV/R2
```

When you're debugging:
- "The site is showing wrong content / no article" → look in DATA (KV, network repo).
- "The site layout is broken / missing component" → look in CODE (Astro pages, deployed Worker).
- "New site missing from dashboard" → look at DATA (`dashboard-index.yaml`).
- "Site looks weird in production but fine in `pnpm dev`" → mismatch between deployed Worker and current code — check what's deployed (`wrangler deployments list`).

### Summary in one sentence

**The Worker is a pre-built Astro app that reads per-request data from KV; the wizard adds data to KV; that's why creating sites doesn't need a build.**

---

## Part 0 — Sync vs async: the mental model

This is the most misunderstood part of the codebase. The wizard *looks* like one click that takes a minute, but underneath there are **three different layers of sync/async**, and confusing them is the #1 source of bugs in this code.

### The three layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1 — Browser UX                                                    │
│   The user clicks "Deploy Staging" and waits ~30–60s for an iframe.    │
│   To them, it's one async operation.                                   │
└──────┬──────────────────────────────────────────────────────────────────┘
       │
       ▼   The "wait" is actually two distinct sub-phases:
       │
┌──────┴──────────────────────────────────┐    ┌────────────────────────────┐
│ Layer 2 — Server action (~3–15s)        │ →  │ Layer 3 — CI + polling     │
│   `createSiteAndBuildStaging`           │    │   (~25–55s after L2)       │
│   Sequential async I/O orchestration.   │    │   GitHub Actions runs      │
│   Awaited as one Promise from client.   │    │   independently;           │
│   `await` chain inside.                 │    │   browser polls Worker.    │
└─────────────────────────────────────────┘    └────────────────────────────┘
```

### Layer 1 — Browser perspective: one async operation

From the user's chair, **"Deploy Staging" is a single async action**. They click → spinner → eventually iframe. They can't do anything else in that window.

That's a deliberate UX choice: site creation is a one-shot operation where partial state is meaningless. There's no value in letting the user navigate away mid-flow.

If you ever need to make this **truly background** (so the user can do other things while waiting), see "Recommendations" at the end of this section. It's a real refactor, not a tweak.

### Layer 2 — Server action: sequential awaits

`createSiteAndBuildStaging` is what Next.js calls a "server action" — a function that runs on the server and is awaited from the client like a regular `async` call. Inside it, **every I/O call is async at the network level, but they're chained sequentially with `await`**:

```ts
// services/dashboard/src/actions/wizard.ts:93 — pseudocode of the timing
async function createSiteAndBuildStaging(data) {
  /* T+0s    */ await fetch(AGGREGATOR_URL/...);          // ~200ms (optional)
  /* T+0.2s  */ logoBuffer = await generateLogoWithGemini(...);  // ~5–10s ← dominant
  /* T+10s   */ await createBranch(stagingBranch);        // ~300ms
  /* T+10.3s */ await commitSiteFiles(...);               // ~1–2s
  /* T+12s   */ await triggerWorkflowViaPush(...);        // ~500ms
  /* T+12.5s */ await addSitesToIndex([siteEntry]);       // ~500ms
  /* T+13s   */ return { stagingUrl, siteFolder };        // returns to client
}
```

**Why sequential and not parallel?** Two reasons:
1. **Data dependencies.** You can't `commitSiteFiles` until `createBranch` succeeded — they need a real branch ref. You can't `triggerWorkflowViaPush` until the commit landed — the trigger references files in that commit. The chain is enforced by the dependency graph, not by code style.
2. **Error isolation.** Sequential `await` makes "if step N throws, steps N+1...M didn't run" trivially true. If you ran them in parallel and one failed mid-flight, you'd be cleaning up partial state in `Promise.allSettled` handlers. Easy to get wrong; not worth the ~500ms savings.

**The two steps that COULD parallelize but don't:**
- `generateLogoWithGemini` (5–10s) and the niche-bundle fetch (~200ms) are independent. Running them in `Promise.all` would shave ~200ms. **Not worth the readability cost** for a one-shot UX.
- `addSitesToIndex` (writes dashboard-index.yaml) doesn't depend on `triggerWorkflowViaPush`. Could parallelize the last two steps for ~500ms. **Same trade-off** — readability beats marginal latency.

**The blob uploads INSIDE `commitSiteFiles` ARE parallelized** (`Promise.all` over `octokit.git.createBlob`). That's the only place parallelism is worth the cost — uploading 5+ files serially would actually be noticeable.

### Layer 3 — CI + polling: true async / decoupled

After `triggerWorkflowViaPush` writes the `.build-trigger` file, two things happen **in parallel** with no further coordination:

```
SERVER (Next.js)              GITHUB                  CI (Actions)        DASHBOARD (browser)
                              ──────                  ────────────        ──────────────────
                                                                          
server action                 sees a push event      sync-kv.yml fires
returns to client             on staging/<slug>      ├── detect job (~5s)
                                                     ├── matrix runs:
                                                     │   pnpm seed:kv     polling: HEAD <url> every 5s
                                                     │   ├─ R2 upload       → 404 (KV not seeded yet)
                                                     │   └─ KV bulk put     → 404
                                                     │                     → 404
                                                     │   (~30–60s total)
                                                     │
                                                     └── done              → 200 ← stops polling, shows iframe
```

The dashboard does **not** wait for CI. The dashboard does **not** get notified when CI finishes. It polls a side-effect (the Worker URL going from 404 → 200) until something changes or it gives up after 120s.

**Why decouple this way?**

1. **Vercel/Next.js function timeout.** The server action runs in a serverless function with a hard limit (typically ~10–60s depending on plan). CI takes ~30–60s. If the server action awaited CI, it would time out and the user would see a 504 even though everything was fine.
2. **CI is the right home for the work.** `seed-kv` does file I/O (R2), bulk KV writes, and a 5-layer YAML resolution against the network repo. Doing that inside a request handler would couple deploy cadence (you'd need to redeploy the dashboard to change seed logic). In CI, the script lives next to the rest of the build pipeline — the right boundary.
3. **Resilience.** The dashboard could go down right after the server action returns and CI would still complete. The user would refresh and see the site. The two layers are independent failure domains, which is a feature, not a bug.

**Why polling instead of webhooks back to the dashboard?**

Polling is dead simple. Webhook-back would need:
- An HTTP endpoint on the dashboard with secret validation.
- Some way to correlate the webhook back to the wizard session that's waiting (the wizard is a client component with no persistent ID).
- Reconnection logic if the websocket drops.
- A fallback if the webhook gets lost (you still need polling).

For a 60-second wait in a one-shot wizard, polling wins on simplicity. **If we ever build a long-running operation** (like a multi-day "regenerate all 500 articles" job), revisit — Server-Sent Events (SSE) over Next.js streaming would be the right move.

**Why `HEAD` polling specifically?**
- Cheap: no body. Just headers.
- The Worker's middleware fail-closed semantics give us a binary readiness signal — `404` = not ready, anything else = ready. No need to inspect the body.
- The Cloudflare cache won't store a `HEAD` response separately, so we always hit origin.

### Why it matters for new developers

These are the bugs people make when they don't internalize the three layers:

| Mistake | What goes wrong | Where it bites |
|---|---|---|
| Adding work *after* `triggerWorkflowViaPush` and expecting CI to see it | Trigger has already pushed; subsequent commits are a separate event | "I added file X, why isn't it in KV?" |
| Trying to `await sync-kv.yml` from the server action | Function timeout; user sees 504 | Server action that "sometimes works" |
| Polling the dashboard instead of the Worker for readiness | The dashboard has no idea when CI finished | Iframe shows the wrong state |
| Adding a callback like `setTimeout(() => render(), 60000)` instead of polling | Brittle: real CI time varies. 90s sometimes, 30s usually | Random "site is ready before iframe shows" or "iframe is empty for 90s" complaints |
| Putting the Gemini call inside `commitSiteFiles` to "parallelize" | Now the commit happens before the logo exists; the logo is in a SECOND commit | Wasted CI run; weird "site without logo for 30s" |

If you're touching this code, read your change against the three-layer model and ask: which layer is each line in?

### Recommendations (ordered by priority)

#### 🟡 Probably worth doing — UX polish

**1. Replace the fake progress timer in StepPreview with real progress events.**

`StepPreview.tsx:67-78` advances 5 fake "steps" on a timer. The real server action reports nothing back until it returns. So if Gemini takes 15s instead of 5, the UI shows "Committing..." while the server is actually still in "Generating logo..." — the labels lie to the user.

Fix: stream real progress from the server action using Next.js 15's streaming server actions or SSE. Each step in `createSiteAndBuildStaging` would yield a status. The client renders whichever step is current, with real timestamps.

**Estimated work:** ~half a day. UX upgrade, not correctness.

**2. Make the polling cadence smarter.**

Currently: every 5 seconds for up to 120 seconds. That's 24 requests in the worst case, most of them returning 404.

Options:
- Exponential backoff: 2s, 4s, 8s, 16s. Faster on the typical fast-CI path; gentler on the slow-CI path.
- Server-side estimate: `triggerWorkflowViaPush` could return an ETA based on the number of files committed, and the client could wait that long before starting to poll.

**Estimated work:** ~1 hour for backoff. Premature optimization unless polling load becomes a real concern.

#### 🟠 Maybe later — architectural

**3. Switch `triggerWorkflowViaPush` to `workflow_dispatch`.**

The current pattern (push a `.build-trigger` file via Contents API to wake up `sync-kv.yml`) works fine and has a benefit: the file's git history is a passive audit trail of every CI trigger.

Switching to `octokit.actions.createWorkflowDispatch()` would:
- Make the intent explicit at the API call level.
- Allow passing structured inputs the workflow can't infer from a file diff.
- Lose the in-repo audit trail (moves it to the Actions UI only).

**Don't do this until you have a real reason** — at minimum, one of:
- You're regenerating GITHUB_TOKEN with broader scope for another feature (then it's free to throw `actions:write` in).
- You need to pass parameters that don't fit the file-trigger model (e.g. "sync only articles X, Y").
- You hit GitHub Contents API rate limits (currently nowhere near).

The 500ms savings per wizard run is irrelevant. The security cost (broader token scope = bigger blast radius if leaked) plus updating two call sites (wizard + `actions/review.ts`) plus testing makes it net-negative until one of those triggers materialize.

**Estimated work:** half a day end-to-end (token regen, secret rotation everywhere, code change in two call sites, test). Don't do speculatively.

**4. Make the wizard truly backgroundable.**

If you want the user to be able to navigate away mid-deploy and come back, you need:
- Persist the in-progress state somewhere durable (DB row keyed by domain/slug).
- A separate background worker that drives the work (not a server action).
- A status endpoint the dashboard hits to show progress on the Site Detail page.

This is the right shape for "we're going to build 50 sites in a batch." Not worth it for the current single-site wizard.

**Estimated work:** 3–5 days. Don't do this until product asks for it.

**6. Webhook-based readiness signal instead of polling.**

Have CI hit a dashboard endpoint when seed-kv finishes. Dashboard pushes a state update over SSE to the open wizard tab.

- Pros: instant readiness signal, lower request volume.
- Cons: more moving parts, harder to debug, still need polling fallback.

**Don't do this for the current setup.** Revisit if you end up with operations that take >5 minutes — at that scale, the request count of polling becomes silly.

#### 🔴 Don't do — fool's-gold optimizations

**7. Don't parallelize `addSitesToIndex` with `triggerWorkflowViaPush`.**

Saves ~500ms. Adds: harder error handling (which committed? which didn't?), nondeterministic ordering of the dashboard-index.yaml commit vs. the trigger commit on the activity feed, and one more thing the next dev has to reason about.

**Not worth it.**

**8. Don't `Promise.all` Gemini and the niche-bundle fetch.**

Saves ~200ms (niche bundle is so fast it doesn't matter). Adds the same readability cost as #6.

**Not worth it.**

---

## Part 1 — Wizard UI

### Entry point

**File:** `services/dashboard/src/app/wizard/page.tsx`

Top-level Next.js page. Renders `WizardShell` and switches between step components based on `currentStep`. Keeps `formData: WizardFormData` and `stagingResult` in `useState` — **no persistence**, refresh = lost progress.

```tsx
// page.tsx switches step components based on currentStep
case 0: return <StepIdentity ... />          // collect slug, name, audiences, company
case 1: return <StepNicheTargeting ... />    // pick or create a content bundle
case 2: return <StepGroups ... />            // pick config groups (theme, ads, tracking presets)
case 3: return <StepTheme ... />             // pick preset + customize colors/fonts/layout
case 4: return <StepContentBrief ... />      // tone, topics, schedule, content guidelines
case 5: return <StepPreview ... />           // ⚠️ THIS is the only step that calls the backend
case 6: return <StepGoLive ... />            // informational summary + links
```

### Wizard shell — step navigation

**File:** `services/dashboard/src/components/wizard/WizardShell.tsx`

Stateless container that renders the step tabs at the top + child component below. Tabs are clickable for completed steps (`i < currentStep`), disabled for future steps. Children receive `goNext` / `goBack` / `goToStep` callbacks. Nothing to know beyond "it's the chrome."

### Steps 0-4: pure client state

These steps **make no backend calls** that gate progression. (Some of them fire optional reference-data fetches — listed below — but the user can move on without waiting.)

| Step | File | What it collects | Optional fetch |
|---|---|---|---|
| 0 — Identity | `StepIdentity.tsx` | `pagesProjectName` (slug), `siteName`, `audiences[]`, `audienceIds[]`, `company` | `useAudiences()` for the picker |
| 1 — Niche Targeting | `StepNicheTargeting.tsx` | Either `bundleId` (existing bundle) or `verticalId` + `selectedCategories[]` + `selectedTags[]` (new bundle) | Verticals, categories, tags, bundles + tag search |
| 2 — Groups | `StepGroups.tsx` | `groups[]` — list of group IDs in merge order (last group wins) | `GET /api/groups` |
| 3 — Theme | `StepTheme.tsx` | `themePreset` (classic / bold / ocean / …), `themeColors`, `fontHeading`, `fontBody`, `themeLayout` | None |
| 4 — Content Brief | `StepContentBrief.tsx` | `tone`, `topics[]`, `articlesPerDay`, `preferredDays[]`, `contentGuidelines` | `suggestTopics()` server action — auto-fills topics with AI on first arrival |

**Important detail in Step 0:** the slug input gets auto-sanitized to lowercase + alphanumerics + hyphens:

```ts
// StepIdentity.tsx — line ~26
function handleProjectNameChange(value: string): void {
  // WHY: this string becomes the directory name in the network repo
  // (`sites/<slug>/`). Anything else would break filesystem paths.
  const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  onChange({ pagesProjectName: sanitized });
}
```

### Step 5: Preview — where everything happens

**File:** `services/dashboard/src/components/wizard/StepPreview.tsx`

> **First read [Part 0](#part-0--sync-vs-async-the-mental-model)** if you haven't yet. This step is where the three sync/async layers meet — the click on "Deploy Staging" is the user-perspective async operation; what unfolds in the next ~60 seconds is two distinct phases (server action then CI + polling).

This is the only step that hits the backend. The user sees a "Deploy Staging" button. Clicking it does three things:

```tsx
// StepPreview.tsx — line ~62 (handleBuildStaging)
function handleBuildStaging(): void {
  setDeployStep(0);

  // (1) Visual progress: a timer advances 5 fake "steps" so the user sees
  //     activity. Total ~16.5s of choreography. The real work is async.
  stepTimerRef.current = setInterval(...);

  // (2) Actually do the work — single server-action call.
  startBuildTransition(async () => {
    const result = await createSiteAndBuildStaging(data);
    setStagingUrl(result.stagingUrl);

    // (3) Poll the worker preview URL until it stops returning 404.
    //     Every 5s, max 120s. Once 200, render the iframe.
    pollRef.current = setInterval(async () => {
      const res = await fetch(result.stagingUrl, { method: "HEAD", cache: "no-store" });
      if (res.status !== 404) {
        clearInterval(pollRef.current);
        setPreviewUrl(result.stagingUrl);
      }
    }, 5000);
  });
}
```

**Why polling instead of WebSockets/SSE?** Simpler. The Worker's middleware fails closed (returns 404) until KV has the `site:<hostname>` mapping. So "stops returning 404" is a clean readiness signal — no need for back-channel events.

### Step 6: Go-Live summary (no backend)

**File:** `services/dashboard/src/components/wizard/StepGoLive.tsx`

Pure informational. Displays the slug, name, vertical, theme, and the working preview URL. Two buttons: **"Back to Dashboard"** and **"View Site Details"**. The wizard ends here. Going live to production happens on the Site Detail page (covered in Part 4 below).

---

## Part 2 — The server action

This is the function that does the actual work. Read it carefully — every other backend file in this guide is a helper called from here.

> **Sync/async note:** This function lives in **Layer 2** of the model in [Part 0](#part-0--sync-vs-async-the-mental-model). It's a single Promise from the client's POV (one `await`), but internally it chains 8+ async I/O calls sequentially. The chain is enforced by data dependencies — see Layer 2 for why we don't parallelize most of it.

**File:** `services/dashboard/src/actions/wizard.ts:93`

```ts
// services/dashboard/src/actions/wizard.ts:93
export async function createSiteAndBuildStaging(
  data: WizardFormData
): Promise<StagingResult> {
  const projectName = data.pagesProjectName;

  // The site folder in the network repo uses the project name as identifier.
  // sync-kv.yml iterates sites/*/ on commits and writes CONFIG_KV under
  // `site:<folder-name>` so the worker middleware can resolve config when
  // the hostname matches.
  const siteFolder = projectName;

  // -----------------------------------------------------------------
  // STEP 0 — Resolve niche targeting (optional Aggregator HTTP call)
  // -----------------------------------------------------------------
  // Either reuse an existing bundle (its rules become the site's
  // category_ids/tag_ids) OR create a new one from selected vertical
  // + categories + tags via createBundle().
  let bundleId: string | undefined = data.bundleId || undefined;
  if (data.bundleId) {
    // existing bundle → fetch its rules
    const res = await fetch(`${AGGREGATOR_URL}/api/bundles/${bundleId}`);
    // ... extract category_ids, tag_ids from bundle.rules
  } else if (data.verticalId && categoryIds.length > 0) {
    // new bundle → POST to aggregator
    const bundle = await createBundle(data.siteName, data.verticalId, categoryIds, tagIds);
    if (bundle) bundleId = bundle.id;
  }

  // -----------------------------------------------------------------
  // STEP 1 — Build site.yaml content (in-memory, sync)
  // -----------------------------------------------------------------
  // This object becomes the YAML that Worker reads from KV at request
  // time. Schema lives in @atomic-platform/shared-types/SiteConfig.
  const siteConfig = {
    domain: projectName,            // network-repo folder name = KV key suffix
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    groups: data.groups.length > 0 ? data.groups : ["adsense-default"],
    active: true,
    bundle_id: bundleId || undefined,
    iab_vertical_code: data.iabVerticalCode || undefined,
    brief: { /* tone, topics, schedule, … */ },
    theme: { base: data.themePreset, colors: data.themeColors, fonts: { ... } },
    layout: data.themeLayout,
  };

  // -----------------------------------------------------------------
  // STEP 2 — Build skill.md (the agent's instructions for this site)
  // -----------------------------------------------------------------
  // Plain markdown, read by content-pipeline when generating articles.
  const skillContent = `# Content Agent Instructions for ${data.siteName} ...`;

  // -----------------------------------------------------------------
  // STEP 3 — Logo: use uploaded OR generate via Gemini
  // -----------------------------------------------------------------
  let logoBuffer: Buffer | null = null;
  if (data.logoBase64) {
    logoBuffer = Buffer.from(data.logoBase64, "base64");
  } else if (process.env.GEMINI_API_KEY) {
    // ~5-10s async HTTP call, non-fatal if it fails (warn + continue).
    logoBuffer = await generateLogoWithGemini(
      process.env.GEMINI_API_KEY,
      data.siteName,
      data.vertical,
      data.audiences.join(", ") || undefined
    );
  }

  // -----------------------------------------------------------------
  // STEP 4 — Assemble the file list for the commit
  // -----------------------------------------------------------------
  // All files go under sites/<siteFolder>/ in the network repo.
  // .gitkeep files keep empty `articles/` and `assets/` dirs in git.
  const files: Array<{ path: string; content: string | Buffer }> = [
    { path: `sites/${siteFolder}/site.yaml`, content: stringifyYaml(siteConfig) },
    { path: `sites/${siteFolder}/skill.md`, content: skillContent },
    { path: `sites/${siteFolder}/assets/.gitkeep`, content: "" },
    { path: `sites/${siteFolder}/articles/.gitkeep`, content: "" },
  ];
  if (logoBuffer) {
    files.push({ path: `sites/${siteFolder}/assets/logo.png`, content: logoBuffer });
    siteConfig.theme.logo = "/assets/logo.png";
    siteConfig.theme.favicon = siteConfig.theme.favicon ?? "/assets/logo.png";
    // Re-serialize site.yaml so the logo path is in the committed file
    files[0] = { path: `sites/${siteFolder}/site.yaml`, content: stringifyYaml(siteConfig) };
  }

  // -----------------------------------------------------------------
  // STEP 5 — Compute the Worker preview URL up-front
  // -----------------------------------------------------------------
  // Returned to the client BEFORE sync-kv.yml has even started.
  // The client polls this URL until middleware stops 404'ing.
  const previewUrl = workerPreviewUrl(siteFolder);
  // → e.g. https://atomic-site-worker-staging.dev1-953.workers.dev/?_atl_site=coolnews-atl

  // -----------------------------------------------------------------
  // STEP 6 — Create the staging branch in the network repo
  // -----------------------------------------------------------------
  const stagingBranch = `staging/${projectName}`;
  await createBranch(stagingBranch);  // see helper below

  // -----------------------------------------------------------------
  // STEP 7 — Atomic multi-file commit via Git Data API
  // -----------------------------------------------------------------
  // Single commit with all the files above. CRITICAL: Git Data API
  // commits do NOT trigger GitHub Actions — that's why step 8 exists.
  await commitSiteFiles(siteFolder, files, "create site", stagingBranch);

  // -----------------------------------------------------------------
  // STEP 8 — Wake up sync-kv.yml via Contents API push
  // -----------------------------------------------------------------
  // Writes a small `.build-trigger` file. Contents API pushes DO
  // trigger Actions (they go through the webhook plumbing).
  // workflow_dispatch would be cleaner but our token lacks
  // `actions:write` scope.
  await triggerWorkflowViaPush(stagingBranch, siteFolder);

  // -----------------------------------------------------------------
  // STEP 9 — Add the site to dashboard-index.yaml on main
  // -----------------------------------------------------------------
  // Note: pages_project / pages_subdomain / zone_id are kept on the
  // type for backwards compatibility but always set to null post-
  // migration. They'll be populated by attachCustomDomain() later.
  const siteEntry: DashboardSiteEntry = {
    domain: siteFolder,
    company: data.company,
    vertical: data.vertical,
    status: "Staging",
    site_id: `${Date.now().toString().slice(-10)}${randomSuffix}`,
    pages_project: null,
    pages_subdomain: null,
    zone_id: null,
    staging_branch: stagingBranch,
    preview_url: previewUrl,
    saved_previews: null,
    custom_domain: null,
    /* ... a few null/false flags ... */
  };

  // Idempotent: re-running the wizard with the same slug updates
  // instead of duplicating.
  const index = await readDashboardIndex();
  const existing = index.sites.find((s) => s.domain === siteFolder);
  if (existing) {
    await updateSiteInIndex(siteFolder, { /* limited update */ });
  } else {
    await addSitesToIndex([siteEntry]);
  }

  revalidatePath("/");

  // -----------------------------------------------------------------
  // STEP 10 — Return the URL so the client can start polling
  // -----------------------------------------------------------------
  return { stagingUrl: previewUrl, siteFolder };
}
```

**Key invariants:**

1. **`projectName` IS `siteFolder` IS `domain` (the dashboard's column name).** All three names mean the same thing — the network-repo directory slug. Don't confuse this with the numeric `site_id` (separate, unrelated internal ID).
2. **Git Data API and Contents API serve different purposes.** Git Data lets us commit many files atomically; Contents triggers Actions. We use both deliberately.
3. **Idempotent at the file level.** Re-running with the same slug overwrites `site.yaml` etc. but doesn't duplicate dashboard-index entries.

---

## Part 3 — Helper functions

These are the building blocks `createSiteAndBuildStaging` calls. Each one's a small, focused unit.

### `createBranch` — create a branch from main

**File:** `services/dashboard/src/lib/github.ts:690`

```ts
export async function createBranch(
  branchName: string,
  fromBranch: string = "main"
): Promise<void> {
  const octokit = getOctokit();

  // (1) Read the SHA of the source branch's tip
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${fromBranch}`,
  });

  // (2) Create the new branch pointing at that SHA
  await octokit.git.createRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `refs/heads/${branchName}`,  // note `refs/heads/` prefix here
    sha: ref.object.sha,
  });
}
```

**Failure modes:** branch already exists → throws `422 Reference already exists`. The wizard doesn't catch this — re-running with the same slug after the branch exists will fail. (Improvement opportunity: catch + treat as success.)

### `commitSiteFiles` — atomic multi-file commit via Git Data API

**File:** `services/dashboard/src/lib/github.ts:573`

This is the one to really understand. It's the only way to commit multiple files in a single GitHub commit.

```ts
export async function commitSiteFiles(
  domain: string,
  files: Array<{ path: string; content: string | Buffer }>,
  message: string,
  branch: string = "main"
): Promise<void> {
  const octokit = getOctokit();

  // (1) Get current branch tip SHA — we'll commit on top of this
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;

  // (2) Get the tree SHA of that commit (we'll layer changes on top)
  const { data: commit } = await octokit.git.getCommit({ ... });
  const baseTreeSha = commit.tree.sha;

  // (3) Upload each file as a blob; get back the blob SHA
  //     Files are uploaded in parallel via Promise.all
  const treeItems = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        content: Buffer.isBuffer(file.content)
          ? file.content.toString("base64")
          : Buffer.from(file.content).toString("base64"),
        encoding: "base64",  // base64 lets us upload binary files (logo.png) too
      });
      return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
    })
  );

  // (4) Create a new tree (= directory snapshot) containing the new blobs,
  //     layered on top of the base tree. Files NOT in `treeItems` keep their
  //     existing SHAs from baseTreeSha.
  const { data: newTree } = await octokit.git.createTree({
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // (5) Create a commit object pointing at the new tree
  const { data: newCommit } = await octokit.git.createCommit({
    message: `site(${domain}): ${message}`,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  // (6) Move the branch ref to point at the new commit
  await octokit.git.updateRef({
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}
```

**The 6 API calls in order:** `getRef → getCommit → createBlob × N → createTree → createCommit → updateRef`. This is the standard "low-level" git over the API. The reason for going low-level instead of using `createOrUpdateFileContents`: the latter is one-file-per-commit; we need atomicity across many files.

### `triggerWorkflowViaPush` — wake up sync-kv.yml

**File:** `services/dashboard/src/lib/github.ts:655`

```ts
export async function triggerWorkflowViaPush(
  branch: string,
  siteFolder: string
): Promise<void> {
  const octokit = getOctokit();
  const triggerPath = `sites/${siteFolder}/.build-trigger`;

  // (1) See if the trigger file already exists. We need its SHA to update
  //     (not delete-and-recreate) so the path doesn't churn.
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      path: triggerPath,
      ref: branch,
    });
    if ("sha" in data) existingSha = data.sha;
  } catch {
    // doesn't exist → that's fine, this is the first wizard run
  }

  // (2) Push a new file or update the existing one. Content is just the
  //     current ISO timestamp — we don't actually read it anywhere; we
  //     just need *some change* to fire a `push` event.
  await octokit.repos.createOrUpdateFileContents({
    path: triggerPath,
    message: `ci: trigger KV sync for ${siteFolder}`,
    content: Buffer.from(new Date().toISOString()).toString("base64"),
    sha: existingSha,
    branch,
  });
}
```

**Why this is needed:** GitHub's webhook system fires on *user-driven* commits — pushes, merges, PRs. Git Data API commits look like internal plumbing and don't fire webhooks. Contents API DOES fire webhooks (it's the "edit a file" UI's API). So we layer one Contents API push on top of the Git Data commits to wake up CI.

**Future improvement:** if we get `actions:write` token scope, switch to `octokit.actions.createWorkflowDispatch()` and remove the `.build-trigger` file pattern.

### `addSitesToIndex` — register site in dashboard-index.yaml

**File:** `services/dashboard/src/lib/github.ts:427`

```ts
export async function addSitesToIndex(
  entries: DashboardSiteEntry[]
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  const existingDomains = new Set(index.sites.map((s) => s.domain));

  // De-dupe by domain — only add entries whose domain isn't already there.
  const newEntries = entries.filter((e) => !existingDomains.has(e.domain));
  index.sites.push(...newEntries);

  if (newEntries.length > 0) {
    await writeDashboardIndex(index, `dashboard: sync ${newEntries.length} domains from Cloudflare`);
  }
  return index;
}
```

`readDashboardIndex` / `writeDashboardIndex` (also in github.ts) read/write `dashboard-index.yaml` on the network repo's `main` branch via the Contents API. They cache reads in-memory with a TTL.

### `updateSiteInIndex` — modify an existing entry

**File:** `services/dashboard/src/lib/github.ts:148`

```ts
export async function updateSiteInIndex(
  domain: string,
  updates: Partial<DashboardSiteEntry>
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  const i = index.sites.findIndex((s) => s.domain === domain);
  if (i === -1) throw new Error(`Site ${domain} not found in dashboard index`);

  index.sites[i] = {
    ...index.sites[i]!,
    ...updates,
    last_updated: new Date().toISOString(),  // always bumps last_updated
  };
  await writeDashboardIndex(index, `dashboard: update ${domain}`);
  return index;
}
```

Used after the wizard re-runs (existing entry path), and by `attachCustomDomain` / `goLive` later.

### `generateLogoWithGemini` — AI logo

**File:** `services/dashboard/src/actions/wizard.ts:1074`

POST to Gemini's image-generation API with a prompt that includes site name + vertical + audience. Returns a `Buffer` of the PNG, or `null` on any failure (logged but **non-fatal** — the wizard proceeds without a logo).

```ts
async function generateLogoWithGemini(...): Promise<Buffer | null> {
  const prompt = `Create a modern, professional logo icon for "${siteName}".
                  ... (specifies: square, no text, transparent bg, etc.) ...`;
  
  const response = await fetch(`${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`, {
    method: "POST",
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  // Response has candidates[].content.parts[].inlineData.{mimeType, data}.
  // Find the image part, decode base64 → Buffer, return.
}
```

To swap providers: replace this function entirely. Its only caller is `createSiteAndBuildStaging`.

---

## Part 4 — What sync-kv.yml does (the async background phase)

> **Sync/async note:** This is **Layer 3** in [Part 0](#part-0--sync-vs-async-the-mental-model) — the genuinely async, decoupled phase. The server action has already returned to the client by the time CI runs. The dashboard learns about completion only by polling the Worker URL until it stops returning 404. CI and the dashboard are independent failure domains; that's a feature, not a limitation.

After `triggerWorkflowViaPush` returns, GitHub Actions takes over. The dashboard does NOT poll Actions — it polls the Worker URL directly until the worker stops returning 404 (a side-effect of CI completing).

**File (workflow):** `atomic-labs-network/.github/workflows/sync-kv.yml`
**File (script):** `atomic-content-platform/packages/site-worker/scripts/seed-kv.ts`

### Two jobs

#### `detect` job (~5s)
Computes the diff between the current commit and its parent. Outputs a JSON list of siteIds to sync. For wizard pushes, the new site's slug is in the list. (For group/override edits, this expands to all sites those affect.)

#### `sync` matrix job (~20-50s per site)
Runs `pnpm --filter @atomic-platform/site-worker seed:kv <slug> [hostnames...]` for each site in the matrix.

### The `seed-kv.ts` script

**File:** `packages/site-worker/scripts/seed-kv.ts`

For each site:

```
1. Load 5-layer config:  org.yaml → groups[].yaml → overrides/config[].yaml → site.yaml
                         deep-merged with priority sort on overrides.

2. Load articles:        sites/<slug>/articles/*.md, parse frontmatter, render markdown→HTML.
                         Rewrite relative `/assets/foo.png` → `/<slug>/assets/foo.png`.

3. Load shared pages:    Per-site override (overrides/<slug>/<page>.md) wins over
                         bundled template (packages/site-worker/shared-pages/<page>.md).

4. R2 upload:            Walk sites/<slug>/assets/, `wrangler r2 object put` per file
                         to bucket `atl-assets-staging` (default) or `atl-assets-prod` (on main).

5. KV bulk write:        Build a JSON file with all keys + values, then
                         `wrangler kv bulk put` to namespace 4673c82c... (staging) or
                         a69cb2c5... (prod, on main).
                         Keys written:
                           site:<hostname>          (one per hostname arg)
                           site-config:<slug>
                           article-index:<slug>     (empty array for new site)
                           article:<slug>:<art>     (one per article — none for new site)
                           shared-page:<slug>:<n>   (one per shared page)
                           sync-status:<slug>       (audit log: gitSha, syncedAt, ok)
```

After this completes for the wizard's site, the staging Worker can resolve `?_atl_site=<slug>` (it finds `site:<slug>.atl.dev` or whatever hostname was passed) and serve the homepage. **That's when the dashboard's polling loop sees the 200 and shows the iframe.**

### Sync-kv envs

The workflow passes envs into seed-kv:

```yaml
env:
  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  NETWORK_DATA_PATH: ${{ github.workspace }}
  KV_NAMESPACE_ID: ${{ github.ref_name == 'main' && secrets.KV_NAMESPACE_ID_PROD || secrets.KV_NAMESPACE_ID_STAGING }}
  R2_BUCKET:        ${{ github.ref_name == 'main' && 'atl-assets-prod' || 'atl-assets-staging' }}
  KV_REMOTE: "true"
  R2_REMOTE: "true"
```

**Important:** `KV_NAMESPACE_ID` and `R2_BUCKET` are tied to branch in lockstep. On `main` they go to prod; on any other branch (including `staging/<slug>`) they go to staging. If they got out of sync, live coolnews.dev would point to articles whose images are in the wrong bucket. Don't break the lockstep.

---

## Part 5 — Post-wizard: going live

The wizard ends with a working Worker Preview but NOT a live production site. To go live, the user does two more actions on the Site Detail page (`/sites/<slug>`).

### `attachCustomDomain` — wire up a real domain

**File:** `services/dashboard/src/actions/wizard.ts:460`
**Triggered from:** Site Detail → Identity tab → Custom Domain panel

```ts
export async function attachCustomDomain(
  domain: string,        // the network-repo slug (e.g. "coolnews-atl")
  customDomain: string,  // the public domain (e.g. "coolnews.dev")
  zoneId: string,        // CF zone ID for that domain
): Promise<{ success: true }> {
  // (1) Update dashboard-index entry: status → Live, custom_domain set, zone_id set.
  //     Note: this is BEFORE the Cloudflare register, so we can roll back if CF fails.
  site.custom_domain = customDomain;
  site.zone_id = resolvedZoneId;
  site.status = 'Live';
  await writeDashboardIndex(index, `dashboard: attach ${customDomain} to ${domain}`);

  // (2) Register the custom domain on the prod Worker.
  //     CF auto-creates the DNS record (apex A/AAAA) — that's the magic.
  //     If this throws, we roll back step 1 (best-effort).
  try {
    await registerWorkerCustomDomain(customDomain, resolvedZoneId);
  } catch (err) {
    // ROLLBACK: restore previous index values
    site.custom_domain = previousCustomDomain;
    site.status = previousStatus;
    site.zone_id = previousZoneId;
    await writeDashboardIndex(index, `dashboard: rollback ...`);
    throw new Error(`Failed to register ${customDomain} on Cloudflare: ...`);
  }

  // (3) Seed prod KV so the Worker can resolve hostname → siteId immediately.
  //     If this fails, sync-kv will self-heal on the next push (non-fatal).
  await putKVEntry(KV_NAMESPACE_PROD, `site:${customDomain.toLowerCase()}`,
                   JSON.stringify({ siteId: domain }));

  // (4) Best-effort email routing (so contact@<customDomain> forwards).
  if (site.zone_id) {
    await enableEmailRouting(site.zone_id);
    await createEmailRoutingRule(site.zone_id, customDomain);
  }
}
```

#### `registerWorkerCustomDomain` — CF API call

**File:** `services/dashboard/src/lib/cloudflare.ts:309`

```ts
export async function registerWorkerCustomDomain(
  hostname: string,
  zoneId: string,
): Promise<{ id: string }> {
  // CF API: PUT /accounts/<id>/workers/domains
  // Tells Cloudflare: "this hostname's traffic should hit my Worker."
  // CF then auto-creates the DNS record (apex A/AAAA → CF edge).
  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/domains`,
    {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({
        zone_id: zoneId,
        hostname,
        service: WORKER_NAME_PROD,         // "atomic-site-worker"
        environment: "production",
      }),
    },
  );
  /* parse + return */
}
```

#### `putKVEntry` — direct KV write (bypassing CI)

**File:** `services/dashboard/src/lib/cloudflare.ts:401`

```ts
export async function putKVEntry(
  namespaceId: string,
  key: string,
  value: string,
): Promise<void> {
  // CF API: PUT /accounts/<id>/storage/kv/namespaces/<ns>/values/<key>
  // Content-Type override matters: KV API expects raw body, not JSON envelope.
  await fetch(
    `${CF_API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { ...getHeaders(), "Content-Type": "text/plain" },
      body: value,  // caller already JSON.stringify'd it
    },
  );
}
```

### ⚠️ Known gap: source-of-truth drift

`registerWorkerCustomDomain` updates Cloudflare's runtime state but NOT the source code. The list of routes the Worker claims on deploy lives in:

**File:** `packages/site-worker/scripts/emit-env-configs.ts`

```ts
production: {
  ...
  routes: [
    { pattern: 'coolnews.dev', custom_domain: true },
    // ... new domains added by attachCustomDomain are NOT here
  ],
}
```

On the next `pnpm deploy:production`, wrangler reconciles deployed routes against this array. **If wrangler treats the array as the full source of truth, API-attached domains may get stripped on deploy** — site goes offline.

A spawned task tracks this (chip "Wire attachCustomDomain to emit-env-configs.ts"). Until that's fixed, after attaching a custom domain, also manually edit `emit-env-configs.ts` and commit.

### `goLive` — merge to main

**File:** `services/dashboard/src/actions/wizard.ts:349`
**Triggered from:** Site Detail → Staging tab → "Go Live" button

```ts
export async function goLive(domain: string): Promise<void> {
  const site = (await readDashboardIndex()).sites.find((s) => s.domain === domain);
  const stagingBranch = site.staging_branch;  // "staging/<domain>"

  // (1) Merge the staging branch into main.
  //     This is the trigger for `sync-kv.yml` running on main, which
  //     writes to PROD KV + atl-assets-prod (instead of staging targets).
  await mergeBranchToMain(stagingBranch, `site(${domain}): go live`);

  // (2) Reset the staging branch to the new main HEAD so future edits
  //     diff against the now-live state.
  await deleteBranch(stagingBranch);
  await createBranch(stagingBranch, "main");

  // (3) Mark the site Ready in dashboard-index.
  await updateSiteInIndex(domain, { status: "Ready" });
}
```

### `publishStagingToProduction` — push edits to live (after first go-live)

**File:** `services/dashboard/src/actions/wizard.ts:382`

Same shape as `goLive` minus the status update. Used by the "Publish to Production" button on already-Live/Ready sites.

---

## Part 6 — Common modifications & where to make them

If you need to…

| Goal | Touch these files |
|---|---|
| Add a new wizard step (e.g. "SEO Setup") | `app/wizard/page.tsx` (add case), new `StepXxx.tsx`, extend `WizardFormData` in `types/dashboard.ts`, optionally extend `createSiteAndBuildStaging` to write the new fields into site.yaml |
| Change what's in `site.yaml` for new sites | `actions/wizard.ts:139` (the `siteConfig = { ... }` block). Also update `@atomic-platform/shared-types/SiteConfig.ts` if the field is read by the Worker |
| Change logo prompt | `actions/wizard.ts:1074` (`generateLogoWithGemini`) |
| Add another file to the initial commit | `actions/wizard.ts:234` (the `files` array) |
| Replace Gemini with another image API | Same function as above; only `createSiteAndBuildStaging` calls it |
| Change polling timeout | `components/wizard/StepPreview.tsx:101` (`TIMEOUT_MS = 120_000`) |
| Add validation to step 0 slug | `components/wizard/StepIdentity.tsx:26` (`handleProjectNameChange`) |
| Change which CF Worker the preview uses | `services/dashboard/src/lib/constants.ts` (`WORKER_STAGING_URL`) — overridable via env `NEXT_PUBLIC_WORKER_STAGING_URL` |
| Change what `sync-kv.yml` does | `atomic-labs-network/.github/workflows/sync-kv.yml` (workflow) AND/OR `packages/site-worker/scripts/seed-kv.ts` (script) |

---

## Part 7 — Debugging recipes

### "I clicked Deploy Staging and the iframe never showed up"

1. **Check toast/console for server-action errors.** If `createSiteAndBuildStaging` threw, the toast shows an error message. Common causes: branch already exists (re-running the wizard with the same slug), GitHub auth issue, missing GEMINI_API_KEY (not fatal — should warn + continue, but worth checking).
2. **Open the network tab.** Look at the HEAD requests to the Worker URL. If they're 404 forever → CI didn't run, or it ran but failed.
3. **Check GitHub Actions UI** for `atomic-labs-network`. Did `sync-kv.yml` fire? If yes, did the matrix job for this site succeed? Read the job log.
4. **Inspect KV directly:**
   ```bash
   CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
     wrangler kv key get "site-config:<slug>" \
     --namespace-id=4673c82cdd7f41d49e93d938fb1c6848 --remote
   ```
   If the key isn't there → CI didn't sync. If it's there but the Worker still 404s → check `site:<hostname>` mapping with the same command.
5. **Manual re-run:** `gh workflow run sync-kv.yml -f site=<slug>` from network repo CLI.

### "I got a stub config in KV — site renders blank"

The slug's `site.yaml` doesn't exist on the active branch. seed-kv now throws hard rather than writing a stub (Phase 8 fix), but if you somehow get into this state: re-seed from the right branch using a worktree:

```bash
cd ~/.../atomic-labs-network
git worktree add /tmp/wt-X staging/<slug>
cd ~/.../atomic-content-platform/packages/site-worker
NETWORK_DATA_PATH=/tmp/wt-X CLOUDFLARE_ACCOUNT_ID=... pnpm seed:kv <slug> [hosts...]
git -C ~/.../atomic-labs-network worktree remove /tmp/wt-X
```

### "Logo isn't showing up"

Order of debugging:
1. Was Gemini called? Check server logs for `[wizard] Logo generation failed`.
2. Is `sites/<slug>/assets/logo.png` in the GitHub branch? `git checkout staging/<slug>` and look.
3. Did sync-kv upload it to R2? `wrangler r2 object get atl-assets-staging/<slug>/assets/logo.png --remote --pipe | file -`.
4. Is `theme.logo` set to `/assets/logo.png` in `site.yaml`? Without that, the Worker doesn't know to render it.

---

## Part 8 — Conventions & gotchas

- **Slug = network-repo folder name = dashboard `domain` field.** Not the same as `site_id` (which is a numeric internal ID). When in doubt, use `domain`.
- **Three sync/async layers — see [Part 0](#part-0--sync-vs-async-the-mental-model).** Most bugs in this code come from confusing them. Every change in this codebase should be checked against "which layer is each line in?"
- **Server actions are sync from the client's perspective** but internally do many async things. The action returns when all I/O is done, then the client moves on. Don't add background work inside an action expecting it to fire-and-forget — it'll either block the response or die when Vercel/Next.js terminates the function.
- **`revalidatePath('/')`** is essential at the end of any action that mutates dashboard-index. Without it, the user goes back to the dashboard and sees stale data.
- **Gemini is non-fatal.** A site without a logo is recoverable (upload one later). Don't add throws to that path.
- **GitHub Data API and Contents API have different webhook semantics.** Git Data = no webhook = no Actions trigger. Contents = webhook = Actions trigger. The wizard relies on this.
- **YAML file extension: `.yaml`, never `.yml`** (project convention from CLAUDE.md).

---

## Part 9 — Out of scope (intentionally not covered)

- The 5-layer config resolution algorithm — that's documented in CLAUDE.md.
- The Worker's request handling (middleware → KV → Astro SSR) — see `docs/flow-map-he.md` (Hebrew) or the memory file at `~/.claude/projects/.../memory/flow_map_atl_network.md` (English).
- The content-pipeline's article generation — that's a separate flow from site creation.

---

## Appendix — File reference

| Concern | File |
|---|---|
| Wizard entry | `services/dashboard/src/app/wizard/page.tsx` |
| Wizard shell (tabs) | `services/dashboard/src/components/wizard/WizardShell.tsx` |
| Step 0: Identity | `services/dashboard/src/components/wizard/StepIdentity.tsx` |
| Step 1: Niche | `services/dashboard/src/components/wizard/StepNicheTargeting.tsx` |
| Step 2: Groups | `services/dashboard/src/components/wizard/StepGroups.tsx` |
| Step 3: Theme | `services/dashboard/src/components/wizard/StepTheme.tsx` |
| Step 4: Brief | `services/dashboard/src/components/wizard/StepContentBrief.tsx` |
| Step 5: Preview | `services/dashboard/src/components/wizard/StepPreview.tsx` |
| Step 6: Go-Live UI | `services/dashboard/src/components/wizard/StepGoLive.tsx` |
| Server actions | `services/dashboard/src/actions/wizard.ts` |
| GitHub helpers | `services/dashboard/src/lib/github.ts` |
| Cloudflare helpers | `services/dashboard/src/lib/cloudflare.ts` |
| Worker preview URL helper | `services/dashboard/src/lib/constants.ts` |
| KV/R2 sync workflow | `atomic-labs-network/.github/workflows/sync-kv.yml` |
| KV/R2 seed script | `packages/site-worker/scripts/seed-kv.ts` |
| Worker route configs | `packages/site-worker/scripts/emit-env-configs.ts` |
| Worker middleware | `packages/site-worker/src/middleware.ts` |
| Shared types | `packages/shared-types/src/*.ts` |

---

## Maintenance

This doc is a snapshot of code as of **2026-04-28** (last commit on the wizard files). When you change the wizard or its server actions, update the relevant section here. The guide should always be true at HEAD; if it isn't, that's the bug.

Companion docs:
- `docs/flow-map-he.md` — Hebrew flow map (non-technical stakeholder version)
- `~/.claude/projects/-Users-michal-Documents-ATL-content-network/memory/flow_map_atl_network.md` — English memory for Claude
