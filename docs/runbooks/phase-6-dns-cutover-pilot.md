# Runbook — Phase 6: DNS cutover for `scienceworld` pilot

**Prereqs**
- Phases 0–5 all green on `docs/astro-workers-migration-plan` branch.
- Phase 5 workflow (`atomic-labs-network/.github/workflows/sync-kv.yml`) merged to network `main` and the required secrets set (see that file's commit message for the full list).
- `CONFIG_KV_STAGING` seeded with scienceworld (run `pnpm seed:kv scienceworld scienceworld-124.pages.dev` from `packages/site-worker/` or trigger `sync-kv.yml` with `site: scienceworld`).
- Deployed staging Worker verified serving scienceworld content.
- User is on the **Dev1** Cloudflare account (`953511f6...`). If cutover should happen on a different account, re-provision KV + Worker there first — this runbook assumes the Dev1 account.

## Pre-cutover — 24h soak

```bash
# 1. Seed production KV (CONFIG_KV) for scienceworld.
cd packages/site-worker
KV_NAMESPACE_ID=a69cb2c59507482ca5e6d114babdd098 \
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
pnpm seed:kv scienceworld scienceworld-124.pages.dev scienceworld-worker.dev1-953.workers.dev

# 2. Deploy prod Worker (adds env.production binding to CONFIG_KV prod).
pnpm build
wrangler deploy --config dist/server/wrangler.json --env production
# → https://atomic-site-worker.dev1-953.workers.dev

# 3. Smoke test against the prod Worker.
curl -s https://atomic-site-worker.dev1-953.workers.dev/_ping       # expect "ok"
curl -s https://atomic-site-worker.dev1-953.workers.dev/ | grep '<title>'
```

Leave this running for **at least 24 hours**. Do one sync-kv dry run via `workflow_dispatch` to confirm the CI path works end-to-end (sha shows up in `sync-status:scienceworld`).

## Cutover window

`scienceworld` has no live traffic (Staging status, no custom domain). Cutover can happen any time.

```bash
# 4. In Cloudflare dashboard → scienceworld's zone (or add zone first):
#    Workers Routes → add:  scienceworld-124.pages.dev/*  →  atomic-site-worker
#    (or whichever hostname scienceworld will live at)
#
# 5. OR via API:
curl -X POST "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/workers/routes" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "scienceworld-124.pages.dev/*", "script": "atomic-site-worker"}'
```

At this point the hostname resolves to the Worker. The old Pages project at `scienceworld` keeps existing on its `.pages.dev` subdomain for fallback — do not delete.

## Verification (post-cutover)

```bash
# 6. Confirm Worker serves the hostname.
curl -sI https://scienceworld-124.pages.dev/ | grep -i cf-worker
# If the worker is reachable, the response includes Cloudflare headers
# with Worker observability (cf-ray + worker timing)

curl -s https://scienceworld-124.pages.dev/ | grep '<title>'
# → matches scienceworld's site_name from KV

# 7. Confirm edit latency works.
# Edit scienceworld's site.yaml in the network repo, commit, push.
# Within ~30s the sync-kv.yml workflow should update KV;
# next request renders with the new value.
# (This is the "the migration actually worked" moment.)

# 8. Update dashboard-index.yaml entry for scienceworld:
#    worker: atomic-site-worker         # new field
#    worker_route: scienceworld-124.pages.dev/*
```

## Monitoring (first 48 h)

- `wrangler tail atomic-site-worker --format pretty` — watch for 5xx.
- Cloudflare dashboard → Workers → atomic-site-worker → Metrics → watch p95.
- If anything is off: rollback (below) and investigate.

## Rollback

```bash
# Remove the Worker route. The hostname then resolves back to the Pages project.
# Cloudflare dashboard → Workers Routes → find pattern, Delete
# Or:
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/<ZONE_ID>/workers/routes/<ROUTE_ID>" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Rollback time: seconds (DNS-internal). The Pages deployment stays up for as long as we want (CF keeps recent deployments).

## Done when

- Worker serves all scienceworld traffic for **≥ 7 days** with zero 5xx spikes.
- sync-kv.yml ran for every intentional config change with sync-status updated.
- At least one successful end-to-end: operator edits YAML → CI green → KV updated → next request served new value, no Worker redeploy.

Next runbook: `phase-7-dns-cutover-coolnews-atl.md` (same steps but for the Live site).
