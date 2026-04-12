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

## CloudGrid Deployment

The platform deploys to CloudGrid as a multi-service app (`atomic-content-platform.apps.cloudgrid.io`).

### Deploy

```bash
# CLI deploy (current branch)
cloudgrid deploy

# Or connect GitHub for auto-deploy on push to main
cloudgrid connect
```

### Local Dev (two options)

```bash
# Option A: CloudGrid dev (tunnels MongoDB/Redis, auto-ports)
cloudgrid dev

# Option B: pnpm dev (manual, each service independently)
cd services/dashboard && pnpm dev          # localhost:3000
cd services/content-pipeline && pnpm dev   # localhost:3001
```

### Secrets & Env

```bash
# Sensitive values (never in git)
cloudgrid secrets set atomic-content-platform KEY=value

# Runtime config (no rebuild needed)
cloudgrid env set atomic-content-platform KEY=value
```

### Adding a New Agent/Service

Every CloudGrid service must:
1. Listen on `process.env.PORT` (default 8080 in CloudGrid)
2. Expose `GET /health` returning HTTP 200

Pattern for a new Node.js/TypeScript agent (like content-pipeline):
1. Create `services/<name>/` with its own `package.json` (self-contained deps, no workspace refs to `packages/*`)
2. Entry point: `src/index.ts` — HTTP server on `process.env.PORT` with `/health`
3. For AI: use `@cloudgrid-io/ai` (zero config in CloudGrid), fall back to `@anthropic-ai/sdk` locally
4. Add to `cloudgrid.yaml` under `services:`
5. If dashboard needs to call it: add `<NAME>_URL: http://<service-name>` to dashboard env in cloudgrid.yaml

### Service Communication

- In CloudGrid: services use internal DNS (`http://content-pipeline`, `http://<service-name>`)
- Locally: services use `http://localhost:<port>` defaults
- Always read the URL from an env var with a localhost fallback

## Conventions

- TypeScript strict mode — no `any`, explicit return types
- Shared types in `packages/shared-types/`, referenced via workspace dependency
- Config inheritance: org.yaml → group.yaml → site.yaml (deep merge)
- All YAML files use `.yaml` extension (not `.yml`)
- Article files: kebab-case slug (e.g., `best-thriller-movies-2026.md`)
- Package names: `@atomic-platform/{package-name}`

## Git Workflow

**Branch rules — follow these on every commit/push without being asked:**

- Asaf works on `asaf-dev`. Michal works on `michal-dev`. **Never commit directly to `main`.**
- When asked to "commit and push": stage the relevant files, write a clear commit message, commit to the current dev branch, and push to `origin/<branch>`.
- When work is ready for review: open a PR from the dev branch to `main` using `gh pr create`. Do not merge directly.
- Never touch the other developer's branch.
- Always run `git branch --show-current` to confirm you are on the right branch before committing.

## Key Environment Variables

| Variable | Used by | Description |
|----------|---------|-------------|
| `SITE_DOMAIN` | site-builder | Target domain to build (e.g., `coolnews.dev`) |
| `NETWORK_DATA_PATH` | site-builder | Path to network data repo root |
| `GITHUB_TOKEN` | dashboard, content-pipeline | GitHub API access for network repos |
| `CONTENT_AGGREGATOR_URL` | content-pipeline | Content Aggregator API base URL (default: `https://content-aggregator-cloudgrid.apps.cloudgrid.io`) |
