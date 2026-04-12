# CloudGrid Deployment

The platform deploys to CloudGrid as a multi-service application at `atomic-content-platform.apps.cloudgrid.io`. CloudGrid handles service orchestration, environment variables, secrets, cron jobs, and internal service communication.

## cloudgrid.yaml

The deployment manifest lives at the repo root:

```yaml
name: atomic-content-platform

services:
  dashboard:
    type: nextjs
    path: /
    env:
      CONTENT_AGENT_URL: http://content-pipeline-app
      NEXTAUTH_URL: https://atomic-content-platform.apps.cloudgrid.io
      GOOGLE_SHEET_ID: "1XE56hNxuhCg4fP8gC59cv2quGp38Im3ASJ1ADj9gzZY"

  content-pipeline:
    type: node
    lang: typescript
    path: /pipeline
    env:
      NETWORK_REPO: atomicfuse/atomic-labs-network
      CONTENT_AGGREGATOR_URL: https://content-aggregator-cloudgrid.apps.cloudgrid.io

  scheduled-publisher:
    type: cron
    schedule: "0 */4 * * *"
    timezone: EST
    run: http://content-pipeline-app/scheduled-publish
```

## Services

### Dashboard (`dashboard`)
- **Type:** `nextjs`
- **Purpose:** Management UI, site CRUD, article review, subscriber API
- **Public URL:** `https://atomic-content-platform.apps.cloudgrid.io`

### Content Pipeline (`content-pipeline`)
- **Type:** `node` (TypeScript)
- **Purpose:** AI content generation, quality scoring
- **Endpoints:** `POST /content-generate`, `GET /health`
- **Internal URL:** `http://content-pipeline-app`

### Scheduled Publisher (`scheduled-publisher`)
- **Type:** `cron`
- **Schedule:** Every 4 hours (`0 */4 * * *` EST)
- **Action:** HTTP request to `http://content-pipeline-app/scheduled-publish`

## Health Checks

Every CloudGrid service must expose `GET /health` returning HTTP 200. The content pipeline implements this directly:

```typescript
if (req.method === "GET" && req.url === "/health") {
  sendJson(res, 200, { status: "ok" });
  return;
}
```

The dashboard uses a Next.js API route at `/health/route.ts`.

## Deploying

### CLI Deploy

```bash
# Deploy current branch
cloudgrid deploy
```

### Auto-Deploy

Connect the GitHub repo for automatic deployment on push to `main`:

```bash
cloudgrid connect
```

## Local Development

### Option A: CloudGrid Dev Mode

Tunnels MongoDB/Redis from CloudGrid, assigns ports automatically:

```bash
cloudgrid dev
```

### Option B: Manual (pnpm)

Run each service independently:

```bash
# Dashboard
cd services/dashboard && pnpm dev          # localhost:3000

# Content Pipeline
cd services/content-pipeline && pnpm dev   # localhost:8080
```

## Environment Variables

Non-sensitive configuration is set in `cloudgrid.yaml` under each service's `env` key. These can also be updated at runtime:

```bash
# Set/update a runtime env var (no rebuild needed)
cloudgrid env set atomic-content-platform KEY=value
```

### Key Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `CONTENT_AGENT_URL` | dashboard | URL to reach the content pipeline |
| `NEXTAUTH_URL` | dashboard | Base URL for NextAuth callbacks |
| `GOOGLE_SHEET_ID` | dashboard | Spreadsheet for subscriber storage |
| `NETWORK_REPO` | content-pipeline | GitHub repo path (owner/name) |
| `CONTENT_AGGREGATOR_URL` | content-pipeline | Content Aggregator API base URL |

## Secrets

Sensitive values are stored as CloudGrid secrets and injected at runtime. They are never committed to Git.

```bash
# Set a secret
cloudgrid secrets set atomic-content-platform KEY=value
```

### Required Secrets

| Secret | Service | Purpose |
|--------|---------|---------|
| `NEXTAUTH_SECRET` | dashboard | NextAuth session encryption |
| `GOOGLE_CLIENT_ID` | dashboard | Google OAuth for dashboard login |
| `GOOGLE_CLIENT_SECRET` | dashboard | Google OAuth for dashboard login |
| `GITHUB_TOKEN` | dashboard, content-pipeline | GitHub API access for network repo |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | dashboard | Google Sheets API (subscriber storage) |
| `GEMINI_API_KEY` | dashboard, content-pipeline | Gemini for logos and topic suggestions |
| `CLOUDFLARE_API_TOKEN` | dashboard | Cloudflare API for Pages/DNS management |
| `CLOUDFLARE_ACCOUNT_ID` | dashboard | Cloudflare account identifier |

Note: `ANTHROPIC_API_KEY` is not needed for the content pipeline when running on CloudGrid -- the CloudGrid AI Gateway handles Claude API access automatically via `@cloudgrid-io/ai`.

## Service Communication

### In CloudGrid

Services communicate via internal DNS. The hostname follows the pattern `http://{service-name}-app`:

```
Dashboard -> http://content-pipeline-app/content-generate
Cron      -> http://content-pipeline-app/scheduled-publish
```

### Locally

Services fall back to `localhost` with default ports:

```typescript
const CONTENT_AGENT_URL = process.env.CONTENT_AGENT_URL ?? "http://localhost:8080";
```

Always read the URL from an environment variable with a localhost fallback.

## Port Assignment

Every CloudGrid service must listen on `process.env.PORT` (defaults to 8080 in CloudGrid). The content pipeline uses this pattern:

```typescript
const port = process.env.PORT ?? 8080;
server.listen(port);
```

## Cron Jobs

The `scheduled-publisher` service is a cron type that fires an HTTP request on a schedule. It does not run its own process -- it calls the content pipeline's `/scheduled-publish` endpoint.

```yaml
scheduled-publisher:
  type: cron
  schedule: "0 */4 * * *"   # every 4 hours
  timezone: EST
  run: http://content-pipeline-app/scheduled-publish
```

The content pipeline handles the request, iterates all sites, checks their publishing schedules, and generates content for sites that are due.
