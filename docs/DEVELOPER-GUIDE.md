# Atomic Content Network Platform -- Developer Guide

## 1. Getting Started

### Prerequisites

| Tool       | Version   | Install                                      |
|------------|-----------|----------------------------------------------|
| Node.js    | 20+ LTS   | https://nodejs.org or `nvm install 20`       |
| pnpm       | 10.30+    | `corepack enable && corepack prepare pnpm@10.30.2 --activate` |
| Git        | 2.x       | https://git-scm.com                          |

### Clone Both Repos

The platform uses a two-repo architecture. Clone them side-by-side inside a shared parent directory:

```bash
mkdir -p ~/Documents/ATL-content-network && cd ~/Documents/ATL-content-network

# Platform repo -- all code (site builder, dashboard, pipeline, types)
git clone git@github.com:atomicfuse/atomic-content-platform.git

# Network data repo -- YAML configs, markdown articles, site assets (zero code)
git clone git@github.com:atomicfuse/atomic-labs-network.git
```

Your directory should look like this:

```
ATL-content-network/
  atomic-content-platform/    <-- code
  atomic-labs-network/         <-- data
```

### Install Dependencies

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform
pnpm install
```

This installs dependencies for all packages in the monorepo workspace (shared-types, site-builder, and future packages).

### Run the Dev Server

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform/packages/site-builder

# Network data path auto-resolves if repos are side-by-side (no env var needed)
SITE_DOMAIN=coolnews.dev pnpm dev
```

The site opens at **http://localhost:4321**.

To build for production:

```bash
SITE_DOMAIN=coolnews.dev pnpm build
```

To deploy to Cloudflare Pages:

```bash
SITE_DOMAIN=coolnews.dev pnpm build
npx wrangler pages deploy dist --project-name=coolnews-dev
```

Static output lands in `packages/site-builder/dist/`.

If your repos are NOT side-by-side, pass `NETWORK_DATA_PATH` explicitly:

```bash
SITE_DOMAIN=coolnews.dev \
NETWORK_DATA_PATH=/custom/path/to/atomic-labs-network \
pnpm dev
```

### Environment Variables

| Variable             | Required | Default                        | Description                              |
|----------------------|----------|--------------------------------|------------------------------------------|
| `SITE_DOMAIN`        | Yes      | `coolnews.dev`                 | Domain of the site to build              |
| `NETWORK_DATA_PATH`  | Yes      | `../../atomic-labs-network`    | Absolute or relative path to network repo |
| `GITHUB_TOKEN`       | No       | --                             | Used by dashboard and content pipeline   |

---

## 2. Architecture Overview

### Two-Repo Architecture

```
atomic-content-platform (CODE)          atomic-labs-network (DATA)
+------------------------------------+  +-----------------------------------+
| packages/                          |  | network.yaml                      |
|   shared-types/   -- TS interfaces |  | org.yaml                          |
|   site-builder/   -- Astro SSG     |  | groups/                           |
|   dashboard/      -- Next.js (TBD) |  |   premium-ads.yaml                |
|   content-pipeline/ -- AI (TBD)    |  | sites/                            |
|   migration/      -- WP tools (TBD)|  |   coolnews.dev/                   |
| platform.config.ts                 |  |     site.yaml                     |
| turbo.json                         |  |     articles/                     |
| pnpm-workspace.yaml                |  |       ai-trends-2026.md           |
+------------------------------------+  |     assets/                       |
         |                              |       logo.svg                    |
         | reads at build time          |       images/                     |
         +----------------------------->+-----------------------------------+
```

**Platform repo** contains all application code: the Astro site builder, shared TypeScript types, and (in future phases) the Next.js dashboard, AI content pipeline, and WordPress migration tools.

**Network data repo** contains pure data: YAML configuration files, markdown articles, and static assets. There is no code in this repo. Multiple organizations can each have their own network data repo.

### How They Connect

At build time, the site-builder reads the network data repo from disk via the `NETWORK_DATA_PATH` environment variable. The config resolver loads `network.yaml`, `org.yaml`, the relevant `group.yaml`, and the target `site.yaml`, deep-merges them into a single `ResolvedConfig`, then passes it to Astro components.

Articles are read from `sites/{domain}/articles/*.md` and rendered as static pages.

### Package Breakdown

| Package              | Name                              | Status      | Description                                           |
|----------------------|-----------------------------------|-------------|-------------------------------------------------------|
| `shared-types`       | `@atomic-platform/shared-types`   | Active      | TypeScript interfaces for all YAML schemas            |
| `site-builder`       | `@atomic-platform/site-builder`   | Active      | Astro 5 static site generator with themes and ads     |
| `dashboard`          | `@atomic-platform/dashboard`      | Placeholder | Next.js 15 management UI (Phase 4)                    |
| `content-pipeline`   | `@atomic-platform/content-pipeline` | Placeholder | AI content generation agents (Phase 3)              |
| `migration`          | `@atomic-platform/migration`      | Placeholder | WordPress migration tooling (Phase 5)                 |

### Tech Stack

- **Monorepo:** Turborepo + pnpm workspaces
- **Site builder:** Astro 5 (static output) + Tailwind CSS v4
- **Dashboard (future):** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode, no `any`)
- **Node.js:** 20+ LTS

---

## 3. Config System

### Config Inheritance

Configuration follows a three-level inheritance chain:

```
org.yaml  --->  group.yaml  --->  site.yaml  --->  ResolvedConfig
 (defaults)    (group overrides)  (site overrides)   (fully merged)
```

The config resolver reads all three files and deep-merges them to produce a single `ResolvedConfig` with every field guaranteed present.

### Where Config Files Live (Network Repo)

```
atomic-labs-network/
  network.yaml          # Network metadata (id, platform version)
  org.yaml              # Organization defaults (tracking, scripts, ads, legal, theme)
  groups/
    premium-ads.yaml    # Group overrides (ads_txt, scripts, tracking)
  sites/
    coolnews.dev/
      site.yaml         # Site-specific config (domain, name, brief, theme, tracking)
```

### Deep Merge Rules

The config resolver applies these rules when merging each layer:

| Data type  | Merge behavior                                                       |
|------------|----------------------------------------------------------------------|
| Objects    | Recursively merged. Child keys override parent keys.                 |
| Arrays     | Child replaces parent entirely (no concatenation).                   |
| `null`     | Explicitly setting a key to `null` clears the parent value.          |
| `undefined`| Skipped -- parent value is preserved if child key is absent.         |
| Scripts    | Merged by `id` -- child script with same `id` replaces parent's version. New ids are appended. |

### Placeholder Resolution

Script fields support `{{placeholder}}` syntax. Variables are gathered from `scripts_vars` at all three levels (org, group, site) and merged. The built-in variable `{{domain}}` is always available.

Example in `premium-ads.yaml`:

```yaml
scripts:
  head:
    - id: network-alpha-init
      type: inline
      content: |
        window.alphaAds = window.alphaAds || [];
        window.alphaAds.push({ siteId: '{{alpha_site_id}}' });
```

And in `site.yaml`:

```yaml
scripts_vars:
  alpha_site_id: "coolnews-001"
```

The resolved output replaces `{{alpha_site_id}}` with `coolnews-001`.

### How to Add a New Site

1. Create a directory in the network repo:

```bash
mkdir -p sites/newsite.com/articles
mkdir -p sites/newsite.com/assets/images
```

2. Create `sites/newsite.com/site.yaml` with required fields:

```yaml
domain: newsite.com
site_name: "New Site"
site_tagline: "Your tagline here"
group: premium-ads          # must match a file in groups/
active: true

tracking:
  ga4: "G-YOURIDHERE"

brief:
  audience: "Describe your target audience"
  tone: "Conversational and informative"
  article_types:
    standard: 50
    listicle: 30
    how-to: 20
  topics:
    - topic1
    - topic2
  seo_keywords_focus:
    - "keyword one"
  content_guidelines:
    - "Guideline one"
  review_percentage: 10
  schedule:
    frequency: "3/week"
    days: [Monday, Wednesday, Friday]
    time: "10:00"

theme:
  base: modern
  colors:
    primary: "#0066FF"
    accent: "#00CCFF"
  fonts:
    heading: "Inter"
    body: "Inter"
```

3. Build or dev the new site:

```bash
SITE_DOMAIN=newsite.com NETWORK_DATA_PATH=path/to/network pnpm dev
```

### How to Add a New Ad Group

Create a new file in `groups/`:

```bash
# groups/new-group.yaml
```

```yaml
group_id: new-group
name: "New Ad Group"

ads_txt: |
  google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0

tracking:
  google_ads: "AW-XXXXXXXXX"

scripts:
  head: []
  body_start: []
  body_end: []
```

Then reference it from any site's `site.yaml` with `group: new-group`.

---

## 4. Adding Content

### Article Location

Articles live in the network data repo under each site's directory:

```
sites/coolnews.dev/articles/
  ai-trends-2026.md
  best-streaming-devices-2026.md
  how-to-secure-home-network.md
```

File naming convention: **kebab-case slug** matching the `slug` field in frontmatter.

### Article Frontmatter

Every article is a Markdown file with YAML frontmatter. Here is a complete example:

```markdown
---
title: "The Biggest AI Trends Reshaping Tech in 2026"
slug: ai-trends-2026
type: standard
status: published
author: "Editorial Team"
publishDate: "2026-03-10"
featuredImage: /assets/images/ai-trends-hero.jpg
tags:
  - AI
  - machine learning
  - tech trends
  - 2026
excerpt: "A brief summary for SEO and article cards."
---

Article body in Markdown here. Use standard Markdown syntax
including headings, lists, links, and images.

## Section Heading

Body text with **bold** and *italic* formatting.

![Alt text for image](/assets/images/some-image.jpg)
```

### Required Frontmatter Fields

| Field           | Type                                      | Description                        |
|-----------------|-------------------------------------------|------------------------------------|
| `title`         | string                                    | Article headline                   |
| `slug`          | string                                    | URL-safe identifier (kebab-case)   |
| `type`          | `standard` / `listicle` / `how-to` / `review` | Content format                |
| `status`        | `draft` / `review` / `published`          | Editorial workflow status          |
| `author`        | string                                    | Display name                       |
| `publishDate`   | string (ISO date)                         | Publish date (`YYYY-MM-DD`)        |
| `tags`          | string[]                                  | Categorization tags                |

### Optional Frontmatter Fields

| Field           | Type   | Description                                  |
|-----------------|--------|----------------------------------------------|
| `featuredImage` | string | Path to hero image (relative to site assets) |
| `excerpt`       | string | Short description for SEO and previews       |
| `reviewer_notes`| string | Notes from human or AI reviewer              |

### Article Statuses

| Status      | Meaning                                             |
|-------------|-----------------------------------------------------|
| `draft`     | Work in progress. Not included in builds.           |
| `review`    | Ready for editorial review. Not yet public.         |
| `published` | Live. Included in site builds and sitemaps.         |

### Image Conventions

- **Featured images:** Referenced via `featuredImage` in frontmatter. Stored in `sites/{domain}/assets/images/`.
- **In-body images:** Use standard Markdown image syntax with paths relative to the site's assets directory.
- **File naming:** Use descriptive kebab-case names (e.g., `ai-trends-hero.jpg`, `multimodal-diagram.jpg`).

---

## 5. Theme System

### How Themes Work

Themes are configured via the `theme` section in YAML config files. The resolved theme is applied at build time through CSS custom properties and component-level styling.

Theme configuration merges through the same inheritance chain: org defaults, then group overrides, then site overrides.

### Theme Configuration

```yaml
# In site.yaml
theme:
  base: modern              # Base theme template: "modern" or "editorial"
  colors:
    primary: "#0066FF"      # Primary brand color
    accent: "#00CCFF"       # Accent / highlight color
    # Additional named colors as needed
  logo: /assets/logo.svg
  favicon: /assets/favicon.png
  fonts:
    heading: "Space Grotesk"
    body: "Inter"
```

### Available Base Themes

| Theme       | Status    | Description                                        |
|-------------|-----------|----------------------------------------------------|
| `modern`    | Active    | Clean, minimal design with bold typography         |
| `editorial` | Planned   | Magazine-style layout with richer typographic hierarchy |

### Site Builder Components (Modern Theme)

The site-builder includes these Astro components:

| Component             | Purpose                                          |
|-----------------------|--------------------------------------------------|
| `BaseLayout.astro`    | Root HTML shell with head scripts and tracking   |
| `PageLayout.astro`    | Standard page wrapper (header, footer, content)  |
| `ArticleLayout.astro` | Article-specific layout with metadata and ads    |
| `SEOHead.astro`       | Meta tags, Open Graph, structured data           |
| `HeadScripts.astro`   | Renders scripts configured for `<head>`          |
| `BodyStartScripts.astro` | Renders scripts for after `<body>` open       |
| `BodyEndScripts.astro`| Renders scripts before `</body>` close           |
| `AdSlot.astro`        | Individual ad placement component                |
| `Interstitial.astro`  | Full-page interstitial ad overlay                |

### How to Change Theme Colors

Edit the `theme.colors` section in the relevant YAML file. Changes at the org level affect all sites; changes at the site level affect only that site.

```yaml
# sites/coolnews.dev/site.yaml
theme:
  colors:
    primary: "#FF6600"     # Override just the primary color
```

### How to Add a New Theme

1. Add the theme name to the `ThemeConfig.base` union type in `packages/shared-types/src/config.ts`.
2. Create theme-specific layout variants or CSS in `packages/site-builder/src/`.
3. Update the base layout to conditionally apply theme styles based on `config.theme.base`.

---

## 6. Build System

### Build Flow

```
Environment vars (SITE_DOMAIN, NETWORK_DATA_PATH)
  |
  v
astro.config.mjs -- reads env vars, configures Vite + Tailwind
  |
  v
src/config.ts -- calls resolveConfig() once, caches result
  |
  v
scripts/resolve-config.ts -- reads YAML, deep-merges org -> group -> site
  |
  v
ResolvedConfig -- passed to all Astro components and layouts
  |
  v
Astro renders pages:
  - index.astro        (homepage)
  - [...slug].astro    (article pages from markdown files)
  - ads.txt            (generated from config)
  - sitemap.xml        (via @astrojs/sitemap)
  |
  v
Static HTML/CSS/JS output in dist/
```

### Config Resolver Steps

The resolver in `scripts/resolve-config.ts` performs these steps in order:

1. Read `network.yaml`, `org.yaml`, and `sites/{domain}/site.yaml`
2. Look up the group file from `groups/{site.group}.yaml`
3. Merge tracking: org -> group -> site (deep merge)
4. Merge scripts: org -> group (by script `id`)
5. Collect `scripts_vars` from all levels, resolve `{{placeholder}}` strings
6. Merge `ads_config`: org -> group -> site (deep merge)
7. Merge `ads_txt`: group replaces org if present (parsed from multiline string)
8. Merge theme: org defaults -> group -> site
9. Merge legal pages: org -> group -> site (shallow merge)
10. Resolve support email pattern with `{{domain}}`
11. Assemble and return `ResolvedConfig`

### ads.txt Generation

The `ads_txt` field in the resolved config is an array of lines. The build process writes these to `dist/ads.txt`. Lines come from the group-level `ads_txt` field (which replaces any org-level ads_txt if present).

### Legal Page Template Resolution

Legal templates in `org.yaml` can contain placeholders. The `legal` field is a shallow-merged record of key-value pairs from org -> group -> site. Sites can override individual legal fields (e.g., `site_description`) without replacing the entire legal config.

---

## 7. Development Workflow

### Making Changes to Platform Code

Changes to files in `atomic-content-platform` affect all sites built with the platform. Examples: modifying a layout component, updating the config resolver, or adding a new shared type.

```bash
cd ~/Documents/ATL-content-network/atomic-content-platform

# Type-check all packages
pnpm typecheck

# Run tests
pnpm test

# Build everything
pnpm build
```

### Making Changes to Network Data

Changes to files in `atomic-labs-network` affect only the specific site or group being modified. Examples: editing an article, changing a site's theme colors, or updating ads.txt entries.

No build step is needed for the network repo itself. Just edit the YAML or Markdown files and re-run the site-builder dev server to see changes.

### Running Tests

```bash
# All packages
pnpm test

# Site-builder only
cd packages/site-builder && pnpm test

# Watch mode
cd packages/site-builder && pnpm test:watch
```

### Type Checking

```bash
# All packages
pnpm typecheck

# Site-builder (includes Astro check)
cd packages/site-builder && pnpm typecheck
```

### Common Tasks

#### Add a new article

1. Create a Markdown file in `sites/{domain}/articles/`:

```bash
touch ~/Documents/ATL-content-network/atomic-labs-network/sites/coolnews.dev/articles/my-new-article.md
```

2. Add frontmatter and body content (see Section 4 for the full format).

3. Set `status: published` when ready to go live.

#### Change site colors

Edit `theme.colors` in the site's `site.yaml`:

```yaml
theme:
  colors:
    primary: "#FF0000"
    accent: "#00FF00"
```

Restart the dev server to see changes.

#### Add a new ad placement

Edit the group's YAML file (e.g., `groups/premium-ads.yaml`) to add entries to the `scripts` section, or edit the `ads_config.ad_placements` array. Ad placements follow this structure:

```yaml
ads_config:
  ad_placements:
    - id: above-content
      position: above-content
      sizes:
        desktop: [[728, 90], [970, 250]]
        mobile: [[320, 50], [300, 250]]
      device: all
```

#### Add a new site to the network

Follow the steps in Section 3 under "How to Add a New Site." In summary:

1. Create `sites/{domain}/` directory with `site.yaml`, `articles/`, and `assets/`.
2. Reference an existing group (or create a new one).
3. Set `active: true`.
4. Build with `SITE_DOMAIN={domain}`.

#### Modify a legal page template

Legal templates cascade from org -> group -> site. To override a legal field for a specific site:

```yaml
# sites/coolnews.dev/site.yaml
legal:
  site_description: "technology news and digital trends"
  effective_date: "2026-06-01"
```

To override at the group level:

```yaml
# groups/premium-ads.yaml
legal_pages_override:
  company_country: "United States"
```

---

## 8. Deploying to Cloudflare Pages

### How Deployment Works

Each site gets its own Cloudflare Pages project. The build process:
1. Builds the Astro site with `SITE_DOMAIN` pointing at the target site
2. Outputs static HTML/CSS/JS to `dist/`
3. Deploys `dist/` to Cloudflare Pages via `wrangler`

### Prerequisites

Install Wrangler (Cloudflare CLI):

```bash
npm install -g wrangler
```

Authenticate with Cloudflare:

```bash
wrangler login
```

Or set environment variables (for CI or headless use):

```bash
export CLOUDFLARE_API_TOKEN=your-token-here
export CLOUDFLARE_ACCOUNT_ID=your-account-id
```

### Deploy Manually (Local)

From `packages/site-builder`, build first:

```bash
cd packages/site-builder
SITE_DOMAIN=coolnews.dev pnpm build
```

#### Deploy to production

Deploys to the main production URL:

```bash
npx wrangler pages deploy dist --project-name=coolnews-dev --branch=main
```

Live at: **https://coolnews-dev.pages.dev**

#### Deploy a branch preview

Deploys a preview from your current branch (e.g. `michal-dev`):

```bash
npx wrangler pages deploy dist --project-name=coolnews-dev --branch=michal-dev
```

This gives you two URLs:
- **Preview URL:** `https://<hash>.coolnews-dev.pages.dev`
- **Branch alias:** `https://michal-dev.coolnews-dev.pages.dev`

Replace `michal-dev` with your branch name (e.g. `asaf-dev`).

### Deploy a Different Site

Same flow, different `SITE_DOMAIN` and `--project-name`:

```bash
# Build
SITE_DOMAIN=muvizz.com pnpm build

# Deploy (project name is the Cloudflare Pages project, usually domain with dots replaced)
npx wrangler pages deploy dist --project-name=muvizz-com
```

### Path Resolution

The site-builder auto-detects the network data repo location. It assumes both repos are cloned side-by-side:

```
ATL-content-network/          (or any shared parent directory)
  atomic-content-platform/    ← you are here
  atomic-labs-network/         ← auto-detected
```

If your repos are in different locations, pass `NETWORK_DATA_PATH` explicitly:

```bash
SITE_DOMAIN=coolnews.dev \
NETWORK_DATA_PATH=/path/to/atomic-labs-network \
pnpm build
```

### Automated Deployment (GitHub Actions)

The workflow at `.github/workflows/deploy-coolnews.yml` runs on every push to `main`:

1. Checks out both repos (platform + network data)
2. Installs dependencies with pnpm
3. Builds shared-types, then builds the site
4. Deploys to Cloudflare Pages via wrangler

**Required GitHub Secrets** (set in repo Settings > Secrets > Actions):

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Pages edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |

To find these:
- **Account ID:** Cloudflare dashboard > any domain > Overview > right sidebar
- **API Token:** Cloudflare dashboard > My Profile > API Tokens > Create Token > "Edit Cloudflare Workers" template

### Adding a New Site to Deployment

1. Create the site in the network data repo (see Section 3)
2. Create a Cloudflare Pages project (via dashboard or `wrangler pages project create <name>`)
3. Copy `.github/workflows/deploy-coolnews.yml` to a new workflow file:

```bash
cp .github/workflows/deploy-coolnews.yml .github/workflows/deploy-newsite.yml
```

4. Update the new workflow: change `SITE_DOMAIN` and `--project-name`
5. Deploy manually first to verify:

```bash
SITE_DOMAIN=newsite.com pnpm build
npx wrangler pages deploy dist --project-name=newsite-com
```

### Naming Convention

| Domain | Cloudflare Pages project name | Workflow file |
|--------|-------------------------------|---------------|
| `coolnews.dev` | `coolnews-dev` | `deploy-coolnews.yml` |
| `muvizz.com` | `muvizz-com` | `deploy-muvizz.yml` |
| `travelnights.com` | `travelnights-com` | `deploy-travelnights.yml` |

---

## 9. Project Status and Roadmap


### Phase Breakdown

| Phase | Name              | Status        | Description                                              |
|-------|-------------------|---------------|----------------------------------------------------------|
| 1     | Site Builder      | **Complete**  | Astro SSG with themes, config resolver, ads, tracking    |
| 2     | Multi-site Deploy | In Progress   | CI/CD for building and deploying multiple sites          |
| 3     | Content Pipeline  | Planned       | AI content generation agents (Claude API)                |
| 4     | Dashboard         | Planned       | Next.js management UI for sites, content, and configs    |
| 5     | Migration         | Planned       | WordPress import and content migration tooling           |

### What Is Built (Phase 1)

- Astro static site generator with the "modern" base theme
- Three-level config inheritance system (org -> group -> site)
- Deep merge with placeholder resolution for scripts and tracking
- Article rendering from Markdown with full frontmatter support
- Ad slot components and ads.txt generation
- Script injection (head, body_start, body_end) with per-site variables
- SEO head tags and sitemap generation
- Shared TypeScript types for all YAML schemas

### What Is Coming

- **Editorial theme** -- a second base theme with magazine-style layouts
- **Content pipeline** -- AI agents that generate and review articles using the Claude API
- **Dashboard** -- a Next.js web UI for managing sites, articles, and configurations
- **Migration tools** -- utilities for importing content from WordPress sites
- **Build filter** -- `detect-changed-sites` to only rebuild sites with changes in CI

---

## 10. Troubleshooting

### Common Issues

#### "Config file not found" error

**Cause:** `NETWORK_DATA_PATH` does not point to the network repo root, or the site directory does not exist.

**Fix:** Verify the path is correct and contains `network.yaml` at the root:

```bash
ls $NETWORK_DATA_PATH/network.yaml
ls $NETWORK_DATA_PATH/sites/$SITE_DOMAIN/site.yaml
```

#### "Site references group X, but group file not found"

**Cause:** The `group` field in `site.yaml` does not match any file in `groups/`.

**Fix:** Check that `groups/{group-id}.yaml` exists and the `group` value in `site.yaml` matches the filename (without the `.yaml` extension).

#### Missing environment variables

**Cause:** `SITE_DOMAIN` or `NETWORK_DATA_PATH` not set.

**Fix:** Always pass both when running dev or build:

```bash
SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=/full/path/to/network pnpm dev
```

If using a relative path for `NETWORK_DATA_PATH`, it is relative to the site-builder package directory, not the repo root. Prefer absolute paths to avoid confusion.

#### YAML syntax errors

**Cause:** Invalid YAML in config files (wrong indentation, missing quotes, tabs instead of spaces).

**Fix:** Validate your YAML before committing:

```bash
# Using Node.js (the yaml package is already a dependency)
node -e "const y = require('yaml'); const fs = require('fs'); console.log(y.parse(fs.readFileSync('path/to/file.yaml', 'utf-8')))"

# Or install a standalone validator
npx yaml-lint sites/coolnews.dev/site.yaml
```

Common YAML mistakes:
- Using tabs instead of spaces for indentation
- Missing quotes around strings with special characters (`:`, `#`, `{`, `}`)
- Incorrect nesting depth
- Using `.yml` extension (the project convention is `.yaml`)

#### Placeholder not resolved (shows `{{variable_name}}` in output)

**Cause:** The variable is not defined in `scripts_vars` at any config level.

**Fix:** Add the variable to `scripts_vars` in the appropriate YAML file (org, group, or site level). The variable name in `scripts_vars` must match the placeholder name without the curly braces.

### How to Debug Config Resolution

To inspect the fully-resolved config for a site, you can run the resolver directly:

```bash
cd packages/site-builder

node -e "
  import('./scripts/resolve-config.ts')
    .then(m => m.resolveConfig(process.env.NETWORK_DATA_PATH, process.env.SITE_DOMAIN))
    .then(c => console.log(JSON.stringify(c, null, 2)))
    .catch(e => console.error(e))
" 2>&1
```

Or add a temporary log in `src/config.ts`:

```typescript
export async function getConfig(): Promise<ResolvedConfig> {
  if (!_config) {
    _config = await resolveConfig(NETWORK_DATA_PATH, SITE_DOMAIN);
    console.log('Resolved config:', JSON.stringify(_config, null, 2));
  }
  return _config;
}
```

The config is resolved once and cached for the lifetime of the build/dev process. Restart the dev server to pick up YAML changes.
