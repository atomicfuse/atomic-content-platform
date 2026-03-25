# Atomic Content Network Platform — Build SOP v2

## Project Overview

Build a multi-tenant content network platform for managing ad-monetized content websites at scale. The platform replaces individual WordPress installations with a centralized, Git-driven architecture using Astro for static site generation, a Next.js management dashboard, and n8n for AI content automation.

**Two-repo architecture:**
- **Platform repo** (`atomic-content-platform`) — the engine. All code, templates, themes, components, build scripts, dashboard. Versioned, tested, deployed independently. Shared across all organizations.
- **Network repos** (one per org, e.g., `atomic-labs-network`) — pure data. YAML configs, markdown articles, site assets. Zero code. Changes constantly via AI pipeline and dashboard.

**Key design principles:**
- Ultra simple. Git is the database. YAML is the config. Markdown is the content.
- Config inheritance: Organization → Group → Site. Each level inherits and can override.
- One Astro template (from platform) serves all sites across all orgs. Differences come from config data, not code.
- All content sites deploy as static HTML on Cloudflare Pages — zero server-side compute.
- The dashboard is a thin UI layer over GitHub API operations on network repos — it doesn't own any data.
- Platform updates are independent of content updates. Version the platform, pin orgs to stable versions.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  PLATFORM (atomic-content-platform repo)                     │
│  One codebase. Versioned. Shared by all orgs.                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ site-builder package (Astro)                            │  │
│  │ ├── Themes (modern, editorial)                          │  │
│  │ ├── Shared components (AdSlot, HeadScripts, etc.)       │  │
│  │ ├── Shared legal page templates (privacy, terms, etc.)  │  │
│  │ ├── Build scripts (config resolver, ads.txt gen, etc.)  │  │
│  │ └── Astro config (reads data from network repo)         │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ dashboard package (Next.js)                             │  │
│  │ ├── Multi-org management UI                             │  │
│  │ ├── Site/Group CRUD → GitHub API on network repos       │  │
│  │ ├── Review queue, content calendar                      │  │
│  │ ├── Manual article requests → n8n webhooks              │  │
│  │ └── Auth via Cloudflare Access                          │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ migration package                                       │  │
│  │ └── WordPress → markdown migration tooling              │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ shared-types package                                    │  │
│  │ └── TypeScript types for configs, articles, schemas     │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Article type templates (listicle, how-to, review, etc.) │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ platform.config.ts — org registry                       │  │
│  │ Maps org slugs → network repo URLs + credentials        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  NETWORK DATA REPOS (one per organization, pure data)        │
│                                                              │
│  atomic-labs-network/              client-x-network/         │
│  ├── network.yaml                  ├── network.yaml          │
│  ├── org.yaml                      ├── org.yaml              │
│  ├── groups/*.yaml                 ├── groups/*.yaml         │
│  └── sites/{domain}/               └── sites/{domain}/       │
│      ├── site.yaml                     ├── site.yaml         │
│      ├── assets/                       ├── assets/           │
│      └── articles/*.md                 └── articles/*.md     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  AI PIPELINE (n8n)                                           │
│                                                              │
│  ├── Triggers: schedule OR dashboard webhook                 │
│  ├── Reads: site brief from network repo via GitHub API      │
│  ├── Reads: article templates from platform repo             │
│  ├── Generates: .md file with frontmatter via AI             │
│  ├── Routes: 95% → status:published / 5% → status:review    │
│  ├── Commits: pushes .md to org's network repo               │
│  └── Notifies: Telegram/Slack on review items                │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  BUILD + DEPLOY (Cloudflare Pages, per site)                 │
│                                                              │
│  On push to network repo:                                    │
│  1. Detect which sites changed (build filter)                │
│  2. Clone network repo (data) + platform repo (code)         │
│  3. Platform reads network.yaml → knows which version to use │
│  4. Run: platform build-site → resolves org→group→site config│
│  5. Astro renders static HTML using platform themes/components│
│  6. Output → Cloudflare CDN                                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Repository Structures

### Platform Repo: `atomic-content-platform`

This is a Turborepo monorepo containing all platform code. No organization-specific data lives here.

```
atomic-content-platform/
├── packages/
│   ├── site-builder/                 ← Astro template + build tooling
│   │   ├── src/
│   │   │   ├── layouts/
│   │   │   │   ├── BaseLayout.astro
│   │   │   │   ├── ArticleLayout.astro
│   │   │   │   └── PageLayout.astro
│   │   │   ├── components/
│   │   │   │   ├── AdSlot.astro
│   │   │   │   ├── Interstitial.astro
│   │   │   │   ├── HeadScripts.astro
│   │   │   │   ├── BodyStartScripts.astro
│   │   │   │   ├── BodyEndScripts.astro
│   │   │   │   ├── TrackingScripts.astro
│   │   │   │   └── SEOHead.astro
│   │   │   ├── pages/                ← Astro page routes (dynamic, read from data)
│   │   │   └── utils/
│   │   │       └── inject-ads.ts     ← paragraph-counting ad injection logic
│   │   ├── themes/
│   │   │   ├── modern/
│   │   │   │   ├── components/
│   │   │   │   │   ├── Header.astro
│   │   │   │   │   ├── Footer.astro
│   │   │   │   │   ├── ArticleCard.astro
│   │   │   │   │   └── Sidebar.astro
│   │   │   │   └── styles/
│   │   │   │       └── theme.css
│   │   │   └── editorial/
│   │   │       ├── components/
│   │   │       └── styles/
│   │   ├── shared-pages/             ← Legal page templates with {{placeholders}}
│   │   │   ├── privacy.md
│   │   │   ├── terms.md
│   │   │   ├── about.md
│   │   │   ├── dmca.md
│   │   │   └── contact.md
│   │   ├── scripts/
│   │   │   ├── resolve-config.ts     ← merges org → group → site config
│   │   │   ├── build-site.ts         ← entry point: builds one site from network data
│   │   │   ├── generate-ads-txt.ts   ← generates ads.txt from resolved config
│   │   │   ├── detect-changed-sites.ts ← determines which sites need rebuild
│   │   │   └── inject-shared-pages.ts  ← resolves {{placeholders}} in legal pages
│   │   ├── astro.config.mjs
│   │   ├── tailwind.config.mjs
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── dashboard/                    ← Next.js management app
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx          ← org selector / home
│   │   │   │   └── [org]/
│   │   │   │       ├── layout.tsx    ← org-scoped layout
│   │   │   │       ├── page.tsx      ← org overview
│   │   │   │       ├── sites/
│   │   │   │       │   ├── page.tsx          ← sites list
│   │   │   │       │   ├── new/page.tsx      ← site creation wizard
│   │   │   │       │   └── [domain]/
│   │   │   │       │       └── page.tsx      ← site detail + config editor
│   │   │   │       ├── groups/
│   │   │   │       │   ├── page.tsx          ← groups list
│   │   │   │       │   └── [groupId]/
│   │   │   │       │       └── page.tsx      ← group detail + editor
│   │   │   │       ├── review/
│   │   │   │       │   └── page.tsx          ← review queue
│   │   │   │       ├── content/
│   │   │   │       │   └── page.tsx          ← content calendar
│   │   │   │       └── stats/
│   │   │   │           └── page.tsx          ← stats dashboard
│   │   │   ├── lib/
│   │   │   │   ├── github.ts         ← Octokit wrapper, org-scoped read/write
│   │   │   │   ├── n8n.ts            ← webhook trigger helpers
│   │   │   │   ├── cloudflare.ts     ← Pages API + Analytics API
│   │   │   │   ├── config-parser.ts  ← YAML parse/serialize for dashboard forms
│   │   │   │   └── org-registry.ts   ← reads platform.config.ts
│   │   │   ├── components/
│   │   │   │   ├── site-form.tsx
│   │   │   │   ├── group-form.tsx
│   │   │   │   ├── article-preview.tsx
│   │   │   │   ├── review-card.tsx
│   │   │   │   ├── color-picker.tsx
│   │   │   │   └── markdown-editor.tsx
│   │   │   └── hooks/
│   │   │       ├── use-sites.ts      ← React Query hooks for GitHub API
│   │   │       ├── use-groups.ts
│   │   │       └── use-articles.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── migration/                    ← WordPress migration tooling
│   │   ├── src/
│   │   │   ├── migrate-from-wp.ts    ← main migration script
│   │   │   ├── html-to-markdown.ts   ← HTML → clean markdown converter
│   │   │   └── url-mapper.ts         ← generates redirect rules
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── shared-types/                 ← TypeScript types shared across all packages
│       ├── src/
│       │   ├── config.ts             ← OrgConfig, GroupConfig, SiteConfig, ResolvedConfig
│       │   ├── article.ts            ← ArticleFrontmatter, ArticleType
│       │   ├── ads.ts                ← AdPlacement, AdSlotConfig, ScriptConfig
│       │   ├── tracking.ts           ← TrackingConfig
│       │   └── network.ts            ← NetworkManifest (network.yaml type)
│       ├── tsconfig.json
│       └── package.json
│
├── templates/                        ← Article type templates for AI pipeline
│   ├── listicle.md
│   ├── how-to.md
│   ├── review.md
│   └── standard.md
│
├── platform.config.ts                ← Org registry
├── package.json                      ← Workspace root (npm workspaces or pnpm)
├── turbo.json                        ← Turborepo config
├── tsconfig.base.json
└── README.md
```

### Network Data Repo: `{org-slug}-network` (one per organization)

Pure data. No `package.json`, no `node_modules`, no code. Just configs, content, and assets.

```
atomic-labs-network/
├── network.yaml                      ← platform version pin + network metadata
├── org.yaml                          ← org-wide defaults
├── groups/
│   ├── premium-ads.yaml
│   └── standard-ads.yaml
├── sites/
│   ├── muvizz.com/
│   │   ├── site.yaml
│   │   ├── assets/
│   │   │   ├── logo.svg
│   │   │   └── favicon.png
│   │   └── articles/
│   │       ├── best-thrillers-2026.md
│   │       └── streaming-wars-update.md
│   ├── travelbeautytips.com/
│   │   ├── site.yaml
│   │   ├── assets/
│   │   └── articles/
│   ├── journeypeaks.com/
│   │   ├── site.yaml
│   │   ├── assets/
│   │   └── articles/
│   └── ... (more sites)
└── README.md
```

---

## Config File Specifications

### network.yaml — Network Manifest

Top-level file in every network repo. Tells the build system which platform version to use.

```yaml
# Platform binding
platform_version: "1.0.0"            # semver tag from platform repo
platform_repo: "atomic-network/atomic-content-platform"

# Network metadata
network_id: "atomic-labs"
network_name: "Atomic Labs Content Network"
created: "2026-03-15"
```

During builds, the build script:
1. Reads `network.yaml` from the network repo.
2. Checks out the specified `platform_version` tag from the platform repo.
3. Runs the platform's build tooling against the network's data.

For development and initial setup, `platform_version: "latest"` can be used to always pull the latest platform code. In production, pin to specific versions for stability.

### org.yaml — Organization Defaults

Everything here is inherited by all groups and sites in this network unless overridden.

```yaml
# Organization identity
organization: "Atomic Labs"
legal_entity: "Atomic Labs Ltd"
company_address: "..."
support_email_pattern: "contact@{{domain}}"

# Default theme
default_theme: modern
default_fonts:
  heading: "Inter"
  body: "Inter"

# Default tracking — applied to every site unless overridden
tracking:
  ga4: null
  gtm: null
  google_ads: null
  facebook_pixel: null
  custom: []

# Default scripts — loaded on every site
scripts:
  head: []
  body_start: []
  body_end: []

# Default ad config
ads_config:
  interstitial: false
  in_content_slots: 2
  sidebar: false
  layout: standard
  ad_placements: []

# Shared legal page variables (available as {{var}} in legal page templates)
legal:
  company_name: "Atomic Labs Ltd"
  company_country: "Israel"
  effective_date: "2025-01-01"
```

### groups/{group-id}.yaml — Group Config

Groups define shared ad operations config for a subset of related sites. This is where ads.txt, ad network scripts, and ad layouts live.

```yaml
group_id: premium-ads
name: "Premium Ad Network Sites"

# --- Ads.txt ---
# Lines written to each site's ads.txt in this group
ads_txt:
  - "google.com, pub-XXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0"
  - "advertising.com, 28246, DIRECT"
  - "rubiconproject.com, 19116, DIRECT"
  - "openx.com, 537149485, DIRECT, 6a698e2ec38604c6"

# --- Tracking overrides ---
tracking:
  google_ads: "AW-XXXXXXXXX"

# --- Ad Network Scripts ---
# JavaScript tags required by ad partners.
# `position` determines where in the HTML they are injected.
# `inline` supports {{variable}} placeholders resolved from site's scripts_vars.
# `src` loads an external script.
scripts:
  head:
    - id: gpt
      src: "https://securepubads.g.doubleclick.net/tag/js/gpt.js"
      async: true
    - id: network-alpha-init
      inline: |
        window.alphaAds = {
          siteId: "{{alpha_site_id}}",
          zone: "{{alpha_zone}}"
        };
    - id: network-alpha-loader
      src: "https://cdn.network-alpha.com/loader.js"
      async: true

  body_start: []

  body_end:
    - id: interstitial-trigger
      inline: |
        if ({{interstitial_enabled}}) {
          window.alphaAds.showInterstitial({
            frequency: "once_per_session",
            delay: 3000
          });
        }

# --- Ad Layout ---
# Defines ad containers that Astro renders on article pages.
# The ad network JS (loaded above) fills these containers at runtime.
ads_config:
  primary_advertiser: "network-alpha"
  interstitial: true
  layout: high-density

  ad_placements:
    - id: "top-banner"
      position: above-content
      sizes:
        desktop: [[728, 90], [970, 90]]
        mobile: [[320, 50], [320, 100]]
      device: all

    - id: "in-content-1"
      position: after-paragraph-3
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250], [336, 280]]
      device: all

    - id: "in-content-2"
      position: after-paragraph-7
      sizes:
        desktop: [[336, 280], [300, 250]]
        mobile: [[300, 250]]
      device: all

    - id: "in-content-3"
      position: after-paragraph-12
      sizes:
        desktop: [[336, 280]]
        mobile: [[300, 250]]
      device: all

    - id: "sidebar-sticky"
      position: sidebar
      sizes:
        desktop: [[300, 600], [160, 600], [300, 250]]
      device: desktop

    - id: "mobile-anchor"
      position: sticky-bottom
      sizes:
        mobile: [[320, 50]]
      device: mobile

# --- Theme overrides for this group ---
theme:
  colors:
    primary: "#1A1A2E"
    secondary: "#16213E"
    accent: "#E94560"
    background: "#FFFFFF"
    text: "#2D2D2D"
    muted: "#6B7280"

# --- Legal page overrides for this group (optional) ---
# If a group needs a different privacy policy (e.g., different ad partners),
# place the override file in the group config. The platform will check for
# group-level legal page overrides before falling back to the platform defaults.
legal_pages_override:
  privacy: |
    Additional paragraph about ad partners used by this group's sites.
```

### sites/{domain}/site.yaml — Per-Site Config

Minimal. References a group and overrides only what's unique to this site.

```yaml
domain: muvizz.com
site_name: "Muvizz"
site_tagline: "Entertainment News & Reviews"
group: premium-ads

# Site status
active: true                          # false = shows maintenance page

# --- Per-site tracking ---
tracking:
  ga4: "G-MUVIZZ1234"

# --- Per-site script variables ---
# Resolves {{placeholders}} in group-level script templates
scripts_vars:
  alpha_site_id: "muvizz-001"
  alpha_zone: "entertainment"
  interstitial_enabled: "true"

# --- Content brief (used by AI pipeline) ---
brief:
  audience: "Movie enthusiasts and entertainment fans, 18-45"
  tone: "casual, opinionated, knowledgeable"
  article_types:
    listicle: 50
    review: 30
    standard: 20
  topics:
    - movie reviews and recommendations
    - streaming platform comparisons
    - entertainment industry news
    - TV show recaps and rankings
  seo_keywords_focus:
    - best movies 2026
    - streaming recommendations
    - entertainment news
  content_guidelines: |
    Write with personality. Take positions on movies — don't be generic.
    Always include specific titles, director names, and streaming platforms.
    Reference recent releases and trending entertainment topics.
  review_percentage: 5
  schedule:
    articles_per_week: 3
    preferred_days: [monday, wednesday, friday]
    preferred_time: "10:00"

# --- Theme overrides (only what differs from group) ---
theme:
  base: modern
  colors:
    primary: "#E50914"
    accent: "#B81D24"
  logo: /assets/logo.svg
  favicon: /assets/favicon.png
  fonts:
    heading: "Playfair Display"
    body: "Inter"

# --- Legal page variable overrides ---
legal:
  site_description: "entertainment news and movie reviews"
```

---

## Config Resolution System

### resolve-config.ts — The Core Engine

Lives in `packages/site-builder/scripts/resolve-config.ts`. This is the most important utility in the system.

**Input:** path to network repo root + target domain.

**Process:**
1. Read `org.yaml` from network repo as base config.
2. Read target site's `site.yaml` to get the `group` reference.
3. Read `groups/{group}.yaml` from network repo.
4. Deep merge: start with `org.yaml`, merge `group.yaml` on top, merge `site.yaml` on top.
5. Resolve all `{{placeholder}}` values in the `scripts` tree using the merged `scripts_vars`.
6. Resolve `support_email_pattern` and similar template strings using site-level values.
7. Return a fully resolved `ResolvedConfig` typed object.

**Deep merge rules:**
- **Objects:** recursively merge. Child keys override parent keys at the same path.
- **Arrays:** child REPLACES parent entirely (no concatenation). This ensures ads.txt lines and ad_placements are fully controlled at the level they're defined.
- **Null values:** explicitly setting a key to `null` clears the parent's value (opt-out mechanism).
- **`scripts_vars`:** merged across all levels (site vars override group vars override org vars), then all `{{placeholder}}` strings in the `scripts` tree are resolved using the final merged vars.
- **`scripts` arrays (head, body_start, body_end):** merged by `id`. If a child level defines a script entry with the same `id` as a parent, the child's version replaces it. New `id`s are appended. This allows a site to override a specific script from its group without redefining the entire array.

**Output type (from shared-types):**

```typescript
interface ResolvedConfig {
  // Network
  network_id: string;
  platform_version: string;

  // Org
  organization: string;
  legal_entity: string;
  company_address: string;

  // Site
  domain: string;
  site_name: string;
  site_tagline: string | null;
  group: string;
  active: boolean;

  // Tracking (fully resolved)
  tracking: {
    ga4: string | null;
    gtm: string | null;
    google_ads: string | null;
    facebook_pixel: string | null;
    custom: Array<{ name: string; src: string; position: string }>;
  };

  // Scripts (fully resolved, all {{placeholders}} replaced)
  scripts: {
    head: ScriptEntry[];
    body_start: ScriptEntry[];
    body_end: ScriptEntry[];
  };

  // Ads
  ads_txt: string[];
  ads_config: {
    primary_advertiser: string;
    interstitial: boolean;
    layout: string;
    ad_placements: AdPlacement[];
  };

  // Theme (fully resolved)
  theme: {
    base: "modern" | "editorial";
    colors: Record<string, string>;
    logo: string;
    favicon: string;
    fonts: { heading: string; body: string };
  };

  // Brief
  brief: SiteBrief;

  // Legal variables (fully resolved, ready for template injection)
  legal: Record<string, string>;
}
```

**Unit tests required:**
- Basic inheritance: org values pass through when group/site don't override.
- Group override: group value replaces org value.
- Site override: site value replaces group value.
- Null clearing: site sets key to null, resolved config has null (not parent value).
- Array replacement: site defines ads_txt, group's ads_txt is fully replaced.
- Script merging by ID: site overrides one script from group, others remain.
- Placeholder resolution: `{{alpha_site_id}}` in group script replaced with site's scripts_vars value.
- Missing group: error thrown if site references non-existent group.
- Nested merge: deeply nested objects merge correctly (e.g., theme.colors.primary).

---

## Build Pipeline

### How a Site Build Works

When Cloudflare Pages triggers a build for a specific site:

```
1. Environment has:
   - SITE_DOMAIN=muvizz.com
   - NETWORK_REPO_PATH=. (current checkout of network repo)
   - PLATFORM_REPO or platform installed as dependency

2. Build script (packages/site-builder/scripts/build-site.ts):
   a. Read network.yaml from NETWORK_REPO_PATH
   b. Verify platform version compatibility
   c. Call resolveConfig(NETWORK_REPO_PATH, SITE_DOMAIN)
   d. Check resolved config: if active === false, output maintenance page only
   e. Set Astro environment:
      - Content directory → NETWORK_REPO_PATH/sites/{domain}/articles/
      - Assets directory → NETWORK_REPO_PATH/sites/{domain}/assets/
      - Resolved config → available as global import to all components
   f. Generate ads.txt → write to public/ directory
   g. Generate shared legal pages with resolved {{variables}} → write to pages/
   h. Run Astro build
   i. Output to dist/

3. Cloudflare Pages serves dist/ as the live site.
```

### Cloudflare Pages Setup (Per Site)

Each site is a separate Cloudflare Pages project. All point at the same network repo but build different sites.

**Option A — Platform as npm dependency (recommended for production):**

The network repo gets a minimal `package.json` and build script that installs the platform:

```json
{
  "private": true,
  "scripts": {
    "build": "npx atomic-content-platform-builder --site $SITE_DOMAIN --data ."
  },
  "dependencies": {
    "atomic-content-platform": "1.0.0"
  }
}
```

Wait — this breaks the "no code in network repo" principle. Instead:

**Option B — Build wrapper script in Cloudflare Pages config (recommended):**

Cloudflare Pages build settings per project:
- **Repository:** `atomic-network/atomic-labs-network` (the data repo)
- **Build command:** A shell script that:
  1. Reads `platform_version` from `network.yaml`
  2. Clones the platform repo at that tag
  3. Installs platform dependencies
  4. Runs the platform's build-site script with `SITE_DOMAIN` and path to network data
- **Build output directory:** `dist/`
- **Environment variables:**
  - `SITE_DOMAIN=muvizz.com`
  - `PLATFORM_REPO=atomic-network/atomic-content-platform`
  - `GITHUB_TOKEN=xxx` (to clone platform repo during build)

**Build command script** (stored in platform repo, referenced by URL or copied as a bootstrap):

```bash
#!/bin/bash
set -e

# Read platform version from network data
PLATFORM_VERSION=$(grep 'platform_version:' network.yaml | awk '{print $2}' | tr -d '"')
PLATFORM_REPO_URL="https://${GITHUB_TOKEN}@github.com/${PLATFORM_REPO}.git"

# Clone platform at specified version
git clone --depth 1 --branch "v${PLATFORM_VERSION}" "${PLATFORM_REPO_URL}" /tmp/platform

# Install platform dependencies
cd /tmp/platform
npm install

# Run build with network data path
NETWORK_DATA_PATH="${OLDPWD}" SITE_DOMAIN="${SITE_DOMAIN}" node packages/site-builder/scripts/build-site.ts

# Copy output
cp -r /tmp/platform/dist "${OLDPWD}/dist"
```

This keeps the network repo pure data while the build process pulls in the correct platform version.

### Build Filter Logic

`packages/site-builder/scripts/detect-changed-sites.ts`

On every push to the network repo, Cloudflare Pages triggers builds for ALL site projects pointing at that repo. Most of those builds are unnecessary (only one site's articles changed).

The build filter runs as the first step of the build command:

1. Get the list of files changed in the current push (via git diff or Cloudflare's environment variables).
2. Determine if the current `SITE_DOMAIN` is affected:
   - Files changed in `sites/{SITE_DOMAIN}/` → YES, build this site.
   - Files changed in `org.yaml` → YES, build ALL sites (org config affects everyone).
   - Files changed in `groups/{this-site's-group}.yaml` → YES, build this site.
   - Files changed in `network.yaml` → YES, build ALL sites (platform version change).
   - Files changed in other sites' folders → NO, skip this build.
3. If skip: exit 0 with empty dist output (Cloudflare Pages treats this as "no change").
4. If build: proceed with full build.

This ensures that committing an article to muvizz.com only triggers muvizz.com's build, not all 20 sites.

---

## Platform Components — Detailed Specs

### AdSlot.astro

Renders an ad container `<div>` based on a placement from ads_config.

**Props:**
- `placement` — an AdPlacement object from the resolved config

**Behavior:**
- Renders a `<div>` with `data-ad-id`, `data-sizes-desktop`, `data-sizes-mobile` attributes.
- Applies device visibility via Tailwind responsive classes:
  - `device: "all"` → visible always
  - `device: "desktop"` → `hidden md:block`
  - `device: "mobile"` → `block md:hidden`
- The div is empty at render time — the ad network JS fills it at runtime using the data attributes.
- Include a subtle "Advertisement" label for CLS compliance.
- Set explicit `min-height` and `min-width` from the first size entry to prevent layout shift.

**Example output:**
```html
<div class="ad-slot block md:hidden"
     data-ad-id="in-content-1"
     data-sizes-mobile='[[300,250],[336,280]]'
     data-sizes-desktop='[[336,280],[300,250]]'
     style="min-height: 250px; min-width: 300px;">
  <span class="text-xs text-gray-400 block text-center">Advertisement</span>
</div>
```

### HeadScripts.astro

Reads the resolved config and outputs all `<head>` scripts in the correct order.

**Output order:**
1. **GA4** (if `tracking.ga4` is set):
   ```html
   <script async src="https://www.googletagmanager.com/gtag/js?id={ga4_id}"></script>
   <script>
     window.dataLayer = window.dataLayer || [];
     function gtag(){dataLayer.push(arguments);}
     gtag('js', new Date());
     gtag('config', '{ga4_id}');
   </script>
   ```
2. **GTM** (if `tracking.gtm` is set):
   ```html
   <script>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','{gtm_id}');</script>
   ```
3. **Google Ads** (if `tracking.google_ads` is set):
   ```html
   <script async src="https://www.googletagmanager.com/gtag/js?id={gads_id}"></script>
   <script>gtag('config', '{gads_id}');</script>
   ```
4. **Facebook Pixel** (if `tracking.facebook_pixel` is set)
5. **Custom tracking** from `tracking.custom[]`
6. **All scripts from `scripts.head[]`** — external as `<script src="..." async>`, inline as `<script>...</script>`

All `{{placeholder}}` values are already resolved. HeadScripts outputs final strings only.

### BodyStartScripts.astro / BodyEndScripts.astro

Same pattern as HeadScripts but for `scripts.body_start` and `scripts.body_end` arrays. Also includes GTM noscript tag in BodyStartScripts if GTM is configured.

### Interstitial.astro

Client-side component (uses Astro `client:load` directive).

**Behavior:**
- Only renders if `ads_config.interstitial === true`.
- Provides the DOM container (full-screen overlay, close button, countdown timer).
- The interstitial trigger logic comes from `scripts.body_end` entries (the ad network JS).
- This component just provides: overlay backdrop, centered ad container div, close button (visible after countdown), session frequency check using sessionStorage.
- The actual ad creative is filled by the ad network JS, same as regular AdSlots.

### ArticleLayout.astro

The main article page layout. Injects ad slots between content paragraphs.

**Ad injection logic** (`packages/site-builder/src/utils/inject-ads.ts`):
1. Receive the compiled HTML content string and the resolved `ads_config`.
2. Parse the HTML to identify paragraph (`<p>`) boundaries.
3. For each `ad_placement` with `position: "after-paragraph-N"`, inject the rendered AdSlot HTML after the Nth paragraph.
4. If the article has fewer paragraphs than the placement position, skip that placement (don't inject after non-existent paragraphs).

**Page structure:**
```
<BaseLayout>
  <Header />
  <main>
    <AdSlot position="above-content" />
    <article class="flex gap-8">
      <div class="content flex-1">
        <!-- article HTML with AdSlots injected between paragraphs -->
      </div>
      <aside class="sidebar hidden lg:block w-[300px]">
        <div class="sticky top-4">
          <AdSlot position="sidebar" />
        </div>
      </aside>
    </article>
  </main>
  <Footer />
  <AdSlot position="sticky-bottom" />  <!-- fixed to viewport bottom -->
  <Interstitial />
</BaseLayout>
```

### SEOHead.astro

Outputs all SEO-related meta tags for an article or page.

**Outputs:**
- `<title>` — article title + site name
- `<meta name="description">` — article description
- `<link rel="canonical">` — full URL
- Open Graph tags: og:title, og:description, og:image, og:type, og:url, og:site_name
- Twitter Card tags: twitter:card, twitter:title, twitter:description, twitter:image
- JSON-LD structured data for articles:
  ```json
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "...",
    "datePublished": "...",
    "author": { "@type": "Organization", "name": "..." },
    "publisher": { "@type": "Organization", "name": "...", "logo": "..." },
    "image": "..."
  }
  ```

---

## Shared Legal Pages

Legal page templates live in the platform repo at `packages/site-builder/shared-pages/`.

They use `{{placeholder}}` syntax resolved at build time from the merged `legal` config values plus top-level site values like `domain`, `site_name`, etc.

**Available variables in legal pages:**
- `{{site_name}}` — from site.yaml
- `{{domain}}` — from site.yaml
- `{{support_email}}` — resolved from `support_email_pattern` with domain
- `{{company_name}}` — from legal config
- `{{company_country}}` — from legal config
- `{{effective_date}}` — from legal config
- `{{site_description}}` — from legal config
- Any other key in the resolved `legal` object

**Example** `shared-pages/privacy.md`:
```markdown
---
title: "Privacy Policy"
layout: page
---

# Privacy Policy for {{site_name}}

**Effective Date:** {{effective_date}}

{{site_name}} ("we", "us", or "our") operates the website
https://{{domain}} (the "Site"). {{site_name}} is a publication
focused on {{site_description}}.

This page informs you of our policies regarding the collection,
use, and disclosure of personal information when you use our Site.

## Information Collection

We collect information that your browser sends whenever you visit
our Site. This may include your IP address, browser type, browser
version, the pages you visit, the time and date of your visit,
and other statistics.

## Advertising

We use third-party advertising companies to serve ads when you
visit {{domain}}. These companies may use information about your
visits to this and other websites to provide advertisements about
goods and services of interest to you.

## Contact

If you have questions about this Privacy Policy, contact us at
{{support_email}}.

{{company_name}}, {{company_country}}
```

Create similar templates for: `terms.md`, `about.md`, `dmca.md`, `contact.md`.

**Group-level legal page overrides:**

If a group has `legal_pages_override.privacy` set, that content is appended to (or replaces) the platform default privacy page for all sites in that group. This handles the case where different ad partner groups need different privacy disclosures.

---

## Themes

### Requirements for Both Themes

- Use the same component interface (same props, same slot names) so switching themes in site.yaml just works.
- Accept all visual customization via CSS custom properties — never hardcoded colors or fonts.
- Fully responsive (mobile-first).
- Support all ad slot positions defined in the AdSlot component.
- Use Tailwind CSS for utility classes.
- Import fonts from Google Fonts based on the resolved config.

**CSS custom properties injected at build time:**
```css
:root {
  --color-primary: {resolved from config};
  --color-secondary: {resolved};
  --color-accent: {resolved};
  --color-background: {resolved};
  --color-text: {resolved};
  --color-muted: {resolved};
  --font-heading: {resolved};
  --font-body: {resolved};
}
```

### modern theme
Clean, minimal design. Grid-based article cards on homepage. Sans-serif default feel. Full-width article layout with optional sidebar.

**Homepage:** Article cards in a responsive grid (3 columns desktop, 2 tablet, 1 mobile). Each card: featured image, title, description excerpt, date, tags.

**Article page:** Single column content area (max-width ~720px) with optional sidebar. Clean typography focused on readability.

### editorial theme
Magazine-style design. Mixed article card sizes on homepage (one featured large + smaller grid). Serif heading feel. Two-column article layout with sidebar always visible on desktop.

**Homepage:** Hero/featured article at top (full width), then grid of smaller cards below. Category-based sections.

**Article page:** Two-column layout — content column + persistent sidebar with related articles and ad slots.

---

## Article Markdown Format

Every article is a `.md` file in the network repo with this frontmatter:

```markdown
---
title: "10 Must-Watch Thriller Movies on Netflix in 2026"
description: "From mind-bending twists to edge-of-your-seat suspense, here are the best thrillers streaming right now."
type: listicle
status: published
publishDate: 2026-03-12
author: "Editorial Team"
tags: ["netflix", "thrillers", "movie recommendations"]
featuredImage: "/images/netflix-thrillers-2026.jpg"
reviewer_notes: ""
slug: must-watch-thriller-movies-netflix-2026
---

Article content in standard markdown.

## First Section

Content here.

## Second Section

More content. Ad slots are NOT placed in the markdown — they are
injected by ArticleLayout based on paragraph count and ads_config.
```

**Content collection schema** (in platform repo):

```typescript
import { defineCollection, z } from 'astro:content';

const articles = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    type: z.enum(['listicle', 'how-to', 'review', 'standard']),
    status: z.enum(['draft', 'review', 'published']),
    publishDate: z.coerce.date(),
    author: z.string().default('Editorial Team'),
    tags: z.array(z.string()).default([]),
    featuredImage: z.string().optional(),
    reviewer_notes: z.string().default(''),
    slug: z.string(),
  }),
});
```

**Critical:** Only articles with `status: "published"` are rendered on the live site.

---

## Next.js Dashboard

### Tech Stack
- **Framework:** Next.js (App Router)
- **Deployment:** Cloudflare Workers (via OpenNext or @cloudflare/next-on-pages)
- **Auth:** Cloudflare Access (zero trust, sits in front of dashboard URL)
- **Data layer:** GitHub API via Octokit — all reads/writes go to network repos
- **UI:** Tailwind CSS + shadcn/ui
- **State:** React Query for caching GitHub API responses

### Multi-Org Architecture

The dashboard is one deployment serving all organizations.

**URL structure:** `https://dashboard.atomicnetwork.com/[org-slug]/...`

**Org registry** (`platform.config.ts` in platform repo):
```typescript
export const organizations = {
  "atomic-labs": {
    name: "Atomic Labs",
    network_repo: "atomic-network/atomic-labs-network",
    github_token_secret: "GITHUB_TOKEN_ATOMIC_LABS",
  },
  "client-x": {
    name: "Client X Corp",
    network_repo: "atomic-network/client-x-network",
    github_token_secret: "GITHUB_TOKEN_CLIENT_X",
  },
};
```

**Access control:** Map email addresses to allowed org slugs. A user might have access to one org or multiple.

```typescript
export const access = {
  "gilad@atomiclabs.com": ["atomic-labs", "client-x"],
  "editor@clientx.com": ["client-x"],
};
```

### Dashboard ↔ GitHub API Operations

Every dashboard action maps to a GitHub API call (Octokit) on the org's network repo.

| Dashboard Action | GitHub API Operation |
|---|---|
| List sites | List directories in `sites/` |
| Read site config | Get file contents: `sites/{domain}/site.yaml` |
| Update site config | Update file: `sites/{domain}/site.yaml` (commit) |
| Create new site | Create tree: site.yaml + assets + empty articles/ (commit) |
| Pause/unpause site | Update `site.yaml` setting `active: true/false` (commit) |
| Delete site | Delete directory `sites/{domain}/` (commit) |
| List articles | List files in `sites/{domain}/articles/` |
| Read article | Get file contents, parse frontmatter + markdown body |
| Update article status | Update .md file frontmatter `status` field (commit) |
| Edit article | Update .md file (commit) |
| Delete article | Delete .md file (commit) |
| List groups | List files in `groups/` |
| Read/update group | Get/update file in `groups/{id}.yaml` (commit) |
| Read org config | Get file contents: `org.yaml` |
| Update org config | Update file: `org.yaml` (commit) |
| Request article | POST to n8n webhook (not a Git operation) |

**Caching:** Use React Query with appropriate stale times. GitHub API has rate limits (5000/hour authenticated). Dashboard is for occasional management use, not high-frequency.

### Dashboard Pages

#### Home / Org Selector (`/`)
- If user has access to one org: redirect to that org's overview.
- If multiple orgs: show org selector cards.

#### Org Overview (`/[org]`)
- Summary cards: total sites, total articles this week, pending reviews, failed builds.
- Quick actions: create site, request article, open review queue.
- Recent activity feed (recent commits to network repo).

#### Sites List (`/[org]/sites`)
- Table/grid of all sites.
- Columns: domain, group, theme, article count, last published, build status, active/paused.
- Filter by group. Search by domain/name.
- Click row → site detail.

#### Site Detail (`/[org]/sites/[domain]`)
- **Config tab:** Form that reads/writes site.yaml. Sections for: identity (name, tagline), group assignment, tracking IDs, script variables, theme (color pickers, logo upload, font selectors), content brief.
- **Articles tab:** List of articles with status badges (published/review/draft). Click to edit/preview. Delete button.
- **Preview tab:** Show current colors/logo/theme as a mini preview.
- **Actions:** Pause/unpause, request article (→ n8n), open live site in new tab.

#### Site Creation Wizard (`/[org]/sites/new`)
Multi-step form:
1. Domain name + site name + tagline.
2. Select group (dropdown from existing groups).
3. Select theme (modern / editorial) with visual preview.
4. Upload logo + favicon.
5. Color picker (pre-filled from group defaults, override as needed).
6. GA4 property ID + any additional tracking.
7. Content brief: audience, tone, topics, article types (percentages), schedule.
8. Review summary of all settings.
9. Create → dashboard commits the entire site folder structure to the network repo via GitHub API. Cloudflare Pages project must be created separately (document this as a manual step or automate via Cloudflare API).

#### Groups Management (`/[org]/groups`)
- List of groups with site count per group.
- Click group → edit form: ads.txt lines, ad placements editor, scripts editor, tracking overrides, theme color overrides.
- Create new group.
- Drag sites between groups (updates `group:` field in their site.yaml).
- Visual preview of ad layout on a sample article.

#### Review Queue (`/[org]/review`)
- List of all articles across all sites with `status: "review"`.
- Sort by date. Filter by site.
- Each item: title, site domain, date, word count.
- Actions per article: preview (render markdown), approve (→ status: published, commit), reject with feedback (→ update reviewer_notes, trigger n8n regen), edit (markdown editor), delete.
- Batch approve for efficiency.

#### Content Calendar (`/[org]/content`)
- Calendar or timeline view showing published + scheduled articles per site.
- Manual article request form: pick site, pick article type, add topic/keywords, submit → n8n webhook.
- Per-site publishing frequency tracker (actual vs target from brief.schedule).

#### Stats (`/[org]/stats`)
**Phase 1 (MVP):**
- Articles published per site per week/month (derived from git log / file dates).
- Build status per site (Cloudflare Pages API: last deploy time, success/fail).
- Group breakdown: sites per group, articles per group.

**Phase 2 (future):**
- Traffic data from Cloudflare Analytics API.
- Revenue integration (pull from DigiKube API or other sources).

### Auth — Cloudflare Access

1. Create a Cloudflare Access Application for the dashboard URL.
2. Policy: allow specific email addresses.
3. Dashboard reads `Cf-Access-Jwt-Assertion` header to identify the logged-in user.
4. Cross-reference user email with `access` config to determine which orgs they can see.
5. No login page code, no session management, no passwords.

---

## AI Content Pipeline (n8n)

### Workflow: Scheduled Content Generation

**Trigger:** Cron schedule (configurable per site via brief.schedule).

**Steps:**
1. **Select target site:** Based on schedule, pick the next site due for content.
2. **Read site config:** Fetch `site.yaml` from network repo via GitHub API. Extract `brief`.
3. **Read article type template:** Based on weighted random selection from `brief.article_types`, fetch the corresponding template from the platform repo's `templates/` directory.
4. **Generate article:** Call AI (Claude API) with system prompt built from:
   - Site's brief (audience, tone, topics, content_guidelines, seo_keywords_focus)
   - Article type template (structural guidance)
   - Instruction to output valid markdown with required frontmatter fields
   - Current date context
5. **Set status:** Random based on `brief.review_percentage` (default 5%). Most → `status: published`, some → `status: review`.
6. **Commit to network repo:** Use GitHub API to create the `.md` file at `sites/{domain}/articles/{slug}.md`. Commit message: `content({domain}): add {type} — {title}`.
7. **If review:** Send notification to Telegram/Slack with article title, site, and link to review queue.
8. **Cloudflare Pages auto-rebuilds** the affected site (build filter ensures only this site rebuilds).

### Workflow: Manual Article Request (from dashboard)

**Trigger:** Webhook POST from dashboard.

**Payload:**
```json
{
  "org": "atomic-labs",
  "site": "muvizz.com",
  "article_type": "listicle",
  "topic": "Best horror movies on Hulu 2026",
  "additional_instructions": "Focus on hidden gems, not obvious picks",
  "status_override": "review"
}
```

Same steps as scheduled, but uses provided topic/instructions and respects status_override.

### Workflow: Article Regeneration (from review rejection)

**Trigger:** Webhook from dashboard when reviewer rejects an article.

**Payload:**
```json
{
  "org": "atomic-labs",
  "site": "muvizz.com",
  "article_path": "sites/muvizz.com/articles/best-horror-2026.md",
  "reviewer_notes": "Headline too clickbaity. Include more specific movie details."
}
```

**Steps:**
1. Fetch the original article from the network repo.
2. Call AI with: original article + reviewer feedback + instruction to revise.
3. Commit updated `.md` with `status: review` (stays in review for re-approval).
4. Notify reviewer that revision is ready.

---

## WordPress Migration

### Migration Script

Located in `packages/migration/src/migrate-from-wp.ts`.

**Input:** WordPress site URL + API credentials (or public REST API if no auth needed).

**Process:**
1. Fetch all published posts via WP REST API: `GET /wp-json/wp/v2/posts?per_page=100&page=N` (paginate through all).
2. For each post:
   - Extract: title, content (HTML), excerpt, date, slug, categories, tags, featured image URL.
   - Convert HTML body to clean markdown (use turndown library). Strip WordPress shortcodes, clean up formatting.
   - Download featured image to `assets/images/`.
   - Map WordPress categories to article `type` (provide a configurable mapping, default: all → "standard").
   - Generate `.md` file with proper frontmatter and `status: published`.
3. Create the site folder structure in the network repo with a starter `site.yaml`.
4. Generate URL mapping report: old WordPress permalink → new Astro URL.
5. Output Cloudflare redirect rules (_redirects file) for any URL format differences.
6. Summary: total posts migrated, any failures, redirect rules needed.

### SEO Preservation Checklist

For each migrated site:
- [ ] All existing URLs return 200 or have 301 redirects configured
- [ ] `<title>` and `<meta description>` preserved from WordPress
- [ ] Canonical URLs set correctly on all pages
- [ ] XML sitemap generated (use @astrojs/sitemap)
- [ ] robots.txt present and correct
- [ ] JSON-LD structured data on article pages
- [ ] Open Graph + Twitter Card meta tags on all pages
- [ ] ads.txt accessible at domain root and contents verified
- [ ] Lighthouse performance score — verify improvement over WordPress
- [ ] Google Search Console: submit new sitemap, monitor indexing for 2 weeks
- [ ] Monitor for 404 spikes in Cloudflare Analytics for 7 days post-migration

---

## Technical Conventions

### Versions
- **Astro:** 5.x stable (or 6.x if stable at build time). Pin in package.json.
- **Next.js:** 15.x (App Router). Pin in package.json.
- **Node.js:** 20 LTS.
- **Tailwind CSS:** v4 with CSS custom properties for theming.
- **TypeScript:** Strict mode throughout all packages.
- **Package manager:** pnpm (for workspace support + speed).
- **Monorepo tool:** Turborepo for the platform repo.

### Git Conventions

**Platform repo commits:**
- `feat(site-builder): add new ad slot position type`
- `fix(dashboard): handle empty article list`
- `chore: bump dependencies`

**Network repo commits (from AI pipeline):**
- `content(muvizz.com): add listicle — 10 Must-Watch Thrillers`
- `content(muvizz.com): revise article after review feedback`

**Network repo commits (from dashboard):**
- `config(muvizz.com): update theme colors`
- `config: update group premium-ads ads.txt`
- `site(newsite.com): create site`

### Naming Conventions
- Site folders in network repo: bare domain (e.g., `muvizz.com/`)
- Article files: kebab-case slug (e.g., `best-thriller-movies-2026.md`)
- Group IDs: kebab-case (e.g., `premium-ads`)
- Config files: always `.yaml` (not `.yml`)
- Platform packages: kebab-case (e.g., `site-builder`, `shared-types`)

### Error Handling
- **Build failures:** Cloudflare Pages serves the last successful build. Failed builds don't take down live sites.
- **Dashboard:** Show build status prominently. Surface GitHub API errors clearly.
- **AI pipeline:** If generation fails or Git commit fails, log error and notify via Telegram. Never silently drop content.
- **Config resolution:** Fail loudly if a site references a non-existent group or has invalid YAML. Build should error, not produce a broken site.

---

## Complete site.yaml Schema Reference

```yaml
# === REQUIRED ===
domain: string                        # e.g., "muvizz.com"
site_name: string                     # e.g., "Muvizz"
group: string                         # references groups/{group-id}.yaml

# === OPTIONAL (with defaults) ===
site_tagline: string | null           # default: null
active: boolean                       # default: true

# Tracking (merged with group → org)
tracking:
  ga4: string | null
  gtm: string | null
  google_ads: string | null
  facebook_pixel: string | null
  custom:
    - name: string
      src: string
      position: "head" | "body_start" | "body_end"

# Script variable replacements (resolves {{key}} in group/org script templates)
scripts_vars:
  [key]: string

# Content brief (used by AI pipeline)
brief:
  audience: string
  tone: string
  article_types:
    [type_name]: number               # percentage weight (should sum to 100)
  topics: string[]
  seo_keywords_focus: string[]
  content_guidelines: string          # multiline instructions for AI
  review_percentage: number           # default: 5
  schedule:
    articles_per_week: number
    preferred_days: string[]          # e.g., ["monday", "wednesday"]
    preferred_time: string            # HH:MM format

# Theme (merged with group → org)
theme:
  base: "modern" | "editorial"
  colors:
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
    muted: string
  logo: string                        # path relative to site assets/
  favicon: string
  fonts:
    heading: string                   # Google Font name
    body: string

# Legal page variables (merged with group → org, used in shared page templates)
legal:
  site_description: string
  [any_key]: string

# Ad config overrides (rarely needed — usually inherited from group)
ads_config:
  interstitial: boolean
  ad_placements: AdPlacement[]        # full replacement if defined
```

---

## Build Order for Claude Code

Execute in this exact sequence. Each phase is a shippable milestone.

### Phase 1: Platform Foundation + First Site (Week 1-2)

**Platform repo setup:**
1. Initialize `atomic-content-platform` as a Turborepo/pnpm workspace with packages: `site-builder`, `dashboard`, `migration`, `shared-types`.
2. In `shared-types`: define all TypeScript interfaces — `NetworkManifest`, `OrgConfig`, `GroupConfig`, `SiteConfig`, `ResolvedConfig`, `AdPlacement`, `ScriptEntry`, `ArticleFrontmatter`, `TrackingConfig`.
3. In `site-builder`: implement `scripts/resolve-config.ts` with full deep merge + placeholder resolution.
4. Write unit tests for config resolution (all merge rules, overrides, null clearing, placeholder resolution, error cases).
5. Implement `scripts/generate-ads-txt.ts`.
6. Implement `scripts/inject-shared-pages.ts` (resolves {{placeholders}} in legal page templates).
7. Create shared legal page templates: `privacy.md`, `terms.md`, `about.md`, `dmca.md`, `contact.md`.
8. Set up Astro project in `site-builder`: `astro.config.mjs` that reads `SITE_DOMAIN` + `NETWORK_DATA_PATH` env vars, calls resolveConfig, configures content collections.
9. Build shared components: `AdSlot.astro`, `HeadScripts.astro`, `BodyStartScripts.astro`, `BodyEndScripts.astro`, `TrackingScripts.astro`, `Interstitial.astro`, `SEOHead.astro`.
10. Build the `modern` theme: Header, Footer, ArticleCard, homepage (article grid), article page layout, page layout.
11. Build `ArticleLayout.astro` with paragraph-counting ad injection via `inject-ads.ts`.
12. Implement `scripts/build-site.ts` — the main entry point that orchestrates the full build.
13. Implement `scripts/detect-changed-sites.ts` — the build filter.

**First network repo:**
14. Create `atomic-labs-network` repo with: `network.yaml`, `org.yaml`, one group (`groups/premium-ads.yaml`), one site (`sites/muvizz.com/` with `site.yaml`, logo, favicon, 3-5 sample articles).
15. Deploy to Cloudflare Pages. Create one Pages project for muvizz.com pointing at the network repo with the build wrapper script.
16. **Verify:** Pages render correctly, ads.txt at root is correct, tracking scripts in head, ad slot divs in correct positions, legal pages render with correct site name/domain, theme colors applied, responsive layout works.

### Phase 2: Second Theme + More Sites + Migration Tooling (Week 2-3)

17. Build `editorial` theme in platform repo (second theme option).
18. Build migration script in `packages/migration`.
19. Add second group to network repo (`groups/standard-ads.yaml`).
20. Migrate 5 WordPress sites into the network repo. Validate each: URLs, SEO, ads, rendering.
21. Create Cloudflare Pages projects for each. Verify build filter works (changing one site only rebuilds that site).

### Phase 3: AI Pipeline (Week 3)

22. Build n8n workflow: scheduled content generation.
23. Build n8n workflow: manual article request via webhook.
24. Build n8n workflow: article regeneration on review rejection.
25. Test end-to-end: n8n generates article → commits to network repo → Cloudflare rebuilds site → article is live.
26. Test review flow: article generated with status:review → notification sent → (simulate) approval → article goes live.

### Phase 4: Dashboard (Week 3-5)

27. Set up Next.js project in `packages/dashboard`. Configure for Cloudflare Workers deployment.
28. Set up Cloudflare Access for auth.
29. Build GitHub API wrapper (`lib/github.ts`) — org-scoped read/write operations on network repos.
30. Build org selector / home page.
31. Build Sites list page + Site detail page (config viewer/editor).
32. Build Site creation wizard.
33. Build Groups management page (ads.txt editor, ad layout editor, scripts editor).
34. Build Review queue page (list, preview, approve/reject/edit actions).
35. Build Content calendar page + manual article request form.
36. Build Stats page (articles count, build status).
37. Deploy dashboard to Cloudflare Workers. Verify all CRUD operations work against the network repo.

### Phase 5: Remaining Migrations + Production Hardening (Week 5-6)

38. Migrate remaining ~14 sites into the network repo.
39. Configure Cloudflare Pages projects for all sites.
40. DNS cutover for all domains.
41. Monitor: 404s, GSC indexing, revenue impact, build times.
42. Polish: error handling, loading states, edge cases.
43. Document: runbook for adding new sites, onboarding new org, troubleshooting builds.
44. Set platform version tag (v1.0.0). Pin network repo to this version.
