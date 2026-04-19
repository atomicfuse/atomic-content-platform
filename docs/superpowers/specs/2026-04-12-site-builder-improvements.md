# Site Builder Improvements Spec

## Task 1 — Email Subscribe

**Status:** Already implemented. Backend at `/api/subscribe` uses Google Sheets with per-domain tabs and dedup. Frontend in `NewsletterForm.astro` has loading state, success message, error handling, and honeypot protection. SUBSCRIBE_API_URL properly configured.

## Task 2A — Shared Pages Editor

- **Override architecture:** `packages/site-builder/overrides/{site}/{page}.md` overrides `shared-pages/{page}.md`
- **Build resolution:** `inject-shared-pages.ts` checks overrides dir first, falls back to global
- **Dashboard API:** CRUD routes at `/api/shared-pages/`, `/api/shared-pages/[name]`, overrides at `/api/shared-pages/[name]/override`
- **Dashboard UI:** List view at `/shared-pages`, editor at `/shared-pages/[name]` with Global/Overrides tabs
- **Files:** `shared-pages.ts` lib, 5 API route files, 2 page components

## Task 2B — ads.txt Profiles

- **Profiles:** `shared-pages/ads-txt/{name}.txt` (default, premium, etc.)
- **Assignments:** `ads-txt-assignments.json` maps domain → profile name
- **Build:** `resolve-ads-txt-profile.ts` resolves profile content, appended to config ads.txt
- **Dashboard:** `/shared-pages/ads-txt` with Profiles/Assignments tabs, inline editor, create/delete
- **API:** CRUD at `/api/ads-txt/profiles` and `/api/ads-txt/assignments`

## Task 3 — Per-Site Email Routing

- **Email format:** `contact@{domain}` → `michal@atomiclabs.io`
- **Cloudflare API:** Create/list/delete email routing rules via zone API
- **Activation:** Only when site has custom domain + zone_id
- **Template variable:** `{{site_email}}` resolves in shared pages (falls back to support_email)
- **Dashboard:** EmailRoutingPanel component in site detail "Email" tab
- **API:** GET/POST/DELETE at `/api/email-routing/[domain]`
- **Fallback:** `hello@atomiclabs.io` when no domain connected

## Task 4 — In-App Guide

- **Content:** 8 markdown files in `docs/guide/` covering all system aspects
- **Dashboard UI:** `/guide` page with left sidebar navigation, markdown rendering
- **API:** `/api/guide/[slug]` reads markdown files
- **Sidebar:** "Guide" nav item at bottom of dashboard nav
