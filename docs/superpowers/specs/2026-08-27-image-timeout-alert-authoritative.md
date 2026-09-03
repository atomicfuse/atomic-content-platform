# Spec — Image-timeout alerts must verify against the article, not process memory

**Date:** 2026-08-27
**Bug:** A (of two found in the image-alert investigation)

## Goal

Stop the 300s image-timeout alert from firing on articles that have an image,
and start it firing on articles that don't — by checking the article itself
instead of one replica's in-memory state. Also fix the broken article URL in
the alert body.

## The defect

`sites-platform` runs **5 replicas**. All image tracking is per-replica,
in-process: `pendingImages`, `successfulImages`, `delayedAlerts`.

1. The queue worker on replica **X** calls `trackPendingImage` → 300s timer in
   X's memory.
2. n8n's callback is load-balanced to replica **Y**. Y commits the image and
   calls `markImageSuccess` in **Y's** `successfulImages`.
3. X's timer fires, checks **X's own** empty `successfulImages`, and alerts.

Proven by the 2026-08-27 log, same slug four minutes apart:

```
09:01:31  [dogslabs/firefighters-...] SUCCESS — image delivered (n8n_duration=21815ms)
09:05:43  TIMEOUT — no callback for dogslabs/firefighters-... after 300s
```

n8n took 22s, not 300. A same-replica callback could not produce both lines:
either `clearPendingImage(requestId)` or the `successfulImages` guard would have
suppressed the alert.

Result on that run: 4 alerts fired, all false; 5 articles genuinely lost their
image (Bug B), all silent. Zero of the alerts were correct.

### Second defect — the URL

`notifications.ts` built `https://${params.site}/articles/${params.slug}`, where
`params.site` is the **siteId**, not a hostname, and `/articles/` is not the
route. Both halves are wrong:

| Result | URL |
|---|---|
| DNS failure | `https://dogslabs/articles/<slug>` (what Slack sent) |
| 404 | `https://dogslabs.com/articles/<slug>/` |
| 200 | `https://dogslabs.com/<slug>/` |

## Architecture

Replace the in-memory success check with an **authoritative read** of the
article's `featuredImage` from Git, injected as a verifier so it stays testable
and so the timer keeps working when no verifier is supplied.

Git, not KV: KV is only seeded minutes later by CI, so at T+300s it is not yet
authoritative. Git is immediate and is what auto-publish copies from.

Unverifiable reads **alert** rather than stay silent. Every failure in this
investigation was a silence, not an error; a false positive is recoverable, a
silent loss is not. The reason string says which case it was.

The URL becomes a dashboard link — always valid, no hostname lookup, and the
dashboard is where the article is acted on. `DASHBOARD_PUBLIC_URL` moves into
`lib/config.ts` so it has one definition instead of being re-declared per file.

## Components

- **Modify** `src/lib/config.ts` — add `DASHBOARD_PUBLIC_URL`
- **Modify** `src/lib/notifications.ts` — correct link in `notifyImageDefaultFallback`
- **Modify** `src/alerts/run.ts` — re-export the shared constant (drop its local copy)
- **Modify** `src/agents/content-generation/n8n-image.ts`
  - `ImageVerifier` type + `createGitImageVerifier()`
  - pure `shouldAlertOnImageTimeout()`
  - timer verifies before alerting
- **Modify** call sites: `dedicated-agent.ts`, `queue/content-generation.ts`
- **Create** `src/__tests__/image-timeout-alert.test.ts`

Reuses the existing `isGeneralImage` from `bulk-image.ts` rather than adding a
fourth copy of the predicate.

## Data flow

Timer fires → in-memory success? → if not, read
`sites/<domain>/articles/<slug>.md` from `staging/<domain>`, falling back to
`main` → parse frontmatter → alert only if `featuredImage` is missing or a
general image.

## Error handling

- Verifier read fails on both branches → returns `null` → alert, with a reason
  naming the failed verification.
- Verifier throws → caught, treated as `null`.
- No verifier injected → previous behaviour (alert), so the timer is never
  silently disabled.
- Timer callback is async; all throws are contained so it can never crash the
  process.

## Edge cases

- Callback lands on the same replica → in-memory guard short-circuits, no read.
- Article published and staging reset between trigger and timeout → staging read
  succeeds anyway (staging == main after reset).
- Article deleted before the timeout → both reads fail → alert as unverifiable.
- Image succeeded but Bug B ate the commit → verifier sees the general image →
  alerts correctly. This is the case that was silent before.

## Test plan

`shouldAlertOnImageTimeout` (pure):
- in-process success → false
- real per-article image → false
- general image → true
- missing image → true
- `null` (unverifiable) → true

`trackPendingImage` (fake timers):
- verifier reports a real image → no alert (the 4 false positives)
- verifier reports a general image → alert (the 5 silent losses)
- verifier throws → alert, reason mentions verification
- `clearPendingImage` before the timeout → no alert, no read

`notifyImageDefaultFallback`:
- message contains the dashboard link
- message never contains `https://<siteId>/` or `/articles/<slug>`

## Out of scope

- Moving `pendingImages` into Redis (the verifier makes it unnecessary).
- The callback-error alert paths (`alertFailure`) — those report a real n8n
  error and are handled by the replica that received it, so they are already
  correct.
- Getting the `run-alerts` cron firing, and the general-images digest.
- Re-pointing the 5 already-lost `featuredImage` values (separate remediation).
