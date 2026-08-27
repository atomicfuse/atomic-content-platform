# Audit log — sync-kv cancellation, staging clobbering, image alerts

**Date:** 2026-08-27 (investigation began 2026-08-11)
**Trigger:** "articles are on the worker preview but never publish to the live site"

## Four bugs, one workflow, one signature

Every one of them failed *silently* — reporting success while doing the wrong
thing. That is the reusable lesson: monitoring must detect **absence and
incorrectness**, not just errors.

### 1. Cross-site run eviction on `main` (network repo, fixed 2026-08-11)

`.github/workflows/sync-kv.yml` had a workflow-level
`concurrency.group: sync-kv-${{ github.ref_name }}`. On `main` every site
shared one group. Auto-publish pushes one commit per site ~25s apart; GitHub
keeps at most **one pending run per group** and evicts the previously pending
one. `cancel-in-progress: false` protects the running job, not the queue. Since
`detect` scopes a run to its own push diff, an evicted run's site was never
synced by anyone.

- **111 of 200** main-branch runs cancelled (55%). **30 of 53** sites stale in
  prod KV for up to a month. `sciencenewslab` last synced 2026-07-20 — exactly
  the date reported.
- Silent because `if: failure()` does not run on `cancelled`, so no Slack alert
  and `sync-status:<site>` kept its last green value.
- **Fix:** concurrency moved to the `sync` job, keyed `…-${{ matrix.site }}`.
- **Verified:** next tick 10/10 main runs green, 0 cancelled.

### 2. Staging-branch fan-out clobbering (network repo, fixed 2026-08-11)

The auto-publish force-reset of `staging/<domain>` produces a diff spanning
nearly every `sites/**` path, so `detect` selected all ~54 sites and the run
re-seeded the whole network into **staging KV** from that branch's snapshot of
main — frozen at that branch's reset moment. Ten sites publishing per tick meant
ten overlapping full-network re-seeds racing on the same keys; last finisher won,
often with a pre-publish snapshot.

- travelnights: its own run seeded 110 articles at 06:20:17; the `gigsfreaks`
  run (branch reset 06:04:35, before travelnights published at 06:06:21)
  overwrote it with 108 at 06:24:16. Both runs reported success — each verified
  against its own checkout's disk count.
- `tvshowsmag` caught the race live: seeded 109, read back 107 on all four
  verify attempts, failed correctly. That failure paged nobody because the Slack
  notify is gated on `ref_name == 'main'`.
- Burned **550 CI jobs per tick**.
- **Fix:** staging-branch runs sync only their own site. 550 jobs → ~10.

### 3. Auto-publish destroying late commits (platform, fixed 2026-08-27)

See `docs/bugs.md`. CAS on the staging ref before the destructive reset.

### 4. Image-timeout alerts decided from per-replica memory (platform, 2026-08-27)

See `docs/bugs.md`. `Replicas: 5/5` was the missing fact — all image tracking is
per-process.

## Diagnostic signature (the fastest triage next time)

| Symptom | Cause |
|---|---|
| Live stale, preview fresh | main-branch run eviction (#1) |
| Live fresh, preview stale | staging fan-out clobbering (#2) |
| Both fresh, images missing on main | auto-publish reset race (#3) |
| Image alerts that don't match the dashboard | per-replica alert state (#4) |

## Also found, not fixed

- **`run-alerts` cron is not firing.** Added 2026-06-07; the 11 alerting sites
  all carry `firstDetectedAt: 2026-06-08T17:00:02.653Z` (13:00 EDT — its exact
  slot), so it ran once and stopped. In a 48h log capture, the only
  `[alert-config]` lines were `runAfterRun` calls; nothing at the scheduled
  time. Consequence: `sync_failed`, `tracking_off`, `general_images` and
  `create_new_site` have not been evaluated since 2026-06-08. `sync_failed`
  being cron-only is *why* bug #1 was invisible — the CI never wrote
  `ok: false`, and nothing was reading it either.
- **`runAlerts` logs nothing on success**, which is why a dead daily cron went
  unnoticed for two months. Needs a heartbeat.
- **`in_review` is inert:** threshold >15/site, actual maximum 6.
- **`monthly_creation_alert` mismatch:** condition tests *failures*, message
  reports *creations*.
- **Slack notify is `main`-only** in CI, so staging-KV failures are recorded in
  `sync-status` and page nobody.
- **`DEV1_SITES` names `muvizzcom`**, but the live site is `muvizz` — likely
  stale, unverified.
- **`grid ssh` returns 403** for a grid **admin** — CloudGrid bug, worth
  reporting; blocked the direct cron test.
- **Manual edits on `main` for a live site silently revert** at that site's next
  publish, because auto-publish copies the whole staging tree over. The 8-article
  remediation had to be applied to both branches for this reason.

## Remediation performed

8 articles across 5 sites re-pointed from `<site>-general-article.webp` to their
real per-article image. All 8 R2 objects still resolved, so no regeneration was
needed. Applied to `main` **and** the two staging branches that also carried the
general image. All three sync runs green; all 8 verified live, cache-busted.

## Tests

Content-pipeline: **629 → 650** (+21). Both regression assertions were confirmed
to fail against the pre-fix code before being fixed:

- Bug #3: `expected "spy" to not be called at all, but actually been called 1 times`
- Bug #4: `expected "spy" to be called with arguments: [ 'dogslabs', … ]`

Artifacts: `docs/test-results/2026-08-27-1607-auto-publish-staging-cas.txt`,
`docs/test-results/2026-08-27-1615-image-timeout-alert.txt`.

Not tested locally by Asaf before commit (couldn't run it); deploy-time
verification is the 02:00 EST scheduler run.
