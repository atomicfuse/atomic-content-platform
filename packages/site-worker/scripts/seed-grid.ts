/**
 * Writes Grid data to KV. Never reads or writes any existing key family.
 *   network-directory              ← dashboard-index.yaml + prod site-config:* (REST) — or local KV with --local
 *   grid-summary:<siteId>:<slug>   ← grid-summaries/<siteId>/<slug>.md (changed files, or all with --all-summaries)
 * Env (CI): NETWORK_DATA_PATH, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID_PROD, KV_NAMESPACE_ID_STAGING
 * Env (--local): NETWORK_DATA_PATH, KV_NAMESPACE_ID (default: staging id — matches `pnpm dev:worker`)
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { gridSummaryKey, networkDirectoryKey } from '../src/lib/kv-schema';
import { buildNetworkDirectory, DEV1_SITE_IDS, type IndexSiteEntry, type SiteConfigSummary } from './lib/grid-directory';
import { localConfigReader, restConfigReader, type ConfigReader } from './lib/grid-config-readers';
import { parseSummaryFile } from './lib/grid-summary-html';
import { bulkPut } from './lib/kv-bulk';

const STAGING_DEFAULT = 'f6c35e1fa8c841b8b193509a3a237f7f';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[seed-grid] missing env ${name}`);
  return v;
}

async function listSummaryFiles(root: string): Promise<string[]> {
  const base = join(root, 'grid-summaries');
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const site of await readdir(base, { withFileTypes: true })) {
    if (!site.isDirectory()) continue;
    for (const f of await readdir(join(base, site.name))) if (f.endsWith('.md')) out.push(`grid-summaries/${site.name}/${f}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const local = args.includes('--local');
  const all = args.includes('--all-summaries');
  const changedIdx = args.indexOf('--changed-file');
  const root = requireEnv('NETWORK_DATA_PATH');

  const index = parseYaml(await readFile(join(root, 'dashboard-index.yaml'), 'utf8')) as { sites?: IndexSiteEntry[] };
  const entries = index.sites ?? [];

  const reader: ConfigReader = local
    ? localConfigReader(process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT)
    : restConfigReader(requireEnv('CLOUDFLARE_ACCOUNT_ID'), requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('KV_NAMESPACE_ID_PROD'));
  const configs = new Map<string, SiteConfigSummary | null>();
  for (const e of entries) {
    // Dev1 configs live in another account; they're never sources, so no read is needed.
    configs.set(e.domain, DEV1_SITE_IDS.has(e.domain) ? null : await reader(e.domain));
  }
  const directory = buildNetworkDirectory(entries, configs, new Date());
  const kvEntries = [{ key: networkDirectoryKey(), value: JSON.stringify(directory) }];

  let summaryPaths: string[] = [];
  if (all) summaryPaths = await listSummaryFiles(root);
  else if (changedIdx >= 0 && args[changedIdx + 1]) {
    summaryPaths = (await readFile(args[changedIdx + 1] as string, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean);
  }
  let skipped = 0;
  for (const p of summaryPaths) {
    const abs = join(root, p);
    if (!existsSync(abs)) { skipped++; continue; } // deleted file — pruning is out of scope
    const parsed = parseSummaryFile(relative(root, abs).split('\\').join('/'), await readFile(abs, 'utf8'));
    if (!parsed) { skipped++; console.warn(`[seed-grid] skipping invalid summary file ${p}`); continue; }
    kvEntries.push({ key: gridSummaryKey(parsed.site, parsed.slug), value: JSON.stringify(parsed.record) });
  }

  const targets = local
    ? [process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT]
    : [requireEnv('KV_NAMESPACE_ID_PROD'), requireEnv('KV_NAMESPACE_ID_STAGING')];
  for (const ns of targets) bulkPut(kvEntries, ns, !local);
  console.log(`[seed-grid] directory: ${directory.sites.length} sites; summaries: ${kvEntries.length - 1} written, ${skipped} skipped; targets: ${targets.length}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
