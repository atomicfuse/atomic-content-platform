#!/usr/bin/env tsx
/**
 * Phase 3 manual KV seeder. Reads the network repo on disk and writes to
 * the CONFIG_KV_STAGING namespace via `wrangler kv bulk put`.
 *
 * Usage:
 *   tsx scripts/seed-kv.ts <siteId> [hostname ...]
 *
 * Example:
 *   tsx scripts/seed-kv.ts coolnews-atl coolnews.dev coolnews-atl.pages.dev
 *
 * Env (all optional, sensible defaults):
 *   NETWORK_DATA_PATH    Path to the network repo checkout (default: sibling dir)
 *   KV_NAMESPACE_ID      Target KV namespace id (default: staging)
 *   KV_REMOTE            "true" to write to remote (default). Set "false" for local miniflare.
 *   CLOUDFLARE_ACCOUNT_ID Needed for remote writes.
 *
 * This script is a Phase-3 bootstrap — Phase 5's CI workflow replaces it
 * for ongoing operations. Keeping it around for local testing & recovery.
 */
import { readFile, readdir, writeFile, mkdtemp } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { marked } from 'marked';

import type { ResolvedConfig } from '@atomic-platform/shared-types';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_NETWORK_PATH = join(__dirname, '..', '..', '..', '..', 'atomic-labs-network');

const NETWORK_DATA_PATH = process.env.NETWORK_DATA_PATH ?? DEFAULT_NETWORK_PATH;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID ?? '4673c82cdd7f41d49e93d938fb1c6848';
const KV_REMOTE = (process.env.KV_REMOTE ?? 'true') !== 'false';

// ---------- YAML loaders ----------

async function readYaml<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf-8');
  return parseYaml(raw) as T;
}

/** MVP 2-layer merge (org + site). Phase 5 uses the full 5-layer resolver. */
function mergeConfigs(org: Record<string, unknown>, site: Record<string, unknown>): ResolvedConfig {
  const deep = (a: unknown, b: unknown): unknown => {
    if (b === undefined || b === null) return a;
    if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b) || a === null) {
      return b;
    }
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      out[k] = deep((a as Record<string, unknown>)[k], v);
    }
    return out;
  };
  return deep(org, site) as ResolvedConfig;
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

// ---------- Frontmatter split ----------

function splitFrontmatter(raw: string): { front: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { front: {}, body: raw };
  return { front: (parseYaml(match[1]!) as Record<string, unknown>) ?? {}, body: match[2] ?? '' };
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
      featuredImage: front.featuredImage ? String(front.featuredImage) : undefined,
      tags: Array.isArray(front.tags) ? front.tags.map(String) : [],
      type: (front.type as ArticleIndexEntry['type']) ?? 'standard',
      status: (front.status as ArticleIndexEntry['status']) ?? 'draft',
    };
    const html = marked.parse(body, { async: false }) as string;
    records.push({ frontmatter, body: html });
  }
  records.sort(
    (a, b) => new Date(b.frontmatter.publishDate).getTime() - new Date(a.frontmatter.publishDate).getTime(),
  );
  return records;
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
  if (hostnames.length === 0) {
    console.warn('[seed-kv] No hostnames provided — seeding config + articles only (no site:<host> lookup).');
  }

  // 1. Org config
  const orgPath = join(NETWORK_DATA_PATH, 'org.yaml');
  const org = (await readYaml<Record<string, unknown>>(orgPath)) ?? {};

  // 2. Site config (from the site's staging branch or main). Working-tree only.
  const sitePath = join(NETWORK_DATA_PATH, 'sites', siteId, 'site.yaml');
  const site = (await readYaml<Record<string, unknown>>(sitePath)) ?? {};

  // 3. Merge into ResolvedConfig-ish (MVP 2-layer).
  const merged = mergeConfigs(
    { ...org, theme: defaultTheme() },
    site,
  );
  // Ensure defaults the Worker relies on.
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
    domain: String(site.domain ?? siteId),
    site_name: String(site.site_name ?? siteId),
    site_tagline: site.site_tagline == null ? null : String(site.site_tagline),
    pages_project: String(site.pages_project ?? siteId),
  } as unknown as ResolvedConfig;

  // 4. Articles.
  const articles = await loadArticles(siteId);
  const index: ArticleIndexEntry[] = articles.map((a) => a.frontmatter);

  // 5. Assemble bulk payload.
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
  const status: SyncStatus = { gitSha: 'manual-seed', committedAt: now, syncedAt: now, ok: true };
  entries.push({ key: syncStatusKey(siteId), value: JSON.stringify(status) });

  console.log(`[seed-kv] siteId=${siteId} hostnames=${hostnames.join(',') || '(none)'} articles=${articles.length} entries=${entries.length}`);
  await bulkPut(entries);
  console.log('[seed-kv] done');
}

void main().catch((err) => {
  console.error('[seed-kv] failed:', err);
  process.exit(1);
});
