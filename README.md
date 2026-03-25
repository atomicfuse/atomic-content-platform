# Atomic Content Network Platform

Multi-tenant content network for managing ad-monetized static websites at scale. Replaces individual WordPress installations with a centralized, Git-driven architecture.

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm
# Clone both repos side-by-side
git clone https://github.com/atomicfuse/atomic-content-platform.git
git clone https://github.com/atomicfuse/atomic-labs-network.git

# Install dependencies
cd atomic-content-platform
pnpm install

# Run dev server
cd packages/site-builder
SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=../../atomic-labs-network pnpm dev

# Open http://localhost:4321
```

## Architecture

Two-repo architecture:
- **This repo** — all code (Astro site builder, themes, config resolver, build tools)
- **Network data repos** (e.g., `atomic-labs-network`) — pure data (YAML configs, markdown articles, images)

```
Platform repo (code)          Network data repo (data)
├── packages/                 ├── network.yaml
│   ├── shared-types/         ├── org.yaml
│   ├── site-builder/         ├── groups/*.yaml
│   ├── dashboard/            └── sites/{domain}/
│   ├── content-pipeline/         ├── site.yaml
│   └── migration/                ├── assets/
├── templates/                    └── articles/*.md
└── platform.config.ts
```

## Documentation

- **[Developer Guide](docs/DEVELOPER-GUIDE.md)** — full setup, architecture, config system, workflows
- **[SOP Spec](docs/superpowers/specs/2026-03-25-content-network-platform-design.md)** — detailed platform specification

## Tech Stack

Turborepo + pnpm | Astro 6 | TypeScript (strict) | Tailwind CSS v4 | Cloudflare Pages
