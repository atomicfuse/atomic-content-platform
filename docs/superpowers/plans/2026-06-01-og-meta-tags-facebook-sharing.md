# Open Graph Meta Tags for Facebook Sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix article sharing on Facebook by ensuring `og:image` is an absolute URL, adding missing OG/article meta tags, and enriching JSON-LD structured data.

**Architecture:** `SEOHead.astro` already emits basic OG tags, but `og:image` receives a relative path (e.g. `/travelswire/assets/images/hero.webp`) which Facebook's scraper cannot resolve. The fix is to resolve all image URLs to absolute before rendering, add missing `article:author`, `article:tag`, and `og:locale` tags, and enrich JSON-LD with author/keywords. Data is already available in KV — no schema changes needed.

**Tech Stack:** Astro 6 (SSR), TypeScript, Vitest

---

## Root Cause Analysis

`seed-kv.ts` rewrites `featuredImage` from `/assets/images/foo.webp` to `/<siteId>/assets/images/foo.webp` via `rewriteFrontmatterUrl()`. This relative path works for `<img src>` tags (the browser resolves them against the page domain), but **Facebook's OG scraper requires absolute URLs** — it has no page context to resolve relative paths.

The `[slug]/index.astro` page passes `article.frontmatter.featuredImage` directly to `SEOHead` without resolving it to an absolute URL. The same issue affects `og:image` and `twitter:image`.

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/site-worker/src/lib/url.ts` | **Create** | `toAbsoluteImageUrl(path, siteBaseUrl)` helper |
| `packages/site-worker/src/lib/__tests__/url.test.ts` | **Create** | Tests for URL resolution helper |
| `packages/site-worker/src/components/SEOHead.astro` | **Modify** | Extended Props, new OG tags, absolute image URL, enriched JSON-LD |
| `packages/site-worker/src/pages/[slug]/index.astro` | **Modify** | Pass `author`, `tags`, `siteBaseUrl` to SEOHead |
| `packages/site-worker/src/pages/index.astro` | **Modify** | Pass `siteBaseUrl` + site logo as fallback OG image |
| `packages/site-worker/src/pages/category/[topic].astro` | **Modify** | Pass `siteBaseUrl` for future OG image support |
| `packages/site-worker/src/pages/search.astro` | **Modify** | Pass `siteBaseUrl` for consistency across all SEOHead call sites |

---

### Task 1: URL Resolution Helper

**Files:**
- Create: `packages/site-worker/src/lib/url.ts`
- Test: `packages/site-worker/src/lib/__tests__/url.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/site-worker/src/lib/__tests__/url.test.ts
import { describe, it, expect } from 'vitest';
import { toAbsoluteImageUrl } from '../url';

describe('toAbsoluteImageUrl', () => {
  const base = 'https://travelswire.com';

  it('prepends base to a relative path', () => {
    expect(toAbsoluteImageUrl('/travelswire/assets/images/hero.webp', base))
      .toBe('https://travelswire.com/travelswire/assets/images/hero.webp');
  });

  it('returns an already-absolute URL unchanged', () => {
    expect(toAbsoluteImageUrl('https://cdn.example.com/img.png', base))
      .toBe('https://cdn.example.com/img.png');
  });

  it('returns undefined for undefined input', () => {
    expect(toAbsoluteImageUrl(undefined, base)).toBeUndefined();
  });

  it('returns undefined for empty string input', () => {
    expect(toAbsoluteImageUrl('', base)).toBeUndefined();
  });

  it('handles base URL with trailing slash', () => {
    expect(toAbsoluteImageUrl('/assets/img.png', 'https://example.com/'))
      .toBe('https://example.com/assets/img.png');
  });

  it('returns protocol-relative URL unchanged', () => {
    expect(toAbsoluteImageUrl('//cdn.example.com/img.png', base))
      .toBe('//cdn.example.com/img.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/site-worker && pnpm vitest run src/lib/__tests__/url.test.ts`
Expected: FAIL — module `../url` not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/site-worker/src/lib/url.ts

/**
 * Resolves a possibly-relative image URL to an absolute URL suitable for
 * og:image and twitter:image meta tags. Social media scrapers (Facebook,
 * Twitter) cannot resolve relative paths — they need full https:// URLs.
 *
 * Returns undefined for falsy input so callers don't emit empty meta tags.
 */
export function toAbsoluteImageUrl(
  url: string | undefined,
  siteBaseUrl: string,
): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('//')) return url;
  const base = siteBaseUrl.endsWith('/') ? siteBaseUrl.slice(0, -1) : siteBaseUrl;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/site-worker && pnpm vitest run src/lib/__tests__/url.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/site-worker/src/lib/url.ts packages/site-worker/src/lib/__tests__/url.test.ts
git commit -m "feat(site-worker): add toAbsoluteImageUrl helper for OG meta tags"
```

---

### Task 2: Extend SEOHead With Missing OG Tags + Absolute Image URLs

**Files:**
- Modify: `packages/site-worker/src/components/SEOHead.astro`

The component needs these changes:
1. New optional props: `author`, `tags`, `siteBaseUrl`
2. Resolve `image` to absolute URL using `toAbsoluteImageUrl`
3. Add `og:image:width`, `og:image:height` when image is present
4. Add `og:locale`
5. Add `article:author` when author is present
6. Add `article:tag` entries when tags are present
7. Enrich JSON-LD with `author` object and `keywords`

- [ ] **Step 1: Update the Props interface and frontmatter script**

Replace the entire `SEOHead.astro` with:

```astro
---
/**
 * Outputs SEO meta tags, Open Graph, Twitter Card, and JSON-LD
 * structured data for an article or page.
 */
import { toAbsoluteImageUrl } from '../lib/url';

interface Props {
  title: string;
  description: string;
  canonicalUrl: string;
  image?: string;
  siteName: string;
  /** Base URL of the site, e.g. "https://travelswire.com". Used to resolve
   *  relative image paths to absolute URLs for og:image / twitter:image. */
  siteBaseUrl?: string;
  publishDate?: string;
  /** Article author display name. Emits article:author OG tag. */
  author?: string;
  /** Article tags/keywords. Emits article:tag OG tags + JSON-LD keywords. */
  tags?: string[];
  /** When true, emits a noindex robots meta tag. */
  noindex?: boolean;
}

const {
  title,
  description,
  canonicalUrl,
  image,
  siteName,
  siteBaseUrl,
  publishDate,
  author,
  tags,
  noindex = false,
} = Astro.props;

// Resolve image to absolute URL — social scrapers can't handle relative paths
const absoluteImage = siteBaseUrl ? toAbsoluteImageUrl(image, siteBaseUrl) : image;

// Build JSON-LD Article structured data when we have a publish date
const jsonLd = publishDate
  ? JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description,
      image: absoluteImage ?? undefined,
      datePublished: publishDate,
      ...(author
        ? { author: { '@type': 'Person', name: author } }
        : {}),
      publisher: {
        '@type': 'Organization',
        name: siteName,
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': canonicalUrl,
      },
      ...(tags && tags.length > 0 ? { keywords: tags.join(', ') } : {}),
    })
  : null;
---

<title>{title}</title>
<meta name="description" content={description} />
<link rel="canonical" href={canonicalUrl} />
{noindex && <meta name="robots" content="noindex, follow" />}

{/* ---- Open Graph ---- */}
<meta property="og:type" content={publishDate ? 'article' : 'website'} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:url" content={canonicalUrl} />
<meta property="og:site_name" content={siteName} />
<meta property="og:locale" content="en_US" />
{absoluteImage && <meta property="og:image" content={absoluteImage} />}
{absoluteImage && <meta property="og:image:width" content="1200" />}
{absoluteImage && <meta property="og:image:height" content="630" />}
{publishDate && <meta property="article:published_time" content={publishDate} />}
{author && <meta property="article:author" content={author} />}
{tags && tags.map((tag) => <meta property="article:tag" content={tag} />)}

{/* ---- Twitter Card ---- */}
<meta name="twitter:card" content={absoluteImage ? 'summary_large_image' : 'summary'} />
<meta name="twitter:title" content={title} />
<meta name="twitter:description" content={description} />
{absoluteImage && <meta name="twitter:image" content={absoluteImage} />}

{/* ---- JSON-LD ---- */}
{jsonLd && <script is:inline type="application/ld+json" set:html={jsonLd} />}
```

- [ ] **Step 2: Verify site-worker builds**

Run: `cd packages/site-worker && pnpm build`
Expected: Build succeeds (no type errors from new import or props)

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/components/SEOHead.astro
git commit -m "feat(site-worker): add absolute image URLs and missing OG tags to SEOHead"
```

---

### Task 3: Pass New Props From Article Page

**Files:**
- Modify: `packages/site-worker/src/pages/[slug]/index.astro:110-118`

The article page already has `article.frontmatter.author`, `article.frontmatter.tags`, and access to `getCanonicalDomain()`. Pass them through.

- [ ] **Step 1: Update the SEOHead invocation**

In `packages/site-worker/src/pages/[slug]/index.astro`, replace the SEOHead block (lines 111-118):

```astro
      <SEOHead
        title={`${article.frontmatter.title} | ${config.site_name}`}
        description={article.frontmatter.description ?? article.frontmatter.title}
        canonicalUrl={`https://${getCanonicalDomain(Astro)}/${slug}`}
        image={article.frontmatter.featuredImage}
        siteName={config.site_name}
        siteBaseUrl={`https://${getCanonicalDomain(Astro)}`}
        publishDate={article.frontmatter.publishDate}
        author={article.frontmatter.author}
        tags={article.frontmatter.tags}
      />
```

Three new props added: `siteBaseUrl`, `author`, `tags`.

- [ ] **Step 2: Verify site-worker builds**

Run: `cd packages/site-worker && pnpm build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/site-worker/src/pages/\[slug\]/index.astro
git commit -m "feat(site-worker): pass author, tags, siteBaseUrl to SEOHead on article pages"
```

---

### Task 4: Add siteBaseUrl to Homepage and Category Pages

These pages don't have article-specific OG tags, but adding `siteBaseUrl` ensures any future `image` prop (e.g. site logo) resolves correctly. Also pass the site logo/favicon as a fallback OG image for the homepage.

**Files:**
- Modify: `packages/site-worker/src/pages/index.astro:86-91`
- Modify: `packages/site-worker/src/pages/category/[topic].astro:56-62`
- Modify: `packages/site-worker/src/layouts/PageLayout.astro:29-34`

- [ ] **Step 1: Update homepage SEOHead invocation**

In `packages/site-worker/src/pages/index.astro`, update the SEOHead block:

```astro
    <SEOHead
      title={config.site_name}
      description={config.site_tagline ?? `${config.site_name} — latest articles`}
      canonicalUrl={`https://${getCanonicalDomain(Astro)}`}
      siteName={config.site_name}
      siteBaseUrl={`https://${getCanonicalDomain(Astro)}`}
      image={config.theme?.logo}
    />
```

- [ ] **Step 2: Update category page SEOHead invocation**

In `packages/site-worker/src/pages/category/[topic].astro`, add `siteBaseUrl`:

```astro
    <SEOHead
      title={pageTitle}
      description={pageDesc}
      canonicalUrl={page > 1 ? `${canonicalUrl}?page=${page}` : canonicalUrl}
      siteName={config.site_name}
      siteBaseUrl={`https://${getCanonicalDomain(Astro)}`}
    />
```

- [ ] **Step 3: Update PageLayout SEOHead invocation**

In `packages/site-worker/src/layouts/PageLayout.astro`, add `siteBaseUrl`:

```astro
    <SEOHead
      title={`${title} | ${config.site_name}`}
      description={description ?? title}
      canonicalUrl={canonicalUrl}
      siteName={config.site_name}
      siteBaseUrl={`https://${getCanonicalDomain(Astro)}`}
    />
```

- [ ] **Step 4: Update search page SEOHead invocation**

In `packages/site-worker/src/pages/search.astro`, add `siteBaseUrl` (lines 20-26):

```astro
    <SEOHead
      title={`Search — ${config.site_name}`}
      description={`Search articles on ${config.site_name}`}
      canonicalUrl={`https://${getCanonicalDomain(Astro)}/search`}
      siteName={config.site_name}
      siteBaseUrl={`https://${getCanonicalDomain(Astro)}`}
      noindex
    />
```

- [ ] **Step 5: Verify site-worker builds**

Run: `cd packages/site-worker && pnpm build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add packages/site-worker/src/pages/index.astro packages/site-worker/src/pages/category/\[topic\].astro packages/site-worker/src/layouts/PageLayout.astro packages/site-worker/src/pages/search.astro
git commit -m "feat(site-worker): add siteBaseUrl to homepage, category, search, and shared page SEOHead"
```

---

### Task 5: Run Full Test Suite + Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all site-worker tests**

Run: `cd packages/site-worker && pnpm vitest run`
Expected: All tests pass (including the new `url.test.ts`)

- [ ] **Step 2: Run full monorepo typecheck**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 3: Run site-worker build**

Run: `cd packages/site-worker && pnpm build`
Expected: Clean build

- [ ] **Step 4: Commit (if any fixes were needed)**

---

### Task 6: Manual Verification With Facebook Sharing Debugger

**Files:** None (manual testing)

This task is manual — run after deploying to staging.

- [ ] **Step 1: Deploy to staging**

Run: `cd packages/site-worker && pnpm deploy:staging`

- [ ] **Step 2: Seed KV for a test site**

Run: `cd packages/site-worker && CLOUDFLARE_ACCOUNT_ID=4a8cfd85d617b38ce1813a552132bc86 pnpm seed:kv travelswire`

- [ ] **Step 3: View source on staging to confirm OG tags**

Visit: `https://atomic-site-worker-staging.accounts-4a8.workers.dev/<article-slug>?_atl_site=travelswire`

View page source and verify these tags are present in `<head>`:
- `<meta property="og:image" content="https://travelswire.com/travelswire/assets/images/...">` — **must be absolute URL**
- `<meta property="og:image:width" content="1200">`
- `<meta property="og:image:height" content="630">`
- `<meta property="og:locale" content="en_US">`
- `<meta property="article:author" content="...">`
- `<meta property="article:tag" content="...">`
- JSON-LD script with `author` object and `keywords` field

- [ ] **Step 4: Test with Facebook Sharing Debugger**

Go to: https://developers.facebook.com/tools/debug/

Paste the production article URL (after deploying to production) and click "Debug". Verify:
- Title, description, and image render correctly in the preview
- No warnings about missing OG tags
- Image displays at full size (not tiny thumbnail)

If the URL was previously shared with broken OG tags, click "Scrape Again" to clear Facebook's cache.

---

## Summary of Changes

| What | Why |
|------|-----|
| `og:image` → absolute URL | Facebook scraper cannot resolve relative paths — this is the root cause |
| `og:image:width` + `og:image:height` | Facebook renders large preview cards immediately instead of refetching the image to determine size |
| `og:locale` | Explicit locale prevents Facebook from guessing |
| `article:author` | Shows author attribution in Facebook share cards |
| `article:tag` | Improves content categorization for social algorithms |
| JSON-LD `author` + `keywords` | Richer structured data for search engines |

## What This Does NOT Change

- **No KV schema changes** — all data (author, tags, image) already exists in `ArticleIndexEntry`
- **No seed-kv changes** — image URLs remain relative in KV (correct for `<img src>` tags); resolution to absolute happens at render time in `SEOHead.astro`
- **No image resizing** — article images are already optimized by the dashboard upload pipeline (resize to max 1200px, WebP). The `1200x630` dimensions in `og:image:width/height` are hints, not enforced — Facebook will use them for initial layout then adapt to actual dimensions
- **No `fb:app_id`** — requires registering a Facebook App; can be added later if needed for Facebook Insights analytics
