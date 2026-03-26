# CI/CD Deployment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the hardcoded assets symlink, wire `build-site.ts` into the dev/build lifecycle, and move CI/CD to the data repo with a clean dev → stage (PR preview) → prod (main) flow.

**Architecture:** `atomic-labs-network` owns the deploy workflow (data changes trigger deploys). `atomic-content-platform` retains only a manual `workflow_dispatch` for code-change rebuilds. Change detection (`detect-changed-sites.ts` logic in bash) ensures only affected sites build.

**Tech Stack:** Astro 6, pnpm, TypeScript, Cloudflare Pages, wrangler, GitHub Actions, tsx

**Spec:** `docs/superpowers/specs/2026-03-26-ci-cd-deployment-flow-design.md`

---

## File Map

### `atomic-content-platform`

| File | Action | What changes |
|------|--------|-------------|
| `packages/site-builder/scripts/build-site.ts` | Modify | Add `setupAssets()`, fix ESM `__dirname` + entry-point check, wire `setupAssets` as step 3a |
| `packages/site-builder/scripts/__tests__/build-site.test.ts` | Create | Unit tests for `setupAssets` |
| `packages/site-builder/package.json` | Modify | Add `prebuild`/`predev` hooks, add `tsx` to devDependencies |
| `packages/site-builder/public/assets` | Delete (git rm) | Remove committed machine-specific symlink |
| `.github/workflows/deploy-coolnews.yml` | Modify | Remove push trigger, keep `workflow_dispatch` only |
| `docs/Notes.md` | Modify | Add dev/stage/prod Q&A section |

### `atomic-labs-network`

| File | Action | What changes |
|------|--------|-------------|
| `.github/workflows/deploy.yml` | Create | Full CI/CD: detect changed sites → matrix deploy → Cloudflare Pages |

---

## Task 1: Remove committed symlink

**Files:**
- Delete: `packages/site-builder/public/assets`

- [ ] **Step 1: Remove symlink from git tracking**

```bash
cd /path/to/atomic-content-platform
git rm packages/site-builder/public/assets
```

Expected output: `rm 'packages/site-builder/public/assets'`

- [ ] **Step 2: Verify public/ no longer tracks assets**

```bash
git ls-files packages/site-builder/public/
```

Expected: empty or only other tracked files — no `public/assets` line.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix(site-builder): remove hardcoded machine-specific assets symlink"
```

---

## Task 2: Add `setupAssets` to `build-site.ts` + fix ESM issues

**Files:**
- Modify: `packages/site-builder/scripts/build-site.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/site-builder/scripts/__tests__/build-site.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readlink, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupAssets } from "../build-site.js";

describe("setupAssets", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "build-site-test-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("creates symlink pointing to network assets dir", async () => {
    const networkPath = join(tmp, "network");
    const assetsTarget = join(networkPath, "sites", "test.com", "assets");
    await mkdir(assetsTarget, { recursive: true });
    const publicDir = join(tmp, "public");
    await mkdir(publicDir, { recursive: true });

    await setupAssets(networkPath, "test.com", publicDir);

    const link = await readlink(join(publicDir, "assets"));
    expect(link).toBe(assetsTarget);
  });

  it("replaces an existing symlink", async () => {
    const networkPath = join(tmp, "network");
    const assetsTarget = join(networkPath, "sites", "test.com", "assets");
    await mkdir(assetsTarget, { recursive: true });
    const publicDir = join(tmp, "public");
    await mkdir(publicDir, { recursive: true });

    // Create stale symlink first (symlink imported statically at top of file)
    await symlink("/some/old/path", join(publicDir, "assets"));

    await setupAssets(networkPath, "test.com", publicDir);

    const link = await readlink(join(publicDir, "assets"));
    expect(link).toBe(assetsTarget);
  });

  it("skips symlink creation when assets dir does not exist", async () => {
    const networkPath = join(tmp, "network");
    await mkdir(networkPath, { recursive: true }); // no assets subdir
    const publicDir = join(tmp, "public");
    await mkdir(publicDir, { recursive: true });

    await setupAssets(networkPath, "test.com", publicDir);

    // public/assets should not exist
    await expect(lstat(join(publicDir, "assets"))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/site-builder
pnpm test
```

Expected: 3 test failures — `setupAssets is not a function` (or similar import error).

- [ ] **Step 3: Implement `setupAssets` in `build-site.ts`**

At the top of `build-site.ts`, make these two import changes:

**1.** Add `symlink`, `access`, and `rm` to the existing `node:fs/promises` import:
```typescript
import { readFile, writeFile, mkdir, rm, symlink, access } from "node:fs/promises";
```

**2.** Add a new import for `fileURLToPath` from `node:url` (needed for the ESM `__dirname` shim):
```typescript
import { fileURLToPath } from "node:url";
```

Then add the ESM shims immediately after all imports (before any other code). These replace the existing undefined `__dirname` reference at line 136:

```typescript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

(`dirname` is already imported from `"node:path"` in the existing file — no change needed there.)

Add the `setupAssets` export function before `buildSite`:

```typescript
/**
 * Symlink public/assets → {networkDataPath}/sites/{siteDomain}/assets/
 *
 * Idempotent: removes any existing symlink/dir at the target path first.
 * Skips gracefully (logs warning) if the source assets dir does not exist.
 *
 * @param networkDataPath - Root of the network data repo
 * @param siteDomain      - Domain slug (e.g. "coolnews.dev")
 * @param publicDir       - Astro public dir (default: process.cwd()/public)
 */
export async function setupAssets(
  networkDataPath: string,
  siteDomain: string,
  publicDir: string = join(process.cwd(), "public"),
): Promise<void> {
  const linkPath = join(publicDir, "assets");
  const targetPath = join(networkDataPath, "sites", siteDomain, "assets");

  // Check target exists before creating symlink (no dangling links)
  try {
    await access(targetPath);
  } catch {
    console.log(`[build-site] No assets directory found for ${siteDomain} — skipping`);
    return;
  }

  // Remove existing symlink or directory at link path
  await rm(linkPath, { recursive: true, force: true });

  await symlink(targetPath, linkPath);
  console.log(`[build-site] Assets linked: ${linkPath} → ${targetPath}`);
}
```

- [ ] **Step 4: Wire `setupAssets` into `buildSite` (after ads.txt, before inject shared pages)**

Inside `buildSite()`, locate the existing `console.log` after `writeFileWithDir(adsTxtPath, ...)`:

```typescript
  console.log(
    `[build-site] Wrote ads.txt (${resolvedConfig.ads_txt.length} entries)`,
  );
```

Insert the `setupAssets` call immediately after that log line and before the `// ---- 5. Inject shared legal pages ----` comment:

```typescript
  // ---- 4a. Link site assets ----

  await setupAssets(networkDataPath, siteDomain);

  // ---- 5. Inject shared legal pages ----
```

**Why here:** The active flag check is step 3 and returns early — so `setupAssets` only runs for active sites. Ads.txt has already been written. Inject shared pages comes next.

- [ ] **Step 5: Fix ESM entry-point guard (replace CJS `require.main === module`)**

Replace lines at the bottom of `build-site.ts`:

```typescript
// Old (CJS — remove):
// Detect if this module is the entry point (CJS).
if (require.main === module) {
  void main();
}
```

```typescript
// New (ESM-compatible):
if (process.argv[1] === __filename) {
  void main();
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd packages/site-builder
pnpm test
```

Expected: all tests pass including the 3 new `setupAssets` tests.

- [ ] **Step 7: Commit**

```bash
git add packages/site-builder/scripts/build-site.ts \
        packages/site-builder/scripts/__tests__/build-site.test.ts
git commit -m "feat(site-builder): add setupAssets, fix ESM entry point and __dirname"
```

---

## Task 3: Wire `build-site.ts` into package.json dev/build lifecycle

**Files:**
- Modify: `packages/site-builder/package.json`

- [ ] **Step 1: Add `prebuild`, `predev`, and `tsx` devDependency**

In `package.json`, add to `scripts`:

```json
"prebuild": "tsx scripts/build-site.ts",
"predev":   "tsx scripts/build-site.ts",
```

Add to `devDependencies`:

```json
"tsx": "^4.19.0"
```

- [ ] **Step 2: Verify prebuild runs before build**

```bash
cd packages/site-builder
SITE_DOMAIN=coolnews.dev \
NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network \
pnpm build
```

Expected first lines: `[build-site] Building site: coolnews.dev` then the Astro build output. Verify `public/assets` symlink is created and points to the network data path.

- [ ] **Step 3: Commit**

```bash
git add packages/site-builder/package.json
git commit -m "feat(site-builder): wire build-site.ts into prebuild/predev lifecycle"
```

---

## Task 4: Convert platform deploy workflow to manual-only

**Files:**
- Modify: `.github/workflows/deploy-coolnews.yml`

- [ ] **Step 1: Replace push trigger with workflow_dispatch**

Replace the `on:` block:

```yaml
# Before:
on:
  push:
    branches: [main]
  workflow_dispatch:

# After:
on:
  workflow_dispatch:
    inputs:
      reason:
        description: "Reason for rebuild (e.g. site-builder update)"
        required: false
        default: "Manual rebuild"
```

Also update the job name for clarity:

```yaml
jobs:
  deploy:
    name: "Rebuild all sites (manual — ${{ inputs.reason }})"
```

And change the build step to rebuild all sites (not just coolnews.dev). Since we only have coolnews.dev for now, keep `SITE_DOMAIN: coolnews.dev` but add a comment:

```yaml
      # TODO: when more sites exist, loop over all sites/*/
      - name: Build coolnews.dev
```

- [ ] **Step 2: Verify the workflow file is valid YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy-coolnews.yml'))" && echo "Valid"
```

Expected: `Valid`

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/deploy-coolnews.yml
git commit -m "ci: convert deploy-coolnews to manual workflow_dispatch only"
git push origin main
```

---

## Task 5: Create deploy workflow in `atomic-labs-network`

**Files (in `atomic-labs-network` repo):**
- Create: `.github/workflows/deploy.yml`

> ⚠️ Before starting: ensure `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `PLATFORM_REPO_TOKEN` are set in `atomic-labs-network` → Settings → Secrets → Actions.
>
> `PLATFORM_REPO_TOKEN` must be a fine-grained PAT with `Contents: Read` on `atomicfuse/atomic-content-platform`.

- [ ] **Step 1: Create `.github/workflows/` directory in `atomic-labs-network`**

```bash
mkdir -p /path/to/atomic-labs-network/.github/workflows
```

- [ ] **Step 2: Write the workflow file**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy Sites

on:
  push:
    branches: [main]
    paths:
      - "sites/**"
      - "groups/**"
      - "org.yaml"
      - "network.yaml"
  pull_request:
    branches: [main]
    paths:
      - "sites/**"
      - "groups/**"
      - "org.yaml"
      - "network.yaml"
  workflow_dispatch:
    inputs:
      force_all:
        description: "Force rebuild all sites (ignores change detection)"
        type: boolean
        default: false

jobs:
  detect:
    name: Detect changed sites
    runs-on: ubuntu-latest
    outputs:
      sites: ${{ steps.detect.outputs.sites }}
    steps:
      - name: Checkout network data
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Detect which sites need rebuilding
        id: detect
        env:
          EVENT: ${{ github.event_name }}
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.sha }}
          FORCE_ALL: ${{ inputs.force_all }}
        run: |
          set -euo pipefail

          # Determine changed file list
          if [[ "$FORCE_ALL" == "true" ]]; then
            CHANGED="*"
          elif [[ "$EVENT" == "pull_request" ]]; then
            CHANGED=$(git diff --name-only "$BASE_SHA"..."$HEAD_SHA" || echo "*")
          else
            # push to main or workflow_dispatch without force_all
            CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "*")
          fi

          echo "Changed files:"
          echo "$CHANGED"

          SITES_TO_BUILD=()

          for site_dir in sites/*/; do
            [[ -d "$site_dir" ]] || continue
            SITE=$(basename "$site_dir")
            GROUP=$(grep "^group:" "sites/$SITE/site.yaml" 2>/dev/null \
                    | awk '{print $2}' | tr -d '"' || true)

            should_build=false

            # First-commit / force: rebuild everything
            if echo "$CHANGED" | grep -q "^\*$"; then
              should_build=true
            # Site-specific files changed
            elif echo "$CHANGED" | grep -qE "^sites/${SITE}/"; then
              should_build=true
            # Org-level config affects all sites
            elif echo "$CHANGED" | grep -q "^org\.yaml$"; then
              should_build=true
            # Network manifest change
            elif echo "$CHANGED" | grep -q "^network\.yaml$"; then
              should_build=true
            # Group config this site belongs to
            elif [[ -n "$GROUP" ]] && echo "$CHANGED" | grep -q "^groups/${GROUP}\.yaml$"; then
              should_build=true
            fi

            if [[ "$should_build" == "true" ]]; then
              SITES_TO_BUILD+=("$SITE")
              echo "→ Will build: $SITE"
            else
              echo "→ Skipping:   $SITE (no relevant changes)"
            fi
          done

          if [[ ${#SITES_TO_BUILD[@]} -eq 0 ]]; then
            echo "sites=[]" >> "$GITHUB_OUTPUT"
          else
            JSON=$(printf '%s\n' "${SITES_TO_BUILD[@]}" | jq -R . | jq -c -s .)
            echo "sites=$JSON" >> "$GITHUB_OUTPUT"
          fi

  deploy:
    name: Deploy ${{ matrix.site }}
    needs: detect
    if: needs.detect.outputs.sites != '[]' && needs.detect.outputs.sites != ''
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        site: ${{ fromJson(needs.detect.outputs.sites) }}

    steps:
      - name: Checkout network data
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Checkout platform code
        uses: actions/checkout@v4
        with:
          repository: atomicfuse/atomic-content-platform
          path: platform
          token: ${{ secrets.PLATFORM_REPO_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Cache pnpm store
        uses: actions/cache@v4
        with:
          path: ~/.local/share/pnpm/store
          key: ${{ runner.os }}-pnpm-${{ hashFiles('platform/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-

      - name: Install dependencies
        working-directory: platform
        run: pnpm install

      - name: Build shared-types
        working-directory: platform
        run: pnpm --filter @atomic-platform/shared-types build

      - name: Build ${{ matrix.site }}
        working-directory: platform/packages/site-builder
        env:
          SITE_DOMAIN: ${{ matrix.site }}
          NETWORK_DATA_PATH: ${{ github.workspace }}
        run: pnpm build

      - name: Deploy to Cloudflare Pages
        working-directory: platform/packages/site-builder
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          WRANGLER_SEND_METRICS: "false"
        run: |
          PROJECT=$(echo "${{ matrix.site }}" | sed 's/\./-/g')
          BRANCH="${{ github.head_ref || github.ref_name }}"
          echo "Deploying ${{ matrix.site }} → project: $PROJECT, branch: $BRANCH"
          npx wrangler pages deploy dist \
            --project-name="$PROJECT" \
            --branch="$BRANCH"
```

- [ ] **Step 3: Verify YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo "Valid"
```

Expected: `Valid`

- [ ] **Step 4: Commit and push to `atomic-labs-network/main`**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add site deploy workflow (detect changed sites → matrix deploy)"
git push origin main
```

- [ ] **Step 5: Verify workflow triggered**

Go to GitHub → `atomicfuse/atomic-labs-network` → Actions.

The push to main with `network.yaml` or `sites/**` changes will trigger the workflow. If not, manually trigger via "Run workflow" → `force_all: true`.

Check:
- detect job output shows `["coolnews.dev"]`
- deploy job builds and deploys successfully
- Cloudflare dashboard shows a new Production deployment

---

## Task 6: Sync dev branches with main in both repos

After Tasks 1-5 are committed to `main` in `atomic-content-platform`:

- [ ] **Step 1: Push `atomic-content-platform` main and sync dev branches**

```bash
cd atomic-content-platform
git fetch origin main
git push origin main
```

For each dev branch, run this pattern (abort and resolve manually if conflict):
```bash
git checkout michal-dev
git merge origin/main --no-ff -m "Merge main into michal-dev"
# If exit code != 0: git merge --abort, resolve conflicts, then re-run
git push origin michal-dev

git checkout asaf-dev
git merge origin/main --no-ff -m "Merge main into asaf-dev"
# If exit code != 0: git merge --abort, resolve conflicts, then re-run
git push origin asaf-dev

git checkout main
```

- [ ] **Step 2: Sync `atomic-labs-network` dev branches with main**

```bash
cd atomic-labs-network
git fetch origin main
```

For each dev branch, run this pattern (abort and resolve manually if conflict):
```bash
git checkout michal-dev
git merge origin/main --no-ff -m "Merge main into michal-dev"
# If exit code != 0: git merge --abort, resolve conflicts, then re-run
git push origin michal-dev

git checkout asaf-dev
git merge origin/main --no-ff -m "Merge main into asaf-dev"
# If exit code != 0: git merge --abort, resolve conflicts, then re-run
git push origin asaf-dev

git checkout main
```

---

## Task 7: Add Notes.md Q&A section

**Files:**
- Modify: `docs/Notes.md` in `atomic-content-platform`

- [ ] **Step 1: Add Q&A section to Notes.md**

Append to `docs/Notes.md`:

```markdown
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
```

- [ ] **Step 2: Commit and push**

```bash
git add docs/Notes.md
git commit -m "docs: add dev/stage/prod deployment flow Q&A to Notes"
git push origin main
```

---

## Task 8: End-to-end verification

- [ ] **Step 1: Test local dev**

```bash
cd packages/site-builder
SITE_DOMAIN=coolnews.dev \
NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network \
pnpm dev
```

Expected:
- `[build-site] Assets linked: .../public/assets → .../atomic-labs-network/sites/coolnews.dev/assets`
- No 404 errors for `/assets/logo.png` in browser at `localhost:4321`

- [ ] **Step 2: Test stage (PR preview)**

In `atomic-labs-network`:
1. Create a branch: `git checkout -b test-preview`
2. Touch a file: `echo "" >> sites/coolnews.dev/site.yaml`
3. Push and open a PR against `main`
4. Check GitHub Actions → workflow runs → Cloudflare preview URL appears in PR

- [ ] **Step 3: Verify prod deploy on next merge to main**

After any real PR is merged to `atomic-labs-network/main`, check:
- GitHub Actions → Deploy Sites workflow ran
- Cloudflare dashboard shows new Production deployment
- `coolnews-dev.pages.dev` reflects the changes
