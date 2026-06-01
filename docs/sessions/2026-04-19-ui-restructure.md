# Session: UI Cosmetic Restructuring — 2026-04-19

## Summary

Restructured the dashboard sidebar, Settings page, Overrides page, and site detail tabs. This was a pure cosmetic/structural change with no business logic modifications.

## Changes Made

1. **Sidebar reordered** to: Dashboard, Settings, Sites, Groups, Overrides, Review Queue, Deleted
2. **Domains, General Scheduler, Email** moved into Settings as route-based tabs (following existing Org/Network pattern)
3. **Shared Pages** moved into Overrides as a tab (new layout.tsx with tab navigation)
4. **Site detail tabs** renamed: "Site Identity" → "Site Settings" (now default), "Staging & Preview" → "Deployments". Removed Email tab entirely.
5. **Custom Domain** (`AttachDomainPanel`) scoped to Identity sub-tab only, moved from page-level rendering into ContentAgentTab.

## Learning Notes

- The Settings page uses Next.js nested routes for tabs (layout.tsx defines tab nav, each tab is a separate page.tsx). This pattern works well but has no active-state highlighting since the layout is a server component. Future improvement: convert to client component with `usePathname` for active state.
- Old routes were preserved as redirects (using Next.js `redirect()`) rather than deleted, so bookmarks and external links still work.
- The `AttachDomainPanel` was rendered at page-level outside all tabs — this is why it showed everywhere. Moving it inside a specific sub-tab required passing `customDomain` as a new prop through ContentAgentTab.

## Files Changed

- `components/layout/Sidebar.tsx` — sidebar reorder
- `app/settings/layout.tsx` — added 3 tabs
- `app/settings/domains/page.tsx` — new
- `app/settings/scheduler/page.tsx` — new
- `app/settings/email/page.tsx` — new
- `app/domains/page.tsx` — redirect
- `app/scheduler/page.tsx` — redirect
- `app/email/page.tsx` — redirect
- `app/overrides/layout.tsx` — new
- `app/overrides/page.tsx` — removed header
- `app/overrides/shared-pages/page.tsx` — new
- `app/shared-pages/page.tsx` — redirect
- `app/sites/[domain]/SiteDetailTabs.tsx` — renamed/reordered tabs, removed Email
- `app/sites/[domain]/page.tsx` — removed AttachDomainPanel, added customDomain prop
- `components/site-detail/ContentAgentTab.tsx` — added AttachDomainPanel to Identity sub-tab
- `CLAUDE.md` — updated navigation/routing docs

## Verification

| Check | Result |
|-------|--------|
| tsc --noEmit | PASS |
| pnpm run build | PASS |
