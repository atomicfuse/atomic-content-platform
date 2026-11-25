# Per-site sitemap (site-worker)

**Goal:** serve a real `/sitemap-index.xml` and `/sitemap.xml` on every site, so the URL that
robots.txt advertises stops returning 404.

## Why

Every site's robots.txt says `Sitemap: https://<host>/sitemap-index.xml`, and both that URL and
`/sitemap.xml` return 404 on all live sites (checked 2026-11-25). There has never been a sitemap route.
Crawlers that discover pages through the sitemap (Google, AdSense site review, ad-verification
crawlers) get nothing. This surfaced while investigating hypezen's AdSense rejection
("site not fully up").

## Architecture

- `src/lib/sitemap.ts`: pure functions, no KV and no Astro, so they're unit-testable.
  - `buildSitemapUrls(input)` returns the list of `{ loc, lastmod? }` for one site.
  - `renderUrlset(urls)` builds the `<urlset>` XML (escaped).
  - `renderSitemapIndex(host)` builds the `<sitemapindex>` that points at `/sitemap.xml`.
- `src/pages/sitemap.xml.ts`: reads config, article index, and which shared pages exist in KV,
  then calls the lib.
- `src/pages/sitemap-index.xml.ts`: renders the index.
- No changes to middleware: it already edge-caches both paths (`s-maxage=600`), and the Grid
  path rewriter already passes them through.
- robots.txt is unchanged and keeps pointing at `/sitemap-index.xml`.

## What's listed

All URLs are absolute, on `https://<canonical domain>` (`getCanonicalDomain`).

| Site type | URLs |
|---|---|
| Modern | `/`; shared pages that exist in KV (about, contact, privacy, terms, dmca, amazon); `/category/<slug>` for every `brief.topics` entry when `categories.enabled`; every visible (published) article `/<slug>` with `lastmod` = publish date, newest first |
| Grid (`theme.template: grid`) | `/`; shared pages that exist; `/topic/<slug>` for each Grid topic. **No `/story/...` pages** (decision 2026-11-25: they summarize other sites' and aggregator content) |

## Edge cases

- No articles, or categories disabled: only the homepage and shared pages are listed.
- Duplicate topics: deduped by slug.
- Special characters in slugs: XML-escaped (`&`, `<`, `>`, `"`, `'`).
- Invalid or missing `publishDate`: the URL is listed without `lastmod`.
- More than 50,000 URLs (sitemap protocol limit): capped at 50,000, newest articles kept.
- Unknown hostname: the middleware already fails closed before the route runs.

## Test plan

Unit tests in `src/lib/__tests__/sitemap.test.ts`:
- Modern: homepage, shared pages, categories, and visible articles only; newest first; lastmod date.
- Categories disabled: no `/category/` URLs.
- Grid: topics plus shared pages, and no articles or stories even when an article index exists.
- XML escaping, well-formed urlset and index, 50,000 cap, invalid date gets no lastmod.

After deploy, check with curl that `/sitemap-index.xml` and `/sitemap.xml` return 200 with XML on
staging (a modern site and a Grid site).

## Out of scope

- Grid `/story/...` URLs (including a Grid site's own articles).
- Image or news sitemap extensions; splitting into multiple child sitemaps.
- Changing robots.txt.
