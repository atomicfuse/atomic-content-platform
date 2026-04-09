FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy monorepo root files for pnpm workspace resolution
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy the dashboard service
COPY services/dashboard/ services/dashboard/

# Install only dashboard dependencies
RUN pnpm install --frozen-lockfile --filter @atomic-platform/dashboard

# Build Next.js standalone
WORKDIR /app/services/dashboard
RUN pnpm build

# --- Production stage ---
FROM node:20-alpine

WORKDIR /app

# Copy standalone server (preserves monorepo path structure)
COPY --from=builder /app/services/dashboard/.next/standalone ./
COPY --from=builder /app/services/dashboard/.next/static ./services/dashboard/.next/static

USER node
EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Standalone server.js is at the service path within the monorepo structure
CMD ["node", "services/dashboard/server.js"]
