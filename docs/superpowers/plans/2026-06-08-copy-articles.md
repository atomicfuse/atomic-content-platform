# Copy Articles Between Sites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/tools/copy-articles` page to the dashboard that copies article markdown files + R2 images between sites.

**Architecture:** New API route `POST /api/articles/copy` handles the copy logic (read source articles from Git, detect slug conflicts on target, copy R2 images, atomic commit to target staging branch). New page at `/tools/copy-articles` provides a 3-step UI: pick source site, pick target site, select articles (all selected by default). Sidebar gets a new "Tools" section.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind CSS v4, existing `github.ts` + `r2-upload.ts` helpers.

---

### Task 1: Add "Tools" Section to Sidebar

**Files:**
- Modify: `services/dashboard/src/components/layout/Sidebar.tsx:14-106`

- [ ] **Step 1: Add the Tools nav item to NAV_ITEMS array**

Insert a new entry **after** the Import item (line 96) and **before** the Deleted item (line 97) in the `NAV_ITEMS` array:

```typescript
  {
    label: "Tools",
    href: "/tools",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743" />
      </svg>
    ),
  },
```

This is a wrench icon from Heroicons (same icon library used by all other sidebar items).

- [ ] **Step 2: Verify the sidebar renders correctly**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm --filter @atomic-platform/dashboard typecheck`

Expected: No errors. The sidebar now shows "Tools" between "Import" and "Deleted".

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/components/layout/Sidebar.tsx
git commit -m "feat(dashboard): add Tools section to sidebar navigation"
```

---

### Task 2: Create the Copy Articles API Route

**Files:**
- Create: `services/dashboard/src/app/api/articles/copy/route.ts`

This is the core backend logic. It reads articles from the source staging branch, checks for slug conflicts on the target, copies R2 images, and commits article files to the target staging branch.

- [ ] **Step 1: Create the API route**

Create file `services/dashboard/src/app/api/articles/copy/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  readDashboardIndex,
  readArticles,
  readFileContent,
  commitNetworkFiles,
  branchExists,
  createBranch,
  invalidateSiteCaches,
} from "@/lib/github";
import { readFromR2, uploadToR2 } from "@/lib/r2-upload";

interface CopyRequest {
  sourceDomain: string;
  targetDomain: string;
  slugs: string[];
}

interface CopyResult {
  copied: string[];
  skipped: Array<{ slug: string; reason: string }>;
  warnings: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as CopyRequest;
    const { sourceDomain, targetDomain, slugs } = body;

    if (!sourceDomain || !targetDomain || !Array.isArray(slugs) || slugs.length === 0) {
      return NextResponse.json(
        { error: "sourceDomain, targetDomain, and slugs[] are required" },
        { status: 400 },
      );
    }

    if (sourceDomain === targetDomain) {
      return NextResponse.json(
        { error: "Source and target sites must be different" },
        { status: 400 },
      );
    }

    // 1. Read dashboard index to get staging branches
    const index = await readDashboardIndex({ fresh: true });
    const sourceEntry = index.sites.find((s) => s.domain === sourceDomain);
    const targetEntry = index.sites.find((s) => s.domain === targetDomain);

    if (!sourceEntry) {
      return NextResponse.json({ error: `Source site '${sourceDomain}' not found` }, { status: 404 });
    }
    if (!targetEntry) {
      return NextResponse.json({ error: `Target site '${targetDomain}' not found` }, { status: 404 });
    }

    const sourceBranch = sourceEntry.staging_branch ?? `staging/${sourceDomain}`;
    const targetBranch = targetEntry.staging_branch ?? `staging/${targetDomain}`;

    // 2. Ensure target staging branch exists
    const targetBranchExist = await branchExists(targetBranch);
    if (!targetBranchExist) {
      await createBranch(targetBranch, "main");
    }

    // 3. Read existing articles on target to detect conflicts
    const targetArticles = await readArticles(targetDomain, targetBranch);
    const targetSlugs = new Set(targetArticles.map((a) => a.slug));

    // 4. Partition into copyable vs. skipped
    const copied: string[] = [];
    const skipped: Array<{ slug: string; reason: string }> = [];
    const warnings: string[] = [];
    const filesToCommit: Array<{ path: string; content: string }> = [];

    for (const slug of slugs) {
      if (targetSlugs.has(slug)) {
        skipped.push({ slug, reason: "Already exists on target site" });
        continue;
      }

      // Read full article markdown from source
      const sourcePath = `sites/${sourceDomain}/articles/${slug}.md`;
      const content = await readFileContent(sourcePath, sourceBranch);
      if (!content) {
        skipped.push({ slug, reason: "Article not found on source site" });
        continue;
      }

      // Copy R2 image if article has a featuredImage
      const imageMatch = content.match(/featuredImage:\s*["']?([^\s"'\n]+)["']?/);
      if (imageMatch?.[1]) {
        const imagePath = imageMatch[1]; // e.g. /assets/images/slug.webp
        const filename = imagePath.split("/").pop();
        if (filename) {
          const sourceR2Key = `${sourceDomain}/assets/images/${filename}`;
          const targetR2Key = `${targetDomain}/assets/images/${filename}`;

          const imageBuffer = await readFromR2(sourceR2Key);
          if (imageBuffer) {
            const ext = filename.split(".").pop() ?? "webp";
            const contentType = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : "image/jpeg";
            const uploaded = await uploadToR2(targetR2Key, imageBuffer, contentType);
            if (!uploaded) {
              warnings.push(`R2 upload failed for ${slug} — article copied without image`);
            }
          } else {
            warnings.push(`R2 image not found for ${slug} (${sourceR2Key}) — article copied without image`);
          }
        }
      }

      const targetPath = `sites/${targetDomain}/articles/${slug}.md`;
      filesToCommit.push({ path: targetPath, content });
      copied.push(slug);
    }

    // 5. Atomic commit all articles to target staging branch
    if (filesToCommit.length > 0) {
      await commitNetworkFiles(
        filesToCommit,
        `feat(content): copy ${filesToCommit.length} article(s) from ${sourceDomain} to ${targetDomain}`,
        targetBranch,
      );
      invalidateSiteCaches(targetDomain, targetBranch);
    }

    const result: CopyResult = { copied, skipped, warnings };
    return NextResponse.json(result);
  } catch (err) {
    console.error("[copy-articles] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm --filter @atomic-platform/dashboard typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/articles/copy/route.ts
git commit -m "feat(dashboard): add POST /api/articles/copy endpoint"
```

---

### Task 3: Create the Copy Articles Page

**Files:**
- Create: `services/dashboard/src/app/tools/copy-articles/page.tsx`

This is the UI — two site dropdowns, an article checklist, and a copy button with result summary.

- [ ] **Step 1: Create the page component**

Create file `services/dashboard/src/app/tools/copy-articles/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";

interface SiteOption {
  domain: string;
  status: string;
}

interface ArticleOption {
  slug: string;
  title: string;
  status: string;
  featuredImage?: string;
}

interface CopyResult {
  copied: string[];
  skipped: Array<{ slug: string; reason: string }>;
  warnings: string[];
}

export default function CopyArticlesPage(): React.ReactElement {
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [sourceDomain, setSourceDomain] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [articles, setArticles] = useState<ArticleOption[]>([]);
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState<CopyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load site list on mount
  useEffect(() => {
    async function loadSites(): Promise<void> {
      try {
        const res = await fetch("/api/sites");
        if (!res.ok) throw new Error("Failed to load sites");
        const data = (await res.json()) as { sites: SiteOption[] };
        setSites(data.sites ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sites");
      } finally {
        setLoadingSites(false);
      }
    }
    void loadSites();
  }, []);

  // Load articles when source site changes
  const loadArticles = useCallback(async (domain: string): Promise<void> => {
    if (!domain) {
      setArticles([]);
      setSelectedSlugs(new Set());
      return;
    }
    setLoadingArticles(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/articles/${encodeURIComponent(domain)}/list`);
      if (!res.ok) throw new Error("Failed to load articles");
      const data = (await res.json()) as { articles: ArticleOption[] };
      const articleList = data.articles ?? [];
      setArticles(articleList);
      setSelectedSlugs(new Set(articleList.map((a) => a.slug)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load articles");
      setArticles([]);
      setSelectedSlugs(new Set());
    } finally {
      setLoadingArticles(false);
    }
  }, []);

  useEffect(() => {
    if (sourceDomain) {
      void loadArticles(sourceDomain);
    } else {
      setArticles([]);
      setSelectedSlugs(new Set());
    }
  }, [sourceDomain, loadArticles]);

  // Clear target if it matches source
  useEffect(() => {
    if (targetDomain && targetDomain === sourceDomain) {
      setTargetDomain("");
    }
  }, [sourceDomain, targetDomain]);

  const toggleSlug = (slug: string): void => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const toggleAll = (): void => {
    if (selectedSlugs.size === articles.length) {
      setSelectedSlugs(new Set());
    } else {
      setSelectedSlugs(new Set(articles.map((a) => a.slug)));
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!sourceDomain || !targetDomain || selectedSlugs.size === 0) return;
    setCopying(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/articles/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDomain,
          targetDomain,
          slugs: Array.from(selectedSlugs),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Copy failed");
      }
      const data = (await res.json()) as CopyResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copy failed");
    } finally {
      setCopying(false);
    }
  };

  const allSelected = articles.length > 0 && selectedSlugs.size === articles.length;
  const canCopy = sourceDomain && targetDomain && selectedSlugs.size > 0 && !copying;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Copy Articles</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Copy articles and their images from one site to another.
        </p>
      </div>

      {/* Site selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
            Source Site
          </label>
          <select
            value={sourceDomain}
            onChange={(e): void => setSourceDomain(e.target.value)}
            disabled={loadingSites}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="">Select source site...</option>
            {sites.map((s) => (
              <option key={s.domain} value={s.domain}>
                {s.domain} ({s.status})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
            Target Site
          </label>
          <select
            value={targetDomain}
            onChange={(e): void => setTargetDomain(e.target.value)}
            disabled={loadingSites || !sourceDomain}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="">Select target site...</option>
            {sites
              .filter((s) => s.domain !== sourceDomain)
              .map((s) => (
                <option key={s.domain} value={s.domain}>
                  {s.domain} ({s.status})
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Article checklist */}
      {sourceDomain && (
        <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              Articles ({articles.length})
            </span>
            {articles.length > 0 && (
              <button
                onClick={toggleAll}
                className="text-xs text-cyan hover:underline"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            )}
          </div>
          {loadingArticles ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
              Loading articles...
            </div>
          ) : articles.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
              No articles found on source site.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-[var(--border-secondary)]">
              {articles.map((article) => (
                <label
                  key={article.slug}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedSlugs.has(article.slug)}
                    onChange={(): void => toggleSlug(article.slug)}
                    className="rounded border-[var(--border-primary)]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {article.title}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {article.slug}
                      {article.featuredImage && " · has image"}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      article.status === "published"
                        ? "bg-emerald-500/10 text-emerald-500"
                        : article.status === "review"
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {article.status}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Copy button */}
      {sourceDomain && targetDomain && (
        <div className="flex items-center gap-3">
          <button
            onClick={(): void => void handleCopy()}
            disabled={!canCopy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-cyan hover:bg-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {copying
              ? "Copying..."
              : `Copy ${selectedSlugs.size} article${selectedSlugs.size !== 1 ? "s" : ""} to ${targetDomain}`}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
          {error}
        </div>
      )}

      {/* Result summary */}
      {result && (
        <div className="space-y-3">
          {result.copied.length > 0 && (
            <div className="px-4 py-3 rounded-lg bg-emerald-500/10 text-emerald-500 text-sm">
              <p className="font-medium">Copied {result.copied.length} article(s)</p>
              <ul className="mt-1 list-disc list-inside text-xs">
                {result.copied.map((slug) => (
                  <li key={slug}>{slug}</li>
                ))}
              </ul>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="px-4 py-3 rounded-lg bg-amber-500/10 text-amber-500 text-sm">
              <p className="font-medium">Skipped {result.skipped.length} article(s)</p>
              <ul className="mt-1 list-disc list-inside text-xs">
                {result.skipped.map((s) => (
                  <li key={s.slug}>
                    {s.slug} — {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.warnings.length > 0 && (
            <div className="px-4 py-3 rounded-lg bg-amber-500/10 text-amber-400 text-sm">
              <p className="font-medium">Warnings</p>
              <ul className="mt-1 list-disc list-inside text-xs">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm --filter @atomic-platform/dashboard typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/tools/copy-articles/page.tsx
git commit -m "feat(dashboard): add Copy Articles page UI"
```

---

### Task 4: Create the Article List API Endpoint

The page needs to fetch articles from a specific site. Currently `readArticles()` is a server-side function but there's no simple GET endpoint to list articles by domain that returns the shape the UI needs. We need a lightweight list endpoint.

**Files:**
- Create: `services/dashboard/src/app/api/articles/[domain]/list/route.ts`

- [ ] **Step 1: Create the article list endpoint**

Create file `services/dashboard/src/app/api/articles/[domain]/list/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { readArticles, readDashboardIndex } from "@/lib/github";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
): Promise<NextResponse> {
  const { domain } = await params;

  try {
    const index = await readDashboardIndex();
    const entry = index.sites.find((s) => s.domain === domain);
    const branch = entry?.staging_branch ?? `staging/${domain}`;

    const articles = await readArticles(domain, branch);

    return NextResponse.json({
      articles: articles.map((a) => ({
        slug: a.slug,
        title: a.title,
        status: a.status ?? "draft",
        featuredImage: a.featuredImage,
      })),
    });
  } catch (err) {
    console.error(`[articles/list] Error loading articles for ${domain}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load articles" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm --filter @atomic-platform/dashboard typecheck`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/articles/[domain]/list/route.ts
git commit -m "feat(dashboard): add GET /api/articles/[domain]/list endpoint"
```

---

### Task 5: Verify the Sites List API Returns the Right Shape

The page fetches `/api/sites` to populate the dropdown. Verify this existing endpoint returns `{ sites: [{ domain, status, ... }] }`.

**Files:**
- Check: `services/dashboard/src/app/api/sites/route.ts`

- [ ] **Step 1: Read the existing sites API route and verify it returns domain + status**

The page expects `{ sites: [{ domain: string, status: string }] }`. Check the existing `/api/sites` route. If it returns a different shape, adjust the page component's fetch to match the actual response shape.

- [ ] **Step 2: Fix any shape mismatch in the page component if needed**

If `/api/sites` doesn't exist or returns a different structure, either:
- Adjust the `loadSites` function in the page to read from the correct endpoint, OR
- Use a server component wrapper that passes sites as props (read via `readDashboardIndex()` server-side)

- [ ] **Step 3: Commit if changes were needed**

```bash
git add -A services/dashboard/src/app/tools/copy-articles/
git commit -m "fix(dashboard): align copy-articles page with sites API response shape"
```

---

### Task 6: End-to-End Verification

- [ ] **Step 1: Run typecheck on the entire dashboard**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm --filter @atomic-platform/dashboard typecheck`

Expected: Zero errors.

- [ ] **Step 2: Run full monorepo typecheck**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm typecheck`

Expected: Zero errors across all packages.

- [ ] **Step 3: Build the dashboard**

Run: `cd /Users/michal/Documents/ATL-content-network/atomic-content-platform && pnpm --filter @atomic-platform/dashboard build`

Expected: Build succeeds. The new page and API route are included in the standalone output.

- [ ] **Step 4: Final commit if any build fixes were needed**

```bash
git add -A
git commit -m "fix(dashboard): resolve build issues for copy-articles feature"
```
