/**
 * Pure sync logic for Content Aggregator bundles used by Grid sites
 * (spec docs/superpowers/specs/2026-10-07-grid-aggregator-sources-design.md).
 * seed-grid.ts does the I/O; everything here is testable without network or KV.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExternalBundleIndex, ExternalIndexEntry, ExternalStoryRecord } from '@atomic-platform/shared-types';
import { slugifyTopic } from '../../src/lib/grid/normalize';
import { externalIndexKey, externalItemKey } from '../../src/lib/kv-schema';
import { splitFrontmatter } from './resolve';

/** Content Aggregator item fields the sync uses (GET /api/content). */
export interface AggregatorItem {
  id: string;
  url: string;
  title: string;
  description: string | null;
  summary: string | null;
  thumbnail: { url?: string } | null;
  content_type: string;
  language: string;
  source: { name: string };
  author: string | null;
  published_at: string;
  categories?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
}

const INDEX_CAP = 300;
/**
 * "**What It Covers:**" heading in the aggregator's editorial brief. The text may start on the
 * same line (the more common live format) — group 2 keeps it.
 */
const HEADING = /^\s*\*\*([^*]+?):?\*\*:?\s*(.*)$/;

/** "What It Covers" + "Why It Matters Now" from the editorial brief. Every other section is dropped. */
export function parseBriefSections(summary: string | null): { whatItCovers: string; whyItMatters: string } {
  const buf: { whatItCovers: string[]; whyItMatters: string[] } = { whatItCovers: [], whyItMatters: [] };
  if (!summary) return { whatItCovers: '', whyItMatters: '' };
  let current: keyof typeof buf | null = null;
  for (const line of summary.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) {
      const name = heading[1]!.trim().toLowerCase();
      current = /^what it (covers|appears to cover)$/.test(name)
        ? 'whatItCovers'
        : name === 'why it matters now' ? 'whyItMatters' : null;
      const inline = heading[2]!.trim();
      if (current && inline) buf[current].push(inline);
      continue;
    }
    if (current) buf[current].push(line);
  }
  return { whatItCovers: buf.whatItCovers.join('\n').trim(), whyItMatters: buf.whyItMatters.join('\n').trim() };
}

/** URL slug for an external story (the item id is appended separately). */
export function externalSlug(title: string): string {
  const slug = slugifyTopic(title).slice(0, 80).replace(/-+$/, '');
  return slug || 'story';
}

/** Aggregator item → KV record, or null when it isn't eligible (spec D4, D6, D9). */
export function toExternalRecord(item: AggregatorItem, rewritten: ReadonlySet<string>, now: Date): ExternalStoryRecord | null {
  if (item.content_type !== 'article') return null;
  const imageUrl = item.thumbnail?.url?.trim() ?? '';
  if (!imageUrl) return null;
  if ((item.language ?? '').toUpperCase() !== 'EN') return null;
  if (rewritten.has(item.id)) return null;
  const { whatItCovers, whyItMatters } = parseBriefSections(item.summary);
  const description = (item.description ?? '').trim();
  if (!whatItCovers && !description) return null;
  return {
    id: item.id,
    slug: externalSlug(item.title),
    title: item.title.trim(),
    description,
    imageUrl,
    url: item.url,
    sourceName: item.source?.name ?? '',
    author: item.author ?? null,
    publishedAt: item.published_at,
    categories: (item.categories ?? []).map((c) => c.name),
    tags: (item.tags ?? []).map((t) => t.name),
    whatItCovers,
    whyItMatters,
    syncedAt: now.toISOString(),
  };
}

/** Feed fields of a record (one index entry). */
export function toIndexEntry(r: ExternalStoryRecord): ExternalIndexEntry {
  return {
    id: r.id, slug: r.slug, title: r.title, description: r.description,
    imageUrl: r.imageUrl, sourceName: r.sourceName, publishedAt: r.publishedAt,
  };
}

/**
 * Existing index + this run's records → newest first, de-duplicated by id, capped.
 * Never drops entries the aggregator stopped returning (spec D7).
 */
export function mergeBundleIndex(
  existing: ExternalBundleIndex | null,
  bundleId: string,
  name: string,
  records: readonly ExternalStoryRecord[],
  now: Date,
  cap: number = INDEX_CAP,
): ExternalBundleIndex {
  const byId = new Map<string, ExternalIndexEntry>((existing?.items ?? []).map((e) => [e.id, e]));
  for (const r of records) byId.set(r.id, toIndexEntry(r));
  const items = [...byId.values()]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id))
    .slice(0, cap);
  return { bundleId, name: name || existing?.name || bundleId, updatedAt: now.toISOString(), items };
}

/** Unique bundle ids referenced by any Grid site's pills. */
export function collectBundleIds(configs: Iterable<{ grid?: { topics?: Array<{ bundles?: unknown }> } } | null>): string[] {
  const ids = new Set<string>();
  for (const config of configs) {
    for (const topic of config?.grid?.topics ?? []) {
      if (!Array.isArray(topic.bundles)) continue;
      for (const b of topic.bundles) if (typeof b === 'string' && b.trim()) ids.add(b.trim());
    }
  }
  return [...ids];
}

/** Aggregator item ids our network articles were generated from (frontmatter `source_item_id`). */
export function rewrittenIdsFromFrontmatter(frontmatters: Iterable<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const fm of frontmatters) {
    const value = fm.source_item_id;
    if (typeof value === 'string' || typeof value === 'number') ids.add(String(value));
  }
  return ids;
}

/** Frontmatter of every network article for the given domains (repo checkout); missing folders are skipped. */
export async function readNetworkArticleFrontmatter(root: string, domains: readonly string[]): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (const domain of domains) {
    const dir = join(root, 'sites', domain, 'articles');
    if (!existsSync(dir)) continue;
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.md')) continue;
      out.push(splitFrontmatter(await readFile(join(dir, file), 'utf8')).front ?? {});
    }
  }
  return out;
}

/** I/O the bundle sync needs (injected so tests never hit the network or KV). */
export interface BundleSyncDeps {
  fetchItems(bundleId: string): Promise<AggregatorItem[]>;
  readIndex(bundleId: string): Promise<ExternalBundleIndex | null>;
  now(): Date;
}

/** KV entries for every bundle. A failing bundle produces no entries, so its KV stays as it was. */
export async function syncBundles(
  bundleIds: readonly string[],
  names: ReadonlyMap<string, string>,
  rewritten: ReadonlySet<string>,
  deps: BundleSyncDeps,
): Promise<{ entries: Array<{ key: string; value: string }>; failed: string[] }> {
  const entries: Array<{ key: string; value: string }> = [];
  const failed: string[] = [];
  const written = new Set<string>();
  for (const bundleId of bundleIds) {
    try {
      const now = deps.now();
      const records = (await deps.fetchItems(bundleId))
        .map((item) => toExternalRecord(item, rewritten, now))
        .filter((r): r is ExternalStoryRecord => r !== null);
      if (records.length === 0) continue;
      const index = mergeBundleIndex(await deps.readIndex(bundleId), bundleId, names.get(bundleId) ?? '', records, now);
      for (const r of records) {
        if (written.has(r.id)) continue; // same story in two bundles → one record
        written.add(r.id);
        entries.push({ key: externalItemKey(r.id), value: JSON.stringify(r) });
      }
      entries.push({ key: externalIndexKey(bundleId), value: JSON.stringify(index) });
    } catch (err) {
      failed.push(bundleId);
      console.error(`[seed-grid] bundle ${bundleId} skipped:`, err instanceof Error ? err.message : err);
    }
  }
  return { entries, failed };
}

type BundleConfig = { grid?: { topics?: Array<{ bundles?: unknown }> } } | null;

/**
 * Bundle ids from every site's resolved config in BOTH environments — a Grid site that exists only on
 * staging (e.g. a test site) must still get its bundles synced. A failing read is logged and skipped.
 */
export async function bundleIdsFromEnvironments(
  siteIds: readonly string[],
  readers: { prod: (id: string) => Promise<BundleConfig>; staging: (id: string) => Promise<BundleConfig> },
): Promise<string[]> {
  const configs: BundleConfig[] = [];
  for (const id of siteIds) {
    for (const [env, read] of [['prod', readers.prod], ['staging', readers.staging]] as const) {
      try {
        configs.push(await read(id));
      } catch (err) {
        console.warn(`[seed-grid] ${env} config read for bundles failed (${id}):`, err instanceof Error ? err.message : err);
      }
    }
  }
  return collectBundleIds(configs);
}
