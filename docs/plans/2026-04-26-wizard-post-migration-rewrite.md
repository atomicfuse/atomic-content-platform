# Wizard Post-Migration Rewrite — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the new-site wizard and supporting actions to work against the post-migration architecture (multi-tenant `atomic-site-worker` Worker + KV + R2; no Cloudflare Pages projects).

**Architecture:** Wizard creates `staging/<slug>` branch → `sync-kv.yml` auto-syncs to staging KV → user previews via `workerPreviewUrl(slug)`. Custom domain attach happens post-staging on `StagingTab`, sets `custom_domain` on `dashboard-index.yaml`. `emit-env-configs.ts` reads dashboard-index at build time and emits one `{ pattern, custom_domain: true }` route per non-null `custom_domain`. Production deploy still manual (`pnpm deploy:production`).

**Tech Stack:** Next.js 15 App Router (dashboard), Astro 6 + Cloudflare Workers (site-worker), Octokit (GitHub API), `yaml` package, vitest.

**Branch:** `feat/wizard-post-migration-rewrite` (off `feat/preview-site-override`).

**Design doc:** `docs/plans/2026-04-26-wizard-post-migration-rewrite-design.md`.

---

## Pre-flight checks (one-time, before Task 1)

Run from `atomic-content-platform/`:

```bash
git branch --show-current   # expect: feat/wizard-post-migration-rewrite
grep -A1 'coolnews\.dev$' /Users/michal/Documents/ATL-content-network/atomic-labs-network/dashboard-index.yaml | head -4
# expect: a line `custom_domain: coolnews.dev` confirming R1 mitigation
```

If `custom_domain: coolnews.dev` is NOT present on the coolnews entry, STOP and add it manually before proceeding (else Task 5's prod build will produce no route for coolnews and the next `pnpm deploy:production` will knock the site offline).

---

## Phase A — emit-env-configs derives routes from dashboard-index (1 commit)

### Task A1: Extract route-derivation helper module

**Files:**
- Create: `packages/site-worker/scripts/lib/load-routes.ts`
- Create: `packages/site-worker/tests/build/load-routes.test.ts`

**Step 1: Write the failing test**

```ts
// packages/site-worker/tests/build/load-routes.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCustomDomains } from '../../scripts/lib/load-routes';

async function withFakeNetwork<T>(yaml: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'atl-load-routes-'));
  await writeFile(join(dir, 'dashboard-index.yaml'), yaml, 'utf-8');
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('loadCustomDomains', () => {
  it('returns one custom-domain route per site with non-null custom_domain', async () => {
    const yaml = `
sites:
  - domain: site-a
    custom_domain: a.example.com
  - domain: site-b
    custom_domain: null
  - domain: site-c
    custom_domain: c.example.com
`;
    await withFakeNetwork(yaml, async (dir) => {
      const routes = await loadCustomDomains(dir);
      expect(routes).toEqual([
        { pattern: 'a.example.com', custom_domain: true },
        { pattern: 'c.example.com', custom_domain: true },
      ]);
    });
  });

  it('returns empty array when no sites have custom_domain', async () => {
    const yaml = `
sites:
  - domain: site-a
    custom_domain: null
`;
    await withFakeNetwork(yaml, async (dir) => {
      expect(await loadCustomDomains(dir)).toEqual([]);
    });
  });

  it('throws when dashboard-index.yaml is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atl-load-routes-empty-'));
    try {
      await expect(loadCustomDomains(dir)).rejects.toThrow(/dashboard-index\.yaml/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips entries in `deleted:` (only `sites:` matter)', async () => {
    const yaml = `
sites:
  - domain: live
    custom_domain: live.example.com
deleted:
  - domain: dead
    custom_domain: dead.example.com
    deleted_at: '2026-01-01T00:00:00Z'
`;
    await withFakeNetwork(yaml, async (dir) => {
      const routes = await loadCustomDomains(dir);
      expect(routes).toEqual([{ pattern: 'live.example.com', custom_domain: true }]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd packages/site-worker
pnpm vitest run tests/build/load-routes.test.ts
```

Expected: FAIL — `loadCustomDomains` not exported (module doesn't exist yet).

**Step 3: Write minimal implementation**

```ts
// packages/site-worker/scripts/lib/load-routes.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface CustomDomainRoute {
  pattern: string;
  custom_domain: true;
}

interface IndexEntry {
  domain: string;
  custom_domain?: string | null;
}

interface DashboardIndex {
  sites?: IndexEntry[];
  deleted?: IndexEntry[];
}

/** Read `<networkPath>/dashboard-index.yaml` and return a route entry for
 *  every active site whose `custom_domain` is set. Used by emit-env-configs.ts
 *  to register Workers Custom Domains at production build time. */
export async function loadCustomDomains(networkPath: string): Promise<CustomDomainRoute[]> {
  const filePath = join(networkPath, 'dashboard-index.yaml');
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read dashboard-index.yaml at ${filePath}: ${(err as Error).message}`);
  }
  const index = parseYaml(raw) as DashboardIndex | null;
  const sites = index?.sites ?? [];
  return sites
    .filter((s): s is IndexEntry & { custom_domain: string } =>
      typeof s.custom_domain === 'string' && s.custom_domain.length > 0,
    )
    .map((s) => ({ pattern: s.custom_domain, custom_domain: true as const }));
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm vitest run tests/build/load-routes.test.ts
```

Expected: 4 tests pass.

**Step 5: Don't commit yet — Task A2 keeps this whole phase atomic.**

---

### Task A2: Wire `loadCustomDomains` into `emit-env-configs.ts`

**Files:**
- Modify: `packages/site-worker/scripts/emit-env-configs.ts`

**Step 1: Update imports + `ENVS` definition**

Replace the hardcoded production routes block with the dynamic load. The change is:

```ts
// Add at the top with other imports:
import { loadCustomDomains } from './lib/load-routes';

// In ENVS, change production.routes from a literal array to a placeholder
// that's populated in main(). Keep staging routes as []:
const ENVS: Record<string, EnvOverrides> = {
  staging: {
    name: 'atomic-site-worker-staging',
    kvNamespaces: { CONFIG_KV: '4673c82cdd7f41d49e93d938fb1c6848' },
    r2Buckets: { ASSET_BUCKET: 'atl-assets-staging' },
    routes: [], // staging is workers.dev-only
  },
  production: {
    name: 'atomic-site-worker',
    kvNamespaces: { CONFIG_KV: 'a69cb2c59507482ca5e6d114babdd098' },
    r2Buckets: { ASSET_BUCKET: 'atl-assets-prod' },
    // Routes are derived from dashboard-index.yaml at build time
    // (see resolveProductionRoutes() below). Hardcoded entries removed
    // post Phase-7/8: the wizard now writes `custom_domain` to the
    // dashboard-index entry; this script picks them up.
    routes: [],
  },
};
```

**Step 2: Add a resolver and call it in `main()`**

```ts
// Above main():
async function resolveProductionRoutes(): Promise<RouteSpec[]> {
  const networkPath = process.env.NETWORK_DATA_PATH;
  if (!networkPath) {
    throw new Error(
      '[emit-env-configs] NETWORK_DATA_PATH must be set for production builds ' +
      '(used to read dashboard-index.yaml and derive custom-domain routes). ' +
      'Set it to the absolute path of an atomic-labs-network checkout.',
    );
  }
  return loadCustomDomains(networkPath);
}

// In main(), before the for-of loop:
ENVS.production.routes = await resolveProductionRoutes();
```

**Step 3: Run the existing build to confirm it still works**

```bash
cd packages/site-worker
NETWORK_DATA_PATH=/Users/michal/Documents/ATL-content-network/atomic-labs-network pnpm build
```

Expected: build succeeds; `[emit-env-configs] production: ... routes=[coolnews.dev]` appears in stdout.

**Step 4: Sanity-check the emitted JSON**

```bash
cat dist/server/wrangler.production.json | python3 -c "import json,sys; print(json.load(sys.stdin)['routes'])"
```

Expected: `[{'pattern': 'coolnews.dev', 'custom_domain': True}]`.

---

### Task A3: Update existing build test to set `NETWORK_DATA_PATH`

**Files:**
- Modify: `packages/site-worker/tests/build/env-configs.test.ts`

**Step 1: Update `beforeAll` to set `NETWORK_DATA_PATH` and use a fixture**

The existing test runs `pnpm build` blind. We make it deterministic by writing a fixture dashboard-index. Replace the `beforeAll` block (lines ~20–39) and add a fixture step:

```ts
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let FIXTURE_NETWORK_DIR: string;

beforeAll(async () => {
  FIXTURE_NETWORK_DIR = await mkdtemp(join(tmpdir(), 'atl-env-configs-'));
  // Mirror the real network's coolnews entry plus a second domain so the
  // multi-domain path is exercised.
  const fixture = `
sites:
  - domain: coolnews-atl
    custom_domain: coolnews.dev
  - domain: science-test
    custom_domain: null
  - domain: example-test
    custom_domain: example.test
`.trimStart();
  await writeFile(join(FIXTURE_NETWORK_DIR, 'dashboard-index.yaml'), fixture, 'utf-8');

  const stagingPath = join(DIST_SERVER, 'wrangler.staging.json');
  // Always rebuild — env-config emit is now a pure function of NETWORK_DATA_PATH
  // contents, and we want our fixture to drive the assertions below.
  execFileSync('pnpm', ['build'], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NETWORK_DATA_PATH: FIXTURE_NETWORK_DIR },
  });
  // Touch keeps the existing freshness comment honest:
  void stagingPath;
});

afterAll(async () => {
  if (FIXTURE_NETWORK_DIR) {
    await rm(FIXTURE_NETWORK_DIR, { recursive: true, force: true });
  }
});
```

Add `afterAll` to imports: `import { describe, expect, it, beforeAll, afterAll } from 'vitest';`

**Step 2: Replace the coolnews-only assertion (around line 91–107)**

```ts
it('production routes are derived from dashboard-index.yaml; staging emits no routes', async () => {
  const staging = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.staging.json'), 'utf-8')) as Record<string, unknown>;
  const prod = JSON.parse(await readFile(join(DIST_SERVER, 'wrangler.production.json'), 'utf-8')) as Record<string, unknown>;

  expect(staging.routes).toEqual([]);

  const prodRoutes = prod.routes as Array<{ pattern: string; custom_domain?: boolean }>;
  expect(prodRoutes).toBeDefined();

  // Both fixtures with custom_domain set → routes; the null one → skipped.
  const patterns = prodRoutes.map((r) => r.pattern).sort();
  expect(patterns).toEqual(['coolnews.dev', 'example.test']);
  for (const r of prodRoutes) {
    expect(r.custom_domain).toBe(true);
  }
});
```

**Step 3: Run the test**

```bash
cd packages/site-worker
pnpm vitest run tests/build/env-configs.test.ts
```

Expected: all tests pass.

**Step 4: Run the full unit suite to be sure**

```bash
pnpm test
```

Expected: all tests pass (this also runs `load-routes.test.ts`).

---

### Task A4: Commit Phase A

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
git add packages/site-worker/scripts/lib/load-routes.ts \
        packages/site-worker/scripts/emit-env-configs.ts \
        packages/site-worker/tests/build/load-routes.test.ts \
        packages/site-worker/tests/build/env-configs.test.ts

git commit -m "$(cat <<'EOF'
feat(site-worker): derive prod custom-domain routes from dashboard-index.yaml

Removes the hardcoded coolnews.dev entry in emit-env-configs. The
production build now reads NETWORK_DATA_PATH/dashboard-index.yaml and
emits one { pattern, custom_domain: true } route per active site whose
custom_domain field is set.

Why: post-migration the wizard writes custom_domain to dashboard-index
on attach. Deriving routes from the same source eliminates per-domain
TS edits + PRs and gives us a single source of truth for which
hostnames the prod worker claims.

Existing build test rewritten to use a fixture network dir, exercising
the multi-domain path. New unit tests for the loadCustomDomains helper
cover the empty, missing-file, and deleted-entry cases.

Production build now requires NETWORK_DATA_PATH (matches seed-kv.ts
convention; clear error if unset).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — AttachDomainPanel + custom-domain actions (1 commit)

### Task B1: Rewrite `attachCustomDomain` and `detachCustomDomain`

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts`

**Step 1: Rewrite both actions**

Replace lines ~480–547 (`attachCustomDomain` through end of `detachCustomDomain`) with:

```ts
/** Attach a custom domain to a site by writing it to dashboard-index.yaml.
 *  Post-migration this is just a data change — the production worker only
 *  picks up the route on the next `pnpm deploy:production` run (which feeds
 *  emit-env-configs.ts). The UI surfaces a "redeploy required" callout to
 *  the operator. Best-effort email-routing setup happens here too since it's
 *  zone-level and unrelated to the legacy Pages flow. */
export async function attachCustomDomain(
  domain: string,
  customDomain: string,
): Promise<{ redeployRequired: true }> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  // Merge a duplicate zone-only entry's zone_id into this site, then drop the dupe.
  const dupeIndex = index.sites.findIndex((s) => s.domain === customDomain);
  if (dupeIndex !== -1) {
    const dupe = index.sites[dupeIndex]!;
    if (dupe.zone_id) site.zone_id = dupe.zone_id;
    index.sites.splice(dupeIndex, 1);
  }

  // Best-effort zone-level setup. Failures here must NOT abort the attach
  // — the data write is the contract; email routing is a nicety.
  if (site.zone_id) {
    try {
      await enableEmailRouting(site.zone_id);
      await createEmailRoutingRule(site.zone_id, customDomain);
    } catch (err) {
      console.error('[attachCustomDomain] email routing setup failed', err);
    }
  }

  site.custom_domain = customDomain;
  site.status = 'Live';
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: attach ${customDomain} to ${domain}`,
  );

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { redeployRequired: true };
}

/** Detach a custom domain from a site (clears the field; reverts status). */
export async function detachCustomDomain(
  domain: string,
): Promise<{ redeployRequired: true }> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.custom_domain) {
    throw new Error(`No custom domain to detach for ${domain}`);
  }

  site.custom_domain = null;
  site.status = 'Ready';
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: detach custom domain from ${domain}`,
  );

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { redeployRequired: true };
}
```

**Step 2: Update `getAvailableZones` (lines ~457–477)**

Drop the `pages_project` filter clause. New body:

```ts
export async function getAvailableZones(): Promise<
  Array<{ domain: string; zoneId: string }>
> {
  const [zones, index] = await Promise.all([
    listZones(),
    readDashboardIndex(),
  ]);

  // Exclude domains already used as a site identifier or already attached
  // as a custom domain.
  const usedAsSite = new Set(index.sites.map((s) => s.domain));
  const usedCustomDomains = new Set(
    index.sites.map((s) => s.custom_domain).filter((d): d is string => Boolean(d)),
  );

  return zones
    .filter((z) => !usedAsSite.has(z.name) && !usedCustomDomains.has(z.name))
    .map((z) => ({ domain: z.name, zoneId: z.id }));
}
```

**Step 3: Drop dead Pages-API imports from the import block at top**

In the `import { ... } from "@/lib/cloudflare"` group, remove these names: `addCustomDomainToProject`, `removeCustomDomainFromProject`, `getPagesProjectDomainsDetailed`. (Keep `listZones`. The other helpers — `createPagesProject`, `listDeployments` — will be removed in subsequent tasks; for now they remain imported but unused, which TS won't error on with our `noUnusedLocals` settings — verify in Step 4.)

**Step 4: Typecheck**

```bash
cd services/dashboard
pnpm typecheck
```

Expected: pass. (If `noUnusedLocals` complains about the still-imported `createPagesProject`/`listDeployments`, comment them out for now — they're deleted in Phase E.)

---

### Task B2: Rewrite `AttachDomainPanel.tsx`

**Files:**
- Modify: `services/dashboard/src/components/site-detail/AttachDomainPanel.tsx`

**Step 1: Rewrite the component**

```tsx
"use client";

import { useState, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { attachCustomDomain, detachCustomDomain, getAvailableZones } from "@/actions/wizard";

interface AttachDomainPanelProps {
  domain: string;
  customDomain: string | null;
}

const REDEPLOY_CMD = "cd packages/site-worker && pnpm deploy:production";

export function AttachDomainPanel({
  domain,
  customDomain,
}: AttachDomainPanelProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [selectedZone, setSelectedZone] = useState("");
  const [zones, setZones] = useState<Array<{ domain: string; zoneId: string }>>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [redeployHint, setRedeployHint] = useState(false);

  useEffect(() => {
    if (customDomain) return;
    setLoadingZones(true);
    getAvailableZones()
      .then(setZones)
      .catch(() => setZones([]))
      .finally(() => setLoadingZones(false));
  }, [customDomain]);

  function handleAttach(): void {
    if (!selectedZone) return;
    startTransition(async () => {
      try {
        await attachCustomDomain(domain, selectedZone);
        setSelectedZone("");
        setRedeployHint(true);
        toast("Custom domain attached", "success");
      } catch {
        toast("Failed to attach domain", "error");
      }
    });
  }

  function handleDetach(): void {
    startTransition(async () => {
      try {
        await detachCustomDomain(domain);
        setRedeployHint(true);
        toast("Custom domain disconnected", "success");
      } catch {
        toast("Failed to disconnect domain", "error");
      }
    });
  }

  function copyCmd(): void {
    void navigator.clipboard.writeText(REDEPLOY_CMD);
    toast("Command copied", "success");
  }

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-3">
      <h3 className="text-sm font-bold text-[var(--text-primary)]">Custom Domain</h3>
      {customDomain ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-[var(--text-primary)]">
              Connected to <span className="font-mono text-cyan">{customDomain}</span>
            </span>
          </div>
          <Button size="sm" variant="danger" loading={isPending} onClick={handleDetach}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <select
            value={selectedZone}
            onChange={(e): void => setSelectedZone(e.target.value)}
            disabled={loadingZones || zones.length === 0}
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-cyan"
          >
            <option value="">
              {loadingZones ? "Loading domains..." : zones.length === 0 ? "No available domains" : "Select a domain"}
            </option>
            {zones.map((z) => (
              <option key={z.zoneId} value={z.domain}>{z.domain}</option>
            ))}
          </select>
          <Button size="sm" loading={isPending} disabled={!selectedZone} onClick={handleAttach}>
            Attach Domain
          </Button>
        </div>
      )}

      {redeployHint && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Domain change saved. The production worker only claims the route on its next deploy.
            Run this from the platform repo:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-primary)] truncate">
              {REDEPLOY_CMD}
            </code>
            <button
              onClick={copyCmd}
              className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-surface)] transition-colors"
              type="button"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Update the caller in `sites/[domain]/page.tsx`**

Find the `<AttachDomainPanel ... />` invocation and remove the `pagesProject` prop:

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
grep -n "AttachDomainPanel" services/dashboard/src/app/sites/\[domain\]/page.tsx
```

Edit that line to drop the `pagesProject={...}` prop. Keep `domain` and `customDomain`.

**Step 3: Typecheck**

```bash
cd services/dashboard
pnpm typecheck
```

Expected: pass.

---

### Task B3: Commit Phase B

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
git add services/dashboard/src/actions/wizard.ts \
        services/dashboard/src/components/site-detail/AttachDomainPanel.tsx \
        services/dashboard/src/app/sites/\[domain\]/page.tsx

git commit -m "$(cat <<'EOF'
feat(dashboard): rewrite custom-domain attach/detach for Worker architecture

attachCustomDomain / detachCustomDomain no longer call the Cloudflare
Pages API (no Pages projects exist post-migration). The actions now
just write custom_domain to dashboard-index.yaml; the production
worker picks up the route on its next pnpm deploy:production run via
emit-env-configs.

AttachDomainPanel surfaces a "redeploy required" callout with the
exact command + copy-to-clipboard. Drops the unused pagesProject prop.

Email-routing setup retained — it's zone-level and unrelated to Pages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Wizard staging flow (1 commit)

### Task C1: Rewrite `createSiteAndBuildStaging`

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts`

**Step 1: Update the import line for `@/lib/cloudflare`**

Remove `createPagesProject` from imports. Keep `listZones`.

**Step 2: Add the `workerPreviewUrl` import**

```ts
import { workerPreviewUrl } from "@/lib/constants";
```

**Step 3: Update the `StagingResult` interface (line ~39–42)**

```ts
interface StagingResult {
  stagingUrl: string;
  /** The network-repo folder name and dashboard-index `domain` for the new site. */
  siteFolder: string;
}
```

**Step 4: Rewrite `createSiteAndBuildStaging` body**

In particular:
- Remove the `cfProject` / `actualProjectName` / `cfSubdomain` block (lines ~271–278).
- Remove the `pages_project: actualProjectName` and `files[0]` regeneration that depends on it.
- Remove the `await triggerWorkflowViaPush(...)` call (line ~299).
- `previewUrl` becomes `workerPreviewUrl(siteFolder)`.
- The new `DashboardSiteEntry` literal sets `pages_project: null`, `pages_subdomain: null`, `zone_id: null`.
- The site.yaml `pages_project` field is removed entirely from `siteConfig` (line ~144).
- The "update existing site" branch in `updateSiteInIndex(...)` drops `pages_project` and `pages_subdomain`.
- Return `{ stagingUrl: previewUrl, siteFolder }`.

Concrete diff for the affected sections:

```ts
// In siteConfig (around line 140), DELETE this line:
//   pages_project: projectName, // placeholder — updated after CF creation
// (no longer written to site.yaml)

// REPLACE the block at ~lines 271–306 (CF Pages creation + URL build) with:
const siteFolder = projectName;  // already in scope; keeping for clarity
const previewUrl = workerPreviewUrl(siteFolder);

// 6. Create staging branch in git
const stagingBranch = `staging/${projectName}`;
await createBranch(stagingBranch);

// 7. Commit site files to the staging branch.
// sync-kv.yml fires automatically on push to `staging/**`, so no
// triggerWorkflowViaPush is needed.
await commitSiteFiles(siteFolder, files, "create site", stagingBranch);

// 8. Create / update dashboard-index entry. Pages-related fields are
// null post-migration (kept on the type for backwards compat).
const now = new Date().toISOString();
const siteEntry: DashboardSiteEntry = {
  domain: siteFolder,
  company: data.company,
  vertical: data.vertical,
  status: "Staging",
  site_id: `${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`,
  exclusivity: null,
  ob_epid: null,
  ga_info: null,
  cf_apo: false,
  fixed_ad: false,
  last_updated: now,
  created_at: now,
  pages_project: null,
  pages_subdomain: null,
  zone_id: null,
  staging_branch: stagingBranch,
  preview_url: previewUrl,
  saved_previews: null,
  custom_domain: null,
};

const index = await readDashboardIndex();
const existing = index.sites.find((s) => s.domain === siteFolder);
if (existing) {
  await updateSiteInIndex(siteFolder, {
    status: "Staging",
    company: data.company,
    vertical: data.vertical,
    staging_branch: stagingBranch,
    preview_url: previewUrl,
  });
} else {
  await addSitesToIndex([siteEntry]);
}

revalidatePath("/");

return { stagingUrl: previewUrl, siteFolder };
```

**Step 5: Drop the `triggerWorkflowViaPush` import if no other caller exists**

```bash
grep -rn 'triggerWorkflowViaPush' services/dashboard/src
```

If only `wizard.ts` imports it AND only the now-deleted call uses it, remove from the import too. Otherwise leave it. (`updateStagingSite`, `uploadStagingLogo`, etc. still use it for staging-branch edit flows — those are correct and stay.)

**Step 6: Typecheck**

```bash
cd services/dashboard
pnpm typecheck
```

Fix any errors before continuing. Most likely: `StepPreview` and `StepGoLive` still reference `result.pagesProject` — fixed in C3/C4.

---

### Task C2: Drop "Domain (optional)" from `StepIdentity.tsx`

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepIdentity.tsx`

**Step 1: Remove the Select for Domain**

Replace the `<div className="grid grid-cols-2 gap-4">` block (lines ~57–74) with just the `<Input label="Site Name" ... />` directly:

```tsx
<Input
  label="Site Name"
  placeholder="Cool News"
  value={data.siteName}
  onChange={(e): void => onChange({ siteName: e.target.value })}
/>
```

**Step 2: Drop the `availableDomains` prop from the interface and unused logic**

Remove `availableDomains: string[];` from `StepIdentityProps`. Remove the `availableDomains` parameter from the function signature. Simplify `handleProjectNameChange` — it no longer needs to track `data.domain`:

```ts
function handleProjectNameChange(value: string): void {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  onChange({ pagesProjectName: sanitized });
}
```

Drop the `import` for `Select` if no longer used in this file (Company still uses Select — keep it). Verify visually.

**Step 3: Typecheck (full pass deferred to C5)**

---

### Task C3: Rewrite `StepPreview.tsx`

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepPreview.tsx`

**Step 1: Update imports + types**

```ts
import { useState, useTransition, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createSiteAndBuildStaging } from "@/actions/wizard";
import type { WizardFormData } from "@/types/dashboard";

interface StagingResult {
  stagingUrl: string;
  siteFolder: string;
}

interface StepPreviewProps {
  data: WizardFormData;
  onNext: () => void;
  onBack: () => void;
  onStagingResult?: (result: StagingResult) => void;
  existingResult?: StagingResult | null;
}
```

**Step 2: Replace `STAGING_STEPS`**

```ts
const STAGING_STEPS = [
  { key: "branch", label: "Creating staging branch on GitHub..." },
  { key: "logo", label: "Generating logo with AI..." },
  { key: "commit", label: "Committing site files..." },
  { key: "kv-sync", label: "Waiting for Worker KV sync (sync-kv.yml)..." },
  { key: "done", label: "Staging site is ready!" },
] as const;
```

**Step 3: Replace the build-readiness poll**

After `setStagingUrl(result.stagingUrl)` and `onStagingResult?.(result)`, replace the `pollUrl` / `setInterval` block with a worker-URL HEAD-poll:

```ts
setWaitingForBuild(true);
setBuildStage("kv-sync");

const pollUrl = result.stagingUrl;
const startedAt = Date.now();
const TIMEOUT_MS = 60_000;

pollRef.current = setInterval(async () => {
  try {
    // HEAD against the worker preview URL — middleware returns 404 until
    // KV has the site:<hostname> entry. Any non-404 response means seeded.
    const res = await fetch(pollUrl, { method: "HEAD", cache: "no-store" });
    if (res.status !== 404) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setWaitingForBuild(false);
      setPreviewUrl(pollUrl);
      toast("Staging site is live!", "success");
      return;
    }
  } catch {
    // network blip — keep polling
  }
  if (Date.now() - startedAt > TIMEOUT_MS) {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setWaitingForBuild(false);
    setPreviewUrl(pollUrl); // surface the link anyway; sync may finish shortly
    toast("Sync taking longer than usual — try the preview link in a moment.", "info");
  }
}, 5000);
```

Drop the dangling `setTimeout(...)` 5-min safety block (the inline timeout above replaces it).

**Step 4: Update the build-stage label map**

```ts
const buildStageLabel: Record<string, string> = {
  "kv-sync": "Worker KV sync running (sync-kv.yml on staging branch)...",
};
```

The Pages-specific labels (queued/initialize/clone_repo/etc.) go away.

**Step 5: Update `handleBuildStaging` step durations**

`stepDurations` had 5 entries (one per Pages step). Now we have 4 active steps (branch/logo/commit/kv-sync) plus done. Use:

```ts
const stepDurations = [1500, 4000, 3000, 8000];
```

(The `kv-sync` step's progress driver gets superseded by the actual poll once `result` arrives.)

**Step 6: Drop `pagesProject` references in JSX**

Search the file for `pagesProject` and remove. Ditto `result.pagesProject`. The "Pages Project" tile in any summary block goes away.

---

### Task C4: Rewrite `StepGoLive.tsx`

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepGoLive.tsx`

**Step 1: Replace the file**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface StepGoLiveProps {
  data: WizardFormData;
  stagingResult: { stagingUrl: string; siteFolder: string } | null;
  onBack: () => void;
}

export function StepGoLive({
  data,
  stagingResult,
  onBack,
}: StepGoLiveProps): React.ReactElement {
  const router = useRouter();

  const siteFolder = stagingResult?.siteFolder ?? data.pagesProjectName;
  const stagingUrl = stagingResult?.stagingUrl ?? null;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Review &amp; Stage</h2>

      <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--text-muted)]">Site Slug</p>
            <p className="font-medium font-mono">{siteFolder}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Site Name</p>
            <p className="font-medium">{data.siteName}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Company</p>
            <p className="font-medium">{data.company}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Vertical</p>
            <p className="font-medium">{data.vertical}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Theme</p>
            <p className="font-medium capitalize">{data.themeBase}</p>
          </div>
          <div>
            <p className="text-[var(--text-muted)]">Articles/Day</p>
            <p className="font-medium">{data.articlesPerDay}</p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-cyan/30 bg-cyan/5 p-4 space-y-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Your site is staged on the multi-tenant Worker.
        </p>
        {stagingUrl && (
          <p className="text-sm text-[var(--text-secondary)]">
            Worker preview:{" "}
            <a
              href={stagingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan underline underline-offset-2"
            >
              {stagingUrl}
            </a>
          </p>
        )}
        <p className="text-xs text-[var(--text-muted)]">
          Open the site detail page to attach a custom domain (optional) and publish to production.
        </p>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={(): void => router.push("/")}>
            Back to Dashboard
          </Button>
          <Button onClick={(): void => router.push(`/sites/${encodeURIComponent(siteFolder)}`)}>
            View Site Details
          </Button>
        </div>
      </div>
    </div>
  );
}
```

---

### Task C5: Update `wizard/page.tsx`

**Files:**
- Modify: `services/dashboard/src/app/wizard/page.tsx`

**Step 1: Drop `availableDomains` state + fetch + prop**

- Remove the `useState<string[]>([])` for `availableDomains` and the `useEffect` that fetches `/api/domains/available`.
- Remove the `availableDomains` prop from the `<StepIdentity ... />` usage.
- Update the `stagingResult` state type:

```ts
const [stagingResult, setStagingResult] = useState<{
  stagingUrl: string;
  siteFolder: string;
} | null>(null);
```

**Step 2: Typecheck**

```bash
cd services/dashboard
pnpm typecheck
```

Expected: pass. Fix any straggler `pagesProject` references that the typechecker flags.

---

### Task C6: Commit Phase C

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
git add services/dashboard/src/actions/wizard.ts \
        services/dashboard/src/app/wizard/page.tsx \
        services/dashboard/src/components/wizard/StepIdentity.tsx \
        services/dashboard/src/components/wizard/StepPreview.tsx \
        services/dashboard/src/components/wizard/StepGoLive.tsx

git commit -m "$(cat <<'EOF'
feat(dashboard): rewrite new-site wizard for post-migration architecture

createSiteAndBuildStaging no longer creates a Cloudflare Pages project
or triggers deploy.yml. It writes the site files to staging/<slug>;
sync-kv.yml fires on push to staging/** and seeds the staging KV. The
preview URL becomes workerPreviewUrl(slug). Pages-specific dashboard-
index fields (pages_project, pages_subdomain, zone_id) are written as
null on new entries.

StepPreview swaps the /api/agent/deployment poll for a HEAD-poll
against the worker URL itself (middleware returns 404 until KV has the
site entry; any non-404 = seeded). 60s soft timeout that surfaces the
link anyway rather than blocking.

StepGoLive is now a clean review screen pointing at the worker preview
URL with a "View Site Details" CTA. The dead Pages-Project tile and
legacy *.pages.dev URL construction are gone.

StepIdentity drops the "Domain (optional)" dropdown — custom-domain
attach is a post-staging concern handled on StagingTab, not in the
wizard. wizard/page.tsx drops the availableDomains fetch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — StagingTab + delete dead helpers (1 commit)

### Task D1: Update `StagingTab.tsx`

**Files:**
- Modify: `services/dashboard/src/components/site-detail/StagingTab.tsx`

**Step 1: Drop refresh button + state**

Remove:
- The `import { ..., refreshPreviewUrl, ... }` reference (delete `refreshPreviewUrl` from the import list).
- The `const [isRefreshing, startRefresh] = useTransition();` line.
- The `handleRefreshPreview` function.
- The `<Button ... onClick={handleRefreshPreview}>Refresh Preview</Button>` element.

**Step 2: Drop unused props from the interface**

Remove `pagesProject` and `pagesSubdomain` from the `StagingTabProps` interface (and the corresponding `void pagesProject; void pagesSubdomain;` lines). The function-signature destructuring drops these too.

**Step 3: Update the caller**

```bash
grep -n "<StagingTab" services/dashboard/src/app/sites/\[domain\]/page.tsx
```

Drop the `pagesProject={...}` and `pagesSubdomain={...}` props from the JSX.

---

### Task D2: Delete `refreshPreviewUrl` action

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts`

**Step 1: Remove the function**

Delete the entire `refreshPreviewUrl(domain)` function (lines ~566–591). Also remove the `listDeployments` import from `@/lib/cloudflare` (no other caller).

**Step 2: Update `ensureStagingBranch`**

Replace the legacy `*.pages.dev` URL construction (lines ~436–445) with `workerPreviewUrl`:

```ts
export async function ensureStagingBranch(domain: string): Promise<string> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  if (site.staging_branch) {
    const exists = await branchExists(site.staging_branch);
    if (exists) return site.staging_branch;
    await createBranch(site.staging_branch, "main");
    return site.staging_branch;
  }

  const stagingBranch = `staging/${domain}`;
  const exists = await branchExists(stagingBranch);
  if (!exists) await createBranch(stagingBranch, "main");

  await updateSiteInIndex(domain, {
    staging_branch: stagingBranch,
    preview_url: workerPreviewUrl(domain),
  });

  revalidatePath(`/sites/${domain}`);
  return stagingBranch;
}
```

**Step 3: Typecheck**

```bash
cd services/dashboard
pnpm typecheck
```

Expected: pass.

---

### Task D3: Commit Phase D

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
git add services/dashboard/src/actions/wizard.ts \
        services/dashboard/src/components/site-detail/StagingTab.tsx \
        services/dashboard/src/app/sites/\[domain\]/page.tsx

git commit -m "$(cat <<'EOF'
refactor(dashboard): remove dead refresh-preview path; drop Pages props from StagingTab

refreshPreviewUrl polled CF Pages deployments; with the worker URL
being a static workerPreviewUrl(siteId) there's nothing to refresh.
Action + Refresh Preview button removed.

ensureStagingBranch no longer constructs *.pages.dev URLs; it writes
workerPreviewUrl(domain) directly.

StagingTab drops its already-unused pagesProject / pagesSubdomain
props (and matching prop drilling on the site detail page).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Cleanup (1 commit)

### Task E1: Delete dead Pages-API helpers from `cloudflare.ts`

**Files:**
- Modify: `services/dashboard/src/lib/cloudflare.ts`

**Step 1: Verify nothing still imports them**

```bash
cd services/dashboard
grep -rn 'createPagesProject\|addCustomDomainToProject\|removeCustomDomainFromProject\|getPagesProjectDomainsDetailed\|listDeployments' src/
```

Expected: only matches inside `src/lib/cloudflare.ts` itself. If any caller remains, fix it before deleting.

**Step 2: Delete the function definitions**

Delete the function bodies for `createPagesProject`, `addCustomDomainToProject`, `removeCustomDomainFromProject`, `getPagesProjectDomainsDetailed`, `listDeployments`. Keep `listZones`, `getAPOStatus`, and any non-Pages helpers. Delete any internal types only used by those functions.

**Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: pass.

---

### Task E2: Update `sync.ts:122–123`

**Files:**
- Modify: `services/dashboard/src/actions/sync.ts`

**Step 1: Set Pages fields to null on synced new entries**

Replace lines 122–124 (`pages_project`, `pages_subdomain`, `zone_id`) with:

```ts
        pages_project: null,
        pages_subdomain: null,
        zone_id: null,
```

The `cfInfo` lookup that produced these is unused for new entries — leave the surrounding sync logic intact (it still reads CF zones to identify domains; we just don't treat the result as a Pages project). If `cfInfo.pagesProject` / `cfInfo.pagesSubdomain` / `cfInfo.zoneId` are now unused, simplify the helper that computed them in a follow-up — out of scope here.

**Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: pass. (`cfInfo` fields may show as unused — that's OK; they're part of an external CF response shape.)

---

### Task E3: Commit Phase E

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
git add services/dashboard/src/lib/cloudflare.ts \
        services/dashboard/src/actions/sync.ts

git commit -m "$(cat <<'EOF'
chore(dashboard): delete dead Pages-API helpers; null Pages fields on synced sites

Removes createPagesProject, addCustomDomainToProject,
removeCustomDomainFromProject, getPagesProjectDomainsDetailed,
listDeployments — none have a caller post-rewrite. listZones and
getAPOStatus retained (used by AttachDomainPanel and CF zone sync).

sync.ts now writes pages_project/pages_subdomain/zone_id as null on
new entries (matches what the wizard does). Existing entries on disk
are not migrated — left as-is, harmless.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Verification

### Task F1: Workspace typecheck + tests

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
pnpm typecheck
pnpm test
```

Expected: both pass.

If typecheck fails: investigate, fix, commit fix on top.

---

### Task F2: End-to-end manual test — no custom domain

Goal: prove the scienceworld-style flow.

1. Start dashboard locally:
   ```bash
   cloudgrid dev   # dashboard → :3001, content-pipeline → :5000
   ```
2. In a browser, go to `http://localhost:3001/wizard` and run the wizard with a throwaway slug, e.g. `wizard-test-{timestamp}`. Skip any optional fields.
3. After staging completes, confirm in another terminal:
   ```bash
   cd /Users/michal/Documents/ATL-content-network/atomic-labs-network
   git fetch
   git ls-remote origin 'staging/wizard-test-*'   # expect the new branch
   git fetch origin main
   git show origin/main:dashboard-index.yaml | grep -A 8 'wizard-test-'
   ```
   Confirm: new entry, `pages_project: null`, `pages_subdomain: null`, `zone_id: null`, `custom_domain: null`, `preview_url` contains `atomic-site-worker-staging` and `?_atl_site=wizard-test-...`.
4. Check the GitHub Actions tab on `atomic-labs-network`: confirm `Sync network data to KV` ran on the new staging branch. Wait for green.
5. Open the worker preview URL in a browser; confirm the site renders with the chosen theme + (placeholder) articles.
6. Back in the dashboard, click "View Site Details" → click Go Live on StagingTab.
7. Confirm `dashboard-index.yaml` on main has `status: Ready` and the entry persists. Confirm `sync-kv.yml` ran on main → prod KV has the entry: open `https://coolnews.dev/?_atl_site=wizard-test-...` (this works because the prod worker honours `?_atl_site=` only on workers.dev — actually expect a 404 there; instead test via the staging worker which does honour the override). For prod KV verification, run `wrangler kv key list --binding CONFIG_KV` against the prod namespace and look for the new `site:` key.

If anything fails, investigate and fix. Commit fixes.

---

### Task F3: End-to-end manual test — with custom domain

Goal: prove the custom-domain path including `pnpm deploy:production` and DNS.

**Pre-req:** a domain you control on the CF dev1 account. Use a throwaway like `wizardtest-{timestamp}.example.com` (replace with a real zone you own).

1. Run wizard for a new site as in F2.
2. After Go Live: on StagingTab, locate `AttachDomainPanel`. Pick the throwaway zone. Click Attach.
3. Confirm:
   - Toast: "Custom domain attached".
   - "Redeploy required" callout shown with the exact `cd packages/site-worker && pnpm deploy:production` command and a Copy button.
   - `git log -1` on `atomic-labs-network/main` shows a "dashboard: attach ..." commit.
   - The dashboard-index entry for the new site has `custom_domain: <your-zone>`, `status: Live`.
4. Run the redeploy:
   ```bash
   cd /Users/michal/Documents/ATL-content-network/atomic-content-platform/packages/site-worker
   NETWORK_DATA_PATH=/Users/michal/Documents/ATL-content-network/atomic-labs-network pnpm deploy:production
   ```
   Confirm in the wrangler output that `routes=[coolnews.dev, <your-zone>]` (or similar) appears.
5. After deploy:
   - `dig <your-zone>` → CF edge IPs.
   - `curl -i https://<your-zone>/` → HTTP 200 with the site's homepage.
6. Back in the dashboard, on StagingTab, click Disconnect on AttachDomainPanel. Confirm the redeploy callout reappears and `dashboard-index.custom_domain` is cleared. (You can skip the actual prod redeploy this time — it's a teardown.)

---

### Task F4: Regression check — coolnews.dev still works

```bash
curl -i https://coolnews.dev/ 2>&1 | head -20
```

Expected: HTTP 200, body looks like Cool News ATL homepage. If the prior deploy in F3 didn't include `coolnews.dev` in the routes, immediately:
- Verify `dashboard-index.yaml` still has `custom_domain: coolnews.dev` for the coolnews-atl entry.
- Re-run `pnpm deploy:production`.

If still broken, this is the Landmine #19 incident — escalate.

---

### Task F5: Open PR (compare URL)

```bash
cd /Users/michal/Documents/ATL-content-network/atomic-content-platform
git push -u origin feat/wizard-post-migration-rewrite
echo "Compare URL:"
echo "https://github.com/atomicfuse/atomic-content-platform/compare/feat/preview-site-override...feat/wizard-post-migration-rewrite"
```

Print the compare URL for the user to open the PR via the web UI (per Landmine #5: `gh pr create` fails due to GITHUB_TOKEN scope).

PR description template (paste into the GitHub UI):

```markdown
## Summary
- Wizard rewritten for post-migration architecture: no Pages API calls; `createSiteAndBuildStaging` writes to `staging/<slug>` and lets `sync-kv.yml` fire automatically.
- Custom-domain attach is a data change on `dashboard-index.yaml`; `emit-env-configs.ts` derives prod routes from the index at build time (hardcoded `coolnews.dev` removed).
- StepGoLive + StagingTab cleaned of Pages remnants; refresh-preview path deleted; dead Pages-API helpers in `cloudflare.ts` removed.

## Design doc
docs/plans/2026-04-26-wizard-post-migration-rewrite-design.md

## Test plan
- [ ] `pnpm test` (site-worker) green
- [ ] `pnpm typecheck` (dashboard + site-worker) green
- [ ] Wizard end-to-end, no custom domain (Task F2)
- [ ] Wizard end-to-end, with custom domain incl. `pnpm deploy:production` (Task F3)
- [ ] coolnews.dev regression (Task F4)
```

---

## Done

The branch is ready for review. After merge: any operator running `pnpm deploy:production` will pick up new custom domains from `dashboard-index.yaml` automatically.
