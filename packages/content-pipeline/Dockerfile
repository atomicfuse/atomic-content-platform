FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy monorepo root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./

# Copy only the packages we need
COPY packages/shared-types/ packages/shared-types/
COPY packages/content-pipeline/ packages/content-pipeline/
COPY templates/ templates/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared-types first, then content-pipeline
RUN pnpm --filter @atomic-platform/shared-types build && \
    pnpm --filter @atomic-platform/content-pipeline build

# --- Production stage ---
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=base /app/ /app/

# Default: run the scheduled publisher (override in K8s manifest)
CMD ["node", "packages/content-pipeline/dist/agents/scheduled-publisher/index.js"]
