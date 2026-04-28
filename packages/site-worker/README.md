# @atomic-platform/site-worker

Astro 6 + `@astrojs/cloudflare` Workers app. One deployment, many hostnames.

Runs **alongside** the legacy `packages/site-builder` during the migration
described in `docs/migration-plan.md`. Don't delete `site-builder` — both
exist side-by-side until Phase 8.

## Phase

Currently **Phase 1 — scaffold only**. The only route is `/` rendering the
request's `host` header as proof the Worker is reachable.

Phases that arrive next:
- Phase 2 — port `modern` theme + homepage + article route (still reading
  from filesystem, same as `site-builder`).
- Phase 3 — KV + middleware: resolve site identity from hostname.
- Phase 4 — Server Islands for ads and pixels.
- Phase 5 — GitHub → KV sync CI.

## Commands

```bash
pnpm dev              # astro dev (Vite) — fast iteration, no workerd
pnpm dev:worker       # astro build && wrangler dev — workerd parity
pnpm build            # astro build — emits dist/_worker.js/ + static files
pnpm typecheck        # astro check + tsc --noEmit
pnpm deploy:staging   # wrangler deploy --env staging (requires CF auth)
```

## Local smoke test

```bash
pnpm build
pnpm preview  # starts wrangler dev with the built bundle
curl -H "Host: scienceworld.local" http://localhost:8787/
# → HTML showing host: scienceworld.local
```

## Cloudflare account

Migration runs on the Dev1 account (`dev1@atomiclabs.io`, account id
`953511f6356ff606d84ac89bba3eff50`). Prod migration later uses a different
account — see `docs/migration-plan.md` Q4.
