# Wizard Edge Cases — QA Audit

**Date:** 2026-04-30
**Scope:** New-site wizard (`/wizard`) — all steps, server actions, polling, custom domain attachment.

---

## Critical — Data Consistency / Broken State

### EC-1: Branch exists on retry after partial failure

**Description:** User clicks "Deploy Staging", `createBranch` succeeds but `commitSiteFiles` fails (network error, GitHub API timeout). Branch `staging/<slug>` exists but has no site files. User clicks "Retry" — `createBranch` throws 422 "Reference already exists" and the entire action fails. User is stuck: can't retry, can't proceed. Manual branch deletion on GitHub required.

**Can we solve it?** Yes

**How:** Catch 422 from `createBranch`. If the branch already exists, treat it as a success (idempotent). The subsequent `commitSiteFiles` will overwrite whatever's on the branch. In `wizard.ts:287`, wrap the call:
```ts
try { await createBranch(repo, `staging/${slug}`, "main"); }
catch (e) { if (!is422(e)) throw e; /* branch exists, proceed */ }
```

---

### EC-2: Dashboard-index updated but branch creation failed

**Description:** Impossible with current ordering (branch created first, index updated last). But the reverse is dangerous: if index is updated and then branch creation fails, the dashboard lists a site that has no backing data. Currently the ordering is correct — index is step 9 of 10. **However**, if the index write succeeds but is the *last* step and then `revalidatePath` or a later operation fails, the index is fine but the user sees an error. Not a real data inconsistency.

**Can we solve it?** Already safe — ordering is correct. No action needed.

---

### EC-3: Files committed but CI not triggered

**Description:** `commitSiteFiles` succeeds (branch has all files), but `triggerWorkflowViaPush` fails (auth error, network timeout). `sync-kv.yml` never runs. Polling times out after 120s. User sees "Sync is taking longer than usual" and can proceed to Step 6, but Worker Preview shows 404.

**Can we solve it?** Yes

**How:** Two fixes:
1. **Retry the trigger:** Wrap `triggerWorkflowViaPush` in a retry loop (2 attempts with 2s delay).
2. **Fallback trigger:** If `.build-trigger` push fails, try `workflow_dispatch` via GitHub API as a backup (`POST /repos/{owner}/{repo}/actions/workflows/sync-kv.yml/dispatches`).

---

### EC-4: Index out of sync after partial action failure

**Description:** Steps 6-8 succeed (branch, files, CI trigger), but step 9 (`addSitesToIndex` / `updateSiteInIndex`) fails (GitHub API timeout). Site is being seeded to KV but doesn't appear in the dashboard. Orphaned branch, invisible site.

**Can we solve it?** Yes

**How:** Wrap the index update in a retry (2 attempts). If still fails, log the error details and surface a specific message: "Site files deployed but dashboard index update failed. The site will appear after manual index update." This at least gives the user clarity instead of a generic error.

---

### EC-5: Custom domain attach — rollback leaves CF registration behind

**Description:** `attachCustomDomain` writes to dashboard-index (step 1), registers on CF Worker (step 2), then seed KV (step 3) fails. Rollback reverts the index but does NOT deregister the CF custom domain. CF now routes the domain to the Worker, but KV has no `site:<hostname>` entry — requests return 404.

**Can we solve it?** Partially

**How:** Add CF deregistration to the rollback path. Currently rollback (lines 501-515) only reverts the index. Add a `deregisterWorkerCustomDomain` call before the index revert. If deregistration also fails, log it and surface to user: "Custom domain may need manual cleanup in Cloudflare dashboard."

---

### EC-6: Race condition — two users create same slug simultaneously

**Description:** User A and User B both enter slug "coolnews" in separate tabs/sessions. Both click "Deploy Staging" at roughly the same time. User A's `createBranch` succeeds. User B's `createBranch` gets 422. User B sees an error but has no idea why.

**Can we solve it?** Yes

**How:** Two complementary fixes:
1. **Pre-check:** Before step 5, check if `staging/<slug>` branch exists (`GET /repos/.../git/ref/heads/staging/<slug>`). If exists, show error *before* deploy: "A site with this slug already exists."
2. **Better error message:** Catch 422 specifically and show: "A site with slug '<slug>' is already being set up. Choose a different slug."

---

### EC-7: Race condition — simultaneous custom domain attaches to same domain

**Description:** Two users attach `example.com` to different sites at the same time. Both read dashboard-index (stale cache, 30s TTL), both find no conflict, both write. Last write wins in the index. CF registration: last `registerWorkerCustomDomain` call wins. Result: one site's domain silently stolen.

**Can we solve it?** Partially

**How:** Add a uniqueness check that reads the index *without cache* before writing: `readDashboardIndex(true /* skip cache */)`. Check if any other site already claims the custom domain. This is not a true lock but reduces the race window from 30s to the time between read and write (~500ms).

---

## High — User Experience / Confusing Failures

### EC-8: Gemini logo generation hangs indefinitely

**Description:** `generateLogoWithGemini` calls `fetch()` with **no timeout**. If Gemini API is slow or unresponsive, the entire `createSiteAndBuildStaging` action hangs. The user sees a spinner forever. Eventually the browser or Next.js server may time out (~30-60s), but the error is opaque.

**Can we solve it?** Yes

**How:** Add `AbortSignal.timeout(15_000)` to the Gemini fetch call:
```ts
const res = await fetch(url, { method: "POST", body, signal: AbortSignal.timeout(15_000) });
```
15 seconds is generous for image generation. On timeout, catch and return null (same as other Gemini failures — non-fatal).

---

### EC-9: `removeBackground` throws, crashes entire action

**Description:** `removeBackground` is called on the generated logo (line 1128) and on user-uploaded logos. It's NOT wrapped in try-catch. If the PNG is malformed or the function throws for any reason, the entire `createSiteAndBuildStaging` action fails — even though the site can work fine without a logo.

**Can we solve it?** Yes

**How:** Wrap `removeBackground` in try-catch everywhere it's called. On failure, use the original image (with background) and log a warning.

---

### EC-10: Page refresh during deploy kills action, leaves partial state

**Description:** User clicks "Deploy Staging", then hits Cmd+R (or browser crashes). The server action may still be executing mid-flight. Depending on where it was: branch may exist, files may be committed, index may be updated. User returns to empty Step 0 with no knowledge of what happened. Retrying hits EC-1 (branch exists → 422).

**Can we solve it?** Yes (EC-1 fix covers most of it)

**How:** The EC-1 fix (idempotent `createBranch`) solves the retry problem. Additionally:
1. After deploy succeeds, write `stagingResult` to `sessionStorage` so a refresh on Step 5/6 can recover it.
2. On wizard mount, check if `staging/<slug>` branch already exists. If so, skip deploy and go straight to polling/preview.

---

### EC-11: Polling succeeds on non-200 status (e.g., 500)

**Description:** Polling logic checks `if (res.status !== 404)` — meaning **any** non-404 status (including 500, 502, 301) is treated as "site is live". The preview URL is set and the iframe may show an error page.

**Can we solve it?** Yes

**How:** Change the poll condition to `if (res.ok)` (status 200-299). On non-404 non-ok status, keep polling (transient error). Add a separate counter for consecutive non-404 errors; after 5, show a warning: "Preview returned an error. The site may still be syncing."

---

### EC-12: User clicks "Deploy Staging" twice fast (double-click)

**Description:** Button is disabled during the React transition, but there's a brief window before the transition starts where a second click could fire. Two `createSiteAndBuildStaging` calls would race — one succeeds, one hits 422 on `createBranch`.

**Can we solve it?** Yes

**How:** Add a `useRef` guard that's set synchronously on first click (before `startTransition`). Check the ref at the top of the handler and bail if already deploying. This is more reliable than relying on button disable.

---

### EC-13: Polling timeout but user proceeds — preview iframe shows 404

**Description:** After 120s polling timeout, the wizard shows a warning but sets the preview URL anyway. User clicks "Next" to Step 6. The iframe loads the Worker Preview URL which is still 404 (KV not synced yet). User sees a broken preview.

**Can we solve it?** Yes

**How:** On timeout, don't auto-set previewUrl. Instead show a clear message: "KV sync hasn't completed yet. You can wait or proceed — the preview will become available once sync finishes." Show a "Check again" button that re-polls. Only set previewUrl when a 200 is actually received.

---

## Medium — Input Validation Gaps

### EC-14: Slug has no length limit

**Description:** `pagesProjectName` is sanitized (lowercase, alphanumeric, hyphens) but has no max length. A user could paste a 1000-character slug. This becomes a branch name (`staging/aaaa...`), a directory name (`sites/aaaa.../`), and a KV key prefix — all could hit platform limits.

**Can we solve it?** Yes

**How:** Add `maxLength={63}` to the input field (matches DNS label limit and GitHub branch name best practices). Show character count.

---

### EC-15: Slug can be all hyphens or start/end with hyphens

**Description:** Sanitization removes non-alphanumeric except hyphens, but allows `---`, `-site-`, `--my--site--`. These produce ugly branch names and potentially invalid directory names.

**Can we solve it?** Yes

**How:** After sanitization, trim leading/trailing hyphens and collapse consecutive hyphens:
```ts
const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
```

---

### EC-16: `siteName` accepts whitespace-only string

**Description:** `canProceed` checks truthiness of `data.siteName`. The string `"   "` (only spaces) is truthy. Produces a site with a blank-looking name in YAML/UI.

**Can we solve it?** Yes

**How:** Trim before checking: `canProceed = data.pagesProjectName?.trim() && data.siteName?.trim()`. Also trim on save.

---

### EC-17: `articlesPerDay` has no bounds

**Description:** Number input with no min/max. User can enter 0 (scheduler never publishes), -1 (undefined behavior), or 99999 (scheduler tries to generate thousands of articles per run, hammering Anthropic API).

**Can we solve it?** Yes

**How:** Add `min={1} max={10}` to the number input. Clamp on save: `Math.max(1, Math.min(10, value))`.

---

### EC-18: `preferredDays` can be empty (no days selected)

**Description:** User can deselect all days. With no preferred days, the scheduler has `preferred_days: []`. Division by zero in `ceil(articles_per_week / preferred_days.length)`.

**Can we solve it?** Yes

**How:** Require at least one day selected. Disable "Next" if `preferredDays.length === 0`. Show hint: "Select at least one day."

---

### EC-19: Topics array has no size limit

**Description:** User can add unlimited topics. Each topic is stored in `site.yaml` under `brief.topics`. 500 topics would bloat the YAML and the KV value.

**Can we solve it?** Yes

**How:** Cap at 20 topics. After 20, disable the "Add" button and show: "Maximum 20 topics."

---

### EC-20: Theme hex color not validated in text input

**Description:** Color picker constrains to valid hex, but the text input next to it accepts any string. Invalid hex (e.g., `"zzz"`) gets written to site.yaml, potentially breaking CSS rendering in the Worker.

**Can we solve it?** Yes

**How:** Validate on blur: if not a valid 3 or 6 digit hex, revert to previous value or show error border.

---

## Low — Acceptable by Design / Self-Healing

### EC-21: Form data lost on page refresh

**Description:** All wizard state is in React `useState`. Refreshing the page at any step loses everything. User must start over.

**Can we solve it?** Yes, but not worth it.

**How:** Could persist to `sessionStorage` on every step change. But this is a one-time setup wizard (run once per site). The friction of re-filling is low. Trade-off: added complexity vs. rare annoyance.

---

### EC-22: Content Aggregator down — site created without bundle

**Description:** If the aggregator is unreachable, `createBundle` returns null. Site is created with `bundle_id: undefined`. No niche targeting rules applied.

**Can we solve it?** Already handled.

**How:** Non-fatal by design. User can assign a bundle later via Site Settings. The site works fine without one.

---

### EC-23: Gemini logo generation fails — site created without logo

**Description:** If Gemini API fails, site is created with no logo. Homepage renders without a logo image.

**Can we solve it?** Already handled.

**How:** Non-fatal by design. User can upload a logo later via Site Settings -> Identity -> Edit Assets.

---

### EC-24: Email routing setup fails during custom domain attach

**Description:** `setupEmailRouting` fails after domain is successfully attached. Email forwarding doesn't work.

**Can we solve it?** Already handled (best-effort).

**How:** Logged as error. User can set up email routing manually via Cloudflare dashboard or retry through the dashboard email settings.

---

### EC-25: `sync-kv.yml` CI run fails after successful wizard deploy

**Description:** Files committed, CI triggered, but the GitHub Actions workflow fails (infra issue, R2 upload error, etc.). KV not seeded. Preview 404s.

**Can we solve it?** Self-healing.

**How:** User or CI re-runs the workflow. `sync-kv.yml` is idempotent. Next push to the branch also triggers it. Polling timeout message already tells user to wait.

---

### EC-26: `attachCustomDomain` — known gap with `emit-env-configs.ts`

**Description:** `attachCustomDomain` registers the domain via CF API at runtime. But `emit-env-configs.ts` (source of truth for routes) doesn't know about it. Next `pnpm deploy:production` could drop the route.

**Can we solve it?** Yes, but out of scope for this spec.

**How:** Already documented as a known bug in `flow-map-he.md` section 2.6. Needs its own design: `attachCustomDomain` should also commit to `emit-env-configs.ts` and trigger a deploy. Tracked separately.

---

## Summary

| ID | Severity | Area | Solvable? | Effort |
|----|----------|------|-----------|--------|
| EC-1 | Critical | Retry after partial failure | Yes | Small |
| EC-2 | — | Index ordering | Already safe | — |
| EC-3 | Critical | CI trigger failure | Yes | Small |
| EC-4 | Critical | Index write failure | Yes | Small |
| EC-5 | Critical | Custom domain rollback | Partially | Medium |
| EC-6 | Critical | Race: same slug | Yes | Small |
| EC-7 | Critical | Race: same domain | Partially | Small |
| EC-8 | High | Gemini timeout | Yes | Small |
| EC-9 | High | removeBackground crash | Yes | Small |
| EC-10 | High | Refresh during deploy | Yes | Medium |
| EC-11 | High | Poll accepts non-200 | Yes | Small |
| EC-12 | High | Double-click deploy | Yes | Small |
| EC-13 | High | Timeout shows broken preview | Yes | Small |
| EC-14 | Medium | Slug length | Yes | Small |
| EC-15 | Medium | Slug leading/trailing hyphens | Yes | Small |
| EC-16 | Medium | Whitespace-only siteName | Yes | Small |
| EC-17 | Medium | articlesPerDay unbounded | Yes | Small |
| EC-18 | Medium | Empty preferredDays | Yes | Small |
| EC-19 | Medium | Topics array unbounded | Yes | Small |
| EC-20 | Medium | Hex color not validated | Yes | Small |
| EC-21 | Low | Form lost on refresh | Yes, not worth it | Medium |
| EC-22 | Low | Aggregator down | Already handled | — |
| EC-23 | Low | Gemini logo fails | Already handled | — |
| EC-24 | Low | Email routing fails | Already handled | — |
| EC-25 | Low | CI run fails | Self-healing | — |
| EC-26 | Low | emit-env-configs gap | Yes, separate task | Large |
