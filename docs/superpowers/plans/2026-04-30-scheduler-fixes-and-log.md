# Scheduler Fixes & Dashboard Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix tag creation bug starving sites of content, create explicit scheduler config, and add a persistent scheduler run log visible in the dashboard.

**Architecture:** Content-pipeline captures per-site article results from `runContentGeneration` and writes them to `scheduler/history.json` on the network repo's main branch after each actual run. Dashboard reads this file via a new API route and renders it in a new Settings tab.

**Tech Stack:** TypeScript, Next.js 15 App Router, Node HTTP server, Octokit (GitHub API), YAML/JSON

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `services/content-pipeline/src/agents/content-generation/api-client.ts` | Modify | Accept HTTP 200 in `createTag()` |
| `services/content-pipeline/src/agents/scheduled-publisher/index.ts` | Modify | Capture per-site results, write run history |
| `services/content-pipeline/src/agents/scheduled-publisher/history.ts` | Create | `SchedulerRunEntry` type + `writeRunHistory()` helper |
| `services/dashboard/src/app/api/scheduler/history/route.ts` | Create | GET endpoint reads `scheduler/history.json` |
| `services/dashboard/src/app/settings/scheduler-log/page.tsx` | Create | Scheduler log UI page |
| `services/dashboard/src/app/settings/layout.tsx` | Modify | Add "Scheduler Log" tab |

---

### Task 1: Fix tag creation — accept HTTP 200

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/api-client.ts:184`

- [ ] **Step 1: Fix the status check in `createTag()`**

In `api-client.ts`, line 184, change:

```ts
// Before:
if (response.status === 201) {
  return (await response.json()) as TagItem;
}

// After:
if (response.status === 201 || response.status === 200) {
  return (await response.json()) as TagItem;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/api-client.ts
git commit -m "fix(content-pipeline): accept HTTP 200 from aggregator tag creation

The aggregator returns 200 instead of 201 when creating tags.
This caused 3/4 topic tags to fail for coolnews-atl, leaving the
aggregator query with only 1 tag and 0 matching articles.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create `scheduler/config.yaml` in network repo

This is a manual commit to the **network repo** (`atomic-labs-network`), not the platform repo.

- [ ] **Step 1: Create the config file**

Create `scheduler/config.yaml` in the network repo on `main`:

```yaml
enabled: true
run_at_hours:
  - 14
timezone: EST
```

- [ ] **Step 2: Commit to network repo**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
mkdir -p scheduler
# (write the file)
git add scheduler/config.yaml
git commit -m "scheduler: create explicit config (was using defaults from 404 fallback)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Define `SchedulerRunEntry` type and `writeRunHistory()` helper

**Files:**
- Create: `services/content-pipeline/src/agents/scheduled-publisher/history.ts`

- [ ] **Step 1: Create the history module**

```ts
/**
 * Scheduler run history — persists run results to the network repo
 * so the dashboard can display a log of past runs.
 *
 * Storage: scheduler/history.json on main branch.
 * Written after each actual run (not no-op hour-skipped ticks).
 * Capped at 50 entries (rolling window).
 */

import { createGitHubClient, readFile, commitFile } from "../../lib/github.js";
import type { AgentConfig } from "../../lib/config.js";

const HISTORY_PATH = "scheduler/history.json";
const MAX_ENTRIES = 50;

export interface SiteRunResult {
  domain: string;
  status: "success" | "partial" | "error" | "no_content";
  articlesCreated: number;
  articlesRequested: number;
  message?: string;
}

export interface SchedulerRunEntry {
  timestamp: string;
  timezone: string;
  forced: boolean;
  sites: SiteRunResult[];
  skipped: Array<{ domain: string; reason: string }>;
}

/** Read existing history from network repo main. Returns [] on 404. */
async function readHistory(config: AgentConfig): Promise<SchedulerRunEntry[]> {
  const octokit = createGitHubClient(config.github);
  try {
    const raw = await readFile(octokit, config.networkRepo, HISTORY_PATH);
    return JSON.parse(raw) as SchedulerRunEntry[];
  } catch {
    return [];
  }
}

/**
 * Append a run entry to scheduler/history.json on main.
 * Reads the current file, prepends the new entry, caps at MAX_ENTRIES,
 * and commits back. Errors are logged but do not throw — history
 * persistence must never break the scheduler itself.
 */
export async function writeRunHistory(
  entry: SchedulerRunEntry,
  config: AgentConfig,
): Promise<void> {
  try {
    const history = await readHistory(config);
    history.unshift(entry);
    const trimmed = history.slice(0, MAX_ENTRIES);
    const octokit = createGitHubClient(config.github);
    await commitFile(octokit, config.networkRepo, {
      path: HISTORY_PATH,
      content: JSON.stringify(trimmed, null, 2),
      message: `scheduler: log run ${entry.timestamp}`,
      branch: "main",
    });
    console.log(`[scheduled-publisher] History written (${trimmed.length} entries)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduled-publisher] Failed to write run history: ${msg}`);
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/content-pipeline/src/agents/scheduled-publisher/history.ts
git commit -m "feat(scheduled-publisher): add run history persistence

Writes scheduler run results to scheduler/history.json on the
network repo main branch. Dashboard reads this file to display
a log of past runs with per-site article counts and errors.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Capture per-site results in `runScheduledPublish`

**Files:**
- Modify: `services/content-pipeline/src/agents/scheduled-publisher/index.ts:152-272`

The current code adds domain strings to `result.triggered[]` without capturing what `runContentGeneration` actually produced. We need to capture the `BatchContentGenerationResult` per site and build a `SchedulerRunEntry`.

- [ ] **Step 1: Add imports and new tracking array**

At the top of the file, add the import:

```ts
import { writeRunHistory } from "./history.js";
import type { SiteRunResult, SchedulerRunEntry } from "./history.js";
```

- [ ] **Step 2: Hoist `articlesPerDay` and declare `siteResults`**

Before the site iteration loop (before line 207 `// 3. Iterate sites`), add:

```ts
  const siteResults: SiteRunResult[] = [];
```

Inside the loop body, hoist `articlesPerDay` so it's accessible in both try and catch. Change the structure from:

```ts
  for (const { domain, branch: preferredBranch } of activeSites) {
    try {
      // ... brief reading ...
      const articlesPerDay = resolveArticlesPerDay(schedule);
```

To:

```ts
  for (const { domain, branch: preferredBranch } of activeSites) {
    let articlesPerDay = 0;
    try {
      // ... brief reading (unchanged) ...
      articlesPerDay = resolveArticlesPerDay(schedule);
```

This makes `articlesPerDay` available in the catch block with the real value if resolution succeeded, or 0 if it failed before that point.

- [ ] **Step 3: Replace the generation call to capture results**

Replace the site processing block (lines 251-258) inside `runScheduledPublish`. Change:

```ts
      console.log(
        `[scheduled-publisher] Triggering ${articlesPerDay} article(s) for ${domain} on ${writeBranch}`,
      );
      await runContentGeneration(
        { siteDomain: domain, count: articlesPerDay, branch: writeBranch },
        config,
      );
      result.triggered.push(domain);
```

To:

```ts
      console.log(
        `[scheduled-publisher] Triggering ${articlesPerDay} article(s) for ${domain} on ${writeBranch}`,
      );
      const genResult = await runContentGeneration(
        { siteDomain: domain, count: articlesPerDay, branch: writeBranch },
        config,
      );
      result.triggered.push(domain);

      const created = genResult.results.filter((r) => r.status === "created").length;
      const genErrors = genResult.results.filter((r) => r.status === "error");
      let siteStatus: SiteRunResult["status"];
      let siteMessage: string | undefined;

      if (genResult.totalSourced === 0) {
        siteStatus = "no_content";
        siteMessage = "Aggregator returned 0 items for this site's topics";
      } else if (created === 0 && genErrors.length > 0) {
        siteStatus = "error";
        siteMessage = genErrors.map((e) => e.message ?? e.reason ?? "unknown").join("; ");
      } else if (created === 0 && genErrors.length === 0) {
        siteStatus = "no_content";
        siteMessage = `All ${genResult.results.length} item(s) skipped (duplicates or filtered)`;
      } else if (created < articlesPerDay && genErrors.length > 0) {
        siteStatus = "partial";
        siteMessage = `${genErrors.length} article(s) failed: ${genErrors[0]?.message ?? "unknown"}`;
      } else {
        siteStatus = "success";
      }

      siteResults.push({
        domain,
        status: siteStatus,
        articlesCreated: created,
        articlesRequested: articlesPerDay,
        message: siteMessage,
      });
```

- [ ] **Step 4: Update the catch block to push to `siteResults`**

Replace the catch block (lines 259-263):

```ts
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduled-publisher] Error processing ${domain}:`, message);
      result.errors.push({ domain, error: message });
      siteResults.push({
        domain,
        status: "error",
        articlesCreated: 0,
        articlesRequested: articlesPerDay,
        message,
      });
    }
```

Since `articlesPerDay` was hoisted with `let articlesPerDay = 0` before the try, it's accessible here with the real value if resolution succeeded.

- [ ] **Step 5: Write history after the loop**

After the Done log line (line 269), before the return, add the history write:

```ts
  // 4. Persist run history (best-effort, never blocks)
  if (siteResults.length > 0 || result.skipped.length > 0) {
    const entry: SchedulerRunEntry = {
      timestamp: new Date().toISOString(),
      timezone: schedCfg.timezone,
      forced: force,
      sites: siteResults,
      skipped: result.skipped,
    };
    await writeRunHistory(entry, config);
  }
```

- [ ] **Step 6: Verify typecheck passes**

Run: `cd services/content-pipeline && pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add services/content-pipeline/src/agents/scheduled-publisher/index.ts
git commit -m "feat(scheduled-publisher): capture per-site article results and write history

Captures BatchContentGenerationResult per site to track articles
created vs requested, categorizes as success/partial/error/no_content,
and writes the run entry to scheduler/history.json after each actual run.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: Dashboard API — `GET /api/scheduler/history`

**Files:**
- Create: `services/dashboard/src/app/api/scheduler/history/route.ts`

- [ ] **Step 1: Create the API route**

```ts
import { NextResponse } from "next/server";
import { readFileContent } from "@/lib/github";

const HISTORY_PATH = "scheduler/history.json";

export async function GET(): Promise<NextResponse> {
  try {
    const raw = await readFileContent(HISTORY_PATH, "main");
    if (raw === null) {
      return NextResponse.json([]);
    }
    const entries = JSON.parse(raw) as unknown[];
    return NextResponse.json(entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to read scheduler history: ${message}` },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/scheduler/history/route.ts
git commit -m "feat(dashboard): add GET /api/scheduler/history endpoint

Reads scheduler/history.json from the network repo main branch.
Returns empty array if file doesn't exist yet.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Add "Scheduler Log" tab to Settings layout

**Files:**
- Modify: `services/dashboard/src/app/settings/layout.tsx:3-9`

- [ ] **Step 1: Add the tab entry**

In the `TABS` array, add after the "General Scheduler" entry:

```ts
const TABS = [
  { label: "Org", href: "/settings" },
  { label: "Network", href: "/settings/network" },
  { label: "Domains", href: "/settings/domains" },
  { label: "General Scheduler", href: "/settings/scheduler" },
  { label: "Scheduler Log", href: "/settings/scheduler-log" },
  { label: "Email", href: "/settings/email" },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/app/settings/layout.tsx
git commit -m "feat(dashboard): add Scheduler Log tab to settings navigation

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Create Scheduler Log page UI

**Files:**
- Create: `services/dashboard/src/app/settings/scheduler-log/page.tsx`

- [ ] **Step 1: Create the page component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";

interface SiteRunResult {
  domain: string;
  status: "success" | "partial" | "error" | "no_content";
  articlesCreated: number;
  articlesRequested: number;
  message?: string;
}

interface SchedulerRunEntry {
  timestamp: string;
  timezone: string;
  forced: boolean;
  sites: SiteRunResult[];
  skipped: Array<{ domain: string; reason: string }>;
}

function formatTimestamp(iso: string, timezone: string): string {
  try {
    const TIMEZONE_MAP: Record<string, string> = {
      EST: "America/New_York",
      EDT: "America/New_York",
      PST: "America/Los_Angeles",
      PDT: "America/Los_Angeles",
      CST: "America/Chicago",
      CDT: "America/Chicago",
      MST: "America/Denver",
      MDT: "America/Denver",
    };
    const resolved = TIMEZONE_MAP[timezone.toUpperCase()] ?? timezone;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: resolved,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

const STATUS_STYLES: Record<SiteRunResult["status"], { dot: string; text: string }> = {
  success: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400" },
  partial: { dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-400" },
  error: { dot: "bg-red-500", text: "text-red-400" },
  no_content: { dot: "bg-orange-500", text: "text-orange-700 dark:text-orange-400" },
};

function SiteRow({ site }: { site: SiteRunResult }): React.ReactElement {
  const style = STATUS_STYLES[site.status];
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-mono font-medium text-[var(--text-primary)]">
            {site.domain}
          </span>
          <span className={`text-xs font-mono ${style.text}`}>
            {site.status === "no_content"
              ? "no content"
              : `${site.articlesCreated}/${site.articlesRequested} articles`}
          </span>
        </div>
        {site.message && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
            {site.message}
          </p>
        )}
      </div>
    </div>
  );
}

function SkippedRow({ domain, reason }: { domain: string; reason: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 bg-[var(--text-muted)]" />
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-mono text-[var(--text-muted)]">{domain}</span>
        <span className="text-xs text-[var(--text-muted)]">skipped — {reason}</span>
      </div>
    </div>
  );
}

function RunCard({ entry }: { entry: SchedulerRunEntry }): React.ReactElement {
  const hasErrors = entry.sites.some((s) => s.status === "error" || s.status === "no_content");
  const allGood = entry.sites.length > 0 && entry.sites.every((s) => s.status === "success");
  const borderColor = hasErrors
    ? "border-red-500/30"
    : allGood
      ? "border-green-500/30"
      : "border-[var(--border-primary)]";

  return (
    <div
      className={`rounded-xl border ${borderColor} bg-[var(--bg-elevated)] overflow-hidden`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {formatTimestamp(entry.timestamp, entry.timezone)}
        </span>
        <span
          className={`text-xs font-mono px-2 py-0.5 rounded-full ${
            entry.forced
              ? "bg-violet-500/20 text-violet-400"
              : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
          }`}
        >
          {entry.forced ? "manual" : "cron"}
        </span>
      </div>
      <div className="px-4 py-2 divide-y divide-[var(--border-secondary)]">
        {entry.sites.map((site) => (
          <SiteRow key={site.domain} site={site} />
        ))}
        {entry.skipped.map((s) => (
          <SkippedRow key={s.domain} domain={s.domain} reason={s.reason} />
        ))}
        {entry.sites.length === 0 && entry.skipped.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] py-2">No sites processed</p>
        )}
      </div>
    </div>
  );
}

export default function SchedulerLogPage(): React.ReactElement {
  const { toast } = useToast();
  const [entries, setEntries] = useState<SchedulerRunEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/scheduler/history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as SchedulerRunEntry[];
        setEntries(data);
      } catch {
        toast("Failed to load scheduler log", "error");
      }
      setLoading(false);
    })();
  }, [toast]);

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">Loading scheduler log…</div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Scheduler Log</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          History of scheduler runs with per-site article creation results.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-8 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            No scheduler runs recorded yet. Runs are logged after the scheduler
            processes sites (hour-skipped ticks are not recorded).
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((entry, i) => (
            <RunCard key={`${entry.timestamp}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd services/dashboard && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/settings/scheduler-log/page.tsx
git commit -m "feat(dashboard): add Scheduler Log page with per-site run history

Shows timestamped cards for each scheduler run with per-site status
(success/partial/error/no_content), article counts, error messages,
and skipped sites with reasons. Cron vs manual badge per run.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Deploy and verify

- [ ] **Step 1: Final typecheck both services**

Run: `pnpm typecheck` (from repo root)
Expected: No errors in either service

- [ ] **Step 2: Push platform changes**

```bash
git push origin michal-dev
```

- [ ] **Step 3: Deploy platform**

```bash
cloudgrid deploy
```

- [ ] **Step 4: Trigger a test run**

From the dashboard Settings → General Scheduler → "Run now" button.
Then navigate to Settings → Scheduler Log — the run should appear.

- [ ] **Step 5: Verify tag resolution**

Check CloudGrid logs after the run. coolnews-atl should now resolve all 4 topic tags (Current Events, In-Depth Analysis, Policy & Politics, Local Stories) and receive articles from the aggregator.
