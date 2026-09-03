#!/usr/bin/env tsx
/**
 * One-off backfill: give every `sites/<siteId>/site.yaml` its real hostname.
 *
 * CSV-imported sites stored the TLD-stripped siteId in `domain:`, which made
 * seed-kv render `info@buzzsoaps` on every contact/terms/privacy page. The
 * authoritative hostname is `custom_domain` in dashboard-index.yaml.
 *
 * Dry-run by default — prints the plan and exits. Pass `--apply` to write.
 *
 * Usage:
 *   NETWORK_DATA_PATH=~/path/to/atomic-labs-network tsx scripts/backfill-site-domains.ts
 *   NETWORK_DATA_PATH=... tsx scripts/backfill-site-domains.ts --apply
 *
 * Operates on the checkout's CURRENT branch only. Staging branches carry their
 * own copy of site.yaml, and `publishStagingToProduction` copies the staging
 * tree over main — so a main-only fix is reverted by the next publish. Run the
 * script once per branch:
 *
 *   for b in main $(git branch -r --list 'origin/staging/*' | sed 's|origin/||'); do
 *     git checkout "$b" && tsx scripts/backfill-site-domains.ts --apply
 *   done
 *
 * Edits the `domain:` line in place rather than re-serialising the YAML —
 * re-serialisation is what produced the churn that hid this bug for months.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { planDomainBackfill, type BackfillSite } from './lib/backfill-site-domains';

/** A site folder plus whether dashboard-index.yaml knows about it at all. */
type ScannedSite = BackfillSite & { listedInIndex: boolean };

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLATFORM_ROOT = join(__dirname, '..', '..', '..');
const DEFAULT_NETWORK_PATH = join(PLATFORM_ROOT, '..', 'atomic-labs-network');
const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH ?? DEFAULT_NETWORK_PATH;

interface DashboardIndexEntry {
  domain?: string;
  custom_domain?: string | null;
}

async function readYaml<T>(path: string): Promise<T | null> {
  try {
    return parseYaml(await readFile(path, 'utf-8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Collect the current state of every site folder in the checkout. */
async function collectSites(): Promise<ScannedSite[]> {
  const index = await readYaml<{ sites?: DashboardIndexEntry[] }>(
    join(NETWORK_DATA_PATH, 'dashboard-index.yaml'),
  );
  if (!index) {
    throw new Error(
      `[backfill-domains] No dashboard-index.yaml at ${NETWORK_DATA_PATH}. ` +
      `Set NETWORK_DATA_PATH to the network repo checkout.`,
    );
  }
  const indexDomains = new Map<string, string>();
  const listed = new Set<string>();
  for (const entry of index.sites ?? []) {
    if (!entry.domain) continue;
    listed.add(entry.domain);
    if (entry.custom_domain) indexDomains.set(entry.domain, entry.custom_domain);
  }

  const siteDirs = await readdir(join(NETWORK_DATA_PATH, 'sites'), { withFileTypes: true });
  const sites: ScannedSite[] = [];
  for (const dir of siteDirs) {
    if (!dir.isDirectory()) continue;
    const config = await readYaml<{ domain?: string }>(
      join(NETWORK_DATA_PATH, 'sites', dir.name, 'site.yaml'),
    );
    if (!config) continue;
    sites.push({
      siteId: dir.name,
      siteDomain: config.domain,
      indexDomain: indexDomains.get(dir.name),
      listedInIndex: listed.has(dir.name),
    });
  }
  return sites.sort((a, b) => a.siteId.localeCompare(b.siteId));
}

/**
 * Rewrite the top-level `domain:` line, leaving every other byte alone.
 * Returns false when the file has no such line (never seen in practice —
 * reported rather than silently patched, so the operator can look).
 */
function rewriteDomainLine(yaml: string, to: string): string | null {
  const pattern = /^domain:.*$/m;
  if (!pattern.test(yaml)) return null;
  return yaml.replace(pattern, `domain: ${to}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const sites = await collectSites();
  const plan = planDomainBackfill(sites);

  console.log(`[backfill-domains] network repo: ${NETWORK_DATA_PATH}`);
  console.log(`[backfill-domains] ${sites.length} sites scanned, ${plan.length} need fixing\n`);

  if (plan.length === 0) {
    console.log('[backfill-domains] Nothing to do.');
    return;
  }

  for (const edit of plan) {
    console.log(`  ${edit.siteId.padEnd(24)} ${edit.from || '(missing)'} → ${edit.to}`);
  }

  const planned = new Set(plan.map((e) => e.siteId));
  const unfixable = sites.filter((s) => {
    if (planned.has(s.siteId)) return false;
    const current = s.siteDomain?.trim().toLowerCase() ?? '';
    const dot = current.lastIndexOf('.');
    return !(dot > 0 && dot < current.length - 1);
  });

  const needsDomainAttached = unfixable.filter((s) => s.listedInIndex);
  if (needsDomainAttached.length > 0) {
    console.log(
      `\n[backfill-domains] ${needsDomainAttached.length} live site(s) have no custom_domain ` +
      `in dashboard-index.yaml — attach a domain in the dashboard, which also fixes site.yaml:`,
    );
    for (const s of needsDomainAttached) console.log(`  ${s.siteId}`);
  }

  const orphans = unfixable.filter((s) => !s.listedInIndex);
  if (orphans.length > 0) {
    console.log(
      `\n[backfill-domains] ${orphans.length} sites/ folder(s) are not listed in ` +
      `dashboard-index.yaml at all — left alone (stale folders, not live sites):`,
    );
    for (const s of orphans) console.log(`  ${s.siteId}`);
  }

  if (!apply) {
    console.log('\n[backfill-domains] Dry run. Re-run with --apply to write these changes.');
    return;
  }

  let written = 0;
  for (const edit of plan) {
    const path = join(NETWORK_DATA_PATH, 'sites', edit.siteId, 'site.yaml');
    const yaml = await readFile(path, 'utf-8');
    const updated = rewriteDomainLine(yaml, edit.to);
    if (updated === null) {
      console.warn(`[backfill-domains] SKIPPED ${edit.siteId}: no top-level "domain:" line`);
      continue;
    }
    await writeFile(path, updated, 'utf-8');
    written += 1;
  }
  console.log(`\n[backfill-domains] Wrote ${written}/${plan.length} site.yaml files.`);
  console.log('[backfill-domains] Review with `git diff`, then commit and push.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
