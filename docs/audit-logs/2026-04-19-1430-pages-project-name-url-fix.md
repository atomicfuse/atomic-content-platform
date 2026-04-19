# Audit Log: Pages Project Name URL Fix

**Session type:** Coding
**Date:** 2026-04-19
**Branch:** `fix/pages-project-name-url`
**Triggered by:** Bug: Preview/staging URLs use the site slug instead of the actual Cloudflare Pages project name. When Cloudflare appends a suffix (e.g., scienceworld-124 instead of scienceworld), all preview links break.

---

## Pre-flight Checks

- [x] `tsc --noEmit` — PASS (clean)
- [ ] `npm run lint` — skipped (no lint script in dashboard package.json)

## Investigation

### Step 1: Where URLs are constructed

Searched all `pages.dev` URL constructions in `services/dashboard/src/`. Found 15+ locations across:

| File | Line(s) | Pattern | Correct? |
|------|---------|---------|----------|
| `actions/review.ts` | 37 | `staging_branch → .${site.pages_project}.pages.dev` | YES |
| `components/site-detail/SiteDetailHeader.tsx` | 19, 22, 32 | `${site.pages_project}.pages.dev` | YES |
| `components/site-detail/StagingTab.tsx` | 44, 63, 329, 376 | `${pagesProject}.pages.dev` (prop from site.pages_project) | YES |
| `app/sites/[domain]/page.tsx` | 104 | `staging_branch → .${site.pages_project}.pages.dev` | YES |
| `components/site-detail/ContentGenerationPanel.tsx` | 130, 341-342 | `pagesProject ?? domainSlug` for fallback | OK (null guard) |
| `components/site-detail/ContentTab.tsx` | 272 | `${previewUrl}/${slug}/` or `${domain}/${slug}` | OK (not pages.dev) |
| `app/api/agent/build/route.ts` | 39 | `${branchSlug}.${body.projectName}.pages.dev` | OK (caller passes correct name) |
| **`actions/wizard.ts`** | **343-352** | **`staging/${projectName}` where projectName = pages_project** | **BUG: uses pages_project for branch name** |
| **`components/wizard/StepGoLive.tsx`** | **17** | **`staging-${projectName}.${projectName}.pages.dev`** | **BUG: uses same var for branch slug AND domain** |
| `actions/wizard.ts` | 200, 216 | Creation flow | OK (captures actual CF name) |
| `actions/wizard.ts` | 489 | `${branchSlug}.${site.pages_project}.pages.dev` | YES |
| `app/review/ReviewQueueClient.tsx` | 64-67 | Uses `article.stagingBaseUrl` from review.ts | YES |

### Step 2: Where Pages project name is stored

- **`dashboard-index.yaml`** in network repo: `sites[].pages_project` field
- **`site.yaml`** per-site config: `pages_project` field
- **Type:** `DashboardSiteEntry.pages_project: string | null` (types/dashboard.ts:19)
- **github.ts:79** backfills `pages_project: null` for old entries

### Step 3: Root Cause

**Scenario B confirmed** — the `pages_project` field exists and is correctly set by the creation flow (wizard.ts:186-231 captures `cfProject.name`). But two locations have bugs:

1. **`ensureStagingBranch`** (wizard.ts:343): When creating a NEW staging branch for a site that doesn't have one, it uses `site.pages_project ?? domain` for BOTH the branch name AND the pages.dev URL domain. The branch name should use `domain` (site folder name), not `pages_project` (CF project name).

2. **`StepGoLive.tsx`** (line 17): The fallback URL construction uses `projectName` for both the branch slug prefix and the pages.dev domain. When `stagingResult` is null, `projectName = data.pagesProjectName` (user input), producing `staging-scienceworld.scienceworld.pages.dev` instead of `staging-scienceworld.scienceworld-124.pages.dev`.

## Decision

**Store:** `pagesProjectName` is already stored as `pages_project` in dashboard-index.yaml.
**Fix approach:** Correct the two buggy URL constructions. No schema changes needed.
**Existing sites:** No migration needed — the creation flow already stores the correct name. Legacy sites with `pages_project: null` are handled by null guards in all URL builders.

## Changes Made

### 1. `services/dashboard/src/actions/wizard.ts` — `ensureStagingBranch`
- Branch name: `staging/${domain}` (NOT `staging/${pages_project}`)
- Preview URL: uses `pagesProject` (actual CF name) for the domain part

### 2. `services/dashboard/src/components/wizard/StepGoLive.tsx`
- Separated `siteSlug` from `pagesProject` in the fallback URL construction
- Branch slug prefix uses site slug; domain uses pages project name

## Post-change Verification

- [x] `tsc --noEmit` after wizard.ts change — PASS
- [x] `tsc --noEmit` after StepGoLive.tsx change — PASS
- [x] URL correctness: scienceworld (slug≠project) — staging: `staging-scienceworld.scienceworld-124.pages.dev` ✓
- [x] URL correctness: coolnews-atl (slug=project) — staging: `staging-coolnews-atl.coolnews-atl.pages.dev` ✓
- [x] All 15 UI locations audited — 13 were already correct, 2 fixed

## Key Insight

The main dashboard (SiteDetailHeader, StagingTab, ContentTab, ReviewQueue, ContentGenerationPanel) was already correct — these all use `site.pages_project` from the dashboard-index. The bugs were isolated to:
1. The `ensureStagingBranch` fallback path (creates staging for sites that lost their branch)
2. The wizard's final review step fallback (when creation hasn't completed yet)

The creation flow correctly captures the actual CF project name via `cfProject.name` from the Cloudflare API response (wizard.ts:186).
