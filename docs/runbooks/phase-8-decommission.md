# Runbook — Phase 8: Decommission legacy Pages projects

**Prereqs**
- Phases 6 + 7 done. Both sites stable on Worker for ≥ 14 days.
- Revenue parity confirmed.
- Editorial team using the KV-driven flow; nobody has asked to "go back".

## Step 1 — Disable legacy CI

```bash
cd atomic-labs-network
git checkout main
git checkout -b chore/retire-deploy-workflow

# Two options:
# (a) Rename so it stops triggering, keep history:
git mv .github/workflows/deploy.yml .github/workflows/deploy.yml.disabled

# (b) Or delete outright — history preserved in git:
git rm .github/workflows/deploy.yml

git commit -m "chore(ci): retire legacy Pages deploy workflow (migration Phase 8)"
# Open PR to main.
```

## Step 2 — Delete the Pages projects

```bash
# List for confirmation.
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 wrangler pages project list

# Delete each (irreversible on CF side — but the code + CI can recreate).
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 wrangler pages project delete scienceworld
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 wrangler pages project delete coolnews-atl
```

Verify the Worker still serves both sites after deletion.

## Step 3 — Remove the legacy builder package

```bash
cd atomic-content-platform
git checkout main
git checkout -b chore/remove-site-builder

# Remove the package.
rm -rf packages/site-builder

# Remove it from the workspace install.
pnpm install    # pnpm-lock.yaml updates

# Update CLAUDE.md: drop site-builder references from
# "Layout — Platform Repo", "Tech Stack", "Common Commands", and
# "Known Landmines" sections. Add a one-line pointer to the Phase 8
# commit for anyone grep-ing history.

git add -- packages pnpm-lock.yaml CLAUDE.md
git commit -m "chore: remove legacy site-builder (migration Phase 8)"
```

## Step 4 — Clean up dashboard-index.yaml

Remove fields that only mattered to the Pages deploy flow:

```yaml
# Before
sites:
  - domain: coolnews-atl
    pages_project: coolnews-atl           # delete — no Pages project left
    pages_subdomain: coolnews-atl         # delete
    staging_branch: staging/coolnews-atl  # keep — content branches still used
    preview_url: https://...              # delete — Pages-specific
    worker: atomic-site-worker            # keep
    ...
```

Dashboard code reading those fields: check `services/dashboard/src/lib/github.ts` and adjacent for references; remove where safe.

## Step 5 — CLAUDE.md truthy-up

Three sections will drift after this phase if not updated:
1. **Tech Stack** — drop "Site builder (legacy)" line. Keep only the Workers target.
2. **Common Commands** — remove the `site-builder` commands.
3. **Known Landmines** — remove `.build-trigger` entry; add anything learned during 6/7/8 that's load-bearing (e.g. KV eventual-consistency window, fail-closed middleware, purge classification).

## Verification

- `pnpm typecheck` passes at repo root (no broken imports of `@atomic-platform/site-builder`).
- `pnpm build` for the remaining packages succeeds.
- Both sites render correctly with the deprecated builder deleted.
- `gh workflow list` in the network repo shows only `sync-kv.yml`.

## If something goes wrong

- The Pages project recreation is manual (CF dashboard) but cheap. `deploy.yml` is in git history.
- `packages/site-builder` is in git history at the `main` commit before the Phase 8 removal. `git revert` restores it.
- Keep the branch `docs/astro-workers-migration-plan` around — it contains the full migration story. Tag its tip as `v1-migration-complete` on merge for easy future reference.

## Done when

- Both sites served by Worker; no Pages project exists in the CF account.
- `packages/site-builder` deleted.
- `deploy.yml` removed.
- CLAUDE.md matches reality.
- Team is not asking "what's the site-builder?" — it's gone from mental model, too.
