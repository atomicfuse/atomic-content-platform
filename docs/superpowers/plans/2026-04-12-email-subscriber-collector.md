# Email Subscriber Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the existing newsletter forms on static Astro sites to collect subscriber emails into Google Sheets via the dashboard API.

**Architecture:** Static sites POST to `dashboard /api/subscribe` with `{email, domain, source}`. The dashboard route uses `google-spreadsheet` to write to a shared Google Spreadsheet with one tab per site domain. Dedup by email per tab.

**Tech Stack:** Astro (client JS), Next.js API route, `google-spreadsheet` + `google-auth-library` npm packages, Google Sheets API v4.

**Spec:** `docs/superpowers/specs/2026-04-12-email-subscriber-collector-design.md`

---

### Task 1: Install Google Sheets dependencies in dashboard

**Files:**
- Modify: `services/dashboard/package.json`

- [ ] **Step 1: Install packages**

```bash
cd services/dashboard && pnpm add google-spreadsheet google-auth-library
```

- [ ] **Step 2: Verify installation**

```bash
cd services/dashboard && node -e "require('google-spreadsheet'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/package.json pnpm-lock.yaml
git commit -m "feat(dashboard): add google-spreadsheet dependency for subscriber collection"
```

---

### Task 2: Create the Google Sheets helper module

**Files:**
- Create: `services/dashboard/src/lib/google-sheets.ts`

This module encapsulates all Google Sheets interactions. It exports two functions: `appendSubscriber` (main entry point) and `getSheet` (for testing/reuse).

- [ ] **Step 1: Create the helper**

```typescript
// services/dashboard/src/lib/google-sheets.ts
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function getAuth(): JWT {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY env var is not set");
  }
  const key = JSON.parse(keyJson) as { client_email: string; private_key: string };
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SCOPES,
  });
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID env var is not set");
  }
  return id;
}

export interface SubscribeResult {
  created: boolean; // true = new row, false = duplicate skipped
}

/**
 * Append a subscriber email to the Google Sheet tab for the given domain.
 * Creates the tab if it doesn't exist. Skips duplicates silently.
 */
export async function appendSubscriber(
  email: string,
  domain: string,
  source: string
): Promise<SubscribeResult> {
  const auth = getAuth();
  const doc = new GoogleSpreadsheet(getSpreadsheetId(), auth);
  await doc.loadInfo();

  const tabName = domain.toLowerCase();

  // Find or create the tab
  let sheet = doc.sheetsByTitle[tabName];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: tabName,
      headerValues: ["email", "subscribed_at", "source"],
    });
  }

  // Check for duplicate
  const rows = await sheet.getRows();
  const normalizedEmail = email.toLowerCase().trim();
  const exists = rows.some(
    (row) => row.get("email")?.toLowerCase().trim() === normalizedEmail
  );

  if (exists) {
    console.log(`[subscribe] duplicate: domain=${tabName} email=${normalizedEmail}`);
    return { created: false };
  }

  // Append new row
  await sheet.addRow({
    email: normalizedEmail,
    subscribed_at: new Date().toISOString(),
    source: source || "unknown",
  });

  console.log(`[subscribe] new: domain=${tabName} source=${source}`);
  return { created: true };
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd services/dashboard && pnpm typecheck
```

Expected: No errors related to `google-sheets.ts`.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/lib/google-sheets.ts
git commit -m "feat(dashboard): add Google Sheets helper for subscriber collection"
```

---

### Task 3: Create the `/api/subscribe` route with CORS

**Files:**
- Create: `services/dashboard/src/app/api/subscribe/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// services/dashboard/src/app/api/subscribe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { appendSubscriber } from "@/lib/google-sheets";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Handle CORS preflight. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Collect a newsletter subscription. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      email?: string;
      domain?: string;
      source?: string;
    };

    const email = body.email?.trim();
    const domain = body.domain?.trim();
    const source = body.source?.trim() || "unknown";

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { status: "error", message: "Valid email is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!domain) {
      return NextResponse.json(
        { status: "error", message: "domain is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const result = await appendSubscriber(email, domain, source);

    return NextResponse.json(
      { status: "ok" },
      { status: result.created ? 201 : 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save subscription";
    console.error("[subscribe] error:", message);
    return NextResponse.json(
      { status: "error", message: "Failed to save subscription" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd services/dashboard && pnpm typecheck
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/dashboard/src/app/api/subscribe/route.ts
git commit -m "feat(dashboard): add POST /api/subscribe route with CORS and Google Sheets integration"
```

---

### Task 4: Add env vars to `.env.local` and `cloudgrid.yaml`

**Files:**
- Modify: `services/dashboard/.env.local`
- Modify: `cloudgrid.yaml`

- [ ] **Step 1: Add env vars to `.env.local`**

Append to `services/dashboard/.env.local`:

```
# Email Subscriber Collection (Google Sheets)
GOOGLE_SHEET_ID=<spreadsheet-id-from-drive-url>
GOOGLE_SERVICE_ACCOUNT_KEY=<paste-json-key-here>
```

Note: The actual values must be provided by the developer. The spreadsheet ID is the long string in the Google Sheets URL between `/d/` and `/edit`.

- [ ] **Step 2: Add `GOOGLE_SHEET_ID` to `cloudgrid.yaml`**

Add to the dashboard env section in `cloudgrid.yaml`:

```yaml
  dashboard:
    type: nextjs
    path: /
    env:
      CONTENT_AGENT_URL: http://content-pipeline-app
      NEXTAUTH_URL: https://atomic-content-platform.apps.cloudgrid.io
      GOOGLE_SHEET_ID: "<spreadsheet-id>"
```

`GOOGLE_SERVICE_ACCOUNT_KEY` is set via `cloudgrid secrets set` (already sensitive — never in yaml).

- [ ] **Step 3: Set the CloudGrid secret for production**

```bash
cloudgrid secrets set atomic-content-platform GOOGLE_SERVICE_ACCOUNT_KEY='<paste-json-key-here>'
```

- [ ] **Step 4: Commit cloudgrid.yaml only** (`.env.local` is gitignored)

```bash
git add cloudgrid.yaml
git commit -m "feat(cloudgrid): add GOOGLE_SHEET_ID env for subscriber collection"
```

---

### Task 5: Add `SUBSCRIBE_API_URL` to Astro build config

**Files:**
- Modify: `packages/site-builder/astro.config.mjs`

- [ ] **Step 1: Add the vite define entry**

In `packages/site-builder/astro.config.mjs`, add a new line after the existing define block (line 36):

```javascript
// In the vite.define block, add:
'import.meta.env.SUBSCRIBE_API_URL': JSON.stringify(
  process.env.SUBSCRIBE_API_URL || 'https://atomic-content-platform.apps.cloudgrid.io/api/subscribe'
),
```

The full define block becomes:

```javascript
define: {
  'import.meta.env.SITE_DOMAIN': JSON.stringify(SITE_DOMAIN),
  'import.meta.env.NETWORK_DATA_PATH': JSON.stringify(NETWORK_DATA_PATH),
  'import.meta.env.IS_STAGING': JSON.stringify(IS_STAGING),
  'import.meta.env.SUBSCRIBE_API_URL': JSON.stringify(
    process.env.SUBSCRIBE_API_URL || 'https://atomic-content-platform.apps.cloudgrid.io/api/subscribe'
  ),
},
```

- [ ] **Step 2: Verify config parses**

```bash
cd packages/site-builder && node -e "import('./astro.config.mjs').then(() => console.log('ok'))"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add packages/site-builder/astro.config.mjs
git commit -m "feat(site-builder): add SUBSCRIBE_API_URL to vite define for newsletter forms"
```

---

### Task 6: Create the shared newsletter subscribe script

**Files:**
- Create: `packages/site-builder/themes/modern/scripts/newsletter-subscribe.ts`
- Modify: `packages/site-builder/tsconfig.json`

This is a client-side script that Astro will bundle. It attaches to all forms with `[data-newsletter-form]`.

- [ ] **Step 1: Add `themes/**/*.ts` to tsconfig include**

In `packages/site-builder/tsconfig.json`, update the `include` array:

```json
"include": ["src/**/*", "scripts/**/*", "themes/**/*.ts", ".astro/types.d.ts"]
```

This ensures the new script under `themes/modern/scripts/` gets typechecked.

- [ ] **Step 2: Create the script**

```typescript
// packages/site-builder/themes/modern/scripts/newsletter-subscribe.ts

const SUBSCRIBE_URL = import.meta.env.SUBSCRIBE_API_URL;
const SITE_DOMAIN = import.meta.env.SITE_DOMAIN;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

document.querySelectorAll<HTMLFormElement>("[data-newsletter-form]").forEach((form) => {
  const source = form.dataset.source || "unknown";
  const emailInput = form.querySelector<HTMLInputElement>('input[type="email"], input[name="email"]');
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const honeypot = form.querySelector<HTMLInputElement>('input[name="_hp"]');

  if (!emailInput || !submitBtn) return;

  const originalBtnText = submitBtn.textContent || "Subscribe";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Honeypot check — bots fill hidden fields
    if (honeypot && honeypot.value) return;

    const email = emailInput.value.trim();
    if (!email || !EMAIL_RE.test(email)) {
      showMessage(form, "Please enter a valid email address.", true);
      return;
    }

    // Loading state
    submitBtn.disabled = true;
    submitBtn.textContent = "Subscribing...";
    clearMessage(form);

    try {
      const res = await fetch(SUBSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, domain: SITE_DOMAIN, source }),
      });

      const data = await res.json();

      if (res.ok) {
        // Replace form with success message
        form.innerHTML = '<p class="newsletter-success">Thanks for subscribing!</p>';
      } else {
        showMessage(form, data.message || "Something went wrong. Please try again.", true);
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    } catch {
      showMessage(form, "Connection error. Please try again later.", true);
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  });
});

function showMessage(form: HTMLFormElement, text: string, isError: boolean): void {
  clearMessage(form);
  const msg = document.createElement("p");
  msg.className = isError ? "newsletter-error" : "newsletter-success";
  msg.textContent = text;
  form.appendChild(msg);
}

function clearMessage(form: HTMLFormElement): void {
  form.querySelector(".newsletter-error")?.remove();
  form.querySelector(".newsletter-success")?.remove();
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/site-builder/themes/modern/scripts/newsletter-subscribe.ts packages/site-builder/tsconfig.json
git commit -m "feat(site-builder): add shared newsletter subscribe client script"
```

---

### Task 7: Wire up NewsletterForm.astro

**Files:**
- Modify: `packages/site-builder/themes/modern/components/NewsletterForm.astro`

- [ ] **Step 1: Add data attributes, honeypot, and script import**

Replace the `<form>` tag (line 23) to add data attributes:

```html
<form class="newsletter-form" data-newsletter-form data-source="homepage">
```

Add honeypot input right after the email input (after line 30):

```html
<input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" />
```

Add script import at the bottom of the file (before `</section>` closing or after the `<style>` block — Astro will hoist it):

```html
<script src="../scripts/newsletter-subscribe.ts"></script>
```

Also add minimal CSS for success/error messages inside the existing `<style>` block:

```css
.newsletter-success {
  color: #10b981;
  font-size: 0.9375rem;
  margin-top: 0.5rem;
}

.newsletter-error {
  color: #ef4444;
  font-size: 0.875rem;
  margin-top: 0.5rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/site-builder/themes/modern/components/NewsletterForm.astro
git commit -m "feat(site-builder): wire up NewsletterForm to subscribe API"
```

---

### Task 8: Wire up NewsletterWidget.astro

**Files:**
- Modify: `packages/site-builder/themes/modern/components/widgets/NewsletterWidget.astro`

- [ ] **Step 1: Add data attributes, honeypot, and script import**

Replace the `<form>` tag (line 16):

```html
<form data-newsletter-form data-source="sidebar" class="newsletter-form">
```

Add honeypot input after the email input (after line 24):

```html
<input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" />
```

Add script import at the bottom:

```html
<script src="../../scripts/newsletter-subscribe.ts"></script>
```

Add success/error CSS to the existing `<style>` block:

```css
.newsletter-success {
  color: #10b981;
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

.newsletter-error {
  color: #ef4444;
  font-size: 0.8125rem;
  margin-top: 0.5rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/site-builder/themes/modern/components/widgets/NewsletterWidget.astro
git commit -m "feat(site-builder): wire up NewsletterWidget to subscribe API"
```

---

### Task 9: Wire up Footer.astro newsletter form

**Files:**
- Modify: `packages/site-builder/themes/modern/components/Footer.astro`

- [ ] **Step 1: Add data attributes, honeypot, and script import**

Replace the footer `<form>` tag (line 57):

```html
<form class="footer-newsletter" data-newsletter-form data-source="footer">
```

Add honeypot input after the email input closing `/>` (after line 64):

```html
<input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" />
```

Add script import before `</footer>` closing tag:

```html
<script src="../scripts/newsletter-subscribe.ts"></script>
```

Add success/error CSS to the existing `<style>` block:

```css
.newsletter-success {
  color: #10b981;
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

.newsletter-error {
  color: #ef4444;
  font-size: 0.8125rem;
  margin-top: 0.5rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/site-builder/themes/modern/components/Footer.astro
git commit -m "feat(site-builder): wire up Footer newsletter form to subscribe API"
```

---

### Task 10: Manual end-to-end test

This task verifies the full flow works locally.

**Prerequisites:**
- A Google Cloud service account with Sheets API enabled
- A Google Spreadsheet shared with the service account email
- `GOOGLE_SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_KEY` set in `services/dashboard/.env.local`

- [ ] **Step 1: Start local services**

```bash
cloudgrid dev
```

Verify both dashboard and content-pipeline start.

- [ ] **Step 2: Test the subscribe API directly**

```bash
curl -X POST http://localhost:3001/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","domain":"coolnews.dev","source":"manual-test"}'
```

Expected: `{"status":"ok"}` with HTTP 201.

- [ ] **Step 3: Test duplicate handling**

Run the same curl command again.

Expected: `{"status":"ok"}` with HTTP 200 (duplicate silently skipped).

- [ ] **Step 4: Verify in Google Sheets**

Open the spreadsheet. Confirm:
- A tab named `coolnews.dev` exists
- Header row: `email | subscribed_at | source`
- One data row: `test@example.com | <timestamp> | manual-test`
- No duplicate row.

- [ ] **Step 5: Test CORS preflight**

```bash
curl -X OPTIONS http://localhost:3001/api/subscribe \
  -H "Origin: https://coolnews.dev" \
  -H "Access-Control-Request-Method: POST" \
  -v 2>&1 | grep -i "access-control"
```

Expected: CORS headers present in response.

- [ ] **Step 6: Test validation**

```bash
curl -X POST http://localhost:3001/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"not-an-email","domain":"coolnews.dev"}'
```

Expected: `{"status":"error","message":"Valid email is required"}` with HTTP 400.

- [ ] **Step 7: Build a site and test the form**

```bash
cd packages/site-builder
SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network SUBSCRIBE_API_URL=http://localhost:3001/api/subscribe pnpm build
```

Open `dist/index.html` in a browser (or `pnpm preview`). Use the newsletter form. Verify:
- Clicking Subscribe shows "Subscribing..." loading state
- On success: form replaced with "Thanks for subscribing!"
- Email appears in Google Sheet

- [ ] **Step 8: Final commit (if any fixes were needed)**

```bash
git add -A && git commit -m "fix: address issues found during e2e testing"
```
