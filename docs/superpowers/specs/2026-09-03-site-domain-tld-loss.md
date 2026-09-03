# Spec — Site `domain` loses its TLD (`info@buzzsoaps`)

**Date:** 2026-09-03
**Reported by:** Asaf — "terms/privacy/contact pages show `info@buzzsoaps` instead of `info@buzzsoaps.com`, on all websites."

## Goal

Make every site's resolved `domain` the real hostname (`buzzsoaps.com`), so seed-time
values derived from it — `support_email` above all — are correct, and make the
correction stick instead of being reverted by the next dashboard save.

## Root cause (three defects, one symptom)

1. **The CSV importer never stores a real domain.**
   `services/content-pipeline/src/agents/migration/site-scaffolder.ts:174-177` sets
   `domain: siteId`, where `domainToSiteId()` deliberately strips the TLD. Every site
   scaffolded from CSV therefore starts life with `domain: buzzsoaps` in `site.yaml`.

2. **`seed-kv` trusts that value with no guard.**
   `packages/site-worker/scripts/seed-kv.ts:605-618` resolves
   `support_email = org.support_email_pattern.replaceAll('{{domain}}', config.domain)`
   → `info@buzzsoaps`, bakes it into the shared-page HTML via `resolveSharedPageVars`,
   and writes it to KV. The Worker already has a guard for this exact problem for
   canonical URLs (`getCanonicalDomain`, `src/lib/config.ts:79-88`) — the equivalent
   was never applied at seed time.

3. **MongoDB overwrites any manual correction.**
   `upsertSiteConfig(domain, config)` (`services/dashboard/src/lib/db/site-configs.ts:50-62`)
   does `$set: { ...config, domain, ... }`, where `domain` is the *Mongo key* — the
   siteId. It clobbers the config's real `domain`. `getSiteConfig` then hands that
   TLD-less value back, and any dashboard save serialises it into `site.yaml`.

   Evidence: `attachCustomDomain` → `patchSiteConfigDomain` correctly wrote
   `domain: buzzsoaps.com` to the staging branch on 2026-05-26
   (`014455eff`). On 2026-06-25 `55d15440d site(buzzsoaps): publish staging edits to
   production` flipped it back to `domain: buzzsoaps` **and reordered every key** —
   the signature of a re-serialised config object, not a hand edit.
   `patchSiteConfigDomain` also never dual-writes to Mongo, so Mongo stayed stale.

## Blast radius

38 of 56 `sites/*/site.yaml` on the network repo's `main` branch have a TLD-less
`domain:`. The 18 correct ones are sites where `patchSiteConfigDomain` ran and has not
yet been overwritten.

Beyond the email, `config.domain` also feeds the newsletter forms
(`Footer.astro:80`, `Sidebar.astro:21`, `[slug]/index.astro:151`). Canonical URLs and
`og:url` are already protected by `getCanonicalDomain()`.

## Architecture

`dashboard-index.yaml` is the authoritative source for a site's real hostname
(`custom_domain`), and CI already passes it to `seed:kv` as a positional hostname
argument. The fix threads that authority into the two places that currently guess.

## Components

| File | Change |
|---|---|
| `packages/site-worker/scripts/lib/resolve.ts` | **New** pure `resolveCanonicalDomain()` |
| `packages/site-worker/scripts/seed-kv.ts` | Read `dashboard-index.yaml`; use the resolver for `config.domain` |
| `services/content-pipeline/src/agents/migration/site-scaffolder.ts` | **New** `resolveSiteDomain()`; stop writing the siteId as `domain` |
| `services/dashboard/src/lib/db/site-configs.ts` | Preserve the config's real `domain` across Mongo round-trips via `site_domain` |
| `services/dashboard/src/app/api/agent/sync-site-configs/route.ts` | Same preservation |
| `services/content-pipeline/src/scripts/backfill-mongo.ts` | Same preservation |
| `services/dashboard/src/actions/wizard.ts` | `patchSiteConfigDomain` dual-writes to Mongo |
| `packages/site-worker/scripts/backfill-site-domains.ts` | **New** one-off Git backfill, dry-run by default |

## Data flow (after the fix)

```
dashboard-index.yaml (custom_domain)  ─┐
sites/<id>/site.yaml (domain)         ─┼─> resolveCanonicalDomain() ─> config.domain ─> support_email ─> KV
seed:kv CLI hostnames                 ─┘
```

`resolveCanonicalDomain` precedence, first match wins:
1. `site.yaml` `domain` containing a `.`
2. `dashboard-index.yaml` `custom_domain` for that siteId, containing a `.`
3. the first CLI hostname containing a `.` that is not a preview host
   (`*.pages.dev`, `*.workers.dev`)
4. the siteId (current behaviour) — with a `console.warn`

## Why `site_domain` rather than renaming the Mongo key

The `site_configs` collection keys documents on `domain` = siteId, with a unique index,
and three separate writers plus a rename route depend on it. Re-keying to `siteId`
would need an index swap and a data migration across a live production read path.
Storing the real hostname alongside the key in `site_domain`, and restoring it on read,
fixes the clobber with two changed functions and no migration. The key field keeps its
current meaning.

## Error handling

- `resolveCanonicalDomain` never throws; falling through to the siteId preserves today's
  behaviour and warns loudly.
- A missing or unparseable `dashboard-index.yaml` is non-fatal — the resolver skips
  that source (`readYaml` already returns `null` on ENOENT).
- Mongo writes stay soft-fail (`console.warn`, never throw), matching the existing
  contract.
- The backfill script is dry-run by default and requires `--apply`.

## Edge cases

- Site with no custom domain and a bare siteId everywhere → resolver returns the siteId,
  same as today, plus a warning. No regression.
- Preview hostnames (`foo.pages.dev`, `*.workers.dev`) must never win over a real domain.
- `financenewsbase` / `muvizzcom` are Dev1-account sites — the backfill only touches Git,
  so account routing is irrelevant to it.
- Multi-part TLDs (`.co.uk`) — the "contains a dot" test handles them; `domainToSiteId`
  already special-cases them for the siteId.
- A site whose `custom_domain` differs from its siteId stem (e.g. `muvizzcom` →
  `muvizz.com`) must take the `custom_domain`, not a naive `siteId + ".com"`. This is
  why the fix reads the index rather than guessing a TLD.

## Test plan

| Test | File |
|---|---|
| `resolveCanonicalDomain` — all four precedence tiers, preview-host rejection | `packages/site-worker/scripts/__tests__/resolve.test.ts` |
| Scaffolder emits the full domain from `row.domain`, from `row.name`, and falls back to the siteId | `services/content-pipeline/src/__tests__/migration/site-scaffolder.test.ts` |
| `upsertSiteConfig` preserves a real `config.domain`; `getSiteConfig` restores it | `services/dashboard/src/lib/db/__tests__/site-configs.test.ts` |
| `patchSiteConfigDomain` dual-writes to Mongo with the custom domain | `services/dashboard/src/actions/__tests__/attach-domain.test.ts` |

## Out of scope (YAGNI)

- Re-keying `site_configs` on `siteId`.
- Changing `domainToSiteId()` — the siteId derivation is correct and load-bearing
  (KV keys, R2 prefixes, branch names).
- Removing the `getCanonicalDomain()` guard in the Worker — it stays as defence in depth.
- Renaming site folders to match their domains.
