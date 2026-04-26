# Audit: Secret-set + PR merges + production deploy.yml regression fix
**Date:** 2026-04-26 07:00–07:30 UTC
**Triggered by:** User: "Cloudflare Workers API token cfut_44hr… added Pull requests: Read and write. Saved" → "go".
**Session type:** DevOps + production hot-fix
**Jira:** None
**Skills used:** `finishing-a-development-branch`, `verification-before-completion`, `dev-audit-trail`.

## Recent context
Continuation of the migration push. Prior session pushed both branches but blocked on (a) PAT lacking secrets:write/pull_requests:write, (b) CF token lacking account scope. User regenerated both. This session executed the rest.

## Goal
1. Set all 5 secrets on the network repo.
2. Verify the new CF token actually has account scope (don't repeat the prior regression).
3. Get sync-kv.yml CI to a green run against real KV.
4. Open + merge both planning PRs.
5. Verify `deploy.yml` (legacy Pages) still works after the CF token rotation.

## Pre-flight
| Check | Result |
|-------|--------|
| `gh auth status` | ✅ authenticated as michal2812 |
| New CF token verify | ✅ active |
| New CF token `/accounts` | ✅ sees Dev1 + Michal (was 0 last time — fixed) |
| New CF token KV access on Dev1 | ✅ 5 namespaces visible incl. CONFIG_KV + CONFIG_KV_STAGING |
| New CF token Pages access on Dev1 | ✅ 2 projects visible (coolnews-atl, scienceworld) |
| PAT has pull_requests:write | ✅ confirmed by successful PR creation |

## What happened

### Secrets ✅ (all 5 set on atomic-labs-network)
Updated via `gh secret set --repo ... <<< '<value>'` (here-string keeps values out of argv). Timestamps all 2026-04-26T06:48:55Z–07:03Z.

| Secret | Source | Note |
|--------|--------|------|
| CLOUDFLARE_ACCOUNT_ID | known | `953511f6356ff606d84ac89bba3eff50` (Dev1) |
| KV_NAMESPACE_ID_STAGING | known | `4673c82cdd7f41d49e93d938fb1c6848` |
| KV_NAMESPACE_ID_PROD | known | `a69cb2c59507482ca5e6d114babdd098` |
| CLOUDFLARE_API_TOKEN | user (NEW token w/ account scope) | overwrote earlier broken token |
| PLATFORM_REPO_TOKEN | user | fine-grained PAT scoped to read atomic-content-platform |

### sync-kv.yml first green run ✅
- Workflow run [#24950493390](https://github.com/atomicfuse/atomic-labs-network/actions/runs/24950493390): 38 s total (Detect 7 s, Sync coolnews-atl 31 s).
- KV verification via direct API call: `sync-status:coolnews-atl` shows `ok:true, syncedAt:2026-04-26T06:49:33Z`.
- One cosmetic miss: `gitSha: "manual-seed"` — the seed-kv.ts script always writes the literal "manual-seed" instead of `$GITHUB_SHA`. **Backlog item** — see `docs/backlog/general.md` "Phase-5 follow-ups".

### Planning PRs ✅ both merged to main
The user merged both manually while I was waiting on tokens (per project policy "never commit directly to main"). Confirmed via `git log origin/main..origin/<branch>` returning empty — branches fully on main. No PR creation needed from the agent.

### Production regression discovered + fixed (3 attempts) ⚠️ → ✅
While checking `deploy.yml`'s health post token rotation, found two **failed** production runs from 2026-04-25 18:01–18:02 UTC:
- [run #24937154896](https://github.com/atomicfuse/atomic-labs-network/actions/runs/24937154896) — `feat(content): add 4 article(s) for scienceworld`
- [run #24937136003](https://github.com/atomicfuse/atomic-labs-network/actions/runs/24937136003) — `feat(content): add 5 article(s) for coolnews-atl`

Cause: after `packages/site-worker` landed on platform `main` (with `wrangler` as a devDep), pnpm's per-package bin layout broke implicit `npx wrangler` lookup from `working-directory: platform/packages/site-builder`. Result: `sh: 1: wrangler: not found` → exit 127.

**The CF token rotation didn't cause this regression — the migration's site-worker package did, and the regression sat undetected for ~36 h until I checked `deploy.yml` health.**

Three fix attempts:
1. ❌ **PR #12** — pin to `npx -y -p wrangler@^4 wrangler`. Still failed `wrangler: not found` (npx with `-p` doesn't put the binary on PATH the way I assumed in the runner's environment).
2. ❌ **PR #13** — switch to `cloudflare/wrangler-action@v3`. Failed because the action runs `npm i wrangler@3.90.0` inside `workingDirectory` (platform/packages/site-builder), and npm chokes on the `"@atomic-platform/shared-types": "workspace:*"` line with `EUNSUPPORTEDPROTOCOL`.
3. ✅ **PR #14** — `npm install --location=global wrangler@^4` in a dedicated step, then `wrangler …` directly. `npm install -g` reads no local `package.json` so workspace specifiers don't matter; the binary lands on PATH. Confirmed working.

After PR #14 merged, dispatched [run #24950762684](https://github.com/atomicfuse/atomic-labs-network/actions/runs/24950762684) with `force_all=true` on main → ✓ Deploy coolnews-atl SUCCESS (muvizz.com failed — unrelated pre-existing content-collection schema bug on a stale legacy site).

### Staging-branch backport ✅
Staging branches still had stale `deploy.yml`. Cherry-picked just the workflow file to both:
- `staging/coolnews-atl` ← `f631ab2`
- `staging/scienceworld` ← `9572c73`

Re-dispatched both. Per-job results:
- staging/coolnews-atl: ✓ Deploy coolnews-atl (5 queued articles published to staging preview)
- staging/scienceworld: ✓ Deploy coolnews-atl + ✓ Deploy scienceworld (4 queued articles published)
- Both: ✗ Deploy muvizz.com (same pre-existing schema bug)

### Verification of yesterday's queued content reaching Pages
- `https://staging-coolnews-atl.coolnews-atl.pages.dev/` returns HTTP 200 with new article titles from the 2026-04-25 publish ("European Best Destinations Names Top 10 Sport Cities", etc.) — sitemap shows 38 URLs.
- `https://coolnews.dev/` (prod) shows older content because new articles live on staging branches; user's normal publish-to-prod flow is staging-branch → main merge.

## Decisions

### Decision 1: don't restore the prior CF token, overwrite with the new one
**Alternatives:**
1. Restore the old CF token value (unknown — couldn't read prior secret).
2. Overwrite with the user's new properly-scoped token.

**Chosen:** 2. **Why:** old value not retrievable; new token has the correct scope (Dev1 account + Workers KV Storage:Edit + Pages access via the Workers template). Once `deploy.yml` was patched, the new token works for both Pages deploys (legacy) and KV writes (new sync-kv).

### Decision 2: 3rd attempt was global npm install, not vendored / pre-built wrangler
**Alternatives:**
1. Add `wrangler` as a devDep to `packages/site-builder/package.json` so it's local.
2. Global install in CI.
3. Pre-build a Docker image with wrangler.
4. Use the official cloudflare/wrangler-action (already failed at attempt #2).

**Chosen:** 2. **Why:** smallest-blast-radius change, doesn't touch the platform repo, doesn't require a new image. `npm install --location=global` is the canonical way to put a CLI on PATH in CI. Dropping it as a devDep on site-builder would also work (and is cleaner long-term) but would require touching the platform repo too — three repo PRs instead of one.

### Decision 3: backport via cherry-pick of the deploy.yml file, not full main → staging merge
**Alternatives:**
1. Merge main into each staging branch.
2. Cherry-pick just `deploy.yml` from main onto each staging.

**Chosen:** 2. **Why:** merging main into staging brings in arbitrary other changes (group config edits, ads-txt updates, etc.) that may not be ready for that staging branch's deploy. Cherry-picking just the workflow file keeps the change focused.

## Testing
- Pre-fix: `wrangler tail` on the staging-Worker confirmed `Astro.locals.runtime.env` removal in Astro 6 (Phase 3 fix from prior session).
- Direct CF API curl: confirmed new CF token sees Dev1 account, lists KV namespaces + Pages projects.
- `gh secret list` after each `set`: confirmed timestamps matched the moment of the set.
- KV API direct GET: `sync-status:coolnews-atl` returns `ok:true` after first successful sync-kv run.
- Real CI run: deploy.yml on main `force_all=true` → coolnews-atl green. Re-runs on staging branches → coolnews-atl + scienceworld green.
- Final HTTP curl: staging Pages URL serves the previously-queued articles + 38 URLs in sitemap.

## Final verification
| Check | Result |
|-------|--------|
| All 5 secrets set on atomic-labs-network | ✅ |
| sync-kv.yml first run green | ✅ |
| Both planning PRs merged to main | ✅ (by user) |
| deploy.yml main run green (coolnews-atl) | ✅ |
| deploy.yml staging/coolnews-atl run green | ✅ |
| deploy.yml staging/scienceworld run green (both sites) | ✅ |
| Staging Pages URL has yesterday's content | ✅ — articles + sitemap confirmed |
| muvizz.com still failing | known pre-existing data issue, unrelated |
| Prod (coolnews.dev) shows latest content | ⏳ pending user staging→main merge |

**Files touched this session:**
- `atomic-labs-network/.github/workflows/deploy.yml` — three iterative fixes; final landed in PR #14 + cherry-picks to both staging branches.
- `atomic-content-platform/docs/audit-logs/2026-04-26-0700-secrets-merges-and-regression-fix.md` — this file (next).
- No platform code changed in this session.

## Post-deploy verification

Already done. Plus the next normal content-pipeline scheduled run will exercise the chain end-to-end without manual intervention — the cron at `0 * * * *` EST will eventually push articles to a staging branch and the now-fixed `deploy.yml` should publish them automatically. **If the next scheduled run shows green in Actions, the regression is fully resolved.**

## CLAUDE.md updates
None this session. The "Known Landmines" section already covers wrangler-related quirks at a high level. The specific gotcha here (pnpm bin layout breaking `npx wrangler` from a sibling workspace package) is captured in the deploy.yml comment at the install step, which is where future maintainers will read it.

## Backlog sync
**New backlog items:**
- `seed-kv.ts` writes `gitSha: "manual-seed"` literally; should read `process.env.GITHUB_SHA` and fall back to "manual-seed" only when unset (file: `packages/site-worker/scripts/seed-kv.ts`, function: `main`).
- `muvizz.com` pre-existing content-collection schema validation failure on `best-sci-fi-movies-2026.md`. Either fix the article frontmatter or remove the directory. Has been failing every deploy.yml run for an unknown duration. Tracked separately from the migration.
- `deploy.yml` matrix-fans out over EVERY `sites/*` dir even on staging-branch runs that should only build their own site. Wasteful + introduces the muvizz.com false-failure on every run. Filter by branch name to fix.

These will be added to `atomic-content-platform/docs/backlog/general.md` in a follow-up commit.

## Session completion checklist
- [x] Audit log created (this file).
- [x] Pre-flight checks recorded.
- [x] Each fix iteration logged with cause + remediation.
- [x] Real CI runs verified for each fix iteration.
- [x] HTTP-level verification of deployed content.
- [x] Decisions captured with alternatives.
- [ ] Backlog synced (pending next commit).
- [x] No CLAUDE.md updates needed (verified specific sections).
