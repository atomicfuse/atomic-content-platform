# Site-Worker: Local Dev & Deploy Workflow

Step-by-step for editing Astro files in `packages/site-worker/` and seeing results locally and in production.

---

## 1. See Changes Locally

### Option A: `astro dev` (fast, no Cloudflare runtime)

Best for HTML/CSS/layout iteration. Hot-reloads instantly.

```bash
cd packages/site-worker
pnpm dev
```

- Opens at **http://localhost:4321** (Vite dev server)
- Hot-reloads on file save — no manual restart needed
- **Does NOT run workerd** — KV/R2 bindings use Vite's mock. You need seeded local KV data (see "Seeding KV" below)
- Good for: CSS tweaks, component layout, template changes

### Option B: `wrangler dev` (slow, full Cloudflare parity)

Runs the actual Workers runtime (workerd). Use when you need real KV/R2 behaviour.

```bash
cd packages/site-worker
pnpm dev:worker
```

This runs `astro build && wrangler dev --config dist/server/wrangler.staging.json`.

- Opens at **http://localhost:8787**
- Requires a rebuild on every change (no hot-reload)
- Tests the real Cloudflare Workers environment locally

### Seeding KV (required before first local run)

If you see `siteId "xxx" has no config in KV`, the KV store hasn't been seeded with site data.

**Important:** `pnpm dev` uses a **local** KV emulator (Miniflare). The default `seed:kv` writes to **remote** Cloudflare KV. You must pass `KV_REMOTE=false` for local dev.

#### For `pnpm dev` (local Astro dev server):

```bash
cd packages/site-worker
KV_REMOTE=false R2_REMOTE=false \
NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network \
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
pnpm seed:kv <siteId> [hostname ...]
```

Then open: `http://localhost:4321/?_atl_site=<siteId>`

#### For staging/production (remote deploy):

```bash
cd packages/site-worker
NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network \
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
pnpm seed:kv <siteId> [hostname ...]
```

(Default is `KV_REMOTE=true` — writes to remote Cloudflare KV.)

#### Parameters

- `<siteId>` = the folder name under `sites/` in the network repo (e.g. `muvizzcom`, `coolnews`)
- `[hostname ...]` = one or more hostnames to map to this siteId (e.g. `muvizz.com`)
- The network repo must have `sites/<siteId>/site.yaml` on the checked-out branch

#### Example (local dev):

```bash
KV_REMOTE=false R2_REMOTE=false \
NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network \
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
pnpm seed:kv muvizzcom muvizz.com
```

#### Cross-branch seeding

For seeding site B while checked out on staging/A, use `git worktree`:

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git worktree add ../network-main main
# then pass NETWORK_DATA_PATH=~/Documents/ATL-content-network/network-main
```

---

## 2. Deploy to Staging

Staging is the `*.workers.dev` URL — no custom domains.

```bash
cd packages/site-worker
pnpm deploy:staging
```

This runs: `astro build` + `emit-env-configs` + `wrangler deploy --config dist/server/wrangler.staging.json`

**View staging:** Use the dashboard's "Worker Preview" button, or hit the staging worker directly with `?_atl_site=<domain>`:

```
https://atomic-site-worker-staging.<account>.workers.dev?_atl_site=coolnews.dev
```

**No KV sync needed** if you only changed Astro code (HTML/CSS/JS). KV sync is only needed when site config or article content changes in the network repo.

---

## 3. Deploy to Production

Production claims custom domains (e.g. `coolnews.dev`).

```bash
cd packages/site-worker
pnpm deploy:production
```

This runs: `astro build` + `emit-env-configs` + `wrangler deploy --config dist/server/wrangler.production.json`

**Custom domain routing** is managed by `scripts/emit-env-configs.ts`. If you need to add/remove a route, edit that file — not `wrangler.toml`.

---

## Quick Reference: What Needs What

| Change type | Rebuild needed? | KV sync needed? | Deploy needed? |
|---|---|---|---|
| CSS / styling | No (hot-reload in `pnpm dev`) | No | Yes, to staging/prod |
| Astro component template | No (hot-reload in `pnpm dev`) | No | Yes, to staging/prod |
| Client-side JS (`<script>`) | No (hot-reload in `pnpm dev`) | No | Yes, to staging/prod |
| Middleware / server logic | Restart `pnpm dev` | No | Yes, to staging/prod |
| Site config (site.yaml, org.yaml) | N/A (network repo) | Yes (`seed:kv`) | No (handled by sync-kv.yml CI) |
| Article content (markdown) | N/A (network repo) | Yes (`seed:kv`) | No (handled by sync-kv.yml CI) |
| wrangler.toml bindings | Re-run `wrangler types` | No | Yes |

---

## Full Flow: Edit an Astro File End-to-End

```bash
# 1. Edit the file
#    e.g. packages/site-worker/src/themes/modern/components/Sidebar.astro

# 2. See it locally (terminal 1)
cd packages/site-worker && pnpm dev
#    Open http://localhost:4321/?_atl_site=coolnews.dev
#    Changes hot-reload on save

# 3. Typecheck
cd packages/site-worker && pnpm typecheck

# 4. Run tests (if any)
cd packages/site-worker && pnpm test

# 5. Commit & push
git add packages/site-worker/src/path/to/changed-file.astro
git commit -m "fix(site-worker): description of change"
git push origin michal-v2

# 6. Deploy to staging
cd packages/site-worker && pnpm deploy:staging

# 7. Verify on staging
#    Use dashboard Worker Preview or direct staging URL

# 8. Deploy to production (when ready)
cd packages/site-worker && pnpm deploy:production
```

---

## Common Commands Cheat Sheet

```bash
pnpm dev              # Vite dev server (fast, hot-reload)
pnpm dev:worker       # workerd dev server (slow, full parity)
pnpm build            # astro build + emit wrangler configs
pnpm typecheck        # astro check + tsc --noEmit
pnpm test             # vitest
pnpm deploy:staging   # build + deploy to staging worker
pnpm deploy:production # build + deploy to production worker
```
