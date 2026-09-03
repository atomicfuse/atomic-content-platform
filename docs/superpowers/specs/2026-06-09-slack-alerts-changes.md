# Slack Alerts Changes Spec — 2026-06-09

## Change 1: `tracking_off` — remove pixel requirement

**Current logic:**
```
(!ga4 && !gtm) || !pixel
```
Fires when no analytics provider (GA4/GTM) OR no Meta pixel.

**New logic:**
```
!ga4 && !gtm
```
Only fires when there is NO analytics provider at all. Meta pixel is no longer checked.

**Files to change:**
- `services/content-pipeline/src/alerts/inputs.ts` — `computeTrackingOff()`: remove `|| !t.pixel` from the condition
- `services/content-pipeline/src/checks/tracking.ts` — `readTracking()`: can keep reading `pixel` for the dashboard checks UI, no functional change needed
- `services/content-pipeline/src/alerts/inputs.ts` — update the JSDoc comment (Spec #8 reference)
- `services/content-pipeline/src/alerts/__tests__/inputs.test.ts` — update test cases for the new logic

**Slack message (unchanged):**
`⚠ {domain}: analytics/pixel not firing`

**Consider:** Rename the message to `⚠ {domain}: no analytics provider (GA4/GTM) configured` since pixel is no longer part of the check.

---

## Change 2: Replace `failed_articles` with two new conditions

**Remove:** The current `failed_articles` condition (> 3 failed in 7d, daily re-fire).

**Add two new conditions:**

### 2a: `monthly_creation_alert` — high failure rate in a month

**Logic:**
1. Compute `expectedMonthly` = `articlesPerDay * preferredDays.length * 4.33` (from schedule)
2. Compute `createdLast30d` = sum of `created` from `generation_events` where `finishedAt >= 30 days ago` and `status in ["success", "partial"]`
3. Compute `failedLast30d` = sum of `failed` from `generation_events` where `finishedAt >= 30 days ago`
4. Alert when `failedLast30d > 0.7 * expectedMonthly` (more than 70% of expected articles failed)

**Fire policy:** Once per 30 days (check on every cron tick, but `lastFiredAt` + 30 days must have passed before re-firing).

**Slack message:**
```
⚠ Article creation alert: {siteName} — only {createdLast30d} articles created this month out of {expectedMonthly} expected
```

**Data needed (new):**
- `createdLast30d` — new aggregation in `repo.ts` or `daily.ts` (sum `created` from `generation_events` with `status in ["success", "partial"]`, `finishedAt >= 30d ago`)
- `expectedMonthly` — computed from the schedule snapshot (already available: `articlesPerDay * preferredDays.length * 4.33`)
- `siteName` — need to pass through from brief or dashboard-index (currently only `domain` is available in the alert runner)

**Note:** The `expectedMonthly` calculation needs the schedule. The alert runner already reads briefs for each site via `gatherInputs`. The schedule can be derived from the `site_stats` rollup doc (already has `schedule: ScheduleSnapshot`) or from the brief.

### 2b: `zero_articles_14d` — no articles created in 14 days

**Logic:**
1. Compute `createdLast14d` = sum of `created` from `generation_events` where `finishedAt >= 14 days ago` and `status in ["success", "partial"]`
2. Alert when `createdLast14d === 0`

**Fire policy:** Once per 14 days (check on every cron tick, but `lastFiredAt` + 14 days must have passed before re-firing).

**Slack message:**
```
🔴 Article creation alert: {siteName} — 0 articles created in the last 14 days
```

### Data changes needed

**New fields in `AlertInputs`:**
```typescript
interface AlertInputs {
  // ... existing fields ...
  createdLast30d: number;      // new
  failedLast30d: number;       // new (already have last7d/last30d in stats)
  createdLast14d: number;      // new
  expectedMonthly: number;     // new — from schedule
  siteName: string;            // new — for human-readable messages
}
```

**New aggregation functions:**
- `sumCreated(domain, since)` — sum `created` from `generation_events` where `status in ["success", "partial"]` and `finishedAt >= since`
- Can reuse/extend existing `sumField()` in `repo.ts` (currently only sums without status filter)

**New config fields in `AlertConfig`:**
```typescript
monthlyCreationAlert: { enabled: boolean; failureThresholdPct: number }  // default: enabled true, 70
zeroArticles14d: { enabled: boolean }                                     // default: enabled true
```

**Files to change:**
- `alerts/config.ts` — add new config fields + defaults
- `alerts/inputs.ts` — add new fields to `AlertInputs`, extend `gatherInputs()` to compute them
- `alerts/run.ts` — add new conditions in `planConditions()`, use new fire policies (30d / 14d intervals)
- `alerts/engine.ts` — may need a new fire policy type or extend `transition_then_daily` to support arbitrary intervals
- `alerts/types.ts` — add new `ConditionId` values, potentially new `FirePolicy` value
- `stats/repo.ts` — add `sumCreatedWithStatus(domain, since)` aggregation
- Tests for all of the above

---

## Change 3: `in_review` — no change

Keep as-is: fires once when > 15 articles in review for a site.

---

## Change 4: `sync_failed` — no change

Keep as-is: fires once when KV sync fails for a site.

---

## Change 5: Replace `imageGenFailed` with `general_images_reminder`

**Remove:** The current `imageGenFailed` condition (disabled, never wired).

**Add:** A weekly network-scoped reminder when any articles across the network use the default general image.

**Logic:**
1. Sum `generalImages` count across all sites (already computed per-site by the dashboard's `countArticleStats` — counts articles whose `featuredImage` is missing or contains `"general-article"`)
2. Alert when total `generalImages > 0`

**Fire policy:** Once per 7 days (network-scoped reminder, like `review_backlog`). Stored as `__network__:general_images`.

**Slack message:**
```
📷 There are {totalGeneralImages} articles using a general image — review it here: https://sites-platform-e297--atomic.cloudgrid.io/articles/general-images
```

**Data needed:**
- `generalImages` per site — needs to be computed in the alert runner. Currently this is computed on the dashboard side (`site-stats.ts` → `countArticleStats`). The alert runner would need to read `article-index:<domain>` from KV (same source as `reviewCount`) and count entries where `featuredImage` is missing or contains `"general-article"`.
- Alternatively, reuse the existing `generalImages` field from the `/site-stats` API response, but that would add a dependency from alerts → stats API.

**Simplest approach:** Extend `gatherInputs()` to also count general images from the KV article-index (same read already done for `reviewCount`). Sum across all sites in `runAlerts()`, then fire the reminder if > 0.

**New config field:**
```typescript
reminders: {
  // ... existing ...
  generalImages: { enabled: boolean }  // default: enabled true
}
```

**Dashboard page needed:** The link `https://sites-platform-e297--atomic.cloudgrid.io/articles/general-images` — need to confirm this route exists or create it. This is outside the scope of the alerts change but the link will be hardcoded in the message.

**Files to change:**
- `alerts/config.ts` — add `reminders.generalImages` config field
- `alerts/inputs.ts` — extend to return `generalImages` count per site
- `alerts/run.ts` — sum `generalImages` across all sites, add `general_images` reminder in `runReminders()`
- `alerts/repo.ts` — exclude `__network__:general_images` from site-level attention (already handled by `NETWORK_PREFIX` filter)
- Tests for all of the above

---

## Change 6: Reminders — remove `review_backlog`, keep `create_new_site`

**Remove:** `review_backlog` reminder. The weekly "N articles waiting for review" message is redundant — the per-site `in_review` alert already covers this.

**Keep:** `create_new_site` (every 14 days, "Time to create a new site").

**Files to change:**
- `alerts/run.ts` — remove the `review_backlog` block from `runReminders()`, remove `totalReviewCount` accumulation from the site loop
- `alerts/config.ts` — remove `reviewBacklog` from `AlertConfig` and `DEFAULT_ALERT_CONFIG`
- Tests — remove review_backlog test cases

**Note:** Existing `__network__:review_backlog` doc in MongoDB becomes orphaned. Harmless (never queried again), but can be cleaned up manually if desired.

---

## Change 7: No new conditions

No new alert conditions (site down, SSL expiring, domain expiring). These are visible on the ops dashboard but don't need Slack alerts.

---

## Change 8: Add dashboard links to all Slack messages

**Current:** Plain text messages with emoji + domain + metric.

**New:** Append a dashboard link to each message so the recipient can click through directly.

**Dashboard base URL:** `https://sites-platform-e297--atomic.cloudgrid.io`

**Updated message templates:**

| Condition | Message |
|-----------|---------|
| `tracking_off` | `⚠ {siteName}: no analytics provider (GA4/GTM) configured\nhttps://sites-platform-e297--atomic.cloudgrid.io/sites/{domain}` |
| `monthly_creation_alert` | `⚠ Article creation alert: {siteName} — only {createdLast30d} articles created this month out of {expectedMonthly} expected\nhttps://sites-platform-e297--atomic.cloudgrid.io/sites/{domain}` |
| `zero_articles_14d` | `🔴 Article creation alert: {siteName} — 0 articles created in the last 14 days\nhttps://sites-platform-e297--atomic.cloudgrid.io/sites/{domain}` |
| `sync_failed` | `🔴 {siteName}: content sync failed — visitors see old content\nhttps://sites-platform-e297--atomic.cloudgrid.io/sites/{domain}` |
| `in_review` | `⚠ {siteName}: {n} articles in review (limit 15)\nhttps://sites-platform-e297--atomic.cloudgrid.io/sites/{domain}` |
| `general_images` (reminder) | `📷 There are {totalGeneralImages} articles using a general image — review it here:\nhttps://sites-platform-e297--atomic.cloudgrid.io/articles/general-images` |
| `create_new_site` (reminder) | `Time to create a new site\nhttps://sites-platform-e297--atomic.cloudgrid.io/wizard` |

**Note:** All per-site messages now use `{siteName}` instead of `{domain}` for readability. Slack auto-links URLs on their own line.

**Implementation:** The dashboard base URL should come from an env var or constant (e.g. `DASHBOARD_URL`), falling back to `https://sites-platform-e297--atomic.cloudgrid.io`. This avoids hardcoding if the CloudGrid slug ever changes.

**Files to change:**
- `alerts/run.ts` — update all message templates in `planConditions()` and `runReminders()`
- `lib/config.ts` or `lib/constants.ts` — add `DASHBOARD_URL` constant/env var
- `alerts/inputs.ts` — ensure `siteName` is available in `AlertInputs`

---

## Summary of all changes

| # | Change | Status |
|---|--------|--------|
| 1 | `tracking_off`: remove pixel, only alert on no GA4/GTM | Spec'd |
| 2a | New `monthly_creation_alert`: >70% failure rate in 30d, fires monthly | Spec'd |
| 2b | New `zero_articles_14d`: 0 articles in 14d, fires bi-weekly | Spec'd |
| 3 | `in_review`: no change (keep > 15, fire once) | No work |
| 4 | `sync_failed`: no change (keep, fire once) | No work |
| 5 | New `general_images` reminder: weekly, with link to review page | Spec'd |
| 6 | Remove `review_backlog` reminder, keep `create_new_site` | Spec'd |
| 7 | No new conditions (no site-down/SSL/domain alerts) | No work |
| 8 | Add dashboard links + use siteName in all messages | Spec'd |

**Conditions removed:** `failed_articles`, `imageGenFailed` (was OFF), `review_backlog` reminder.

**Conditions added:** `monthly_creation_alert`, `zero_articles_14d`, `general_images` reminder.

**Conditions unchanged:** `in_review`, `sync_failed`, `tracking_off` (logic changed), `create_new_site` reminder.
