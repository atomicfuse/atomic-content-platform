FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy monorepo root files for pnpm workspace resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy the content-pipeline service
COPY services/content-pipeline/ services/content-pipeline/

# Install only content-pipeline dependencies
RUN pnpm install --frozen-lockfile --filter @atomic-platform/content-pipeline

# Build TypeScript
RUN pnpm --filter @atomic-platform/content-pipeline build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

# Copy built application with production dependencies
COPY --from=builder /app/services/content-pipeline/dist/ services/content-pipeline/dist/
COPY --from=builder /app/services/content-pipeline/package.json services/content-pipeline/
COPY --from=builder /app/node_modules/ node_modules/
COPY --from=builder /app/services/content-pipeline/node_modules/ services/content-pipeline/node_modules/

WORKDIR /app/services/content-pipeline

USER node
EXPOSE 8080
ENV PORT=8080

CMD ["node", "dist/index.js"]
