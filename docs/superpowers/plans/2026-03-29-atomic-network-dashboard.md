# Atomic Network Dashboard — Implementation Plan

## Context

**Problem:** Atomic Labs manages a network of ad-monetized content sites. Today there's no central UI — site configs live as YAML in a GitHub repo, deployments happen manually, and there's no lifecycle tracking. The dashboard gives admins a single control panel to manage domains from raw Cloudflare domain through site creation, staging preview, to live monetized site.

**Jira tickets:** GM-30 (Main Dashboard), GM-45 (Dashboard Grid), GM-29 (Site Creation Flow), GM-35 (Monetization — stubs only), GM-42 (Google Auth), GM-43 (Sync Domains)

**Location:** `/Users/michal/Documents/ATL-content-network/atomic-content-platform/packages/dashboard/`

**Brand:** Nunito font, cyan `#52BAF2` / magenta `#C542C5`, dark theme default + light mode

---

## Decisions (Confirmed)

1. **dashboard-index.yaml** — Approved. New file at network repo root for dashboard metadata.
2. **Initial data** — Start empty. Domains populate via Cloudflare sync (GM-43).
3. **Stats & activity** — Real data from GitHub: article counts from repo, activity from git commit history, build status from GitHub Actions API.
4. **Credentials** — User will provide all keys: Google OAuth, Cloudflare API, GitHub PAT.
5. **GM-35 Monetization** — UI stubs only, no real integration yet.

---

## Architecture

### Data Layer — GitHub as Database

No external database. The GitHub repo `atomicfuse/atomic-labs-network` is the source of truth.

**New file: `dashboard-index.yaml`** at network repo root — stores dashboard-specific metadata per domain that doesn't belong in site.yaml (build config):

```yaml
sites:
  - domain: decoratingmom.com
    company: ATL
    vertical: Lifestyle
    status: Live          # New | Preview | Ready | Live | WordPress
    site_id: "1952252148"
    exclusivity: Taboola
    ob_epid: null
    ga_info: "G-C5W98CQV7E"
    cf_apo: true
    fixed_ad: false
    last_updated: "2025-12-01T10:00:00Z"
    created_at: "2025-11-15T08:00:00Z"
```

**Why not extend site.yaml?** Dashboard metadata (company, exclusivity, OB epid) is operational data unrelated to site building. Mixing it into site.yaml pollutes the Astro build config. A single index file also enables atomic reads (one API call for the full table) vs N calls to read N site.yaml files.

### API Layer

- **GitHub API** (Octokit) — read/write dashboard-index.yaml, site.yaml, articles, commit files
- **Cloudflare API** — list domains, trigger Pages builds, check APO status
- All through **Next.js Server Actions** and **Route Handlers** — no tokens exposed to client

### Auth

- **NextAuth.js v5** with Google OAuth provider
- Restricted to `@atomiclabs.io` email domain
- Session-based, server-side checks on all routes

### Frontend

- **Server Components** by default for all data-fetching pages
- **Client Components** only for: table interactions, wizard state, modals, toasts
- **Tailwind CSS v4** with CSS custom properties for brand tokens
- No heavy component library — custom primitives (~10 components)

---

## File Structure

```
packages/dashboard/
  package.json
  next.config.ts
  tsconfig.json
  postcss.config.mjs
  .env.local.example
  tailwind.config.ts           # Tailwind v4 with brand tokens
  src/
    app/
      layout.tsx               # Root layout: Nunito font, theme provider, auth
      page.tsx                 # Dashboard home (stats + table + activity)
      globals.css              # Brand CSS custom properties, Tailwind imports
      loading.tsx              # Root loading skeleton
      sites/
        [domain]/
          page.tsx             # Site Detail screen (Live sites)
          loading.tsx
      wizard/
        page.tsx               # Site Creation wizard (5-step)
      api/
        auth/[...nextauth]/
          route.ts             # NextAuth Google OAuth
    components/
      ui/                      # Brand primitives
        Button.tsx
        Badge.tsx
        Input.tsx
        Select.tsx
        Textarea.tsx
        Modal.tsx
        Tabs.tsx
        Slider.tsx
        Toast.tsx
        Table.tsx
      layout/
        Sidebar.tsx            # Nav sidebar (Dashboard, Sites, Review Queue, + New Site)
        Header.tsx             # Top bar
        StatsPanel.tsx         # 4 stat cards
        ActivityFeed.tsx       # Recent activity feed
      dashboard/
        SitesTable.tsx         # Main domain lifecycle table (client component)
        SiteRow.tsx            # Single row with status-based click behavior
        Filters.tsx            # Company, Vertical, Status dropdowns + search
        SyncDomainsButton.tsx  # Cloudflare sync button
      wizard/
        WizardShell.tsx        # Step container with tab navigation
        StepIdentity.tsx       # Step 1: domain, name, company, vertical
        StepTheme.tsx          # Step 2: Modern / Editorial picker
        StepContentBrief.tsx   # Step 3: audience, tone, topics, schedule
        StepPreview.tsx        # Step 4: staging preview iframe
        StepGoLive.tsx         # Step 5: go live button
      site-detail/
        SiteDetailHeader.tsx   # Top bar: name, domain, badge, open site button
        ContentTab.tsx         # Articles list
        ContentAgentTab.tsx    # Agent config (editable brief fields)
        MonetizationTab.tsx    # Read-only monetization info (stub)
      panels/
        ReadySitePanel.tsx     # Side panel for Ready sites
    lib/
      github.ts               # Octokit wrapper: readIndex, writeIndex, commitSiteFiles, readArticles
      cloudflare.ts            # CF API: listDomains, triggerBuild, checkAPO
      auth.ts                  # NextAuth config
      constants.ts             # Status colors, verticals, companies
    types/
      dashboard.ts             # DashboardSiteEntry, DashboardIndex, SiteStatus
    actions/
      sites.ts                 # Server Actions: updateSiteEntry, deleteSiteEntry
      wizard.ts                # Server Actions: createSite (multi-file commit), goLive
      sync.ts                  # Server Action: syncDomainsFromCloudflare
      agent.ts                 # Server Actions: pauseAgent, resumeAgent, updateBrief
```

---

## Implementation Phases

### Phase A — Scaffolding & Brand System

- [ ] Replace placeholder `package.json` with full Next.js 15 dependencies
- [ ] Create `next.config.ts` — transpilePackages for shared-types
- [ ] Create `tsconfig.json` — extend base tsconfig
- [ ] Create `postcss.config.mjs` — Tailwind v4 PostCSS plugin
- [ ] Create `tailwind.config.ts` — brand colors (cyan #52BAF2, magenta #C542C5), Nunito font, dark mode class strategy
- [ ] Create `src/app/globals.css` — CSS custom properties for brand tokens
- [ ] Create `src/app/layout.tsx` — root layout with Nunito, dark/light theme provider, sidebar nav
- [ ] Create UI primitives: Button, Badge, Input, Select, Textarea, Modal, Tabs, Toast

**Dependencies:**
```
next@15  react@19  react-dom@19  typescript
tailwindcss@4  @tailwindcss/postcss  postcss
next-auth@5  @auth/core
@octokit/rest  yaml
@atomic-platform/shared-types (workspace:*)
next-themes (dark/light toggle)
```

### Phase B — Auth (GM-42)

- [ ] Create `src/lib/auth.ts` — NextAuth config with Google provider, @atomiclabs.io restriction
- [ ] Create `src/app/api/auth/[...nextauth]/route.ts`
- [ ] Create `middleware.ts` — protect all routes except `/api/auth/*`
- [ ] Add SessionProvider to layout

### Phase C — Data Layer & Types

- [ ] Create `src/types/dashboard.ts` — DashboardSiteEntry, DashboardIndex, SiteStatus, Company, Vertical
- [ ] Create `src/lib/github.ts` — Octokit wrapper: readDashboardIndex, writeDashboardIndex, readSiteConfig, commitSiteFiles, readArticles
- [ ] Create `src/lib/cloudflare.ts` — listZones, triggerPagesBuild, getAPOStatus
- [ ] Create `src/lib/constants.ts` — status colors, verticals list, companies list
- [ ] Add DashboardSiteEntry/DashboardIndex types to `@atomic-platform/shared-types`

**`dashboard.ts` types:**
```typescript
type SiteStatus = 'New' | 'Preview' | 'Ready' | 'Live' | 'WordPress';
type Company = 'ATL' | 'NGC';
type Vertical = 'Lifestyle' | 'Travel' | 'Entertainment' | 'Animals' | 'Science' | 'Food & Drink' | 'News' | 'Conspiracy' | 'Other';

interface DashboardSiteEntry {
  domain: string;
  company: Company;
  vertical: Vertical;
  status: SiteStatus;
  site_id: string;
  exclusivity: string | null;
  ob_epid: string | null;
  ga_info: string | null;
  cf_apo: boolean;
  fixed_ad: boolean;
  last_updated: string;  // ISO 8601
  created_at: string;
}
```

**`github.ts` functions:**
- `readDashboardIndex()` — fetch + parse dashboard-index.yaml
- `writeDashboardIndex(index)` — commit updated dashboard-index.yaml
- `readSiteConfig(domain)` — fetch sites/{domain}/site.yaml
- `commitSiteFiles(domain, files[])` — Git Data API multi-file atomic commit
- `readArticles(domain)` — list articles in sites/{domain}/articles/

**`cloudflare.ts` functions:**
- `listZones()` — fetch all domains from CF account
- `triggerPagesBuild(projectName)` — trigger deploy
- `getAPOStatus(zoneId)` — check APO enabled

### Phase D — Dashboard Home (GM-30, GM-45)

- [ ] Create `src/app/page.tsx` — server component, fetches dashboard index
- [ ] Create `StatsPanel.tsx` — 4 stat cards (Total Sites, Articles This Week, Pending Review, Failed Builds)
- [ ] Create `SitesTable.tsx` — client component, main data grid with all columns
- [ ] Create `Filters.tsx` — Company, Vertical, Status dropdowns + search input
- [ ] Create `SyncDomainsButton.tsx` — calls Cloudflare API, adds new domains as "New"
- [ ] Create `ActivityFeed.tsx` — derived from git commit history in network repo
- [ ] Create `Sidebar.tsx` — nav: Dashboard, Sites, Review Queue, + New Site
- [ ] Create `src/actions/sync.ts` — syncDomainsFromCloudflare server action

**Stats panel data sources:**
- Total sites: count from dashboard-index.yaml
- Articles this week: read article frontmatter dates from repo via GitHub API
- Pending review: count articles with status "review" from repo
- Failed builds: GitHub Actions API (list workflow runs with conclusion=failure)

**Sites table:**
- Columns: Website, Company, Vertical, Status, Site ID, Exclusivity, OB epid, GA Info, Last Updated, CF APO, Fixed Ad
- Status badges: New=gray, Preview=purple, Ready=blue, Live=green, WordPress=orange
- Row click: New→wizard, Preview→staging preview, Ready→side panel, Live→site detail, WordPress→tooltip

**Activity feed:**
- Derived from git commit history in the network repo
- Parse commit messages for: site creation, article publishing, build triggers, monetization changes

### Phase E — Site Creation Wizard (GM-29)

- [ ] Create `src/app/wizard/page.tsx` — client component with step state machine
- [ ] Create `WizardShell.tsx` — step container with tab navigation (Identity, Theme, Content Brief, Preview, Go Live)
- [ ] Create `StepIdentity.tsx` — domain dropdown (from "New" sites), site name, tagline, company, vertical
- [ ] Create `StepTheme.tsx` — Modern / Editorial visual picker cards
- [ ] Create `StepContentBrief.tsx` — audience, tone, topics, articles/week, preferred days checkboxes, content guidelines
- [ ] Create `StepPreview.tsx` — triggers staging build, iframe preview, back/edit capability
- [ ] Create `StepGoLive.tsx` — deploy to production button
- [ ] Create `src/actions/wizard.ts` — createSite + goLive server actions

**Server Action `createSite`:**
1. Generate site.yaml from wizard data (maps to SiteConfig type)
2. Create skill.md from content brief
3. Create empty assets/ and articles/ placeholder files
4. Multi-file atomic commit to network repo via Git Data API
5. Update dashboard-index.yaml (status: Preview)
6. Trigger Cloudflare Pages staging build

**What gets created in network repo:**
- `sites/{domain}/site.yaml`
- `sites/{domain}/skill.md`
- `sites/{domain}/assets/.gitkeep`
- `sites/{domain}/articles/.gitkeep`

### Phase F — Site Detail Screen (GM-30)

- [ ] Create `src/app/sites/[domain]/page.tsx` — server component, fetches site config + articles
- [ ] Create `SiteDetailHeader.tsx` — site name, domain, status badge, company, vertical, "Open Live Site" link
- [ ] Create `ContentTab.tsx` — articles table (title, type badge, AI score, status, date, preview link)
- [ ] Create `ContentAgentTab.tsx` — editable brief fields, agent stats, pause/resume button
- [ ] Create `MonetizationTab.tsx` — read-only ad config stub, "Edit Monetization" button (disabled)
- [ ] Create `src/actions/agent.ts` — updateBrief, pauseAgent, resumeAgent server actions
- [ ] Create `src/actions/sites.ts` — updateSiteEntry server action

### Phase G — Panels & Polish

- [ ] Create `ReadySitePanel.tsx` — slide-out panel for Ready sites with info + "Start Monetization" stub button
- [ ] Add WordPress "Migration coming soon" tooltip on row click
- [ ] Create Toast component + toast notifications for sync, save, deploy
- [ ] Create `loading.tsx` skeletons for all async pages
- [ ] Add `error.tsx` error boundaries for failed API calls
- [ ] Add dark/light mode toggle in header
- [ ] Final UI polish: responsive layout, hover states, transitions

---

## Data Model: `dashboard-index.yaml`

**Location:** Root of `atomicfuse/atomic-labs-network` repo

**Initial state:** Empty `sites: []` — populated via Cloudflare sync or site creation wizard.

**Schema types** added to `@atomic-platform/shared-types` so dashboard and future consumers share them.

---

## Credentials Needed in `.env.local`

```
GOOGLE_CLIENT_ID=           # Google OAuth for @atomiclabs.io
GOOGLE_CLIENT_SECRET=
NEXTAUTH_SECRET=            # Will generate
NEXTAUTH_URL=http://localhost:3000

GITHUB_TOKEN=               # PAT with repo access to atomicfuse/atomic-labs-network
CLOUDFLARE_API_TOKEN=       # API token with Zone:Read, Pages:Edit permissions
CLOUDFLARE_ACCOUNT_ID=      # Account ID
```

---

## Verification

1. `pnpm --filter @atomic-platform/dashboard dev` starts without errors
2. Google sign-in redirects and only allows @atomiclabs.io
3. Dashboard loads sites from dashboard-index.yaml via GitHub API
4. "Sync Domains" fetches from Cloudflare and adds new entries
5. Site creation wizard commits files to network repo
6. Staging preview shows site in iframe
7. Status transitions work: New → Preview → Ready
8. Site Detail screen loads articles from GitHub
9. Dark/light mode toggle works
10. `pnpm --filter @atomic-platform/dashboard build` succeeds with zero TypeScript errors
