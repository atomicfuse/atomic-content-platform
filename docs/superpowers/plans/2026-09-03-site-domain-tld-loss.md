# Plan — Site `domain` loses its TLD

Spec: `docs/superpowers/specs/2026-09-03-site-domain-tld-loss.md`

Order matters: Task 1 alone fixes every live site on the next KV sync. Tasks 2–3 stop
new and existing sites from regressing. Task 4 cleans the stored data.

---

### Task 1: `resolveCanonicalDomain` + seed-kv wiring

Files:
- Modify: `packages/site-worker/scripts/lib/resolve.ts`
- Modify test: `packages/site-worker/scripts/__tests__/resolve.test.ts`
- Modify: `packages/site-worker/scripts/seed-kv.ts`

- [x] Write failing tests for `resolveCanonicalDomain` (4 precedence tiers + preview-host rejection)
- [x] Run test — confirm it fails
- [x] Implement `resolveCanonicalDomain` in `lib/resolve.ts`
- [x] Run test — confirm it passes
- [x] Wire into `seed-kv.ts`: load `dashboard-index.yaml`, thread CLI hostnames into
      `resolveSiteConfig`, replace `domain: String(site.domain ?? siteId)`
- [x] Typecheck + full site-worker suite green

### Task 2: Scaffolder writes the full domain

Files:
- Modify: `services/content-pipeline/src/agents/migration/site-scaffolder.ts`
- Modify test: `services/content-pipeline/src/__tests__/migration/site-scaffolder.test.ts`

- [x] Write failing tests: `buildFullSiteConfig` / `buildSiteYaml` emit `travelbeautytips.com`
- [x] Run test — confirm it fails
- [x] Add `resolveSiteDomain(row)`; use it for the `domain` field in both builders
- [x] Run test — confirm it passes
- [x] Typecheck + full content-pipeline suite green

### Task 3: Mongo stops clobbering `config.domain`

Files:
- Modify: `services/dashboard/src/lib/db/site-configs.ts`
- Modify test: `services/dashboard/src/lib/db/__tests__/site-configs.test.ts`
- Modify: `services/dashboard/src/app/api/agent/sync-site-configs/route.ts`
- Modify: `services/content-pipeline/src/scripts/backfill-mongo.ts`
- Modify: `services/dashboard/src/actions/wizard.ts` (`patchSiteConfigDomain`)
- Modify test: `services/dashboard/src/actions/__tests__/attach-domain.test.ts`

- [x] Write failing tests: round-trip preserves `domain: "example.com"` under key `"example"`
- [x] Run test — confirm it fails
- [x] Add `buildSiteConfigDoc` / `restoreSiteConfigDoc` in `lib/db/site-configs.ts`
- [x] Apply the same shape in `sync-site-configs/route.ts` and `backfill-mongo.ts`
- [x] Add `upsertSiteConfig` dual-write to `patchSiteConfigDomain`
- [x] Run tests — confirm they pass
- [x] Typecheck + full dashboard suite green

### Task 4: Git backfill script (dry-run by default)

Files:
- Create: `packages/site-worker/scripts/backfill-site-domains.ts`
- Create test: `packages/site-worker/scripts/__tests__/backfill-site-domains.test.ts`

- [x] Write failing tests for the pure planning function (which sites need fixing, to what)
- [x] Run test — confirm it fails
- [x] Implement the planner + a `--apply` writer over the local network-repo checkout
- [x] Run test — confirm it passes
- [x] Produce a dry-run report over all 56 sites

### Task 5: QA + handover

- [x] `pnpm typecheck` at repo root
- [x] Full suite with output saved to `docs/test-results/2026-09-03-site-domain-tld-loss.txt`
- [x] State test-count delta
- [ ] **STOP** — Asaf tests locally and approves before any commit, push, or deploy

---

## Deployment sequence (after approval — not part of the code change)

1. Merge to `main`, `cloudgrid plug`.
2. Run the backfill with `--apply` against the network repo (writes `main` + each
   `staging/<site>` branch). This is what triggers the `sync-kv` workflow.
3. Verify `curl https://<site>/contact` for a sample of sites.

Step 2 writes to the network repo's `main` and fires production KV syncs — it needs an
explicit go-ahead, separate from approving the code.


---

## Outcome (2026-09-03)

Tasks 1–4 complete, Task 5 complete except the approval gate.

Tests: 1261 → **1296 passing** (+35). Typecheck 0 errors, build green.
`pnpm lint` in services/dashboard is unconfigured (pre-existing — `next lint`
drops into its setup prompt); `tsc --noEmit` is the enforced static gate.

End-to-end verification: a real `seed-kv` run against an unmodified
`site.yaml` (`domain: buzzsoaps`), with `wrangler` shimmed so nothing reached
Cloudflare, produced `support_email = info@buzzsoaps.com` and the correct
address in the contact/terms/privacy KV payloads. Task 1 alone fixes every
live site.

Backfill dry run over `main`: 56 scanned, 30 fixable, 2 live sites lacking a
custom_domain, 6 orphan folders. `--apply` verified in a throwaway worktree:
30 files, one line changed each, no YAML re-serialisation.

Audit log: `docs/audit-logs/2026-09-03-1720-site-domain-tld-loss.md`.
