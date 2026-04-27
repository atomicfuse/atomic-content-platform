#!/usr/bin/env tsx
/**
 * Phase-3-and-beyond manual KV seeder.
 *
 * Reads the network repo on disk, resolves the per-site config (org +
 * groups + site, deep-merged), copies the site's assets into the Worker
 * bundle under `<siteId>/assets/`, rewrites image URLs in articles +
 * frontmatter, parses + bundles shared legal pages, and writes the lot
 * to CONFIG_KV_STAGING via `wrangler kv bulk put`.
 *
 * Usage:
 *   tsx scripts/seed-kv.ts <siteId> [hostname ...]
 *
 * Env (all optional):
 *   NETWORK_DATA_PATH    Path to the network repo checkout
 *   KV_NAMESPACE_ID      Target KV namespace id (default: staging)
 *   KV_REMOTE            "true" to write remote (default), "false" for local
 *   CLOUDFLARE_ACCOUNT_ID Required for remote writes.
 *
 * Phase-5 CI runs this same script. Keep the file generic — anything
 * site-specific lives in the network-repo data, not here.
 */
import { readFile, readdir, writeFile, mkdtemp, stat, rm } from 'node:fs/promises';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { marked } from 'marked';

import type { LayoutConfig, ResolvedConfig } from '@atomic-platform/shared-types';
import {
  siteLookupKey,
  siteConfigKey,
  articleIndexKey,
  articleKey,
  syncStatusKey,
  type ArticleIndexEntry,
  type ArticleRecord,
  type SiteLookup,
  type SyncStatus,
} from '../src/lib/kv-schema';
import {
  deepMerge,
  mergeScriptLayers,
  mergeAdPlacementLayers,
  splitFrontmatter,
  rewriteAssetUrls,
  rewriteFrontmatterUrl,
  selectMatchingOverrides,
  stripModeKeys,
  stripOverrideMetaFields,
  type MergeModes,
  type OverrideConfig,
} from './lib/resolve';
import { resolveLayout } from './lib/resolve-layout';
import { parseFeatured } from './lib/parse-featured';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const PLATFORM_ROOT = join(__dirname, '..', '..', '..');
const DEFAULT_NETWORK_PATH = join(PLATFORM_ROOT, '..', 'atomic-labs-network');

const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH ?? DEFAULT_NETWORK_PATH;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID ?? '4673c82cdd7f41d49e93d938fb1c6848';
const KV_REMOTE = (process.env.KV_REMOTE ?? 'true') !== 'false';
/** R2 bucket name for per-site assets. Defaults to staging. Override
 *  with `R2_BUCKET=atl-assets-prod pnpm seed:kv ...` for prod seeding. */
const R2_BUCKET = process.env.R2_BUCKET ?? 'atl-assets-staging';
const R2_REMOTE = (process.env.R2_REMOTE ?? 'true') !== 'false';

/** Bundled shared-page templates. Lived in `packages/site-builder/`
 *  during the migration; moved into site-worker in Phase 8c when the
 *  legacy builder was retired. */
const BUNDLED_SHARED_PAGES_DIR = join(PACKAGE_ROOT, 'shared-pages');

const SHARED_PAGES = ['about', 'contact', 'privacy', 'terms', 'dmca'] as const;
type SharedPageName = typeof SHARED_PAGES[number];

// ---------- YAML / merge helpers ----------

async function readYaml<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return parseYaml(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function defaultTheme(): Record<string, unknown> {
  return {
    base: 'modern',
    logo: null,
    favicon: null,
    fonts: { heading: 'Inter', body: 'Inter' },
    colors: {
      primary: '#0066ff',
      secondary: '#1a1a2e',
      accent: '#00ccff',
      background: '#ffffff',
      text: '#1a1a2e',
      muted: '#6b7280',
      surface: '#f8f9fa',
      border: '#e5e7eb',
    },
  };
}

// ---------- Asset copy ----------

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/** Walks a directory tree calling `cb(absolutePath, relativePath)` for
 *  every file. Used by the R2 uploader. */
async function walkFiles(
  root: string,
  cb: (absPath: string, relPath: string) => Promise<void>,
  prefix = '',
): Promise<number> {
  if (!(await pathExists(root))) return 0;
  let count = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      count += await walkFiles(abs, cb, rel);
    } else if (entry.isFile()) {
      await cb(abs, rel);
      count += 1;
    }
  }
  return count;
}

/** Removes any stale `public/<siteId>/assets/` dir left over from the
 *  pre-R2 bundling era. Idempotent: if the dir doesn't exist, no-op.
 *  Without this, `dist/client/<siteId>/assets/` would still ship in the
 *  Worker bundle on next build, and the build-stability test would flag
 *  it. The canonical asset source is now R2 + the network repo. */
async function removeStalePublicAssetsDir(siteId: string): Promise<void> {
  const stale = join(PACKAGE_ROOT, 'public', siteId);
  if (await pathExists(stale)) {
    await rm(stale, { recursive: true, force: true });
    console.log(`[seed-kv] removed stale public/${siteId}/ (pre-R2 leftover)`);
  }
}

/** Uploads `<NETWORK>/sites/<siteId>/assets/**` to R2 under
 *  `<siteId>/assets/<rel>` keys. Replaces the previous public-bundle
 *  approach; new images now flow live without a Worker redeploy. */
async function uploadAssetsToR2(siteId: string, bucket: string): Promise<number> {
  const src = join(NETWORK_DATA_PATH, 'sites', siteId, 'assets');
  if (!(await pathExists(src))) {
    console.warn(`[seed-kv] No assets dir at ${src} — skipping R2 upload`);
    return 0;
  }
  return walkFiles(src, async (abs, rel) => {
    const key = `${siteId}/assets/${rel}`;
    runWrangler([
      'r2',
      'object',
      'put',
      `${bucket}/${key}`,
      '--file',
      abs,
      R2_REMOTE ? '--remote' : '--local',
    ]);
  });
}

// ---------- Article loading ----------

async function loadArticles(siteId: string): Promise<ArticleRecord[]> {
  const dir = join(NETWORK_DATA_PATH, 'sites', siteId, 'articles');
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    console.warn(`[seed-kv] No articles dir at ${dir} — skipping`);
    return [];
  }

  const records: ArticleRecord[] = [];
  for (const file of files) {
    const raw = await readFile(join(dir, file), 'utf-8');
    const { front, body } = splitFrontmatter(raw);
    const slug = String(front.slug ?? file.replace(/\.md$/, ''));
    const frontmatter: ArticleIndexEntry = {
      slug,
      title: String(front.title ?? slug),
      description: front.description ? String(front.description) : undefined,
      author: String(front.author ?? 'Editorial Team'),
      publishDate: new Date(String(front.publishDate ?? Date.now())).toISOString(),
      featuredImage: rewriteFrontmatterUrl(front.featuredImage ? String(front.featuredImage) : undefined, siteId),
      tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
      type: (front.type as ArticleIndexEntry['type']) ?? 'standard',
      status: (front.status as ArticleIndexEntry['status']) ?? 'draft',
      featured: parseFeatured(front.featured),
    };
    const html = rewriteAssetUrls(marked.parse(body, { async: false }) as string, siteId);
    records.push({ frontmatter, body: html });
  }
  records.sort(
    (a, b) => new Date(b.frontmatter.publishDate).getTime() - new Date(a.frontmatter.publishDate).getTime(),
  );
  return records;
}

// ---------- Shared pages ----------

interface SharedPageRecord {
  slug: SharedPageName;
  title: string;
  html: string;
}

async function loadSharedPage(siteId: string, name: SharedPageName): Promise<SharedPageRecord | null> {
  // Per-site override wins; otherwise bundled template.
  const overridePath = join(NETWORK_DATA_PATH, 'overrides', siteId, `${name}.md`);
  const bundledPath = join(BUNDLED_SHARED_PAGES_DIR, `${name}.md`);
  const usePath = (await pathExists(overridePath)) ? overridePath : bundledPath;
  if (!(await pathExists(usePath))) return null;

  const raw = await readFile(usePath, 'utf-8');
  const { front, body } = splitFrontmatter(raw);
  const html = rewriteAssetUrls(marked.parse(body, { async: false }) as string, siteId);
  return {
    slug: name,
    title: String(front.title ?? name.charAt(0).toUpperCase() + name.slice(1)),
    html,
  };
}

// ---------- Group + site config resolution ----------

async function resolveSiteConfig(siteId: string): Promise<{ config: ResolvedConfig; site: Record<string, unknown> }> {
  const org = (await readYaml<Record<string, unknown>>(join(NETWORK_DATA_PATH, 'org.yaml'))) ?? {};
  const sitePath = join(NETWORK_DATA_PATH, 'sites', siteId, 'site.yaml');
  // Fail hard if the site directory doesn't exist on the current branch
  // checkout. Without this, seed-kv would silently write a stub config
  // (org defaults only) and the Worker would render a blank homepage —
  // which already happened once for scienceworld when this checkout was
  // on `staging/coolnews-atl`. Better to refuse to seed than to corrupt
  // KV. Operator should switch branches (or use a worktree) and retry.
  if (!(await pathExists(sitePath))) {
    throw new Error(
      `[seed-kv] sites/${siteId}/site.yaml not found at ${sitePath}.\n` +
      `  Network repo is at ${NETWORK_DATA_PATH}.\n` +
      `  Is this the right branch checkout? Try \`git worktree add\` for the\n` +
      `  branch that owns sites/${siteId}/ and re-run with NETWORK_DATA_PATH=<that-path>.`,
    );
  }
  const site = (await readYaml<Record<string, unknown>>(sitePath)) ?? {};

  const groups: string[] = Array.isArray(site.groups)
    ? (site.groups as string[])
    : site.group
      ? [String(site.group)]
      : [];

  const layers: Array<Record<string, unknown>> = [{ ...org, theme: { ...defaultTheme(), ...(org.theme as Record<string, unknown> | undefined) } }];

  for (const g of groups) {
    const groupCfg = await readYaml<Record<string, unknown>>(join(NETWORK_DATA_PATH, 'groups', `${g}.yaml`));
    if (groupCfg) {
      layers.push(groupCfg);
      console.log(`[seed-kv]   merged group: ${g}`);
    } else {
      console.warn(`[seed-kv]   group not found: ${g}`);
    }
  }

  // Layer 3: overrides/config — targeted config exceptions (sites in
  // specific groups, or specific sites). Sorted lowest priority first so
  // higher-priority entries apply last.
  const overridesDir = join(NETWORK_DATA_PATH, 'overrides', 'config');
  const overrideFiles: OverrideConfig[] = [];
  if (await pathExists(overridesDir)) {
    const files = (await readdir(overridesDir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    for (const f of files) {
      const cfg = await readYaml<OverrideConfig>(join(overridesDir, f));
      if (cfg) overrideFiles.push(cfg);
    }
  }
  const matchingOverrides = selectMatchingOverrides(overrideFiles, siteId, groups);
  for (const o of matchingOverrides) {
    layers.push(stripModeKeys(o) as Record<string, unknown>);
    console.log(`[seed-kv]   merged override: ${o.override_id ?? '(unnamed)'} (priority ${o.priority ?? 0})`);
  }

  layers.push(site);

  const mergedRaw = layers.reduce((acc, layer) => deepMerge(acc, layer) as Record<string, unknown>, {});

  // --- Per-field merge modes ---
  // The site layer (last) may declare `merge_modes` to control how its
  // values combine with inherited config. Scripts default to merge-by-id;
  // ads_config defaults to add. These post-merge fixups override what
  // the generic deepMerge did for array fields.
  const siteModes = (site.merge_modes ?? {}) as MergeModes;
  mergedRaw.scripts = mergeScriptLayers(layers);
  const mergedPlacements = mergeAdPlacementLayers(layers);
  if (mergedRaw.ads_config && typeof mergedRaw.ads_config === 'object') {
    (mergedRaw.ads_config as Record<string, unknown>).ad_placements = mergedPlacements;
  }

  // scripts_vars: merge (default) or replace
  if (siteModes.scripts_vars === 'replace' && site.scripts_vars) {
    mergedRaw.scripts_vars = site.scripts_vars;
  }

  // tracking: merge (default via deepMerge) or replace
  if (siteModes.tracking === 'replace' && site.tracking) {
    mergedRaw.tracking = site.tracking;
  }

  // ads_txt: add (default) or replace
  if (siteModes.ads_txt !== 'replace') {
    // Additive: collect from all layers, dedup.
    const all: string[] = [];
    for (const layer of layers) {
      const entries = layer.ads_txt;
      if (Array.isArray(entries)) {
        for (const e of entries) if (typeof e === 'string') all.push(e);
      }
    }
    mergedRaw.ads_txt = [...new Set(all)];
  } else if (site.ads_txt) {
    mergedRaw.ads_txt = site.ads_txt;
  }

  // theme: merge (default via deepMerge) or replace
  if (siteModes.theme === 'replace' && site.theme) {
    mergedRaw.theme = site.theme;
  }

  // legal: merge (default via deepMerge) or replace
  if (siteModes.legal === 'replace' && site.legal) {
    mergedRaw.legal = site.legal;
  }

  // Don't persist merge_modes in the resolved KV config — it's a
  // build-time directive, not a runtime value.
  delete mergedRaw.merge_modes;

  // Strip override meta-fields that leaked into the merged result from
  // the override layer (override_id, name, priority, targets).
  const merged = stripOverrideMetaFields(mergedRaw);

  const config: ResolvedConfig = {
    ad_placeholder_heights: {
      'above-content': 90,
      'after-paragraph': 280,
      sidebar: 600,
      'sticky-bottom': 50,
    },
    ads_config: { interstitial: false, layout: 'standard', ad_placements: [] },
    scripts: { head: [], body_start: [], body_end: [] },
    scripts_vars: {},
    ads_txt: [],
    tracking: { ga4: null, gtm: null, google_ads: null, facebook_pixel: null, custom: [] },
    categories: { enabled: false, root_path: '/category' },
    sidebar: { enabled: false, widgets: [] },
    search: { enabled: false },
    preview_page: { enabled: false },
    active: true,
    ...merged,
    layout: resolveLayout(merged.layout as LayoutConfig | undefined),
    theme: {
      ...(merged.theme as Record<string, unknown> | undefined ?? {}),
    } as ResolvedConfig['theme'],
    domain: String(site.domain ?? siteId),
    site_name: String(site.site_name ?? siteId),
    site_tagline: site.site_tagline == null ? null : String(site.site_tagline),
    pages_project: String(site.pages_project ?? siteId),
  } as unknown as ResolvedConfig;

  // Rewrite theme.logo / theme.favicon `/assets/...` paths the same way
  // article URLs are rewritten — the Header/Footer components read these
  // and emit raw <img src=…>. Bare `/assets/logo.png` 404s on the Worker.
  const theme = config.theme as Record<string, unknown> | undefined;
  if (theme) {
    if (typeof theme.logo === 'string') theme.logo = rewriteFrontmatterUrl(theme.logo, siteId);
    if (typeof theme.favicon === 'string') theme.favicon = rewriteFrontmatterUrl(theme.favicon, siteId);
  }

  return { config, site };
}

// ---------- KV write ----------

interface BulkEntry {
  key: string;
  value: string;
}

function runWrangler(args: string[]): void {
  console.log('[seed-kv] wrangler', args.join(' '));
  execFileSync('wrangler', args, { stdio: 'inherit' });
}

async function bulkPut(entries: BulkEntry[]): Promise<void> {
  const tmp = await mkdtemp(join(tmpdir(), 'site-worker-seed-'));
  const path = join(tmp, 'kv-bulk.json');
  await writeFile(path, JSON.stringify(entries), 'utf-8');
  const args = [
    'kv',
    'bulk',
    'put',
    path,
    `--namespace-id=${KV_NAMESPACE_ID}`,
    KV_REMOTE ? '--remote' : '--local',
  ];
  runWrangler(args);
}

// ---------- Main ----------

async function main(): Promise<void> {
  const [siteId, ...hostnames] = process.argv.slice(2);
  if (!siteId) {
    console.error('Usage: tsx scripts/seed-kv.ts <siteId> [hostname ...]');
    process.exit(1);
  }
  console.log(`[seed-kv] siteId=${siteId}, hostnames=${hostnames.join(',') || '(none)'}`);

  // 1. Resolve config
  const { config } = await resolveSiteConfig(siteId);
  const adCount = (config.ads_config?.ad_placements ?? []).length;
  console.log(`[seed-kv] ad_placements resolved: ${adCount}`);

  // 2. Articles
  const articles = await loadArticles(siteId);
  const index: ArticleIndexEntry[] = articles.map((a) => a.frontmatter);
  console.log(`[seed-kv] articles: ${articles.length}`);

  // 3. Shared pages
  const sharedPages: SharedPageRecord[] = [];
  for (const name of SHARED_PAGES) {
    const page = await loadSharedPage(siteId, name);
    if (page) sharedPages.push(page);
  }
  console.log(`[seed-kv] shared pages: ${sharedPages.map((p) => p.slug).join(', ') || '(none)'}`);

  // 4. Assets — upload to R2 under `<siteId>/assets/<rel>`.
  //    The Worker's `/<siteId>/assets/[...path]` route reads from the
  //    R2 binding at request time, so new images flow live within the
  //    cache window WITHOUT a Worker redeploy. Replaces the previous
  //    bundle-into-public/ approach (which required a deploy per asset
  //    change). Also wipes any stale `public/<siteId>/` directory so
  //    re-running on an old checkout cleans the bundle.
  await removeStalePublicAssetsDir(siteId);
  const assetCount = await uploadAssetsToR2(siteId, R2_BUCKET);
  console.log(`[seed-kv] assets: uploaded ${assetCount} files to R2 bucket "${R2_BUCKET}"`);

  // 5. KV bulk payload
  const now = new Date().toISOString();
  const entries: BulkEntry[] = [];

  for (const hostname of hostnames) {
    const lookup: SiteLookup = { siteId };
    entries.push({ key: siteLookupKey(hostname.toLowerCase()), value: JSON.stringify(lookup) });
  }
  entries.push({ key: siteConfigKey(siteId), value: JSON.stringify(config) });
  entries.push({ key: articleIndexKey(siteId), value: JSON.stringify(index) });
  for (const record of articles) {
    entries.push({ key: articleKey(siteId, record.frontmatter.slug), value: JSON.stringify(record) });
  }
  for (const page of sharedPages) {
    entries.push({ key: `shared-page:${siteId}:${page.slug}`, value: JSON.stringify(page) });
  }
  const status: SyncStatus = {
    gitSha: process.env.GITHUB_SHA ?? 'manual-seed',
    committedAt: now,
    syncedAt: now,
    ok: true,
  };
  entries.push({ key: syncStatusKey(siteId), value: JSON.stringify(status) });

  console.log(`[seed-kv] entries=${entries.length} (1 config + ${index.length} articles + ${sharedPages.length} shared pages + ${hostnames.length} hostnames + 1 sync-status)`);
  await bulkPut(entries);
  console.log('[seed-kv] done');
}

void main().catch((err) => {
  console.error('[seed-kv] failed:', err);
  process.exit(1);
});
