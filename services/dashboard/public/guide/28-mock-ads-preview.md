# Mock-Ad Preview (`?mockads`)

Add `mockads` to any network site's URL — for example `hypezen.com/?mockads` — and **your browser only** sees every ad position filled with a mock ad instead of the real one. Use it to check where ads sit and how a layout looks (Grid feed tiles, divider, rails, sidebar, in-article, sticky bar) on the live site, without waiting for real ads to fill and without changing any group.

Other visitors are not affected: they keep the real ads.

## How it works

- The first `?mockads` visit sets a session cookie (`atl_mockads`). Every page on **that site** then shows mocks — homepage, topics, stories, infinite scroll, the next stories below a story — until the browser is closed.
- **`?mockads=off`** (or `=0`) ends it right away.
- Works on production and staging, on every site, with no setup.
- Upper/lower case doesn't matter (`?MockAds` works). `mockads` must be the parameter name, not a value (`?topic=mockads` does nothing).

## What you see

- Every ad placement the site has (from org, groups, overrides and the site) shows a mock of its position and size. Grid feed ads look like a story card with an **AD** badge.
- Real ad code, the interstitial and the page-wide scripts (`head`, `body_start`, `body_end`, `before_footer` — where ad SDKs live) are not loaded, so the preview makes **no real ad requests or impressions**.
- Tracking (GA4, GTM, pixels) still loads.
- A small **Mock Ads Active** panel in the corner lists the slots on the page.

## Notes

- `?trending` wins: with both, the page has no ads at all.
- Pages in a mock session are never cached, so mocks never reach other visitors.
- To show mocks to everyone (e.g. a test site), put the site in the **mock-ads** group instead — and never publish that to a live site.
