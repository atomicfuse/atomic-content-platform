# Dashboard Design Spec

**Date:** 2026-03-26
**Status:** Draft
**Package:** `packages/dashboard`

## Overview

The central control panel for the Atomic Content Platform. A Next.js 15 application where admins manage all domains across their full lifecycle — from a raw domain to a live monetized site.

**Approach:** GitHub API Direct (Approach A). No database. GitHub is the single source of truth. Dashboard reads/writes YAML files via Octokit. Cloudflare API for analytics and deployment status.

## Tech Stack

- Next.js 15 (App Router)
- Tailwind CSS v4
- shadcn/ui components
- `@octokit/rest` — GitHub API
- `@tanstack/react-query` — data fetching + caching
- `yaml` — parse/serialize YAML
- `@atomic-platform/shared-types` — shared TypeScript interfaces

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main dashboard: stats, filters, domain lifecycle table, activity feed |
| `/sites/[domain]` | Site detail: 3-tab view (Content, Content Agent, Monetization) |

Future flows (separate tickets):
- Site Creation Wizard (GM-29) — opened from "New" row click
- Monetization Setup (GM-35) — opened from "Start Monetization" or "Edit Monetization"

## Auth (V1)

Environment-level protection (Cloudflare Access or basic auth). No user login system. Access controlled via `platform.config.ts` access list. GitHub PAT stored as env var per org.

---

## Main Dashboard (`/`)

### Layout

```
┌──────────────────────────────────────────────────┐
│  Logo: Atomic Content Platform          Org Name │
├──────────────────────────────────────────────────┤
│ [Total Sites] [Articles/Week] [Pending Review] [Failed Builds] │
├──────────────────────────────────────────────────┤
│ 🔍 Search...  | Company ▾ | Vertical ▾ | Status ▾              │
├──────────────────────────────────────────────────┤
│                                                  │
│  Domain Lifecycle Table                          │
│  (scrollable, full width)                        │
│                                                  │
├──────────────────────────────────────────────────┤
│  Recent Activity Feed                            │
│  (scrollable list of events)                     │
└──────────────────────────────────────────────────┘
```

### Stats Panel

4 cards in a row:

| Card | Source | Highlight |
|------|--------|-----------|
| Total Sites | Count of `sites/*/site.yaml` | — |
| Articles Published This Week | Count articles with `publishDate` in current week | — |
| Pending Review | Count articles with `status: review` | Red if > 0 |
| Failed Builds | Cloudflare Pages API failed deployments | Red if > 0 |

### Filters

- **Search bar:** Filters table rows by domain name (client-side)
- **Company dropdown:** ATL / NGC (maps to org in config)
- **Vertical dropdown:** Derived from site configs (topics/categories)
- **Status dropdown:** New / Preview / Ready / Live / WordPress

### Domain Lifecycle Table

#### Columns

| Column | Source |
|--------|--------|
| Website | `site.yaml → domain` |
| Company | `site.yaml → organization` or org-level mapping |
| Vertical | `site.yaml → brief.topics[0]` or new `vertical` field |
| Status | Computed (see Status Logic below) |
| Site ID | `site.yaml → monetization.site_id` (new field) |
| Exclusivity | `site.yaml → monetization.exclusivity` (new field) |
| OB epid | `site.yaml → monetization.ob_epid` (new field) |
| GA Info | `site.yaml → tracking.ga4` |
| Last Updated | Latest git commit timestamp on `sites/{domain}/` |
| Traffic | Cloudflare Analytics API |
| Publisher | `site.yaml → monetization.publisher` (new field) |
| Link | Constructed: `https://{domain}` |
| Cloudflare APO | `site.yaml → monetization.cloudflare_apo` (new field) |
| Fixed Ad Insert | `site.yaml → monetization.fixed_ad_insert` (new field) |

#### Status Logic

| Status | Condition | Badge Color |
|--------|-----------|-------------|
| New | `site.yaml` exists, no Cloudflare deployment | Gray |
| Preview | Has staging deployment (`d6d9d146.{domain}.pages.dev`) but not production | Purple |
| Ready | Has production deployment, no monetization configured | Blue |
| Live | Production + monetization active (GM-35 defines criteria) | Green |
| WordPress | `site.yaml → legacy_platform: "wordpress"` (new field) | Orange |

#### Row Click Behavior

| Status | Action |
|--------|--------|
| New | Opens Site Creation Wizard (GM-29) |
| Preview | Opens staging preview (link to `https://{hash}.{domain}.pages.dev/`) |
| Ready | Opens side panel: site info + "Start Monetization" button |
| Live | Navigates to `/sites/[domain]` |
| WordPress | Shows tooltip: "Migration coming soon" |

### Recent Activity Feed

Scrollable list of latest events across all sites. Each item:
- Colored dot (green=success, red=failure, yellow=warning, purple=deploy, blue=monetization)
- Description text
- Relative timestamp ("2h ago")

Event types:
- Article published
- Build failed
- Article flagged for review
- Site created
- Preview deployed
- Monetization activated

**Source:** Aggregated from GitHub commit history + Cloudflare deployment events.

---

## Site Detail Screen (`/sites/[domain]`)

### Top Bar

```
← Back | CoolNews — coolnews.dev | [Live] | ATL · Tech | [Open Live Site ↗]
```

- Back arrow → returns to main dashboard
- Site name + domain
- Status badge (color-coded)
- Company + Vertical
- External link button to live site

### Tab: Content

Articles table for this site.

| Column | Source |
|--------|--------|
| Title | `frontmatter.title` |
| Type | `frontmatter.type` — badge: Listicle (blue), How-to (teal), Review (purple), Standard (gray) |
| AI Quality Score | `frontmatter.ai_quality_score` (new field, 0-100). Color: green ≥ 80, yellow 60-79, red < 60 |
| Status | `frontmatter.status` — Published / Flagged. Flagged links to Review Queue |
| Publish Date | `frontmatter.publishDate` |
| Preview | Button → opens article preview URL |

### Tab: Content Agent

Two-column layout.

**Left column — Agent Config (editable form):**

| Field | Maps to |
|-------|---------|
| Target audience | `site.yaml → brief.audience` |
| Tone of writing | `site.yaml → brief.tone` |
| Topics | `site.yaml → brief.topics` (tag input) |
| Articles per week | `site.yaml → brief.schedule.articles_per_week` |
| Preferred publish days | `site.yaml → brief.schedule.preferred_days` (checkboxes) |
| Content guidelines | `site.yaml → brief.content_guidelines` (textarea) |
| Approval threshold | `site.yaml → brief.review_percentage` (slider, inverted: threshold = 100 - review_percentage) |
| Scoring criteria | New field: `site.yaml → brief.scoring_criteria` (checkboxes) |

Saving writes changes back to `site.yaml` via GitHub API (commit to network repo).

**Right column — Agent Status (read-only + controls):**

| Field | Source |
|-------|--------|
| Status | Running / Paused — from agent runtime state |
| Model in use | From agent config |
| Articles generated this week | Count from recent commits |
| Auto-published | Count articles with `status: published` this week |
| Flagged | Count articles with `status: review` this week |
| Last run | From agent logs/state |
| Next scheduled run | Computed from schedule config |
| Pause / Resume | Button → toggles agent state |

### Tab: Monetization

Read-only display of monetization config. All fields from `site.yaml → monetization.*`.

| Field | Description |
|-------|-------------|
| Active ad networks | List of configured networks |
| Site ID | Monetization platform site ID |
| OB epid | Outbrain endpoint ID |
| GA Info | Google Analytics property |
| Cloudflare APO | Enabled/disabled |
| Fixed Ad Insert | Enabled/disabled |
| Ad Placements | List of placement positions + sizes |

"Edit Monetization" button → opens Monetization wizard pre-filled (GM-35).

---

## Shared Types Extensions

New fields needed in `SiteConfig`:

```typescript
interface MonetizationConfig {
  site_id: string | null;
  exclusivity: boolean;
  ob_epid: string | null;
  publisher: string | null;
  cloudflare_apo: boolean;
  fixed_ad_insert: boolean;
  ad_networks: AdNetwork[];
}

interface AdNetwork {
  name: string;       // "Google AdSense", "Outbrain"
  status: "active" | "inactive";
}

// Add to SiteConfig:
interface SiteConfig {
  // ... existing fields
  monetization?: MonetizationConfig;
  legacy_platform?: "wordpress";  // For migration tracking
  vertical?: string;              // Site vertical category
}

// Add to ArticleFrontmatter:
interface ArticleFrontmatter {
  // ... existing fields
  ai_quality_score?: number;  // 0-100, set by content pipeline
}
```

---

## Data Fetching Strategy

| Data | API | Cache (stale time) |
|------|-----|-------------------|
| Site configs | GitHub Contents API | 30s |
| Article list | GitHub Contents API | 30s |
| Article content | GitHub Contents API | 60s |
| Traffic stats | Cloudflare Analytics API | 5min |
| Deployment status | Cloudflare Pages API | 30s |
| Git commit history | GitHub Commits API | 60s |
| Agent status | TBD (runtime API) | 10s |

All fetching via React Query. Optimistic updates on config edits (write to GitHub, update cache immediately, revalidate on response).

## API Rate Limits

GitHub authenticated: 5,000 requests/hour. With ~12 sites and moderate usage, this is plenty. React Query caching prevents redundant requests.

## Out of Scope (V1)

- User authentication / login system
- n8n integration
- Site Creation Wizard UI (GM-29, separate ticket)
- Monetization Setup flow (GM-35, separate ticket)
- WordPress migration tools
- Multi-org switching (single org for V1)
