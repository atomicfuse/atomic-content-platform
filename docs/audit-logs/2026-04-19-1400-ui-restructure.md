# Audit Log: UI Cosmetic Restructuring

- **Date:** 2026-04-19
- **Session type:** Coding
- **Branch:** `refactor/ui-restructure`
- **Triggered by:** UI cosmetic restructuring — reorder sidebar, move pages into Settings/Overrides tabs, rename site detail tabs, scope Custom Domain to Identity only

## Pre-flight Checks

| Check | Result |
|-------|--------|
| tsc --noEmit (dashboard) | PASS |
| Branch created | refactor/ui-restructure |

## Investigation

- **Sidebar**: `NAV_ITEMS` array in `components/layout/Sidebar.tsx` — 11 items, static array
- **Settings**: Route-based tabs via `app/settings/layout.tsx` (`TABS` array) + nested `page.tsx` files. Server component layout, no active state highlighting.
- **Overrides**: Single page at `app/overrides/page.tsx`, no layout/tabs
- **Site detail**: `SiteDetailTabs.tsx` uses `<Tabs>` UI component with 4 tabs (Staging, Content, Site Identity, Email)
- **Domains**: Server component at `app/domains/page.tsx`, uses `fetchDomains` action + `DomainsTable`
- **Scheduler**: Client component at `app/scheduler/page.tsx`, heading "Scheduler Agent"
- **Email**: Client component at `app/email/page.tsx`, heading "Email Forwarding"
- **Shared Pages**: Client component at `app/shared-pages/page.tsx`, list table
- **Custom Domain**: `AttachDomainPanel` rendered OUTSIDE tabs at page level in `sites/[domain]/page.tsx`
- **ContentAgentTab**: 5 sub-tabs (Identity, Content Brief, Groups, Overrides, Config)

## Decision: Tab Pattern

**Chosen:** Reuse existing route-based tab pattern (each tab = nested route page under settings/).
**Alternative considered:** Client-side `<Tabs>` component. Rejected because Settings already uses route-based pattern, and consistency is more important.

## Changes

### Change 1: Sidebar Reorder
- **File:** `components/layout/Sidebar.tsx`
- **Action:** Reordered NAV_ITEMS: Dashboard, Settings, Sites, Groups, Overrides, Review Queue, Deleted. Removed Domains, Shared Pages, Email, Scheduler.
- **tsc --noEmit:** PASS

### Change 2a: Settings Layout — Add Tabs
- **File:** `app/settings/layout.tsx`
- **Action:** Added Domains, General Scheduler, Email to TABS array
- **tsc --noEmit:** PASS

### Change 2b: Settings Domains Tab
- **File:** `app/settings/domains/page.tsx` (new)
- **Action:** Server component rendering DomainsTable + SyncDomainsButton (same content as old /domains page)
- **tsc --noEmit:** PASS

### Change 2c: Settings Scheduler Tab
- **File:** `app/settings/scheduler/page.tsx` (new)
- **Action:** Client component with scheduler config (renamed heading to "General Scheduler")
- **tsc --noEmit:** PASS

### Change 2d: Settings Email Tab
- **File:** `app/settings/email/page.tsx` (new)
- **Action:** Client component with email forwarding config
- **tsc --noEmit:** PASS

### Change 2e: Old Route Redirects
- **Files:** `app/domains/page.tsx`, `app/scheduler/page.tsx`, `app/email/page.tsx`
- **Action:** Replaced content with `redirect()` to new Settings tab routes
- **tsc --noEmit:** PASS

### Change 3a: Overrides Layout
- **File:** `app/overrides/layout.tsx` (new)
- **Action:** Created layout with Overrides | Shared Pages tabs (matching Settings pattern)
- **tsc --noEmit:** PASS

### Change 3b: Overrides Page Header
- **File:** `app/overrides/page.tsx`
- **Action:** Removed h1 header (now in layout)
- **tsc --noEmit:** PASS

### Change 3c: Shared Pages Under Overrides
- **File:** `app/overrides/shared-pages/page.tsx` (new)
- **Action:** Shared pages list table as tab under Overrides
- **tsc --noEmit:** PASS

### Change 3d: Shared Pages Redirect
- **File:** `app/shared-pages/page.tsx`
- **Action:** Replaced with `redirect("/overrides/shared-pages")`
- **tsc --noEmit:** PASS

### Change 4: Site Detail Tabs
- **File:** `app/sites/[domain]/SiteDetailTabs.tsx`
- **Action:** Renamed "Site Identity" → "Site Settings" (first tab, id: site-settings), "Staging & Preview" → "Deployments". Removed Email tab. Removed EmailRoutingPanel import.
- **tsc --noEmit:** PASS

### Change 5: Custom Domain Scoped to Identity
- **Files:** `components/site-detail/ContentAgentTab.tsx`, `app/sites/[domain]/page.tsx`
- **Action:** Added `customDomain` prop to ContentAgentTab. Rendered AttachDomainPanel inside Identity sub-tab. Removed from page level.
- **tsc --noEmit:** PASS

## Final Verification

| Check | Result |
|-------|--------|
| tsc --noEmit | PASS |
| npm run lint | N/A (not configured) |
| npm run build | PASS |
