# CLAUDE.md

## Overview

Atomic Content Network Platform — a multi-tenant content network for managing ad-monetized static websites at scale. Turborepo/pnpm monorepo.

## Architecture

Two-repo architecture:
- **This repo** (`atomic-content-platform`) — all code: site builder, dashboard, content pipeline, migration tools, shared types
- **Network data repos** (e.g., `atomic-labs-network`) — pure data: YAML configs, markdown articles, site assets. Zero code.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `packages/shared-types` | TypeScript interfaces for YAML schemas, articles, ads, tracking | Active |
| `packages/site-builder` | Astro static site generator — themes, components, build scripts, config resolver | Active |
| `packages/dashboard` | Next.js management UI (Phase 4) | Placeholder |
| `packages/content-pipeline` | AI content generation agents (Phase 3) | Placeholder |
| `packages/migration` | WordPress migration tooling (Phase 5) | Placeholder |

## Tech Stack

- **Monorepo:** Turborepo + pnpm
- **Site builder:** Astro 6 (static output)
- **Dashboard:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS v4
- **Node.js:** 20+ LTS

## Common Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Run tests
pnpm test

# Run site-builder dev server
cd packages/site-builder
SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network pnpm dev

# Build a specific site
cd packages/site-builder
SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network pnpm build
```

## Conventions

- TypeScript strict mode — no `any`, explicit return types
- Shared types in `packages/shared-types/`, referenced via workspace dependency
- Config inheritance: org.yaml → group.yaml → site.yaml (deep merge)
- All YAML files use `.yaml` extension (not `.yml`)
- Article files: kebab-case slug (e.g., `best-thriller-movies-2026.md`)
- Package names: `@atomic-platform/{package-name}`

## Key Environment Variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `SITE_DOMAIN` | site-builder | Target domain to build (e.g., `coolnews.dev`) |
| `NETWORK_DATA_PATH` | site-builder | Path to network data repo root |
| `GITHUB_TOKEN` | dashboard, content-pipeline | GitHub API access for network repos |
