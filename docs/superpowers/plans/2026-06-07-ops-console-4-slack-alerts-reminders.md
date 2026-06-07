# Ops Console 4 — Slack Alerts & Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A stateful, edge-triggered "Needs Attention" engine that posts Slack alerts for the ATL-specific conditions (failed articles, sync failed, in-review backlog, tracking off) plus two scheduled reminders, with dedup so it never re-fires every tick. Read-only `/attention` API for the console.

**Architecture:** The engine lives in content-pipeline (owns crons + the existing Slack helper). Per-`(site,condition)` state in Mongo (`alert_state`) drives edge-triggering via a pure `evaluateCondition(state, input, now)` (where `input = { alerting, value, policy }` — see `types.ts`). Inputs: `failedArticles` from the stats Mongo (Plan 1), `sync`/`tracking` from the checks readers (Plan 2), `reviewCount` from a KV `article-index` count. Delivery via a new exported `notifyAttention()` that posts the verbatim message (no severity prefix). Triggers: a daily cron + after-each-run. Infra alerts (down/SSL/domain) are owned by the Domains Dashboard, **not** this engine.

**Tech Stack:** TypeScript (strict), `mongodb` (Plan 1 `lib/mongo.ts`), existing `notifications.ts`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-slack-alerts-reminders-design.md`
**Depends on:** Plan 1 (`lib/mongo.ts`, stats repo, after-run hook point), Plan 2 (`checks/sync.ts`, `checks/tracking.ts`, `lib/kv.ts`).

---

## Pre-flight notes
- Branch `michal-dev`. Engine errors must never crash the cron; Slack-send failure must **not** advance `lastFiredAt` (so it retries next tick).
- **`now` is injected** into all engine logic (no `Date.now()` in pure functions) for testability.
- **Conditions fired here:** #1 failed articles (`>3`/7d), #3 sync failed (`ok:false`), #5 in-review (`>15`, on crossing), #8 tracking off. #9 image-gen ships **off**. #2/#4/#6/#7 are owned by the Domains Dashboard.
- **`notifications.ts` reality:** `dispatch`/`sendSlack`/`withSeverity` are module-private; only `notifyX` wrappers exported; severities are `critical`(🔴)/`not_critical`(🟡) with prefixes. We add a new **exported** `notifyAttention(config, message)` that posts the message verbatim (templates already carry their own `🔴`/`⚠`). `SLACK_WEBHOOK_URL` env → `config.slackWebhookUrl`.

## File structure
```
services/content-pipeline/
  src/lib/notifications.ts        (modify: export notifyAttention)
  src/alerts/types.ts             (create: ConditionId, AlertState, Policy)
  src/alerts/engine.ts            (create: evaluateCondition — pure)
  src/alerts/config.ts            (create: thresholds + enable flags + optional scheduler/alerts.yaml)
  src/alerts/inputs.ts            (create: gather per-site inputs: failedArticles, sync, tracking, reviewCount)
  src/alerts/run.ts               (create: runAlerts + reminders; reads inputs, evaluates, fires, upserts state)
  src/alerts/repo.ts              (create: getAttention[/:domain] read view)
  src/alerts/__tests__/*.test.ts
  src/agents/content-generation/index.ts   (modify: GET /run-alerts cron endpoint; GET /attention[/:domain]; after-run hook)
cloudgrid.yaml                    (modify: add run-alerts cron)
services/dashboard/src/app/api/attention/route.ts          (create: proxy)
services/dashboard/src/app/api/attention/[domain]/route.ts (create: proxy)
```

---

## Task 1: `notifyAttention` (verbatim Slack post)

**Files:** Modify `src/lib/notifications.ts`; Test `src/alerts/__tests__/notify.test.ts`.

- [ ] **Step 1: Failing test** — mock `fetch`; `notifyAttention({ slackWebhookUrl: "https://hooks.slack/x" }, "⚠ site: msg")` POSTs `{ text: "⚠ site: msg" }` exactly (no prefix); with no `slackWebhookUrl` it no-ops without throwing.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — export `notifyAttention(config: NotificationConfig, message: string)`; reuse the private `sendSlack` (post `{text: message}`); wrap in try/catch returning a boolean `ok` so the caller knows whether to advance `lastFiredAt`:
```typescript
export async function notifyAttention(config: NotificationConfig, message: string): Promise<boolean> {
  if (!config.slackWebhookUrl) return false;
  try { await sendSlack(config, message); return true; }
  catch (e) { console.error(`[alerts] slack send failed: ${(e as Error).message}`); return false; }
}
```
- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/lib/notifications.ts services/content-pipeline/src/alerts/__tests__/notify.test.ts
git commit -m "feat(content-pipeline): notifyAttention verbatim Slack helper"
```

---

## Task 2: The edge-trigger engine (`evaluateCondition`) — pure, the critical surface

**Files:** Create `src/alerts/types.ts`, `src/alerts/engine.ts`; Test `__tests__/engine.test.ts`.

- [ ] **Step 1: Types** (`types.ts`):
```typescript
export type ConditionId = "failed_articles" | "sync_failed" | "in_review" | "tracking_off";
export type FirePolicy = "transition_only" | "transition_then_daily";
export interface AlertState {
  _id: string;                 // `${domain}:${conditionId}` or `__network__:${reminderId}`
  status: "ok" | "alerting";
  firstDetectedAt: Date | null;
  lastFiredAt: Date | null;
  lastValue: number | null;
}
export interface EvalInput { alerting: boolean; value: number | null; policy: FirePolicy; }
export interface EvalResult { newState: AlertState; shouldFire: boolean; }
```

- [ ] **Step 2: Failing tests** covering each policy:
  - `transition_only` (sync/in_review/tracking): fires once on `ok→alerting`; does **not** re-fire while still alerting; resets to `ok` when `alerting=false`; can fire again after reset. (in-review "crossing 15" = `alerting = value>15`.)
  - `transition_then_daily` (failed_articles): fires on entering alerting; re-fires only if `now - lastFiredAt >= 24h` while still alerting; resets on clear.
  - `firstDetectedAt` set on entering alerting, cleared on reset.
  - `now` injected.
```typescript
import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../engine.js";
const t0 = new Date("2026-06-07T09:00:00Z");
const ok = (id="travelswire:in_review"): any => ({ _id:id, status:"ok", firstDetectedAt:null, lastFiredAt:null, lastValue:null });

it("transition_only fires once then stays quiet", () => {
  const r1 = evaluateCondition(ok(), { alerting:true, value:17, policy:"transition_only" }, t0);
  expect(r1.shouldFire).toBe(true);
  const r2 = evaluateCondition(r1.newState, { alerting:true, value:18, policy:"transition_only" }, new Date("2026-06-07T10:00:00Z"));
  expect(r2.shouldFire).toBe(false);
});
it("transition_then_daily re-fires after 24h", () => {
  const r1 = evaluateCondition(ok("s:failed_articles"), { alerting:true, value:5, policy:"transition_then_daily" }, t0);
  const r2 = evaluateCondition(r1.newState, { alerting:true, value:6, policy:"transition_then_daily" }, new Date("2026-06-08T09:30:00Z"));
  expect(r1.shouldFire && r2.shouldFire).toBe(true);
});
```

- [ ] **Step 3: Run → FAIL.**
- [ ] **Step 4: Implement `evaluateCondition`** — pure function honoring the two policies; sets `firstDetectedAt`/`lastValue`; only sets `lastFiredAt` when `shouldFire` (the caller passes back whether the Slack send succeeded — see Task 5; so `evaluateCondition` returns `shouldFire`, and the runner decides whether to persist `lastFiredAt`). Keep `lastFiredAt` advancement in the runner (Task 5), not here, so a failed Slack post doesn't mark fired.

- [ ] **Step 5: Run → PASS. Step 6: Commit**
```bash
git add services/content-pipeline/src/alerts/types.ts services/content-pipeline/src/alerts/engine.ts services/content-pipeline/src/alerts/__tests__/engine.test.ts
git commit -m "feat(content-pipeline): edge-trigger alert engine (pure)"
```

---

## Task 3: Config (thresholds + enable flags)

**Files:** Create `src/alerts/config.ts`; Test.

- [ ] **Step 1: Failing test** — `loadAlertConfig()` returns defaults when `scheduler/alerts.yaml` is absent: `{ enabled:true, failedArticles:{enabled:true, limit:3}, syncFailed:{enabled:true}, inReview:{enabled:true, limit:15}, trackingOff:{enabled:true}, imageGenFailed:{enabled:false}, reminders:{ reviewBacklog:{weekday:1}, createNewSite:{everyDays:14} } }`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** with code defaults; optionally read `scheduler/alerts.yaml` via Octokit `readFile` (main) and merge (mirror `dashboard/src/lib/scheduler.ts:readSchedulerConfig`). No SSL/domain thresholds (Domains Dashboard owns those).
- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/alerts/config.ts services/content-pipeline/src/alerts/__tests__/config.test.ts
git commit -m "feat(content-pipeline): alert config + defaults"
```

---

## Task 4: Per-site inputs (incl. reviewCount)

**Files:** Create `src/alerts/inputs.ts`; Test.

- [ ] **Step 1: Failing test** for `reviewCount(domain)` — given a mocked `article-index:<domain>` KV value (array of entries), counts `status==="review"`; KV null/error → 0 (logged).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**
  - `reviewCount(domain)`: read `article-index:${domain}` via `lib/kv.ts` (Plan 2) from prod namespace; count `status==="review"`.
  - `gatherInputs(domain, now)`: compose `{ failedArticles7d }` (from stats `repo.getSiteStats(domain, now).failedArticles.last7d`), `{ syncOk }` (from `checks/sync.readSyncStatus`), `{ trackingOk }` (from `checks/tracking.readTracking` — `ok = ga4 && (gtm || true)`? Per spec #8: "GA/GTM **or** Pixel not present" → define `trackingOff = !(ga4 || gtm) || !pixel`? Re-read spec: condition fires when "GA/GTM or Meta Pixel not firing". Implement `trackingOff = !pixel || !(ga4 || gtm)` and unit-test the boolean; adjust to the spec's exact intent), `{ reviewCount }`.
- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/alerts/inputs.ts services/content-pipeline/src/alerts/__tests__/inputs.test.ts
git commit -m "feat(content-pipeline): alert inputs (reviewCount + gather)"
```

---

## Task 5: The runner — evaluate, fire, persist state; reminders

**Files:** Create `src/alerts/run.ts`; Test `__tests__/run.test.ts` (in-memory Mongo + stubbed `notifyAttention`).

- [ ] **Step 1: Failing tests:**
  - For a site over the failed-articles limit, `runAlerts(now)` fires `notifyAttention` once with the exact template `⚠ {site}: {n} failed articles in 7d (limit 3)` and writes `alert_state` `status:"alerting"`, `lastFiredAt:now`.
  - Running again same day → no second fire (state arbiter).
  - **Slack failure does not advance `lastFiredAt`** (stub `notifyAttention` → false; assert `lastFiredAt` stays null and it retries next call).
  - Reminders: review-backlog digest fires only on its configured weekday, message `{n} articles waiting for review across the network` (n = sum of reviewCount); "create new site" respects `everyDays` cadence via `__network__:create_new_site` state.
  - Multi-trigger: calling the after-run path then the daily path doesn't double-fire the same condition.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `runAlerts(now, { onlySite?, conditions? })`:**
  - list sites via `listActiveSites(octokit, repo)` — it requires `(octokit, repo)` args (see `lib/site-brief.ts`); build the Octokit from `loadConfig().github` and pass `config.networkRepo`, as the existing agents do. For each enabled condition: `gatherInputs` → derive `{alerting, value}` → load `alert_state` (`_id = ${domain}:${conditionId}`) → `evaluateCondition` → if `shouldFire`, format the template and `notifyAttention`; **only if send succeeded** set `lastFiredAt=now`; persist `newState` (with `lastFiredAt` decided here).
  - reminders: evaluate network-scoped state keys; fire via `notifyAttention`.
  - Everything try/caught per condition; engine never crashes the cron.
  - Provide a thin `runAfterRun(domain, now)` that evaluates only `#1` + `#5` for one site (called from the generation hook).
- [ ] **Step 4: Run → PASS. Step 5: Commit**
```bash
git add services/content-pipeline/src/alerts/run.ts services/content-pipeline/src/alerts/__tests__/run.test.ts
git commit -m "feat(content-pipeline): alert runner + reminders with dedup"
```

---

## Task 6: Read view (`getAttention`) + routes + cron wiring + after-run hook

**Files:** Create `src/alerts/repo.ts`; modify `index.ts`; modify the generation hook; modify `cloudgrid.yaml`; create dashboard proxy.

- [ ] **Step 1:** `getAttention(domain?)` reads `alert_state`, returns `{ alerting: [{ condition, severity, since, value }] }` (severity is a display field: `sync_failed`→`critical`, others→`warn`; `value` null for boolean conditions). Unit-test the mapping.
- [ ] **Step 2:** Add routes in `index.ts`:
  - `GET /run-alerts` (cron target) → `await runAlerts(new Date())` → `{status:"ok"}` (catch → log, still 200 so cron isn't marked failed; or 500 — match the `/scheduled-publish` convention).
  - `GET /attention` / `GET /attention/:domain` → `getAttention(...)` (503 on Mongo failure).
- [ ] **Step 3:** After-run hook: at **each** of the three post-`runContentGeneration` boundaries where `recordGeneration` is called (Plan 1 Task 8 — HTTP `/content-generate`, queue worker, scheduler), also `void runAfterRun(siteDomain, new Date())` (fire-and-forget, failure-isolated). In the **scheduler** path, place it inside the per-site loop so each site is evaluated (not once per run).
- [ ] **Step 4:** `cloudgrid.yaml`: add a cron service mirroring `scheduled-publisher`:
```yaml
  run-alerts:
    type: cron
    schedule: "0 13 * * *"   # 09:00 EST-ish daily; tune
    timezone: EST
    run: http://content-pipeline-app/run-alerts
```
- [ ] **Step 5:** Dashboard `/api/attention/route.ts` + `[domain]/route.ts` — thin proxies via `getAgentUrl()`.
- [ ] **Step 6:** typecheck + tests both services → PASS. **Commit**
```bash
git add services/content-pipeline/src/alerts/repo.ts services/content-pipeline/src/agents/content-generation/index.ts cloudgrid.yaml services/dashboard/src/app/api/attention
git commit -m "feat: alerts cron + /attention read API + after-run hook + dashboard proxy"
```

---

## Final verification
- [ ] content-pipeline + dashboard typecheck & tests green; engine edge-case tests (Task 2) and Slack-failure-no-advance test (Task 5) green.
- [ ] Manual smoke (optional): seed a site with `failedArticles>3` in Mongo, `curl http://localhost:5000/run-alerts`, confirm one Slack post and `alert_state` written; second call same day → no duplicate.
- [ ] Scoped commits; no secrets staged.

## Notes
- The engine is the critical correctness surface — keep `evaluateCondition` pure and `now`-injected. State, not time-since-last-tick, is the single arbiter; that's what prevents double-firing across the daily + after-run triggers.
- `notifyAttention` posts verbatim — the runner does `{site}`/`{n}` substitution before calling.
- This is the last subsystem; it depends on Plans 1 and 2 being merged first.
