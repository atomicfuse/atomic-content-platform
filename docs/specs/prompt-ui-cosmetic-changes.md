# Atomic Network Dashboard — UI Cosmetic Restructuring

> **Mode:** `--dangerously-skip-permissions` — execute autonomously.
> **Repo:** `atomic-content-platform`
> **Service:** `services/dashboard`
> **Skills:** Follow BOTH `.claude/skills/dev-audit-trail/SKILL.md` AND `.claude/skills/atomic-labs-dev-standards/SKILL.md`

---

## OPERATING RULES

1. **Follow the dev-audit-trail skill FIRST.** Before touching any code: create `docs/` directories, read last 2-3 session summaries + backlog, create the audit log. Law 1: Log first, work second.
2. **Never ask for permission.** Just do it — read, code, commit.
3. **Never ask clarifying questions** unless something is truly impossible to infer from the codebase.
4. **Read first, code second.** After the audit log exists, read the relevant files to understand current patterns.
5. **Run `tsc --noEmit` after EVERY file change.** Log the result in the audit log. If it fails, fix before moving on.
6. **One feature branch:** `refactor/ui-restructure`
7. **Never commit to `main` or `master`.**
8. **Compress Superpowers.** Write one combined spec+plan at `docs/plans/2026-04-19-ui-restructure.md` before implementing. Don't wait for approval — this is a cosmetic-only change.
9. **Don't break functionality.** These are cosmetic/structural changes only — no logic changes.

---

## AUDIT TRAIL SETUP (do this FIRST — before reading any source code)

Follow dev-audit-trail Steps 0–1:

1. Run directory setup (`mkdir -p docs/audit-logs docs/sessions docs/decisions docs/plans docs/backlog docs/strategy`)
2. Read last 2-3 session summaries + backlog for context
3. Create audit log: `docs/audit-logs/2026-04-19-HHMM-ui-restructure.md`
   - Session type: **Coding**
   - Triggered by: "UI cosmetic restructuring — reorder sidebar, move pages into Settings/Overrides tabs, rename site detail tabs, scope Custom Domain to Identity only"
4. Run pre-flight checks (`tsc --noEmit`, `npm run lint`) and record results
5. Self-register in CLAUDE.md if not already present

Only AFTER the audit log exists → proceed to Discovery.

---

## DISCOVERY (after audit log is created)

Read in this order, log what you find in the audit log Investigation section:
```
services/dashboard/src/app/
services/dashboard/src/components/
```

Identify and document:
- The sidebar navigation component (likely in a layout file or a Sidebar component)
- The current sidebar menu items array and their order
- The current routing structure under `[org]/`
- The site detail page tabs and how they're implemented
- Where "Domains", "Scheduler", "Email", "Shared Pages" pages currently live as routes/components
- Where "Custom Domain" section is rendered (which tabs/components)
- How Settings currently implements its Org/Network tabs (pattern to follow for new tabs)

---

## TASK 1 — Reorder Sidebar Navigation

**Current sidebar order (from screenshot):**
Dashboard, Sites, Review Queue, Domains, Shared Pages, Email, Scheduler, Groups, Overrides, Settings, Deleted

**New sidebar order:**
1. Dashboard
2. Settings
3. Sites
4. Groups
5. Overrides
6. Review Queue
7. Deleted

**Items being REMOVED from sidebar** (moving into Settings or Overrides — see Tasks 2 & 3):
- Domains
- Shared Pages
- Email
- Scheduler

Find the sidebar navigation config (likely an array of nav items). Reorder and remove as specified. Keep the same icons, styles, and active-state behavior.

At the bottom of the sidebar, keep: Guide, + New Site, Dark Mode toggle, user avatar — in their current positions.

**Log this as Change 1 in the audit log. Run `tsc --noEmit` after.**

---

## TASK 2 — Move Domains, Scheduler, Email into Settings as Tabs

The Settings page currently has tabs: **Org** | **Network**

**New Settings tabs:** Org | Network | Domains | General Scheduler | Email

Implementation:
1. **Move the Domains page** content into a new tab component under Settings. Match whatever tab pattern the existing Org/Network tabs use (query param, nested route, or client-side tabs).
2. **Move the Scheduler page** content into a new tab. **Rename "Scheduler" to "General Scheduler"** in the tab label AND any page heading (e.g., if the page says "Scheduler Agent", change to "General Scheduler").
3. **Move the Email page** content into a new tab under Settings.
4. **Delete or redirect old standalone routes** for Domains, Scheduler, and Email to Settings with the appropriate tab active.

**Keep all existing functionality intact** — just move the UI. API routes, data fetching, actions all stay the same.

**Log each sub-change separately in the audit log. Run `tsc --noEmit` after each file change.**

**Decision to log:** How to implement the tabs — reuse existing tab pattern vs. new approach. Document the choice with alternatives.

---

## TASK 3 — Move Shared Pages into Overrides as Tabs

The Overrides page and Shared Pages page are currently separate routes.

**New structure:** Overrides page gets tabs: **Overrides** | **Shared Pages**

Implementation:
1. `/[org]/overrides` route becomes a tabbed page (follow the same pattern used in Settings).
2. First tab: "Overrides" — renders current Overrides content.
3. Second tab: "Shared Pages" — renders current Shared Pages content.
4. Delete or redirect `/[org]/shared-pages` to `/[org]/overrides` with Shared Pages tab active.

**Log changes in audit log. Run `tsc --noEmit` after each file change.**

---

## TASK 4 — Restructure Site Detail Page Tabs

Inside Sites → site detail page. Current tabs:
**Staging & Preview** | **Content** | **Site Identity** | **Email**

**New tab order and names:**
1. **Site Settings** (was "Site Identity") — now the first/default tab
2. **Deployments** (was "Staging & Preview")
3. **Content** (unchanged)

**Remove:** the "Email" tab entirely. Delete the tab trigger and its content panel.

**Rename mapping:**
- "Site Identity" → "Site Settings"
- "Staging & Preview" → "Deployments"

Update everywhere: tab labels, breadcrumbs, page titles, URL params (e.g., `?tab=site-identity` → `?tab=site-settings`).

**Log each rename and removal as separate changes. Run `tsc --noEmit` after each.**

---

## TASK 5 — Custom Domain Section: Show Only in Identity Sub-tab

The "Custom Domain" card (showing "Connected to coolnews.dev") currently appears in the site detail page.

Inside Site Settings, there are sub-tabs: **Identity** | **Content Brief** | **Groups** | **Overrides** | **Config**

**Rule:** Custom Domain section must:
- ✅ Show ONLY on the Identity sub-tab
- ❌ NOT show on Content Brief, Groups, Overrides, Config
- ❌ NOT show on Deployments or Content top-level tabs

Check if the Custom Domain component is rendered at a shared layout level. If so, move it inside the Identity sub-tab component specifically.

**Log as a change entry with verification.**

---

## POST-IMPLEMENTATION (dev-audit-trail Steps 5–10)

After all tasks:

### Testing (Step 5)
Functionally verify — not just compile:
- Navigate through all sidebar items — correct order, correct destinations
- Open Settings → verify all 5 tabs render their content
- Open Overrides → verify both tabs work
- Open a site → verify tab order, names, no Email tab
- Verify Custom Domain only on Identity sub-tab
- Check for broken links or missing content

### Final verification (audit log)
| Check | Result |
|-------|--------|
| tsc --noEmit | ✅ / ❌ |
| npm run lint | ✅ / ❌ |
| npm run build | ✅ / ❌ |
| Manual/functional test | ✅ / ❌ |

### Post-deploy verification (Step 6)
List what to verify after deployment:
- [ ] All sidebar links resolve correctly in production
- [ ] Settings tabs load real data (Domains, Email, Scheduler)
- [ ] Old URLs (/domains, /shared-pages, /email, /scheduler) redirect properly
- [ ] Site detail page reflects new tab names

### CLAUDE.md update (Step 7)
Update the following sections if they exist:
- Project structure / routing — reflect moved pages
- Navigation — reflect new sidebar order
- Any references to old tab names

### Backlog sync (Step 8)
Read `docs/backlog/general.md`. Mark done items. Add new items from all 6 categories. Log in audit.

### Session summary (Step 9)
Create `docs/sessions/2026-04-19-ui-restructure.md` with learning notes (min 3 sentences).

### Completion checklist (Step 10)
Run through the full session completion gate before ending.

---

## Commit

Only after ALL audit trail steps are complete:

```
refactor(ui): restructure sidebar, settings tabs, and site detail layout

- Reordered sidebar: Dashboard → Settings → Sites → Groups → Overrides → Review Queue → Deleted
- Moved Domains, General Scheduler, Email into Settings as tabs
- Moved Shared Pages into Overrides as a tab
- Renamed Site Identity → Site Settings, Staging & Preview → Deployments
- Removed Email tab from site detail page
- Scoped Custom Domain to Identity sub-tab only
```

---

## REFERENCE: Current vs New Structure

```
SIDEBAR (before → after):
  Dashboard          → Dashboard
  Sites              → Settings        ← moved up, now contains Domains/Scheduler/Email
  Review Queue       → Sites
  Domains            → Groups
  Shared Pages       → Overrides       ← now contains Shared Pages as tab
  Email              → Review Queue
  Scheduler          → Deleted
  Groups
  Overrides
  Settings
  Deleted

SETTINGS PAGE (before → after):
  [Org] [Network]
  →
  [Org] [Network] [Domains] [General Scheduler] [Email]

OVERRIDES PAGE (before → after):
  (just overrides list)
  →
  [Overrides] [Shared Pages]

SITE DETAIL TABS (before → after):
  [Staging & Preview] [Content] [Site Identity] [Email]
  →
  [Site Settings] [Deployments] [Content]
```
