# Platform Q&A — Key Decisions & Flow

Quick reference for the team. Covers architecture decisions, deployment behavior, and the end-to-end site lifecycle.

---

## What database does the dashboard use?

**There is no database.** Git is the database. The dashboard is a thin UI layer over the GitHub API.

Every dashboard action maps directly to a GitHub API call on the network repo:

| Dashboard Action | Where Data Lives |
|---|---|
| List sites | `sites/` directory via GitHub API |
| Read/update site config | `sites/{domain}/site.yaml` |
| List articles | `sites/{domain}/articles/*.md` |
| Edit article | Update `.md` file (git commit) |
| Manage groups | `groups/*.yaml` |
| Org config | `org.yaml` |

**Tech stack:**
- **Data layer:** GitHub API via Octokit — all reads/writes go to network repos
- **Caching:** React Query with stale times (GitHub has 5000 req/hour rate limit)
- **Auth:** Cloudflare Access (no session DB, no passwords — just `Cf-Access-Jwt-Assertion` header)
- **Stats:** Derived from git log / file dates + Cloudflare Pages API

No Postgres, no Redis, no SQLite. Just YAML files in git.

---

## How do I run the dashboard locally?

The dashboard is **not built yet** — it's Phase 4 in the SOP. Currently just an empty stub (`packages/dashboard/package.json` only).

When built, it will run like any Next.js app:

```bash
cd packages/dashboard
pnpm dev
# Opens at http://localhost:3000
```

With a `.env.local`:

```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx
```

**Local vs Production:**
- **Production:** Cloudflare Access provides user identity via header. Deployed on Cloudflare Workers.
- **Locally:** Mock/hardcode the authenticated user (e.g., `admin@atomiclabs.com`). No Cloudflare Access needed.

Only requirement is a valid `GITHUB_TOKEN` with repo access to the network repo. No database, no Docker, no backend services.

---

## Will dashboard code changes trigger Cloudflare deployments?

**No.** The two repos are completely independent in terms of deployment:

| Change | Deploys to Cloudflare? |
|---|---|
| Edit `packages/dashboard/` | No |
| Edit `packages/site-builder/` | No |
| Edit `packages/content-pipeline/` | No |
| Push article/config to `atomic-labs-network` | Yes — rebuilds the affected site |

Platform repo = code changes, no auto-deploy. Network repo = data changes, auto-deploys sites.

You can freely develop the dashboard — push commits, merge to main — and nothing deploys on Cloudflare. The dashboard would only deploy when you explicitly set up a separate Cloudflare Workers project for it.

---

## With 10 sites, does changing one site rebuild all of them?

**No.** Only the affected site builds. The `detect-changed-sites.ts` script runs as the first step of every build and determines relevance.

Each site has its own Cloudflare Pages project. When you push to the network repo, all workflows trigger, but most exit immediately after the change detection step.

| Files Changed | What Builds |
|---|---|
| `sites/coolnews.dev/articles/*` | Only coolnews.dev |
| `sites/coolnews.dev/site.yaml` | Only coolnews.dev |
| `groups/premium-ads.yaml` | All sites in that group |
| `org.yaml` | All sites |
| `network.yaml` | All sites |

At scale (10+ sites), consider switching from one-workflow-per-site to a single matrix workflow that only spawns jobs for affected sites.

---

## Does the dashboard automatically create all site files?

**Yes — the git data is automatic.** When a manager fills in the site creation wizard, the dashboard commits the full folder structure to the network repo via a single GitHub API call:

```
sites/newsite.com/
├── site.yaml          ← generated from form data
├── assets/
│   ├── logo.svg       ← uploaded in wizard
│   └── favicon.png    ← uploaded in wizard
└── articles/          ← empty, agents fill this later
```

**However**, the Cloudflare Pages project is NOT automatic by default. Someone still needs to:
1. Point DNS to Cloudflare Pages
2. Create the Cloudflare Pages project (set `SITE_DOMAIN`, connect to network repo)

This is either a manual step or automated via the Cloudflare API (`lib/cloudflare.ts` in the dashboard).

---

## What is the "wizard"?

Just a multi-step form. The SOP calls it "Site Creation Wizard" but it's a standard UX pattern — a form broken into steps instead of one giant page:

1. Domain + site name + tagline
2. Select group (dropdown)
3. Select theme (modern/editorial)
4. Upload logo + favicon
5. Pick colors
6. GA4 tracking ID
7. Content brief (audience, tone, topics, schedule)
8. Review summary
9. Submit → commits to GitHub

It's a Next.js page with a step counter and next/back buttons. Nothing more.

---

## End-to-End Site Lifecycle

The full flow from buying a domain to a live site with content:

1. **Manager buys domain** (external — GoDaddy, Cloudflare, etc.)
2. **Points DNS** to Cloudflare Pages (manual or automated)
3. **Creates Cloudflare Pages project** for that domain (manual or via Cloudflare API)
4. **Fills in the wizard** in the dashboard → commits site folder to network repo
5. **Cloudflare Pages builds** the empty site (homepage, legal pages, no articles yet)
6. **Agents pick it up** — scheduled-publisher reads the brief's schedule, triggers content-generation agent → articles get committed → site auto-rebuilds with content

Steps 2-3 are the only manual infra steps. Everything after the wizard is automatic.

---

## Where do K8s agents live in the codebase?

In `packages/content-pipeline/` inside the platform repo (`atomic-content-platform`). The SOP's core rule: all code in the platform repo, all data in network repos.

Agents interact with the system via GitHub API:

```
K8s Agent (content-pipeline)
    │
    ├── READS:  site brief from network repo (via GitHub API)
    ├── READS:  article templates from platform repo's templates/
    ├── CALLS:  Claude API to generate content
    └── WRITES: .md file to network repo (via GitHub API commit)
              │
              └── triggers Cloudflare Pages rebuild automatically
```

Each agent is an independent entry point — team members can work on different agents in parallel without conflicts.

---

## How do I run the content generation agent locally?

### 1. Setup

```bash
cd atomic-content-platform/packages/content-pipeline
cp .env.example .env
```

Edit `.env` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...                         # required
GITHUB_TOKEN=ghp_...                                 # required (for writing articles)
GEMINI_API_KEY=AIzaSy_...                            # optional (for featured images)
NETWORK_REPO=atomicfuse/atomic-labs-network          # required for GitHub write mode
```

For **local dev** (writes files directly to disk instead of GitHub):

```
LOCAL_NETWORK_PATH=/path/to/atomic-labs-network
```

### 2. Start the server

```bash
pnpm agent:content-generation
```

You should see:

```
[server] Content generation agent running on http://localhost:3001
[server] POST http://localhost:3001/content-generate
```

### 3. Send a request (Postman or curl)

- **Method:** `POST`
- **URL:** `http://localhost:3001/content-generate`
- **Headers:** `Content-Type: application/json`
- **Body:**

```json
{
  "siteDomain": "coolnews.dev",
  "rssUrl": "https://rss.app/feeds/..."
}
```

### Responses

| Status | Meaning |
|--------|---------|
| `201 created` | Article generated and written |
| `200 skipped` | No new articles found in the feed |
| `400` | Missing/invalid `siteDomain` or `rssUrl` |
| `502` | Agent error — check terminal logs |

---

## What is the dev → stage → prod deployment flow?

Three environments, each with a clear trigger:

| Environment | Trigger | URL |
|-------------|---------|-----|
| **Dev** | `pnpm dev` locally | `localhost:4321` |
| **Stage** | Open a PR against `main` in `atomic-labs-network` | `{hash}.coolnews-dev.pages.dev` (Cloudflare preview) |
| **Prod** | Merge PR to `main` in `atomic-labs-network` | `coolnews-dev.pages.dev` |

### Key rules

- **Only data changes trigger deploys.** `atomic-labs-network` owns the deploy workflow. Pushing code changes to `atomic-content-platform` does NOT trigger Cloudflare — only `workflow_dispatch` (manual) is available there.

- **Only affected sites build.** The workflow detects which `sites/`, `groups/`, `org.yaml`, or `network.yaml` files changed, and builds only the relevant sites. Most commits skip most sites.

- **Cloudflare knows prod vs. preview from the branch name.** Deploying from `main` → Production URL. Deploying from any other branch → Preview URL. This is handled automatically by wrangler.

### How to trigger a stage (preview) deploy

1. Push your changes to your branch in `atomic-labs-network` (e.g. `asaf-dev`)
2. Open a PR against `main`
3. GitHub Actions runs automatically — only if `sites/**`, `groups/**`, `org.yaml`, or `network.yaml` changed
4. Cloudflare Pages creates a preview URL — check the PR for the deployment link

### How to trigger a prod deploy

Merge the PR to `main`. The workflow runs, detects changes, builds, and deploys Production.

### How to force-rebuild all sites (e.g. after site-builder code change)

Go to GitHub → `atomicfuse/atomic-labs-network` → Actions → "Deploy Sites" → Run workflow → enable "Force rebuild all sites".

Or use the manual workflow in `atomic-content-platform` → Actions → "Rebuild All Sites (manual)".

### Secrets required in `atomic-labs-network` GitHub repo settings

| Secret | What it is |
|--------|-----------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token scoped to `Pages: Edit` only |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (from dashboard URL) |
| `PLATFORM_REPO_TOKEN` | Fine-grained GitHub PAT with `Contents: Read` on `atomic-content-platform` |

---

## Where does the Site ID in the dashboard come from?

**It's auto-generated — not pulled from Cloudflare or GitHub.** The dashboard generates it when a domain is added (via Sync or Add Domain):

```typescript
function generateSiteId(): string {
  const timestamp = Date.now().toString().slice(-10);
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${timestamp}${random}`;
}
```

It's just `timestamp + 3 random digits` — a throwaway unique ID with no real meaning. Stored in `dashboard-index.yaml` alongside each domain entry.

**Possible alternatives if we want it meaningful:**
1. **Cloudflare Zone ID** — the actual CF zone identifier
2. **Cloudflare Pages project name** — like `coolnews-dev`
3. **A custom ID defined per site** in Jira or an internal system
4. **Remove it entirely** — domain is already a unique identifier
