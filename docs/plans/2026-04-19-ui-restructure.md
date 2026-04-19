# UI Restructure Plan — 2026-04-19

## Summary
Cosmetic-only restructuring of the dashboard UI:
1. Reorder sidebar (7 items, remove 4 that move into tabs)
2. Settings gets 3 new tabs: Domains, General Scheduler, Email
3. Overrides gets a tab: Shared Pages
4. Site detail tabs: rename + reorder + remove Email
5. Custom Domain scoped to Identity sub-tab only

## Implementation Order
1. Discovery — understand current patterns
2. Sidebar reorder (nav config array)
3. Settings tabs (follow existing Org/Network pattern)
4. Overrides tabs (same pattern)
5. Site detail tab rename/reorder/remove
6. Custom Domain scoping
7. Verification & commit
