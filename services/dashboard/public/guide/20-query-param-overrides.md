# Query-Param Activated Overrides & Template Variables

Override configs that only take effect when a specific URL query parameter is present. Normal visitors see the base config; testers and partners see the patched version. Zero impact on existing sites.

## Two Features

### 1. Conditional Overrides (query-param activation)

A standard override with an **activation condition**. Instead of being merged at seed-time (permanently), it's stored separately in KV and merged at request-time only when the URL contains the matching query param.

**Example:** Override with `activation: { query_param: "stickytest", query_value: "true" }` targeting `travelswire.com`.

| URL | What happens |
|-----|-------------|
| `travelswire.com/article` | Normal config (override ignored) |
| `travelswire.com/article?stickytest=true` | Override config merged on top |
| `travelswire.com/article?stickytest=false` | Normal config (value doesn't match) |

### 2. Template Variables in Widget Code

Ad placement `code` fields can contain `${paramName}` placeholders that get resolved from URL query params at request-time. This works on **all requests** (not just conditional overrides) so UTM params and ad-network tracking values flow into widget code automatically.

**Example:** Widget code `<div id="widget-${giladqp}">` with URL `?giladqp=test` renders as `<div id="widget-test">`.

## Creating a Conditional Override

1. Go to **Overrides** > **Create New Override**
2. On the **General** tab, fill in the **Activation Condition** section:
   - **Query Parameter Name** — the URL param that activates this override (e.g. `stickytest`)
   - **Query Parameter Value** (optional) — if set, the param must equal this value. If empty, any value triggers activation.
3. On the **Targeting** tab, select which groups/sites this override applies to (same as regular overrides)
4. On the **Config** tab, configure the changes you want when the override is active (ads, tracking, scripts, etc.)
5. Click **Save**

The override is stored separately in KV and only applied when the URL matches. The next `seed-kv` run picks up the activation field and writes the override to `cond-overrides:<siteId>` instead of merging it into the base config.

## Using Template Variables

Put `${paramName}` anywhere in an ad placement's **Widget Code** field. The middleware resolves these from URL query params before rendering.

### UTM Tracking Example

Widget code on the dashboard:

```html
<script src="https://adnetwork.com/widget?campaign=${utm_campaign}&source=${utm_source}"></script>
```

Visitor arrives via marketing link:

```
travelswire.com/article?utm_source=google&utm_campaign=summer_sale
```

Rendered widget code:

```html
<script src="https://adnetwork.com/widget?campaign=summer_sale&source=google"></script>
```

The ad network receives campaign attribution automatically.

### Dynamic Widget IDs

Widget code:

```html
<div id="widget-${partner_id}"></div>
<script src="https://partner.com/embed.js?id=${partner_id}"></script>
```

URL: `travelswire.com/article?partner_id=abc123`

Result:

```html
<div id="widget-abc123"></div>
<script src="https://partner.com/embed.js?id=abc123"></script>
```

### Combining with Conditional Overrides

Template variables work inside conditional override configs too. Create an override with activation `?test=true` that has a widget code containing `${tracking_id}`. Visit:

```
travelswire.com/article?test=true&tracking_id=XYZ
```

The override merges (because `test=true`), and then `${tracking_id}` resolves to `XYZ` in the widget code.

## Query Param Propagation

When a conditional override or template variable is active, the middleware injects an inline script that propagates the relevant query params across internal navigation. Clicking a link from the article to the homepage carries the params automatically — no need to manually append them to every URL.

This uses the same mechanism as the `_atl_site` preview propagation: `<a>` hrefs are rewritten on click, and `window.fetch` is patched for server island sub-requests.

## Security

### Template variable sanitization

Values substituted from URL params are sanitized to `[a-zA-Z0-9_-.:` characters only. HTML tags, quotes, and special characters are stripped. This prevents injection attacks via crafted URLs.

| URL param value | Substituted as |
|-----------------|----------------|
| `summer_sale` | `summer_sale` |
| `abc-123` | `abc-123` |
| `v2.1:beta` | `v2.1:beta` |
| `"><script>alert(1)</script>` | `scriptalert1script` (stripped) |

### Cache safety

Responses with conditional overrides or resolved template variables are served with `cache-control: private, no-store`. This prevents edge caching of per-URL-param content — each visitor with different params gets a fresh response.

### Performance

- **No query params** (vast majority of traffic): zero overhead. The `searchParams.toString()` check skips both the KV read and template resolution entirely.
- **Query params present**: one extra KV read (`cond-overrides:<siteId>`) per request, plus string replacement on `code` fields that contain `${`.

## How It Works (Technical)

### Seed-time (seed-kv.ts)

When `seed-kv.ts` resolves a site's config:

1. Overrides **with** an `activation` field are excluded from the normal merge chain
2. They are stored separately as `cond-overrides:<siteId>` in KV — an array of `{ override_id, priority, activation, config }`
3. Overrides **without** activation work exactly as before (merged at seed-time)

### Request-time (middleware.ts)

For each request with query params:

1. **Conditional override check**: Read `cond-overrides:<siteId>` from KV. For each entry, check if the URL has the matching query param (and optional value). If yes, deep-merge the override's config on top.
2. **Template variable resolution**: Scan all `ad_placements[].code` fields for `${paramName}` patterns. Replace with the URL param value (sanitized). Track which params were used.
3. **Propagation**: Inject an inline script that carries all matched params (activation + template vars) across internal link clicks and fetch calls.
4. **Cache**: Set `cache-control: private, no-store` to prevent edge caching.

### Data flow

```
Dashboard: override with activation field
    |
    v
Network repo: overrides/config/<id>.yaml (with activation: { query_param, query_value })
    |
    v
seed-kv.ts: selectConditionalOverrides() -> writes cond-overrides:<siteId> to KV
    |
    v
middleware.ts: reads cond-overrides, matches URL params, deep-merges config
    |
    v
Template resolution: ${paramName} -> URL param value (sanitized)
    |
    v
Server Islands (AdSlot, InterstitialLoader, etc.): read patched config from Astro.locals
    |
    v
Rendered HTML with resolved widget code + propagation script
```

## Code Map

```
packages/site-worker/
  src/middleware.ts                    -- Conditional override matching + template var resolution
  src/lib/kv-schema.ts                -- ConditionalOverrideEntry type, conditionalOverridesKey()
  src/lib/deep-merge.ts               -- Runtime deep merge for overlay config
  src/lib/preview-override.ts         -- generateParamPropagationScript()
  scripts/lib/resolve.ts              -- selectConditionalOverrides(), activation filtering
  scripts/seed-kv.ts                  -- Writes cond-overrides:<siteId> to KV

services/dashboard/
  src/app/overrides/[id]/page.tsx     -- Activation Condition UI on General tab
```

## Cookbook

### Test a new ad layout without affecting live traffic

1. Create override: activation `?adtest=true`, target your site
2. Config tab: set `ads_config` with new placements
3. Visit `yoursite.com?adtest=true` — see new layout
4. Share URL with team for review
5. When approved: remove activation to make it permanent, or create a regular override

### Pass UTM data to ad network widgets

1. Edit the site's ad placement widget code (or use an override)
2. Add template variables: `<script src="https://ad.com/w?c=${utm_campaign}&s=${utm_source}">`
3. Marketing links naturally carry UTMs — widget code resolves automatically

### A/B test ad partner with a specific tracking ID

1. Create override: activation `?partner=acme`
2. Widget code: `<script src="https://acme.com/ad.js?id=${acme_id}"></script>`
3. URL: `yoursite.com?partner=acme&acme_id=12345`
4. Override merges new ad config + template resolves the partner ID
