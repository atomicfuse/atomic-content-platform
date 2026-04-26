# Design: New-Site Wizard Rewrite for Post-Migration Architecture

Date: 2026-04-26
Branch: `feat/wizard-post-migration-rewrite` (off `feat/preview-site-override`)

## Problem

The Pages → Workers migration is complete (Phase 7/8). All sites are served by the multi-tenant `atomic-site-worker`; per-site config lives in `CONFIG_KV` and assets in R2. There are no Cloudflare Pages projects on the account.

The new-site wizard still assumes the legacy world:

- `services/dashboard/src/actions/wizard.ts` calls `createPagesProject`, `addCustomDomainToProject`, `triggerWorkflowViaPush` (legacy `deploy.yml`), polls for Pages deployment URLs, and stores `pages_project` / `pages_subdomain` in `dashboard-index.yaml`.
- `services/dashboard/src/components/wizard/StepGoLive.tsx:19` constructs `https://staging-${siteSlug}.${pagesProject}.pages.dev` — a hostname that no longer resolves.
- `services/dashboard/src/actions/sync.ts:123` writes `pages_subdomain` on synced new entries.
- `AttachDomainPanel.tsx` calls Pages-API helpers that hit dead Cloudflare endpoints.

These will fail or create dead artifacts. The wizard needs to be rewritten end-to-end against the Worker-based architecture.

## Constraints / Inputs

- `sync-kv.yml` (in the network repo) already triggers on push to both `staging/**` and `main`, so the wizard does not need to "trigger" any deploy — committing to the right branch is enough.
- The platform repo has no CI deploy for `site-worker` on push to main; production rollouts of the worker are run manually via `pnpm deploy:production` from `packages/site-worker` (auto-deploy is a follow-up, out of scope here).
- The Worker preview URL is `https://atomic-site-worker-staging.dev1-953.workers.dev/?_atl_site=<domain>` and is already exposed via `workerPreviewUrl(siteId)` in `services/dashboard/src/lib/constants.ts`.
- `coolnews.dev` is currently routed via the production worker as a Workers Custom Domain (`custom_domain: true` in `emit-env-configs.ts`). Detaching the legacy Pages DNS record was the incident behind Landmine #19 — DNS auto-management is what kept the site recoverable.

## Decisions

### D1. Custom-domain registration mechanism: derive from `dashboard-index.yaml`

Approach **B**. `packages/site-worker/scripts/emit-env-configs.ts` reads `dashboard-index.yaml` at build time and emits one `{ pattern, custom_domain: true }` route per site whose `custom_domain` field is set. The hardcoded `coolnews.dev` entry is removed; coolnews stays routed because its dashboard-index entry has `custom_domain: 'coolnews.dev'` (verified during implementation; if not set, added as a one-line edit).

Rejected:
- **A — auto-PR to `emit-env-configs.ts`**: per-domain code edits forever, requires new GitHub-API plumbing for the platform repo (today the wizard only writes the network repo).
- **C — manual instructions only**: every new custom domain becomes a hand-edit + redeploy.

Trade-off accepted: production deploys still need to be triggered manually after each new custom-domain attach. The dashboard surfaces a "redeploy required" callout. Auto-deploy hook is a follow-up.

### D2. Wizard's terminal step: end at staging, not at Go Live

Approach **β**. The wizard's job is *create + stage*. The final step (`StepGoLive`, retained name for now) is a review screen showing the Worker preview URL and a "View Site Details" CTA. The actual Go Live action stays on `StagingTab.tsx` — which already has it for sites staged earlier and re-visited later. Avoids duplicating Go Live logic between the wizard and the site-detail page.

### D3. Custom-domain entry point: on `StagingTab`, not in the wizard

Approach **c1**. The wizard's `StepIdentity` loses the "Domain (optional)" dropdown. The user attaches a custom domain (or not) post-staging via a rewritten `AttachDomainPanel` on the site-detail page. Single source of truth (`custom_domain` field on the dashboard-index entry); no two-phase pending state; `emit-env-configs.ts` only ever reads sites that have actually gone live.

Rejected:
- **c2 — `pending_custom_domain` field**: adds a new field and a state-promotion step purely to keep the wizard streamlined.
- **c3 — write `custom_domain` immediately on staging**: breaks the invariant that prod-claimed routes correspond to sites whose content is in prod KV.

## End-to-End Flow

```
Wizard
  StepIdentity → StepNicheTargeting → StepGroups → StepTheme →
  StepContentBrief → StepScriptVars → StepPreview → StepGoLive

StepPreview            createSiteAndBuildStaging():
                         - resolve bundle, build site.yaml
                         - generate logo (Gemini, optional)
                         - create staging/<slug> branch in network repo
                         - commit site files (sync-kv.yml fires automatically)
                         - write dashboard-index entry with status=Staging,
                           preview_url = workerPreviewUrl(slug),
                           pages_project=null, pages_subdomain=null,
                           zone_id=null, custom_domain=null
                       (no CF Pages API; no triggerWorkflowViaPush)
                       Poll Worker preview URL until non-404 (or 60s timeout).

StepGoLive             "Your site is staged" review screen
                       - shows worker preview URL
                       - CTA: "View Site Details"

StagingTab             - Worker Preview block (existing)
                       - Edit panel (existing)
                       - AttachDomainPanel (rewritten):
                           pick CF zone → set custom_domain on
                           dashboard-index, show "redeploy required" callout,
                           best-effort enable email routing
                       - Go Live button (existing goLive() action, unchanged)

emit-env-configs.ts    reads dashboard-index.yaml at build time;
                       routes = sites[].custom_domain
                                  → { pattern, custom_domain: true }
                       (hardcoded coolnews.dev removed)

sync.ts:123            stops writing pages_subdomain / pages_project on
                       synced new entries (set null instead).
```

## Component-Level Changes

### `services/dashboard/src/actions/wizard.ts`

- `createSiteAndBuildStaging(data)`:
  - Remove `createPagesProject`.
  - Remove `triggerWorkflowViaPush` (sync-kv.yml fires on push to `staging/**`).
  - Remove `pages_project` from site.yaml (legacy field).
  - `previewUrl = workerPreviewUrl(siteFolder)`.
  - dashboard-index entry: `pages_project: null`, `pages_subdomain: null`, `zone_id: null`, `custom_domain: null`.
  - Return type: `{ stagingUrl: string; siteFolder: string }` (rename `pagesProject` → `siteFolder`).

- `goLive(domain)` — unchanged.

- `publishStagingToProduction(domain)` — unchanged.

- `ensureStagingBranch(domain)`:
  - Drop the `pagesHost` / `*.pages.dev` URL construction.
  - `previewUrl = workerPreviewUrl(domain)`.

- `refreshPreviewUrl(domain)` — **deleted**. Worker URL is static.

- `attachCustomDomain(domain, customDomain)` — rewrite:
  - Drop `addCustomDomainToProject` and `getPagesProjectDomainsDetailed`.
  - Keep: merge duplicate zone entries (existing logic), set `custom_domain` + `status: "Live"`, best-effort `enableEmailRouting` + `createEmailRoutingRule` (zone-level, still relevant).
  - Return `{ redeployRequired: true }` so the UI surfaces the redeploy message.

- `detachCustomDomain(domain)` — rewrite:
  - Drop Pages-API calls.
  - Clear `custom_domain` + revert status to `Ready`.
  - Same `redeployRequired: true` return signal.

- `getAvailableZones()` — keep. Drop the `pages_project` filter clause.

- `saveStagingPreview(domain, url, label)` — unchanged.

### `services/dashboard/src/components/wizard/StepPreview.tsx`

- `STAGING_STEPS` rewritten to: `["Creating staging branch", "Committing site files", "Generating logo", "Waiting for Worker KV sync", "Done"]`.
- Drop the `/api/agent/deployment` poll; replace with HEAD-poll of the worker preview URL every ~5s. Success when status ≠ 404. 60s safety timeout, then fall through to "may take a moment" + manual link (no error).
- Iframe sandbox stays; just sources the worker URL.
- Drop `pagesProject` references; only the slug (`pagesProjectName`) is needed.

### `services/dashboard/src/components/wizard/StepGoLive.tsx`

- Delete the legacy `https://staging-${siteSlug}.${pagesProject}.pages.dev` URL construction.
- Display `stagingResult.stagingUrl` (the worker preview URL) directly.
- Copy: "Your site is staged on the multi-tenant Worker. Visit the site detail page to attach a custom domain (optional) and publish to production."
- Drop the "Pages Project" field from the summary grid.
- Update `stagingResult` prop type: `{ stagingUrl: string; siteFolder: string }`.

### `services/dashboard/src/components/wizard/StepIdentity.tsx`

- Remove the "Domain (optional)" dropdown. `data.domain` is no longer collected by this step (kept on the type for backwards compat or removed in the same patch — decided during impl).

### `services/dashboard/src/app/wizard/page.tsx`

- Drop the `availableDomains` fetch + state (no longer needed by `StepIdentity`).
- `setStagingResult` typed as `{ stagingUrl: string; siteFolder: string } | null`.

### `services/dashboard/src/components/site-detail/AttachDomainPanel.tsx`

- Drop `pagesProject` prop from the interface.
- Same selector UX (pick from `getAvailableZones()`) — but on Attach:
  - Calls rewritten `attachCustomDomain(domain, selectedZone)` (no Pages API).
  - On success, render a yellow callout: *"Domain attached. Run `pnpm deploy:production` from `packages/site-worker` to claim the route on the production worker."* with a copy-to-clipboard button for the command.
- Same callout shows on Detach.

### `services/dashboard/src/components/site-detail/StagingTab.tsx`

- Remove the "Refresh Preview" button + `handleRefreshPreview` + `isRefreshing` state.
- Remove `pagesProject` / `pagesSubdomain` props from the interface (already no-op'd).
- All other behavior unchanged.

### `services/dashboard/src/app/sites/[domain]/page.tsx`

- Stop passing `pagesProject` / `pagesSubdomain` to `StagingTab` and `AttachDomainPanel`.

### `services/dashboard/src/lib/cloudflare.ts`

- Delete: `createPagesProject`, `addCustomDomainToProject`, `removeCustomDomainFromProject`, `getPagesProjectDomainsDetailed`, `listDeployments`.
- Keep: `listZones`, `getAPOStatus`, anything else not Pages-specific.

### `services/dashboard/src/actions/sync.ts`

- Line 122–123: set `pages_project: null`, `pages_subdomain: null` on the new entry. Existing entries on disk are untouched (no migration).

### `packages/site-worker/scripts/emit-env-configs.ts`

- Remove the hardcoded `production.routes: [{ pattern: 'coolnews.dev', custom_domain: true }]`.
- Add `loadCustomDomains(networkPath: string): RouteSpec[]`:
  - Reads `<networkPath>/dashboard-index.yaml`, parses with the `yaml` package.
  - Returns `sites.filter(s => s.custom_domain).map(s => ({ pattern: s.custom_domain, custom_domain: true }))`.
- For `production`, call `loadCustomDomains(process.env.NETWORK_DATA_PATH)` and use the result. Throw a clear error if `NETWORK_DATA_PATH` is unset on a production build.
- For `staging`, routes stay `[]` (intentional — staging is workers.dev only).

### `packages/site-worker/tests/build/env-configs.test.ts`

- Update assertions for the new shape.
- Feed a fake `dashboard-index.yaml` (via temp dir + `NETWORK_DATA_PATH`) with three entries: one with `custom_domain: 'coolnews.dev'`, one with `custom_domain: 'example.test'`, one with `custom_domain: null`.
- Assert: production routes contain both `coolnews.dev` and `example.test` with `custom_domain: true`; the null one is skipped.
- Assert: production build with no `NETWORK_DATA_PATH` throws with a clear message.

## What Stays Unchanged

- `goLive()`, `publishStagingToProduction()`, `saveStagingPreview()`, `saveAllStagingEdits()`, `updateStagingSite()`, `readStagingConfig()`, `generateLogoPreview()`, `uploadStagingLogo()`, `suggestTopics()`, `getFallbackTopics()`, `generateLogoWithGemini()`.
- All other wizard steps (`StepNicheTargeting`, `StepGroups`, `StepTheme`, `StepContentBrief`, `StepScriptVars`).
- `WizardShell.tsx`.
- The `enableEmailRouting` / `createEmailRoutingRule` zone-level helpers.

## Out of Scope

- Auto-deploy of the production worker on push to main (CloudGrid hook or GitHub Actions). Worth doing as a follow-up; not part of this rewrite.
- Migrating existing `dashboard-index.yaml` entries to null out their `pages_project` / `pages_subdomain` / `zone_id` fields. Left as-is — harmless leftover data.
- Removing the `pages_project` / `pages_subdomain` / `zone_id` fields from the `DashboardSiteEntry` TypeScript type. Kept for backwards compat with existing data on disk; can be cleaned up later.
- Replacing `data.domain` on `WizardFormData`. Either kept as a no-op or removed in the same patch — decided during impl.

## Test Plan

### Wizard end-to-end, no custom domain (scienceworld-style)

1. Run wizard with throwaway slug (`science-test`); skip the (now-removed) custom-domain field.
2. Confirm `staging/science-test` branch created on the network repo.
3. Confirm site files committed; `dashboard-index.yaml` has new entry with `pages_project: null`, `pages_subdomain: null`, `zone_id: null`, `custom_domain: null`, `preview_url` matching `workerPreviewUrl('science-test')`.
4. Confirm `sync-kv.yml` ran on the staging branch (GitHub Actions UI).
5. Visit worker preview URL → site renders.
6. On `StagingTab`, click Go Live → merge to main → `sync-kv.yml` runs on main → prod KV gets the entry.
7. Site reachable via worker preview URL; no custom domain claimed (correct — scienceworld-style).

### Wizard end-to-end, with custom domain

1. Run wizard with throwaway slug + a domain you control on the CF account.
2. Same checks 1–5 above, plus:
3. On `StagingTab`, click Go Live → status `Ready`.
4. On rewritten `AttachDomainPanel`, pick the domain → Attach.
5. Confirm `dashboard-index.custom_domain` set on the entry; "redeploy required" callout shown.
6. Run `pnpm deploy:production` from `packages/site-worker`. Confirm logs show the new domain in the routes list.
7. `dig <domain>` → CF edge IPs; `curl https://<domain>/` → site renders.

### `emit-env-configs.ts` unit test

- With fake `dashboard-index.yaml` + `NETWORK_DATA_PATH` set: assert routes for production contain every entry with non-null `custom_domain`, none of those without.
- With `NETWORK_DATA_PATH` unset on a production build: assert clear error.
- Staging routes always `[]`.

### Negative / regression

- Existing entries with populated `pages_project` / `pages_subdomain` / `zone_id` left untouched after a wizard run + Go Live (don't drop the fields from the index file).
- coolnews.dev still gets emitted as a route on production builds (verify its dashboard-index entry has `custom_domain: 'coolnews.dev'` — if not, set it as a one-line edit in the implementation PR).
- coolnews.dev still serves correctly after `pnpm deploy:production`: `curl https://coolnews.dev/` → 200.

## Risks

- **R1 — coolnews.dev temporarily unrouted.** If we deploy production after removing the hardcoded `coolnews.dev` route but before its dashboard-index entry has `custom_domain` set, the route disappears (Landmine #19 territory). Mitigation: verify the entry first; if not set, the same PR adds it. Don't merge until verified.
- **R2 — `NETWORK_DATA_PATH` unset in CI.** A production build that can't find the network repo throws. Mitigation: clear error message; documented in `CLAUDE.md` env-vars table (already there for `seed-kv.ts`).
- **R3 — Worker preview URL polling races KV-sync latency.** KV is eventually consistent (Landmine #17). 60s timeout fall-through with a "may take a moment" message handles the long tail without the wizard blocking forever.

## Follow-ups (not in this PR)

- Auto-deploy production worker on push to main (CI or CloudGrid hook).
- Clean up legacy `pages_project` / `pages_subdomain` / `zone_id` fields from `dashboard-index.yaml` and the `DashboardSiteEntry` type.
- Remove `data.domain` from `WizardFormData` if not kept above.
