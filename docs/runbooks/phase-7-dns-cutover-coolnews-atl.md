# Runbook — Phase 7: DNS cutover for `coolnews-atl` (Live site)

**Prereqs**
- Phase 6 done. `scienceworld` stable on the Worker for ≥ 7 days.
- `coolnews-atl` already seeded into production KV (same account + namespace as scienceworld — namespaces are shared across sites).
- Operators know the rollback command cold. Re-read Phase 6 runbook.

## Pre-cutover

```bash
# 1. Seed production KV for coolnews-atl.
cd packages/site-worker
KV_NAMESPACE_ID=a69cb2c59507482ca5e6d114babdd098 \
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
pnpm seed:kv coolnews-atl coolnews.dev coolnews-atl.pages.dev

# 2. Capture a pre-cutover baseline for the ad-impression parity check.
#    From the ad-network dashboard (AdSense etc.) record:
#    - impressions / hr for the last 24 h
#    - RPM / hr for the last 24 h
#    - anything else the revenue team watches
#    Keep this alongside the cutover change record.

# 3. Confirm the prod Worker serves coolnews-atl via a test hostname
#    (already seeded in staging; add a prod lookup for safety):
wrangler kv key put \
  "site:coolnews-atl-test.dev1-953.workers.dev" \
  '{"siteId":"coolnews-atl"}' \
  --namespace-id=a69cb2c59507482ca5e6d114babdd098 \
  --account-id=953511f6356ff606d84ac89bba3eff50 \
  --remote

curl -s https://atomic-site-worker.dev1-953.workers.dev/ \
  -H "Host: coolnews-atl-test.dev1-953.workers.dev"
# (or just curl the prod Worker URL directly — it's seeded)
```

## Cutover window

- **Pick off-peak** — mid-night ET based on GA4 session curve.
- Communicate to anyone watching ad-network dashboards.
- Have the rollback terminal ready in a second window.

```bash
# 4. Add the Worker route for coolnews.dev:
curl -X POST "https://api.cloudflare.com/client/v4/zones/505b529c5928da452abb172f685d97a7/workers/routes" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "coolnews.dev/*", "script": "atomic-site-worker"}'

# 5. Also route the .pages.dev hostname so it keeps serving identical content
#    (removes the divergence between old Pages URLs and the Worker):
curl -X POST "https://api.cloudflare.com/client/v4/zones/<coolnews-atl-pages-zone-id>/workers/routes" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "coolnews-atl.pages.dev/*", "script": "atomic-site-worker"}'
# (Note: the .pages.dev subdomain may not be routable — if CF rejects,
# skip this step. Old .pages.dev URLs will still work via the Pages
# project itself.)
```

## Verification (first 60 minutes)

```bash
# 6. Live traffic is now reaching the Worker.
wrangler tail atomic-site-worker --format pretty   # watch for errors

# Key sanity checks:
# - 5xx rate on Worker Metrics dashboard
# - p95 latency (expect under 300 ms from edge)
# - Homepage + at least 5 article URLs return 200
# - GA4 events in real-time view (pixel island working)
# - Ad impressions rate in the ad-network dashboard —
#   should stay within ±10% of the baseline from step 2.
```

## First 48 hours

- Check ad-network revenue dashboards once every 6 hours.
- If impressions > 10% lower and not recovering after 2 h, investigate.
- Document anything surprising in `docs/sessions/<date>-phase-7-cutover.md`.

## Rollback

```bash
# List routes:
curl "https://api.cloudflare.com/client/v4/zones/505b529c5928da452abb172f685d97a7/workers/routes" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" | jq

# Delete by route id:
curl -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/505b529c5928da452abb172f685d97a7/workers/routes/<ROUTE_ID>" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Rollback returns coolnews.dev to the Pages project (still deployed, still up). Recovery time: ~30 s for CF edge to re-resolve.

## Done when

- coolnews.dev served exclusively by Worker for ≥ 14 days.
- Revenue parity within ±5% of pre-cutover baseline.
- No 5xx spikes beyond normal edge-noise levels.
- At least one editorial workflow completed end-to-end via KV sync:
  - Operator edits an article or config on `staging/coolnews-atl`.
  - Merges to main.
  - sync-kv.yml runs, writes to KV.
  - Change visible on coolnews.dev within 60 s. No rebuild.

Next: `phase-8-decommission.md`.
