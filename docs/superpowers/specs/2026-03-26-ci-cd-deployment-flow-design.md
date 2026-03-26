# CI/CD Deployment Flow Design

**Date:** 2026-03-26
**Status:** Approved

---

## Problem

Two issues block a clean, secure deployment pipeline:

1. **Hardcoded symlink:** `packages/site-builder/public/assets` is committed to git as a symlink pointing to `/Users/asafcohen/Desktop/...` — a machine-specific path that breaks on every other developer's machine and in CI.

2. **Wrong trigger repo:** The Cloudflare Pages deploy workflow lives in `atomic-content-platform` and fires on every code commit. The architecture requires: code changes → no auto-deploy, data changes → auto-deploy affected sites only.

---

## Architecture Principle

```
atomic-content-platform  →  code (site-builder, agents, dashboard)
                              No auto-deploy. Manual rebuild only.

atomic-labs-network      →  data (articles, site configs, assets)
                              Auto-deploy on main push, preview on PR.
                              Only affected sites build.
```

---

## Fix 1: Dynamic Assets Linking

`build-site.ts` already runs as a pre-build orchestrator (ads.txt, legal pages). Add `setupAssets()` as step 0 of `buildSite()`.

```
setupAssets(networkDataPath, siteDomain, publicDir?)
  → publicDir defaults to join(process.cwd(), 'public')
  → remove public/assets if it exists (symlink or directory)
  → check if {networkDataPath}/sites/{siteDomain}/assets/ exists
    → if NOT: log "[build-site] No assets directory found for {siteDomain}, skipping" and return
    → if YES: symlink {networkDataPath}/sites/{siteDomain}/assets/ → public/assets
```

`publicDir` defaults to `join(process.cwd(), 'public')` but is injectable for testing. **Do not create a dangling symlink** — if the assets directory does not exist, skip silently with a log warning.

**Ordering relative to active check:** `setupAssets()` runs as step 3a — after the `active` flag check and after ads.txt. For inactive sites, `buildSite()` returns before reaching step 3a, so no symlink is created and no assets are deployed alongside the maintenance page. This keeps the maintenance deployment minimal (maintenance `index.html` only).

Wire into `package.json` via npm lifecycle hooks using `build-site.ts` directly (no extra wrapper needed — it already has a `main()` CLI entry point):

```json
"prebuild": "tsx scripts/build-site.ts",
"predev":   "tsx scripts/build-site.ts"
```

The existing `main()` in `build-site.ts` already reads `SITE_DOMAIN` and `NETWORK_DATA_PATH` from env and calls `buildSite()`. No new file needed.

Add `tsx` to `site-builder`'s devDependencies (currently only hoisted from workspace — must be explicit for CI reliability):
```json
"devDependencies": {
  "tsx": "^4.19.0"
}
```

Fix the ESM entry point check (currently CJS-style `require.main === module`) and add missing `__dirname` shim (used on line 136 of `build-site.ts`, undefined in ESM):
```typescript
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// ...
const isMain = process.argv[1] === __filename;
if (isMain) void main();
```

Remove the committed `public/assets` symlink from git (`git rm packages/site-builder/public/assets`).

---

## Fix 2: CI/CD Flow — Three Environments

| Environment | Trigger | URL |
|-------------|---------|-----|
| **Dev** | `pnpm dev` locally | `localhost:4321` |
| **Stage** | PR opened/updated against `main` in `atomic-labs-network` | `{hash}.coolnews-dev.pages.dev` (Cloudflare preview) |
| **Prod** | Push to `main` in `atomic-labs-network` | `coolnews-dev.pages.dev` |

### Workflow in `atomic-labs-network`

Single workflow file: `.github/workflows/deploy.yml`

**Triggers:**
- `push` to `main` — production deploy
- `pull_request` targeting `main` — preview/stage deploy
- `workflow_dispatch` with `force_all` boolean input — manual full rebuild (skips change detection)

**Path filter (push and pull_request triggers only):**
```yaml
paths: ['sites/**', 'groups/**', 'org.yaml', 'network.yaml']
```
Commits touching only `README.md`, `docs/`, etc. never start the workflow.

### Job 1 — detect

Runs bash logic equivalent to `detect-changed-sites.ts`.

**Diff command selection:**
```bash
if [[ "$EVENT" == "pull_request" ]]; then
  CHANGED=$(git diff --name-only "$BASE_SHA"..."$HEAD_SHA")
elif [[ "$FORCE_ALL" == "true" ]]; then
  CHANGED="*"
else
  # push to main
  CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "*")
fi
```
where `BASE_SHA=${{ github.event.pull_request.base.sha }}`, `HEAD_SHA=${{ github.sha }}`, `EVENT=${{ github.event_name }}`, `FORCE_ALL=${{ inputs.force_all }}`.

**Site enumeration and group resolution:**
```bash
for site_dir in sites/*/; do
  SITE=$(basename "$site_dir")
  GROUP=$(grep "^group:" "sites/$SITE/site.yaml" 2>/dev/null | awk '{print $2}' | tr -d '"')
  # apply shouldBuildSite logic in bash
done
```

**Rebuild rules (mirrors `detect-changed-sites.ts`):**
- `CHANGED` contains `*` → rebuild all
- Any file matches `sites/{SITE}/` prefix → rebuild
- `org.yaml` or `network.yaml` changed → rebuild all
- `groups/{GROUP}.yaml` changed → rebuild this site

**Output:** JSON array of site domains, e.g. `["coolnews.dev"]`. Empty array `[]` means nothing to build — the deploy job is skipped via `if: needs.detect.outputs.sites != '[]'`.

**`force_all` behavior:** When `force_all` is `true`, enumerate all sites by globbing `sites/*/` and output all of them, bypassing the diff entirely.

### Job 2 — deploy (matrix)

One runner per changed site (`strategy.matrix.site: ${{ fromJson(needs.detect.outputs.sites) }}`).

Each runner:
1. Checks out `atomic-labs-network` with `fetch-depth: 0` (needed for PR base SHA diffs)
2. Checks out `atomic-content-platform` into `./platform` using `PLATFORM_REPO_TOKEN`
3. Caches pnpm store keyed to `platform/pnpm-lock.yaml`
4. Installs deps and builds shared-types
5. Runs `pnpm build` in `platform/packages/site-builder` with:
   - `SITE_DOMAIN: ${{ matrix.site }}`
   - `NETWORK_DATA_PATH: ${{ github.workspace }}`
6. Deploys via:
   ```bash
   PROJECT=$(echo "${{ matrix.site }}" | sed 's/\./-/g')
   BRANCH="${{ github.head_ref || github.ref_name }}"
   npx wrangler pages deploy dist --project-name="$PROJECT" --branch="$BRANCH"
   ```

**Project name derivation:** Replace all dots with dashes. `coolnews.dev` → `coolnews-dev`. `my.coolnews.dev` → `my-coolnews-dev`. This applies consistently in both bash and any future tooling.

**Cloudflare Pages prod/preview:** When `BRANCH=main`, Cloudflare marks the deployment as Production. Any other branch name creates a Preview deployment with a unique URL.

**Inactive sites:** `buildSite()` returns early and writes a maintenance page when a site's `active: false`. The matrix runner still deploys — the deployed output is the maintenance page only. This is intentional.

### Workflow in `atomic-content-platform`

`deploy-coolnews.yml` converted to `workflow_dispatch` only (push trigger removed). Used manually when site-builder code changes require a full rebuild of all sites. Rebuilds every site in `atomic-labs-network` without change detection (all sites share the code).

---

## Security

| Secret | Stored in | Scope |
|--------|-----------|-------|
| `CLOUDFLARE_API_TOKEN` | `atomic-labs-network` secrets | `Cloudflare Pages: Edit` permission only |
| `CLOUDFLARE_ACCOUNT_ID` | `atomic-labs-network` secrets | Account ID |
| `PLATFORM_REPO_TOKEN` | `atomic-labs-network` secrets | Fine-grained PAT: `Contents: Read` on `atomic-content-platform` only |

No secrets in code. No global API keys.

---

## What Does Not Change

- `detect-changed-sites.ts` — kept as-is (used in tests); CI uses equivalent bash for efficiency
- `build-site.ts` — existing steps (ads.txt, legal pages) unchanged; `setupAssets` added as step 0
- Astro config — unchanged
- Per-site Cloudflare Pages projects — unchanged (one project per domain)

---

## Testing

- `setupAssets`: unit tested with real temp directories — covers (a) normal symlink creation, (b) replaces existing symlink, (c) skips gracefully when assets dir absent
- Workflow: validated via `workflow_dispatch` with `force_all=true` on first run; verified against Cloudflare Pages dashboard
