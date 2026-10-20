# Ad-Free Links (`?trending`)

Add `trending` as a URL query parameter to any network site, and that visitor sees **no ads** for the rest of their browser session on that site. It works on every site (production and staging, current and future) and needs no setup in the dashboard.

## What counts

`trending` must be the **name** of a query parameter, after the `?`. Any value (or none) works, and upper/lower case doesn't matter.

| URL | Ad-free? |
|-----|----------|
| `site.com/?trending` | Yes |
| `site.com/some-article?trending` | Yes |
| `site.com/?utm_source=fb&trending&x=2` | Yes |
| `site.com/?trending=1`, `?trending=anything` | Yes |
| `site.com/?Trending`, `?TRENDING` | Yes |
| `trending-news.com/` (site name) | No |
| `site.com/trending`, `site.com/trending-movies-2026` (path / article slug) | No |
| `site.com/?topic=trending` (`trending` as a value) | No |
| `site.com/?trendingnow` (different name) | No |
| `site.com/#trending` (after `#` never reaches the server) | No |

## How long it lasts

The first `?trending` visit sets a session cookie (`atl_noads`). After that, every page on **that site** stays ad-free — homepage, articles, categories, Grid stories, infinite scroll — even though later URLs don't include `trending`. Closing the browser ends it. Other network domains are not affected.

## What is removed

- All ad placements (banners, in-content, sidebar, sticky, Grid feed ads)
- The interstitial
- All page-wide scripts in `head`, `body_start`, `body_end` and `before_footer` (where ad SDKs live), from every layer: org, groups, overrides and site
- Scripts attached to individual articles

Conditional overrides still apply, but they can't bring ads back.

## What stays

Analytics and tracking: GA4, GTM, Google Ads conversion, Meta pixel and custom tracking codes.

## Things to know

- **Anyone can use it.** The parameter is public; anyone who adds it gets an ad-free session. Watch analytics for unexpected `trending` traffic.
- **Every page-wide script is removed, not only ad scripts.** If you add a non-ad script (e.g. a consent banner or chat widget) under Scripts, `trending` visitors won't get it.
- **Ad code pasted directly into an article's text is not removed.**
- **`?x=1` and `?agi=1011` are not covered.** Those URLs are handed to other systems before this rule runs, so they show their normal ads.
- Ad-free pages are never cached, so they can't be served to other visitors.
