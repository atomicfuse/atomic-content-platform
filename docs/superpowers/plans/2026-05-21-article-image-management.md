# Article Image Management & Content Tab Enhancements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every site has a real default image, track which articles use it, provide dashboard tools to filter/manage/replace general images, and enhance the Content tab with filters + pagination.

**Architecture:** Seven independent workstreams touching dashboard (Next.js), content-pipeline (Node), and shared-types. The `featuredImage` field is added to `ArticleEntry` throughout, enabling general-image detection via pattern match (`-general-article.webp` suffix). Site default images are generated at creation time via Gemini and uploaded to R2. A new `/articles/general-images` page aggregates all sites. Article editing is a new full-stack feature with R2 upload + Git commit.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4, Octokit (GitHub API), Gemini API (image gen), S3-compatible R2 uploads, Slack webhooks.

---

## Current-State Testing Notes

### What exists today

1. **Default image is a phantom path.** Content generation sets `featuredImage` to `/assets/images/${siteDomain}-general-article.webp` (agent.ts:550). This file is **never created** — it 404s on every site. The n8n image callback replaces it with a real image asynchronously.

2. **Slack notification partially works.** `notifyImageDefaultFallback()` in `notifications.ts:97-119` fires when:
   - n8n webhook trigger fails (agent.ts:906-914)
   - n8n callback returns error status (n8n-image.ts:158-167)
   - Image processing/R2 upload fails (n8n-image.ts:176-182)

   **Gap:** No notification fires when n8n is simply not configured (`N8N_IMAGE_WEBHOOK_URL` is unset). Articles silently keep the default image.

3. **WordPress import generates images.** `orchestrator.ts:85-108` calls `generateImageWithGemini()` for each imported article. This path is covered — but if Gemini fails, the article gets no image at all (the `featuredImage` field is omitted, not set to a default).

4. **`ArticleEntry` has no `featuredImage`.** The dashboard type (`dashboard.ts:70-86`) and `readArticles()` (`github.ts:526-579`) don't include `featuredImage`. No way to know from the dashboard which articles use the default image.

5. **ContentTab has zero filters.** No search, no status filter, no pagination. All articles load at once from Git via `readArticles()`.

6. **No article editing.** The article detail page (`/sites/[domain]/articles/[slug]/page.tsx`) is read-only. Only per-article scripts can be edited.

7. **PendingChangesBar is boolean.** Shows "You have unpublished changes" but no details about what changed.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `services/dashboard/src/app/articles/general-images/page.tsx` | Server component: "Articles with General Image" page |
| `services/dashboard/src/app/articles/general-images/GeneralImagesClient.tsx` | Client component: table, filters, image actions |
| `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts` | Already exists — extend with PATCH for editing |
| `services/dashboard/src/app/api/articles/[domain]/[slug]/image/route.ts` | POST: upload replacement image for an article |
| `services/dashboard/src/app/api/articles/general-images/route.ts` | GET: aggregate articles with general images across all sites |
| `services/dashboard/src/app/api/sites/staging-diff/route.ts` | GET: return file-level diff between staging and main |
| `services/dashboard/src/components/site-detail/ContentFilters.tsx` | Filter bar component for ContentTab |
| `services/dashboard/src/components/site-detail/StagingDiffModal.tsx` | Modal showing what changed on staging |
| `services/dashboard/src/lib/general-image-utils.ts` | `isGeneralImage()` helper function |
| `services/dashboard/src/lib/general-image.ts` | Gemini default image generation for site creation |

### Modified files

| File | Change |
|------|--------|
| `services/dashboard/src/types/dashboard.ts` | Add `featuredImage?: string` to `ArticleEntry` |
| `services/dashboard/src/lib/github.ts` | Return `featuredImage` from `readArticles()` |
| `services/dashboard/src/components/site-detail/ContentTab.tsx` | Add Image column, filters, pagination |
| `services/dashboard/src/components/layout/Sidebar.tsx` | Add "General Images" nav item |
| `services/dashboard/src/actions/wizard.ts` | Add default image generation + R2 upload after site creation |
| `services/content-pipeline/src/agents/content-generation/agent.ts` | Ensure Slack notification on all general-image paths |
| `services/content-pipeline/src/agents/migration/orchestrator.ts` | Set default image on Gemini failure + notify |
| `services/dashboard/src/components/site-detail/PendingChangesBar.tsx` | Add clickable diff modal |
| `services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx` | Add Edit functionality (image + markdown) |

---

## Task 1: Add `featuredImage` to ArticleEntry + readArticles

**Files:**
- Modify: `services/dashboard/src/types/dashboard.ts:70-86`
- Modify: `services/dashboard/src/lib/github.ts:526-579`
- Test: manual — verify via `pnpm typecheck` in dashboard

- [ ] **Step 1: Add `featuredImage` to `ArticleEntry` type**

In `services/dashboard/src/types/dashboard.ts`, add to the `ArticleEntry` interface:

```typescript
export interface ArticleEntry {
  slug: string;
  title: string;
  type: string;
  status: string;
  publishDate: string;
  featuredImage?: string;  // NEW
  score?: number;
  scoreBreakdown?: { ... };
  qualityNote?: string;
  reviewerNotes?: string;
}
```

- [ ] **Step 2: Return `featuredImage` from `readArticles()`**

In `services/dashboard/src/lib/github.ts`, in the `readArticles()` function, add to the mapped object (around line 558):

```typescript
return {
  slug: file.name.replace(".md", ""),
  title: (frontmatter.title as string) ?? file.name,
  type: (frontmatter.type as string) ?? "standard",
  status: (frontmatter.status as string) ?? "draft",
  publishDate: (frontmatter.publishDate as string) ?? "",
  featuredImage: (frontmatter.featuredImage as string) ?? undefined,  // NEW
  score: (frontmatter.quality_score as number) ?? (frontmatter.score as number | undefined),
  scoreBreakdown: frontmatter.score_breakdown as ArticleEntry["scoreBreakdown"],
  qualityNote: frontmatter.quality_note as string | undefined,
  reviewerNotes: frontmatter.reviewer_notes as string | undefined,
} as ArticleEntry;
```

- [ ] **Step 3: Add helper to detect general image**

Create `services/dashboard/src/lib/general-image-utils.ts` (keep runtime functions out of the types file):

```typescript
/** Returns true if the article uses the site's default general image or has no image. */
export function isGeneralImage(featuredImage: string | undefined, domain: string): boolean {
  if (!featuredImage) return true;
  return featuredImage.includes(`${domain}-general-article`);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS (no new errors)

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/types/dashboard.ts services/dashboard/src/lib/github.ts services/dashboard/src/lib/general-image-utils.ts
git commit -m "feat(dashboard): add featuredImage to ArticleEntry and readArticles"
```

---

## Task 2: ContentTab — Filters + Pagination + Image Column

**Files:**
- Create: `services/dashboard/src/components/site-detail/ContentFilters.tsx`
- Modify: `services/dashboard/src/components/site-detail/ContentTab.tsx`
- Test: manual — load a site with articles, verify filters and pagination work

- [ ] **Step 1: Create `ContentFilters` component**

Create `services/dashboard/src/components/site-detail/ContentFilters.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";

export interface ContentFilterState {
  search: string;
  status: string;   // "" = all, "published", "review", "draft"
  type: string;     // "" = all, "listicle", "how-to", "review", "standard"
  generalImage: string; // "" = all, "yes", "no"
  sortBy: string;   // "date-desc" (default), "date-asc", "score-desc", "score-asc"
}

interface ContentFiltersProps {
  filters: ContentFilterState;
  onChange: (filters: ContentFilterState) => void;
  articleCount: number;
  filteredCount: number;
}

const STATUS_OPTIONS = ["", "published", "review", "draft"];
const TYPE_OPTIONS = ["", "listicle", "how-to", "review", "standard"];
const IMAGE_OPTIONS = [
  { value: "", label: "All" },
  { value: "yes", label: "General image" },
  { value: "no", label: "Custom image" },
];
const SORT_OPTIONS = [
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "score-desc", label: "Highest score" },
  { value: "score-asc", label: "Lowest score" },
];

export function ContentFilters({
  filters,
  onChange,
  articleCount,
  filteredCount,
}: ContentFiltersProps): React.ReactElement {
  // Render: search input, status select, type select, image select, sort select
  // Use standard <input> and <select> elements styled with Tailwind
  // Show "Showing X of Y articles" when filtered
  // ... implementation follows the Review Queue filter pattern
}
```

Full implementation: a horizontal row of filter controls. Search is a text input with debounce. Status/Type/Image are `<select>` dropdowns. Sort is a `<select>`. Show article count badge.

- [ ] **Step 2: Add filters + pagination to ContentTab**

In `services/dashboard/src/components/site-detail/ContentTab.tsx`:

1. Import `ContentFilters` and `ContentFilterState`
2. Import `isGeneralImage` from `@/lib/general-image-utils`
3. Add state: `const [filters, setFilters] = useState<ContentFilterState>({ search: "", status: "", type: "", generalImage: "", sortBy: "date-desc" })`
4. Add state: `const [page, setPage] = useState(1)` with `PAGE_SIZE = 25`
5. Add `useMemo` to filter + sort + paginate:

```typescript
const filtered = useMemo(() => {
  let result = articles;

  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter((a) => a.title.toLowerCase().includes(q) || a.slug.includes(q));
  }
  if (filters.status) {
    result = result.filter((a) => a.status === filters.status);
  }
  if (filters.type) {
    result = result.filter((a) => a.type === filters.type);
  }
  if (filters.generalImage === "yes") {
    result = result.filter((a) => isGeneralImage(a.featuredImage, domain));
  } else if (filters.generalImage === "no") {
    result = result.filter((a) => !isGeneralImage(a.featuredImage, domain));
  }

  // Sort
  result = [...result].sort((a, b) => {
    switch (filters.sortBy) {
      case "date-asc": return new Date(a.publishDate).getTime() - new Date(b.publishDate).getTime();
      case "score-desc": return (b.score ?? -1) - (a.score ?? -1);
      case "score-asc": return (a.score ?? -1) - (b.score ?? -1);
      default: return new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime();
    }
  });

  return result;
}, [articles, filters, domain]);

const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
```

6. Reset `page` to 1 when filters change
7. Render `<ContentFilters>` above the table
8. Render `paged` instead of `articles` in the table body
9. Add pagination controls below the table: "Page X of Y", Previous/Next buttons

- [ ] **Step 3: Add "Image" column to the table**

Add a new column header "Image" between Title and Type. In each row:

```tsx
<td className="px-4 py-3">
  {isGeneralImage(article.featuredImage, domain) ? (
    <Badge label="General" variant="warning" />
  ) : (
    <Badge label="Custom" variant="success" />
  )}
</td>
```

- [ ] **Step 4: Typecheck and verify**

Run: `cd services/dashboard && pnpm typecheck`
Then: `cloudgrid dev` and navigate to a site's Content tab. Verify:
- Search by article name works
- Status, type, image filters work
- Pagination shows 25 articles per page
- Sort options work

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/components/site-detail/ContentFilters.tsx services/dashboard/src/components/site-detail/ContentTab.tsx
git commit -m "feat(dashboard): add filters, pagination, and image column to ContentTab"
```

---

## Task 3: Generate Default Site Image at Creation Time

**Files:**
- Create: `services/dashboard/src/lib/general-image.ts`
- Modify: `services/dashboard/src/actions/wizard.ts`
- Test: manual — create a test site and verify R2 has `<siteId>/assets/images/<siteId>-general-article.webp`

**Important:** `services/dashboard/src/lib/r2-upload.ts` already exists with `uploadToR2(key, data, contentType, domain?)`. Reuse it — do NOT recreate it.

- [ ] **Step 1: Create Gemini image generation helper for dashboard**

Create `services/dashboard/src/lib/general-image.ts`:

```typescript
import { uploadToR2 } from "./r2-upload";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

export async function generateAndUploadDefaultSiteImage(
  siteId: string,
  siteName: string,
  vertical: string,
): Promise<{ success: boolean; reason?: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { success: false, reason: "GEMINI_API_KEY not configured" };

  const prompt = `Create a professional, visually appealing hero image for a website called "${siteName}" in the ${vertical} niche. The image should be a high-quality photograph or illustration suitable as a default article thumbnail. No text overlays. Clean, modern aesthetic. 1200x630 pixels aspect ratio.`;

  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      return { success: false, reason: `gemini_${response.status}` };
    }

    const data = await response.json();
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      (p: Record<string, unknown>) => p.inlineData,
    );
    if (!imagePart?.inlineData) {
      return { success: false, reason: "no_image_in_response" };
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, "base64");

    // Optimize with sharp (same as article upload: max 1200px, WebP)
    const sharp = (await import("sharp")).default;
    const optimized = await sharp(imageBuffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const r2Key = `${siteId}/assets/images/${siteId}-general-article.webp`;
    const uploaded = await uploadToR2(r2Key, optimized, "image/webp");

    if (!uploaded) return { success: false, reason: "r2_upload_failed" };
    return { success: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { success: false, reason };
  }
}
```

- [ ] **Step 3: Call from wizard after site files are committed**

In `services/dashboard/src/actions/wizard.ts`, after `commitSiteFiles()` (around line 403) and before `triggerWorkflowViaPush()` (line 414), add:

```typescript
// Generate default site image and upload to R2 (non-blocking)
const verticalName = data.vertical?.name ?? data.topics?.[0] ?? "general";
const imageResult = await generateAndUploadDefaultSiteImage(
  projectName,
  data.siteName,
  verticalName,
);
if (!imageResult.success) {
  console.warn(`[wizard] Default site image generation failed: ${imageResult.reason}`);
}
```

This is non-blocking — if it fails, the site still creates fine, articles just get a 404 default image (same as today).

- [ ] **Step 4: Also call from WordPress import site scaffolder**

In `services/content-pipeline/src/agents/migration/orchestrator.ts`, after the site is scaffolded and committed, add a similar Gemini call for the default site image. Use the existing `generateImageWithGemini()` from `src/lib/gemini.ts` + `uploadToR2()` from `src/lib/r2-upload.ts`:

```typescript
// Generate default site image
const siteImagePrompt = `Professional hero image for "${site.name}" website in the ${site.category} niche. No text. Clean, modern. 1200x630.`;
const siteImageResult = await generateImageWithGemini(config.geminiApiKey, siteImagePrompt);
if (siteImageResult.ok) {
  const optimized = await sharp(siteImageResult.data).resize({ width: 1200 }).webp({ quality: 80 }).toBuffer();
  await uploadToR2(`${siteId}/assets/images/${siteId}-general-article.webp`, optimized, "image/webp");
}
```

- [ ] **Step 5: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`
Run: `cd services/content-pipeline && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/lib/general-image.ts services/dashboard/src/actions/wizard.ts services/content-pipeline/src/agents/migration/orchestrator.ts
git commit -m "feat(wizard,migration): generate default site image with Gemini at creation time"
```

---

## Task 4: Slack Notification on All General-Image Paths

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts`
- Modify: `services/content-pipeline/src/agents/migration/orchestrator.ts`
- Test: manual — generate articles with `N8N_IMAGE_WEBHOOK_URL` unset and verify Slack message

- [ ] **Step 1: Notify when n8n is not configured**

In `services/content-pipeline/src/agents/content-generation/agent.ts`, around line 868-918 where n8n triggers are sent, add a notification for articles that will never get images because n8n is not configured:

```typescript
if (!config.n8nImageWebhookUrl) {
  // n8n not configured — all articles keep default image
  for (const req of imageRequests) {
    void notifyImageDefaultFallback(config.notifications, {
      site: req.siteDomain,
      articleTitle: req.articleTitle,
      slug: req.slug,
      reason: "n8n image webhook not configured (N8N_IMAGE_WEBHOOK_URL unset)",
    });
  }
}
```

Check the existing code — if there's already a guard for `!config.n8nImageWebhookUrl`, add the notification inside it. If the guard skips the entire image trigger loop, the notification needs to happen just before or inside that guard.

- [ ] **Step 2: Notify on WP migration Gemini failure**

In `services/content-pipeline/src/agents/migration/orchestrator.ts`, where Gemini image generation happens per article (around lines 85-108), if `generateImageWithGemini()` fails, set the default image path AND send notification:

```typescript
if (!imageResult.ok) {
  // Gemini failed — use default image
  article.featuredImage = `/assets/images/${siteId}-general-article.webp`;
  void notifyImageDefaultFallback(config.notifications, {
    site: siteId,
    articleTitle: article.title,
    slug: article.slug,
    reason: `Gemini image generation failed: ${imageResult.reason}`,
  });
}
```

Add this import at the top of `orchestrator.ts`:

```typescript
import { notifyImageDefaultFallback } from "../../lib/notifications";
```

- [ ] **Step 3: Typecheck**

Run: `cd services/content-pipeline && pnpm typecheck`

- [ ] **Step 4: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/agent.ts services/content-pipeline/src/agents/migration/orchestrator.ts
git commit -m "fix(pipeline): send Slack notification on all general-image fallback paths"
```

---

## Task 5: "Articles with General Image" Sidebar Page

**Files:**
- Create: `services/dashboard/src/app/articles/general-images/page.tsx`
- Create: `services/dashboard/src/app/articles/general-images/GeneralImagesClient.tsx`
- Create: `services/dashboard/src/app/api/articles/general-images/route.ts`
- Modify: `services/dashboard/src/components/layout/Sidebar.tsx`
- Test: manual — verify page loads and shows articles with general images across sites

- [ ] **Step 1: Create the API route**

Create `services/dashboard/src/app/api/articles/general-images/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { readDashboardIndex, readArticles } from "@/lib/github";
import { isGeneralImage } from "@/lib/general-image-utils";

export interface GeneralImageArticle {
  domain: string;
  siteName: string;
  slug: string;
  title: string;
  featuredImage?: string;
  publishDate: string;
  status: string;
  stagingBranch: string | null;
}

export async function GET(): Promise<NextResponse> {
  const index = await readDashboardIndex();
  const activeSites = index.sites.filter((s) =>
    s.status === "Staging" || s.status === "Ready" || s.status === "Live"
  );

  const results: GeneralImageArticle[] = [];

  await Promise.allSettled(
    activeSites.map(async (site) => {
      const branch = site.staging_branch ?? undefined;
      const articles = await readArticles(site.domain, branch);
      for (const a of articles) {
        if (isGeneralImage(a.featuredImage, site.domain)) {
          results.push({
            domain: site.domain,
            siteName: site.domain, // dashboard-index has no site_name; domain is the display identifier
            slug: a.slug,
            title: a.title,
            featuredImage: a.featuredImage,
            publishDate: a.publishDate,
            status: a.status,
            stagingBranch: site.staging_branch ?? null,
          });
        }
      }
    }),
  );

  // Sort by publish date descending
  results.sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

  return NextResponse.json(results);
}
```

**Note:** This endpoint reads all sites' articles. For a network with many sites, this could be slow. The initial implementation reads from Git (same as existing `readArticles`). Future optimization: cache in KV or read from article-index.

- [ ] **Step 2: Create the server page**

Create `services/dashboard/src/app/articles/general-images/page.tsx`:

```typescript
import { GeneralImagesClient } from "./GeneralImagesClient";

export const metadata = { title: "Articles with General Images" };

export default function GeneralImagesPage(): React.ReactElement {
  return <GeneralImagesClient />;
}
```

- [ ] **Step 3: Create the client component**

Create `services/dashboard/src/app/articles/general-images/GeneralImagesClient.tsx`:

Table with columns: Site, Article Title (clickable to preview), Status, Published Date, Image Actions (Upload / Generate AI).

Features:
- Fetches from `GET /api/articles/general-images` on mount
- Search filter by article title or site name
- Each row has two buttons:
  - "Upload" — file input for image upload, calls `POST /api/articles/{domain}/{slug}/image`
  - "Generate AI" — calls `POST /api/agent/generate` (existing n8n trigger flow) for a single article

- [ ] **Step 4: Add sidebar nav item**

In `services/dashboard/src/components/layout/Sidebar.tsx`, add to `NAV_ITEMS` array after "Review Queue" (around line 77):

```typescript
{
  label: "General Images",
  href: "/articles/general-images",
  icon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
    </svg>
  ),
},
```

- [ ] **Step 5: Typecheck and verify**

Run: `cd services/dashboard && pnpm typecheck`
Then: `cloudgrid dev`, navigate to General Images page, verify it lists articles.

- [ ] **Step 6: Commit**

```bash
git add services/dashboard/src/app/articles/general-images/ services/dashboard/src/app/api/articles/general-images/ services/dashboard/src/components/layout/Sidebar.tsx
git commit -m "feat(dashboard): add General Images page showing articles using default image"
```

---

## Task 6: Article Image Replace API

**Files:**
- Create: `services/dashboard/src/app/api/articles/[domain]/[slug]/image/route.ts`
- Test: manual — upload a replacement image for an article and verify R2 + Git are updated

- [ ] **Step 1: Create the image replace API route**

Create `services/dashboard/src/app/api/articles/[domain]/[slug]/image/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { uploadToR2 } from "@/lib/r2-upload";
import { commitNetworkFiles } from "@/lib/github";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ domain: string; slug: string }> },
): Promise<NextResponse> {
  const { domain, slug } = await params;
  const formData = await req.formData();
  const file = formData.get("image") as File | null;
  const branch = (formData.get("branch") as string) ?? `staging/${domain}`;

  if (!file || !IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Invalid image file" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "Image exceeds 10MB" }, { status: 400 });
  }

  // 1. Optimize image (same as article upload: max 1200px, WebP, quality ladder)
  const sharp = (await import("sharp")).default;
  const raw = Buffer.from(await file.arrayBuffer());
  let optimized = await sharp(raw).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  if (optimized.length > 350 * 1024) {
    optimized = await sharp(raw).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
  }
  if (optimized.length > 350 * 1024) {
    optimized = await sharp(raw).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 40 }).toBuffer();
  }

  // 2. Upload to R2
  const r2Key = `${domain}/assets/images/${slug}.webp`;
  const uploaded = await uploadToR2(r2Key, optimized, "image/webp");
  if (!uploaded) {
    return NextResponse.json({ error: "R2 upload failed" }, { status: 500 });
  }

  // 3. Update article frontmatter in Git
  const imagePath = `/assets/images/${slug}.webp`;
  // readFileContent() returns string | null (not an object)
  const { readFileContent } = await import("@/lib/github");
  const articlePath = `sites/${domain}/articles/${slug}.md`;
  const content = await readFileContent(articlePath, branch);
  if (!content) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  // Parse frontmatter, update featuredImage, reconstruct markdown
  // Split on the YAML delimiters to isolate frontmatter from body
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return NextResponse.json({ error: "Invalid article format" }, { status: 400 });
  }
  const [, fmBlock, body] = fmMatch;
  // Replace or add featuredImage in the frontmatter block
  const hasFeaturedImage = /^featuredImage:.*$/m.test(fmBlock);
  const updatedFm = hasFeaturedImage
    ? fmBlock.replace(/^featuredImage:.*$/m, `featuredImage: ${imagePath}`)
    : `${fmBlock}\nfeaturedImage: ${imagePath}`;
  const final = `---\n${updatedFm}\n---\n${body}`;

  await commitNetworkFiles(
    [{ path: articlePath, content: final }],
    `fix(content): replace image for ${slug} on ${domain}`,
    branch,
  );

  return NextResponse.json({
    status: "updated",
    imagePath,
    r2Key,
    branch,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd services/dashboard && pnpm typecheck`

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/articles/[domain]/[slug]/image/route.ts
git commit -m "feat(dashboard): add article image replacement API with R2 upload + Git commit"
```

---

## Task 7: Article Edit Page

**Files:**
- Modify: `services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx`
- Modify: `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts` (add PATCH)
- Test: manual — edit an article's markdown and image, verify Git + R2 update

- [ ] **Step 1: Add PATCH handler to existing article API route**

In `services/dashboard/src/app/api/articles/[domain]/[slug]/route.ts`, add a PATCH handler for updating article content:

```typescript
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ domain: string; slug: string }> },
): Promise<NextResponse> {
  const { domain, slug } = await params;
  const body = await req.json();
  const { content, branch: branchOverride } = body as { content: string; branch?: string };
  const branch = branchOverride ?? `staging/${domain}`;

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const articlePath = `sites/${domain}/articles/${slug}.md`;

  await commitNetworkFiles(
    [{ path: articlePath, content }],
    `fix(content): edit article ${slug} for ${domain}`,
    branch,
  );

  return NextResponse.json({ status: "updated", slug, branch });
}
```

- [ ] **Step 2: Add edit UI to article detail page**

Modify `services/dashboard/src/app/sites/[domain]/articles/[slug]/page.tsx`:

1. Load the full article content (frontmatter + body) — the existing page already calls the article API
2. Add an "Edit" toggle button
3. In edit mode, show:
   - A `<textarea>` with the full markdown content (frontmatter + body)
   - An image upload section (drag-and-drop or file picker)
   - "Save" and "Cancel" buttons
4. "Save" calls:
   - `PATCH /api/articles/{domain}/{slug}` for markdown changes
   - `POST /api/articles/{domain}/{slug}/image` for image replacement (if image was changed)
5. Show success/error toast

The edit UI should be a client component. Extract into `ArticleEditor.tsx` if the page component is server-rendered.

- [ ] **Step 3: Create `POST /api/agent/generate-image` route + add button**

Create `services/dashboard/src/app/api/agent/generate-image/route.ts` — a lightweight route that proxies a single-article image generation request to the content-pipeline's n8n trigger:

```typescript
import { NextRequest, NextResponse } from "next/server";

const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { domain, slug, title, branch } = (await req.json()) as {
    domain: string; slug: string; title: string; branch?: string;
  };
  if (!domain || !slug || !title) {
    return NextResponse.json({ error: "domain, slug, title required" }, { status: 400 });
  }

  const res = await fetch(`${getAgentUrl()}/trigger-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      siteDomain: domain,
      slug,
      articleTitle: title,
      branch: branch ?? `staging/${domain}`,
    }),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
```

**Note:** This requires a corresponding `POST /trigger-image` endpoint on the content-pipeline that accepts a single-article image request and fires the n8n webhook. Add it in `services/content-pipeline/src/agents/content-generation/index.ts` alongside the existing routes, reusing `triggerN8nImage()` from `n8n-image.ts`.

In the article detail page, add a "Generate AI Image" button that calls this route:

```typescript
async function handleGenerateImage(): Promise<void> {
  setGenerating(true);
  try {
    const res = await fetch("/api/agent/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, slug, title: article.title }),
    });
    if (res.ok) toast("Image generation triggered — it may take ~1 minute", "success");
    else toast("Failed to trigger image generation", "error");
  } finally {
    setGenerating(false);
  }
}
```

- [ ] **Step 4: Typecheck and verify**

Run: `cd services/dashboard && pnpm typecheck`
Verify the full flow: edit markdown → save → check Git commit. Upload image → check R2 + Git.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/app/sites/[domain]/articles/[slug]/ services/dashboard/src/app/api/articles/
git commit -m "feat(dashboard): add article editing with markdown editor and image replacement"
```

---

## Task 8: Enhanced PendingChangesBar with Diff

**Files:**
- Create: `services/dashboard/src/app/api/sites/staging-diff/route.ts`
- Create: `services/dashboard/src/components/site-detail/StagingDiffModal.tsx`
- Modify: `services/dashboard/src/components/site-detail/PendingChangesBar.tsx`
- Test: manual — make a change on staging, verify diff modal shows it

- [ ] **Step 1: Create staging diff API route**

Create `services/dashboard/src/app/api/sites/staging-diff/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Octokit } from "@octokit/rest";
import { readDashboardIndex } from "@/lib/github";
import { NETWORK_REPO_OWNER, NETWORK_REPO_NAME } from "@/lib/constants";

export interface StagingDiffFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return NextResponse.json({ error: "domain required" }, { status: 400 });
  }

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) {
    return NextResponse.json({ files: [], aheadBy: 0 });
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const { data } = await octokit.repos.compareCommitsWithBasehead({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    basehead: `main...${site.staging_branch}`,
  });

  const files: StagingDiffFile[] = (data.files ?? []).map((f) => ({
    filename: f.filename,
    status: f.status as StagingDiffFile["status"],
    additions: f.additions,
    deletions: f.deletions,
  }));

  return NextResponse.json({
    files,
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
  });
}
```

- [ ] **Step 2: Create StagingDiffModal component**

Create `services/dashboard/src/components/site-detail/StagingDiffModal.tsx`:

A modal that shows a list of changed files grouped by type:
- **Articles added** (files in `sites/*/articles/*.md` with status "added")
- **Articles modified** (status "modified")
- **Articles removed** (status "removed")
- **Config changed** (site.yaml, etc.)
- **Other** (assets, etc.)

Each file shows its name with a colored badge (green for added, yellow for modified, red for removed).

- [ ] **Step 3: Make the warning icon clickable in PendingChangesBar**

In `services/dashboard/src/components/site-detail/PendingChangesBar.tsx`:

1. Add state: `const [showDiff, setShowDiff] = useState(false)`
2. Make the warning icon/text area clickable:

```tsx
<button
  onClick={(): void => setShowDiff(true)}
  className="flex items-center gap-2 hover:underline cursor-pointer"
>
  <div className="shrink-0 rounded-full bg-amber-500/10 p-1">
    {/* warning icon SVG */}
  </div>
  <p className="text-sm text-amber-700 dark:text-amber-300">
    You have unpublished changes on staging
  </p>
</button>
```

3. Render the modal:

```tsx
<StagingDiffModal
  open={showDiff}
  onClose={(): void => setShowDiff(false)}
  domain={domain}
/>
```

- [ ] **Step 4: Typecheck and verify**

Run: `cd services/dashboard && pnpm typecheck`
Verify: make a change on staging (add/edit/delete an article), check that the diff modal lists the changes.

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/app/api/sites/staging-diff/ services/dashboard/src/components/site-detail/StagingDiffModal.tsx services/dashboard/src/components/site-detail/PendingChangesBar.tsx
git commit -m "feat(dashboard): show staging diff details when clicking pending changes warning"
```

---

## Edge Cases & QA Checklist

### Image generation
- [ ] Gemini API key not configured → site creation succeeds, image skipped with console warning
- [ ] Gemini returns error/rate limit → non-blocking, site still creates
- [ ] R2 credentials missing → upload skipped with warning
- [ ] Image > 350KB after WebP quality 40 → still uploaded (just larger than ideal)

### Slack notifications
- [ ] `SLACK_WEBHOOK_URL` not configured → notifications silently skipped
- [ ] n8n not configured (`N8N_IMAGE_WEBHOOK_URL` unset) → all articles get notifications
- [ ] n8n configured but webhook fails → notification sent
- [ ] n8n callback returns error → notification sent
- [ ] WordPress import: Gemini fails → default image set + notification sent

### Content tab filters
- [ ] Search with no results → shows "No articles match filters" message
- [ ] Filter combination narrows to 0 → same empty state
- [ ] Changing filters resets to page 1
- [ ] Page > totalPages after filter change → reset to 1
- [ ] 0 articles → filters hidden or disabled
- [ ] 200+ articles → pagination works correctly, only 25 rendered per page

### Article image replacement
- [ ] Upload non-image file → 400 error
- [ ] Upload > 10MB → 400 error
- [ ] Article doesn't exist on branch → 404 error
- [ ] R2 upload fails → 500 error, no Git commit
- [ ] Article has no `featuredImage` in frontmatter → field is added
- [ ] Article already has custom image → replaced

### Staging diff
- [ ] Site with no staging branch → no diff available
- [ ] Site with no pending changes → modal shows "No changes"
- [ ] Binary files (images) in diff → shown as "binary changed", no content diff
- [ ] 100+ files changed → list is scrollable

### General Images page
- [ ] Network with 0 articles using general images → shows empty state
- [ ] Slow API (many sites) → loading spinner shown
- [ ] Upload from general images page → article row updates/disappears from list
