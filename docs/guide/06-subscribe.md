# Email Subscriber Collection

Every generated site includes a newsletter signup form. Subscriptions are collected via the dashboard API and stored in Google Sheets.

## End-to-End Flow

```
User visits site
    |
    v
Newsletter form (footer widget or homepage section)
    |
    v
Client-side JS validates email + checks honeypot
    |
    v
POST /api/subscribe on dashboard
    { email, domain, source }
    |
    v
Server validates email + domain
    |
    v
Google Sheets: find or create tab for domain
    |
    v
Dedup check (email already exists for this domain?)
    |
    v
Append row: email, subscribed_at, source
    |
    v
201 Created (new) or 200 OK (duplicate)
```

## Frontend Components

Two Astro components render the subscribe form:

- **`NewsletterForm.astro`** -- standalone call-to-action section (used on homepage)
- **`NewsletterWidget.astro`** -- compact sidebar widget

Both share the same client-side script: `newsletter-subscribe.ts`.

### Form HTML

```html
<form data-newsletter-form data-source="homepage">
  <input type="email" name="email" placeholder="Enter your email" required />
  <button type="submit">Subscribe</button>
  <!-- Honeypot field: hidden from humans, bots fill it -->
  <input name="_hp" tabindex="-1" autocomplete="off"
         style="position:absolute;left:-9999px" />
</form>
```

The `data-source` attribute tracks where the subscription came from (homepage, sidebar, footer).

### Client-Side Logic

The `newsletter-subscribe.ts` script:

1. Finds all `[data-newsletter-form]` elements on the page
2. On submit, checks the honeypot field -- if filled, silently ignores the submission (bot)
3. Validates the email format client-side
4. POSTs to the `SUBSCRIBE_API_URL` environment variable with `{ email, domain, source }`
5. On success, replaces the form with a "Thank you for subscribing!" message
6. On error, shows an inline error message below the form

Environment variables used:
- `SUBSCRIBE_API_URL` -- dashboard API endpoint (e.g., `https://atomic-content-platform.apps.cloudgrid.io/api/subscribe`)
- `SITE_DOMAIN` -- the current site's domain, sent with each request

## API Endpoint

**`POST /api/subscribe`** on the dashboard service.

### Request

```json
{
  "email": "user@example.com",
  "domain": "coolnews.dev",
  "source": "homepage"
}
```

### Validation

- Email must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- Domain is required
- Returns 400 with an error message on validation failure

### CORS

The endpoint allows cross-origin requests from any origin (`Access-Control-Allow-Origin: *`) since the subscribe form runs on generated sites hosted on different domains. The `OPTIONS` handler returns proper preflight headers.

## Google Sheets Storage

Subscribers are stored in a single Google Spreadsheet, with one tab (worksheet) per domain.

### Tab Structure

Each domain gets its own tab named after the domain (lowercased). If the tab does not exist, it is created automatically with these headers:

| email | subscribed_at | source |
|-------|--------------|--------|
| user@example.com | 2026-04-12T10:30:00.000Z | homepage |

### Dedup Logic

Before appending a new row, the API reads all existing rows in the domain's tab and checks if the normalized email (lowercased, trimmed) already exists. If it does, the request returns 200 (success, no new row). If it is new, it appends a row and returns 201.

### Authentication

The Google Sheets API is accessed via a service account. The credentials are stored in the `GOOGLE_SERVICE_ACCOUNT_KEY` secret (JSON string). The spreadsheet ID is in the `GOOGLE_SHEET_ID` environment variable.

## Spam Protection

The system uses a **honeypot field** for spam protection. The `_hp` input is:
- Positioned off-screen (`left: -9999px`)
- Has `tabindex="-1"` and `autocomplete="off"`
- Hidden from real users who interact with the form normally

Bots that auto-fill all form fields will populate this hidden input. The client-side script checks: if `honeypot.value` is non-empty, the submission is silently dropped.

## Configuration

### Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `SUBSCRIBE_API_URL` | site-builder | Full URL to the subscribe endpoint |
| `SITE_DOMAIN` | site-builder | Domain sent with each subscription |
| `GOOGLE_SHEET_ID` | dashboard | Google Spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | dashboard | Service account JSON (secret) |

### CloudGrid Config

In `cloudgrid.yaml`, the sheet ID is set as a regular env var:

```yaml
services:
  dashboard:
    env:
      GOOGLE_SHEET_ID: "1XE56hNxuhCg4fP8gC59cv2quGp38Im3ASJ1ADj9gzZY"
```

The service account key is stored as a CloudGrid secret (never in Git).
