# Audit log — site `domain` loses its TLD (`info@buzzsoaps`)

**Date:** 2026-09-03
**Trigger:** "in the terms, privacy, contact pages the email of each website is
info@buzzsoaps instead of a full address like info@buzzsoaps.com — this is on
all websites"

## Symptom

`curl https://buzzsoaps.com/contact` returned
`<p><strong>Email:</strong> info@buzzsoaps</p>`. Same on `/terms` and `/privacy`.
30 of 56 sites affected.

## Root cause — three defects, one symptom

The system conflates two different things: the **siteId** (site folder name, KV
key, R2 prefix — `buzzsoaps`) and the **hostname** (`buzzsoaps.com`). Three
places wrote the former where the latter belonged.

### 1. The CSV importer never stored a real domain

`site-scaffolder.ts:174-177` set `domain: siteId`, where `domainToSiteId()`
deliberately strips the TLD. Every CSV-imported site started life with
`domain: buzzsoaps` in `site.yaml`.

### 2. `seed-kv` trusted it with no guard

`seed-kv.ts` resolves
`support_email = org.support_email_pattern.replaceAll('{{domain}}', config.domain)`
→ `info@buzzsoaps`, then bakes it into the shared-page HTML and writes it to KV.

The Worker already had a guard for exactly this — `getCanonicalDomain()`
(`src/lib/config.ts:79-88`), whose comment reads "handles the common case where
site.yaml has `domain: financenewsbase`". It protects canonical URLs and
`og:url`. Nobody applied the equivalent at seed time, so everything resolved
*before* the request — the support email above all — kept the broken value.
**A symptom patch at one layer left the same bug live at another.**

### 3. MongoDB reverted every manual correction

`upsertSiteConfig(domain, config)` did `$set: { ...config, domain, ... }`, where
`domain` is the *Mongo key* — the siteId. It clobbered `config.domain`.
`getSiteConfig` handed that back, and any dashboard save serialised it into
`site.yaml`.

Evidence: `attachCustomDomain` → `patchSiteConfigDomain` correctly wrote
`domain: buzzsoaps.com` to the staging branch on 2026-05-26 (`014455eff`). On
2026-06-25 `55d15440d site(buzzsoaps): publish staging edits to production`
flipped it back **and reordered every key** — the signature of a re-serialised
config object, not a hand edit. `patchSiteConfigDomain` also never dual-wrote to
Mongo, so Mongo stayed stale and won the next round.

This is the CLAUDE.md "Mongo Dual-Write After Git Mutations" landmine, in a form
the rule as written does not catch: the write *was* mirrored elsewhere, but the
mirror silently rewrote a field.

## Blast radius

- 30 of 56 sites on `main` had a TLD-less `domain:` and a `custom_domain` to fix
  it from. 2 more (`chaibeseret`, `travelingfoodie2`) have no custom domain
  attached yet. 6 `sites/` folders are not in `dashboard-index.yaml` at all.
- Beyond the email, `config.domain` feeds the newsletter forms
  (`Footer.astro:80`, `Sidebar.astro:21`, `[slug]/index.astro:151`).

## Fix

| Layer | Change |
|---|---|
| seed-kv | New `resolveCanonicalDomain()` — site.yaml → `dashboard-index.yaml` `custom_domain` → CLI hostname (preview hosts rejected) → siteId, with a warning on the last |
| importer | New `resolveSiteDomain()` — `site.yaml` gets the real hostname |
| Mongo | `site_domain` field preserves the real hostname across round-trips; `buildSiteConfigDoc`/`restoreSiteConfigDoc` in `lib/db/site-configs.ts`, mirrored in `sync-site-configs` and `backfill-mongo` |
| Mongo | `patchSiteConfigDomain` now dual-writes to Mongo |
| data | `scripts/backfill-site-domains.ts`, dry-run by default |

**The seed-kv fallback alone fixes every live site on the next KV sync** — no
data migration needed. Verified end-to-end: with `site.yaml` still reading
`domain: buzzsoaps`, a real `seed-kv` run (wrangler shimmed so nothing reached
Cloudflare) produced `config.support_email = 'info@buzzsoaps.com'` and
`info@buzzsoaps.com` in the contact, terms and privacy KV payloads.

## Why the backfill does not guess

A naive `siteId + ".com"` would have been wrong for three sites the dry run
surfaced: `decotricksworld → decortricksworld.com` (different spelling),
`giantsavings → giant-savings.co` (hyphen, `.co`), `muvizz → muvizz.com`. The
script only ever copies `custom_domain` from `dashboard-index.yaml`, and skips
sites that have none.

## Tests

Before: 1261 passing (dashboard 313, site-worker 294, content-pipeline 654).
After: **1296 passing** (dashboard 319, site-worker 315, content-pipeline 662).
Delta: **+35** — 11 `resolveCanonicalDomain`, 10 backfill planner, 8 scaffolder,
5 Mongo round-trip, 1 dual-write.

Two existing tests asserted the *buggy* behaviour and were corrected:
`site-scaffolder.test.ts` ("sets domain to the site ID") and
`integration.test.ts` (`expect(siteYaml.domain).toBe("tvshowbox")`).

Full output: `docs/test-results/2026-09-03-site-domain-tld-loss.txt`.

## Not deployed

Code is on `asaf-dev`, untested by Asaf, uncommitted. The Git backfill writes to
the network repo's `main` and every `staging/*` branch and fires production KV
syncs — it needs its own explicit go-ahead, separate from approving the code.

## Reusable lessons

1. **A guard at one layer is not a fix.** `getCanonicalDomain()` masked this for
   months at request time while seed time stayed broken. When you patch around a
   bad value, fix the source or the next consumer inherits it.
2. **A dual-write that rewrites a field is worse than no dual-write.** It looks
   correct, passes review, and silently reverts corrections forever.
3. **Key ≠ value.** Using a natural key (`domain`) that is really a surrogate
   (`siteId`) invites exactly this class of bug.
