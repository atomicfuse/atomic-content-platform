/**
 * Writes Grid data to KV. Never reads or writes any existing key family.
 *   network-directory              ← dashboard-index.yaml + prod site-config:* (REST) — or local KV with --local
 *   grid-summary:<siteId>:<slug>   ← grid-summaries/<siteId>/<slug>.md (changed files, or all with --all-summaries)
 *   grid-ext-item:<itemId>         ← Content Aggregator bundles used by Grid pills (every run)
 *   grid-ext-index:<bundleId>      ← same; merged with the existing index, never pruned
 * Also stores publisher favicons in R2 (aggregator/assets/favicons/<domain>.png, once per domain — see
 * scripts/lib/grid-favicons.ts). Skipped with --local. R2_BUCKET overrides the bucket (default atl-assets-prod).
 * Env (CI): NETWORK_DATA_PATH, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID_PROD, KV_NAMESPACE_ID_STAGING,
 *           CONTENT_API_BASE_URL (aggregator; falls back to CONTENT_AGGREGATOR_URL, then the default)
 * Env (--local): NETWORK_DATA_PATH, KV_NAMESPACE_ID (default: staging id — matches `pnpm dev:worker`)
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { gridSummaryKey, networkDirectoryKey } from '../src/lib/kv-schema';
import { buildNetworkDirectory, DEV1_SITE_IDS, type IndexSiteEntry, type SiteConfigSummary } from './lib/grid-directory';
import { localConfigReader, localIndexReader, restConfigReader, restIndexReader, type ConfigReader } from './lib/grid-config-readers';
import { bundleIdsFromEnvironments, readNetworkArticleFrontmatter, rewrittenIdsFromFrontmatter, syncBundles } from './lib/grid-bundles';
import { aggregatorBase, bundleSyncExitCode, fetchBundleItems, fetchBundleNames } from './lib/aggregator-client';
import { parseSummaryFile } from './lib/grid-summary-html';
import { createFaviconStore, r2FaviconDeps } from './lib/grid-favicons';
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

  // Content Aggregator bundles referenced by any Grid site's pills (spec D8). A failing bundle
  // writes nothing, so its existing KV stays as it was.
  // Prod configs are already loaded for the directory; staging is read too so staging-only Grid
  // sites (test sites) get their bundles synced. Local runs have a single namespace.
  const siteIds = entries.filter((e) => !DEV1_SITE_IDS.has(e.domain)).map((e) => e.domain);
  const bundleIds = await bundleIdsFromEnvironments(siteIds, {
    prod: async (id) => configs.get(id) ?? null,
    staging: local
      ? async () => null
      : restConfigReader(requireEnv('CLOUDFLARE_ACCOUNT_ID'), requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('KV_NAMESPACE_ID_STAGING')),
  });
  if (bundleIds.length > 0) {
    const base = aggregatorBase(process.env);
    const rewritten = rewrittenIdsFromFrontmatter(await readNetworkArticleFrontmatter(root, entries.map((e) => e.domain)));
    const readIndex = local
      ? localIndexReader(process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT)
      : restIndexReader(requireEnv('CLOUDFLARE_ACCOUNT_ID'), requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('KV_NAMESPACE_ID_PROD'));
    const favicons = local
      ? null
      : createFaviconStore(r2FaviconDeps(requireEnv('CLOUDFLARE_ACCOUNT_ID'), requireEnv('CLOUDFLARE_API_TOKEN'), process.env.R2_BUCKET ?? 'atl-assets-prod'));
    const { entries: bundleEntries, failed } = await syncBundles(bundleIds, await fetchBundleNames(base), rewritten, {
      fetchItems: (id) => fetchBundleItems(base, id),
      readIndex,
      now: () => new Date(),
      ...(favicons ? { favicons: (domains: string[]) => favicons.resolve(domains) } : {}),
    });
    // Icons are cosmetic: a failed manifest write only means some domains are re-checked next run.
    await favicons?.save().catch((err: unknown) => console.warn('[seed-grid] favicon manifest not saved:', err instanceof Error ? err.message : err));
    kvEntries.push(...bundleEntries);
    console.log(`[seed-grid] bundles: ${bundleIds.length} (${failed.length} failed), entries: ${bundleEntries.length}`);
    // Directory + summaries are still written below; the exit code just makes a total outage visible in CI.
    process.exitCode = bundleSyncExitCode(bundleIds.length, failed.length);
    if (process.exitCode) console.error('[seed-grid] every bundle failed — check CONTENT_API_BASE_URL / the aggregator');
  }

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
  console.log(`[seed-grid] directory: ${directory.sites.length} sites; kv entries: ${kvEntries.length - 1} written, ${skipped} skipped; targets: ${targets.length}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
