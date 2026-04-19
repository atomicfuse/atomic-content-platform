# Email Subscriber Collector — Design Spec

## Overview

Add a working email subscription flow to the Atomic Content Network. Each static site has newsletter forms (homepage, sidebar, footer) that currently do nothing (`action="#"`). Wire them up to collect subscriber emails into a shared Google Spreadsheet, with one tab per site domain.

No actual newsletter sending — just collection and tracking.

## Architecture

```
Static Site (Astro)                    Dashboard (Next.js)              Google Sheets
┌──────────────────┐   POST /api/subscribe   ┌──────────────┐   googleapis    ┌──────────────┐
│ NewsletterForm   │ ──────────────────────►  │ /api/subscribe│ ────────────► │ Spreadsheet   │
│ NewsletterWidget │   {email, domain,        │ route.ts      │               │  Tab: site1   │
│ Footer form      │    source}               └───────────────┘               │  Tab: site2   │
└──────────────────┘                                                          └───────────────┘
```

Three layers:

| Layer | Changes |
|-------|---------|
| Site-builder (Astro) | Client JS to intercept form submit, POST to dashboard, show feedback |
| Dashboard (Next.js) | New `POST /api/subscribe` route with Google Sheets integration |
| Google Sheets | Shared spreadsheet, one tab per domain |

## Site-Builder Changes

### Files modified

- `packages/site-builder/themes/modern/components/NewsletterForm.astro`
- `packages/site-builder/themes/modern/components/widgets/NewsletterWidget.astro`
- `packages/site-builder/themes/modern/components/Footer.astro`

### New file

- `packages/site-builder/themes/modern/scripts/newsletter-subscribe.ts` — shared client-side script for all newsletter forms.

### Behavior

A single shared `<script>` handles all three form variants. Each form is marked with `data-newsletter-form` and `data-source` attributes. The script:

1. Queries all elements with `[data-newsletter-form]`.
2. Intercepts form submit (prevent default).
3. Validates email client-side (basic regex) before sending.
4. Reads the email from the `input[type="email"]` or `input[name="email"]` inside the form (no reliance on CSS class names).
5. Sends `POST` to the subscribe API URL with JSON body:
   ```json
   { "email": "user@example.com", "domain": "coolnews.dev", "source": "homepage" }
   ```
   - `domain`: read from `import.meta.env.SITE_DOMAIN` (already defined in `astro.config.mjs` vite.define block).
   - `source`: read from `data-source` attribute — `"homepage"` for NewsletterForm, `"sidebar"` for NewsletterWidget, `"footer"` for Footer.
6. On success: replaces the form with a "Thanks for subscribing!" message.
7. On error: shows inline error text below the form, re-enables the button.
8. While loading: disables button, shows "Subscribing..." text.
9. Includes a hidden honeypot field (`<input name="_hp" style="display:none">`) for basic bot prevention — if filled, the request is silently dropped client-side.

### Subscribe API URL

Add `SUBSCRIBE_API_URL` to the site-builder's `astro.config.mjs` vite.define block:

```js
'import.meta.env.SUBSCRIBE_API_URL': JSON.stringify(
  process.env.SUBSCRIBE_API_URL || 'https://atomic-content-platform.apps.cloudgrid.io/api/subscribe'
),
```

The shared script reads `import.meta.env.SUBSCRIBE_API_URL` at build time. No data attributes needed for the URL.

### Component changes

Each Astro component (NewsletterForm, NewsletterWidget, Footer) needs:
1. Add `data-newsletter-form` attribute to the `<form>` element.
2. Add `data-source="homepage|sidebar|footer"` attribute.
3. Add hidden honeypot: `<input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">`.
4. Import the shared script: `<script src="../scripts/newsletter-subscribe.ts"></script>` (adjust path per component).

## Dashboard API Route

### New file

`services/dashboard/src/app/api/subscribe/route.ts`

### Endpoint

`POST /api/subscribe`

### Request body

```typescript
{
  email: string;    // required, valid email
  domain: string;   // required, the site domain
  source?: string;  // optional, defaults to "unknown"
}
```

### Response

New subscription (201):
```json
{ "status": "ok" }
```

Duplicate (200):
```json
{ "status": "ok" }
```

Validation error (400):
```json
{ "status": "error", "message": "Valid email is required" }
```

Server error (500):
```json
{ "status": "error", "message": "Failed to save subscription" }
```

### Logic

1. Parse and validate request body.
2. Validate email format (regex + basic checks).
3. Initialize Google Sheets client using `google-spreadsheet` package (lightweight Google Sheets wrapper) with service account auth.
4. Normalize domain to lowercase for consistent tab naming.
5. Check if a tab named `{domain}` exists in the spreadsheet.
   - If not: create it with header row `["email", "subscribed_at", "source"]`.
6. Use Google Sheets `MATCH` formula or a column A search to check for duplicate email. Read column A values to check — acceptable for expected scale (hundreds to low thousands of subscribers per site; see Scaling section).
7. If email already exists: return 200 success (silent dedup).
8. Append row: `[email, new Date().toISOString(), source]`.
9. Return 201 for new subscription.
10. Log subscription events: `console.log("[subscribe] new: domain=... source=...")` or `"[subscribe] duplicate: domain=..."` for observability.

### CORS

The route must handle CORS since static sites are on different origins:

- `Access-Control-Allow-Origin: *` (public subscribe forms)
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`
- Handle `OPTIONS` preflight request.

### Auth exclusion

The `/api/subscribe` route must be excluded from any auth middleware (it's called by anonymous visitors). The existing auth middleware already excludes `/api/` routes per commit `a4b3267`.

## Google Sheets Setup

### Spreadsheet

- One Google Spreadsheet in the specified Drive folder.
- Spreadsheet ID stored in env var `GOOGLE_SHEET_ID`.

### Tab structure

Each tab is named by the site domain, lowercased (e.g., `coolnews.dev`, `techbuzz.io`).

Header row (row 1):

| A | B | C |
|---|---|---|
| email | subscribed_at | source |

Data rows:

| A | B | C |
|---|---|---|
| user@example.com | 2026-04-12T10:30:00.000Z | homepage |

### Service account

- Google Cloud service account with Sheets API enabled.
- Service account email shared as Editor on the spreadsheet.
- JSON key stored as CloudGrid secret `GOOGLE_SERVICE_ACCOUNT_KEY`.
- For local dev: same value in `services/dashboard/.env.local`.

## Dependencies

### New npm packages (dashboard)

- `google-spreadsheet` — lightweight Google Sheets API wrapper (much smaller than full `googleapis` package)
- `google-auth-library` — peer dependency for service account auth

### Environment variables

| Variable | Service | Description |
|----------|---------|-------------|
| `GOOGLE_SHEET_ID` | dashboard | Spreadsheet ID from the Google Drive URL |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | dashboard | JSON key for service account (stringified) |
| `SUBSCRIBE_API_URL` | site-builder | Full URL to the subscribe endpoint (build time) |

## Deployment

### cloudgrid.yaml changes

Add `GOOGLE_SHEET_ID` to the dashboard env block:

```yaml
dashboard:
  env:
    GOOGLE_SHEET_ID: "<spreadsheet-id>"
```

`GOOGLE_SERVICE_ACCOUNT_KEY` is sensitive — store as a CloudGrid secret:

```bash
cloudgrid secrets set atomic-content-platform GOOGLE_SERVICE_ACCOUNT_KEY='<json-key>'
```

### Site-builder build-time env

`SUBSCRIBE_API_URL` is consumed at Astro build time. It does not need to be in `cloudgrid.yaml` — it's set in the `astro.config.mjs` vite.define block with a hardcoded default pointing to the production dashboard URL. No deployment config needed.

## Scaling

Expected scale: hundreds to low thousands of subscribers per site. At this scale, reading column A for dedup is fast and well within Google Sheets API rate limits (60 req/min per service account).

If a site exceeds ~10k subscribers, consider:
- Switching to append-only (no dedup) and deduplicating on read/export.
- Moving to a database (e.g., MongoDB via CloudGrid).

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid email format | 400 response, client shows error |
| Missing domain | 400 response |
| Google Sheets API down | 500 response, client shows "try again later" |
| Duplicate email | 200 response (silent skip), client shows success |
| Network error from client | Client shows "connection error, try again" |

## Security

- Basic email validation (format check, not disposable-email filtering).
- Hidden honeypot field for basic bot prevention (zero user friction).
- No rate limiting in v1 (can add later if spam becomes an issue).
- CORS open to all origins (public forms).
- No PII beyond email address.
- Service account key stored as secret, never in git.

## Out of Scope

- Actual newsletter sending (future feature).
- Unsubscribe mechanism.
- Email verification / double opt-in.
- Rate limiting / CAPTCHA.
- Dashboard UI to view subscribers (just use Google Sheets directly).
- Export functionality.
