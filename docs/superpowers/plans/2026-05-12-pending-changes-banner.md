# Pending Changes Banner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a page-level banner on the site detail page when the staging branch has unpublished changes, with an "Apply to Live Site" button that publishes to production.

**Architecture:** New API endpoint uses GitHub Compare API to detect if `staging/<domain>` is ahead of `main`. A client component fetches this on mount and renders an amber banner with a publish button above the tab bar. The button calls the existing `publishStagingToProduction` server action.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Octokit (GitHub API), Tailwind CSS v4.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `services/dashboard/src/app/api/sites/staging-status/route.ts` | Create | API: compare staging branch to main |
| `services/dashboard/src/components/site-detail/PendingChangesBar.tsx` | Create | Client component: banner + publish button |
| `services/dashboard/src/app/sites/[domain]/page.tsx` | Modify | Add PendingChangesBar above SiteDetailTabs |

---

### Task 1: API Endpoint — staging-status

**Files:**
- Create: `services/dashboard/src/app/api/sites/staging-status/route.ts`

- [ ] **Step 1: Create the API route**

Create `services/dashboard/src/app/api/sites/staging-status/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { readDashboardIndex } from "@/lib/github";
import { NETWORK_REPO_OWNER, NETWORK_REPO_NAME } from "@/lib/constants";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json(
      { error: "domain query param is required" },
      { status: 400 },
    );
  }

  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    const stagingBranch = site.staging_branch;
    if (!stagingBranch) {
      return NextResponse.json({ hasPendingChanges: false, aheadBy: 0, domain });
    }

    // Only relevant for live/ready sites
    if (site.status !== "Ready" && site.status !== "Live") {
      return NextResponse.json({ hasPendingChanges: false, aheadBy: 0, domain });
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GITHUB_TOKEN not configured" },
        { status: 500 },
      );
    }

    const octokit = new Octokit({ auth: token });

    const { data } = await octokit.repos.compareCommitsWithBasehead({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      basehead: `main...${stagingBranch}`,
    });

    return NextResponse.json(
      {
        hasPendingChanges: data.ahead_by > 0,
        aheadBy: data.ahead_by,
        domain,
      },
      { headers: { "Cache-Control": "private, max-age=10" } },
    );
  } catch (err) {
    console.error("[sites/staging-status] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to check staging status" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Verify the endpoint compiles**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/sites/staging-status/route.ts
git commit -m "feat(dashboard): add staging-status API endpoint

Compares staging branch to main via GitHub Compare API.
Returns { hasPendingChanges, aheadBy, domain }.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: PendingChangesBar Component

**Files:**
- Create: `services/dashboard/src/components/site-detail/PendingChangesBar.tsx`

- [ ] **Step 1: Create the component**

Create `services/dashboard/src/components/site-detail/PendingChangesBar.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { publishStagingToProduction } from "@/actions/wizard";

interface PendingChangesBarProps {
  domain: string;
  customDomain: string | null;
}

export function PendingChangesBar({
  domain,
  customDomain,
}: PendingChangesBarProps): React.ReactElement | null {
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [isPublishing, startPublish] = useTransition();
  const { toast } = useToast();

  const checkStatus = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/sites/staging-status?domain=${encodeURIComponent(domain)}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { hasPendingChanges: boolean };
      setHasPendingChanges(data.hasPendingChanges);
    } catch {
      // Silently fail — banner just won't show
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  function handlePublish(): void {
    startPublish(async () => {
      try {
        await publishStagingToProduction(domain);
        setHasPendingChanges(false);
        setConfirming(false);
        toast("Changes published to production!", "success");
      } catch {
        toast("Failed to publish to production", "error");
      }
    });
  }

  if (loading || !hasPendingChanges) return null;

  const displayDomain = customDomain ?? domain;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 min-w-0">
        <div className="shrink-0 rounded-full bg-amber-500/10 p-1">
          <svg
            className="h-4 w-4 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-300">
          You have unpublished changes on staging
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {confirming ? (
          <>
            <span className="text-xs text-[var(--text-secondary)]">
              Publish to {displayDomain}?
            </span>
            <Button
              size="sm"
              variant="primary"
              loading={isPublishing}
              onClick={handlePublish}
            >
              Confirm
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(): void => setConfirming(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            onClick={(): void => setConfirming(true)}
          >
            Apply to Live Site &mdash; {displayDomain}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/site-detail/PendingChangesBar.tsx
git commit -m "feat(dashboard): add PendingChangesBar component

Amber banner shown when staging branch has unpublished changes.
Includes confirmation step and calls publishStagingToProduction.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Integrate Banner into Site Detail Page

**Files:**
- Modify: `services/dashboard/src/app/sites/[domain]/page.tsx`

- [ ] **Step 1: Add PendingChangesBar above the tabs**

In `services/dashboard/src/app/sites/[domain]/page.tsx`:

1. Add import at the top (after existing imports):
```typescript
import { PendingChangesBar } from "@/components/site-detail/PendingChangesBar";
```

2. In the JSX return, insert `<PendingChangesBar>` between `<SiteDetailHeader>` and `<SiteDetailTabs>`. Only render for live/ready sites:

Replace:
```tsx
    <div className="space-y-6">
      <SiteDetailHeader
        site={site}
        logoUrl={
          (siteConfig?.theme as Record<string, unknown> | undefined)?.logo
            ? `/api/sites/asset?domain=${encodeURIComponent(decodedDomain)}&file=${encodeURIComponent(((siteConfig!.theme as Record<string, unknown>).logo as string).replace(/^\//, ""))}`
            : null
        }
      />
      <SiteDetailTabs
```

With:
```tsx
    <div className="space-y-6">
      <SiteDetailHeader
        site={site}
        logoUrl={
          (siteConfig?.theme as Record<string, unknown> | undefined)?.logo
            ? `/api/sites/asset?domain=${encodeURIComponent(decodedDomain)}&file=${encodeURIComponent(((siteConfig!.theme as Record<string, unknown>).logo as string).replace(/^\//, ""))}`
            : null
        }
      />
      {(site.status === "Ready" || site.status === "Live") && site.staging_branch && (
        <PendingChangesBar
          domain={decodedDomain}
          customDomain={site.custom_domain}
        />
      )}
      <SiteDetailTabs
```

- [ ] **Step 2: Verify the page compiles**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Run:
```bash
cloudgrid dev
```

1. Open `http://localhost:3001/sites/<any-live-site-domain>`
2. If the site has unpublished changes on staging, the amber banner should appear between the header and the tabs
3. Click "Apply to Live Site" — confirm step should appear
4. Click "Confirm" — should publish and banner should disappear
5. If the site has no pending changes, no banner should appear

- [ ] **Step 4: Commit**

```bash
git add services/dashboard/src/app/sites/[domain]/page.tsx
git commit -m "feat(dashboard): show pending-changes banner on site detail page

Renders PendingChangesBar above tabs for live/ready sites when
staging branch is ahead of main. Provides quick publish-to-production
without navigating to the Deployments tab.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
