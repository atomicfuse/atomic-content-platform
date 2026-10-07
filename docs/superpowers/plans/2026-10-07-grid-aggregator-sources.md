# Grid Aggregator Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grid sites mix Content Aggregator bundle stories with network stories, with an on-site story page per external story (What It Covers or a short AI summary), leaving network stories and bundle-less Grid sites unchanged.

**Architecture:** An hourly sync (`seed-grid.ts`, run by the network repo's `sync-grid.yml`) copies filtered bundle items into KV (`grid-ext-item:*`, `grid-ext-index:*`). The Grid Worker reads those keys to build a mixed feed and an `/story/aggregator/<slug>-<id>` page. The content-pipeline grid-summaries agent writes AI summaries for external stories (`grid-summaries/aggregator/<id>.md`) and supports per-story pinning. The dashboard edits the new config fields and drives the per-story actions.

**Tech Stack:** TypeScript strict, Astro 6 + Cloudflare Workers (site-worker), Node 22 + vitest (content-pipeline, scripts), Next.js 15 + React Testing Library (dashboard), pnpm/turbo monorepo.

**Spec:** `docs/superpowers/specs/2026-10-07-grid-aggregator-sources-design.md` (decisions D1–D9 referenced below).

## Global Constraints
- External source id is the literal `aggregator` (reserved; no network site may use it).
- KV keys: `grid-ext-item:<itemId>`, `grid-ext-index:<bundleId>`, `grid-summary:aggregator:<itemId>`; only `seed-grid.ts` writes Grid KV keys (CLAUDE.md #34).
- Index cap: 300 entries per bundle, newest first. Never drop entries because the aggregator stopped returning them (D7).
- Defaults: `topics[].bundles: []`, `external_story_mode: "what_it_covers"`, `blocked_sources: []`, `per_bundle_limit: 20` (clamp 1–100).
- Sync keeps only `content_type === "article"`, non-empty `thumbnail.url`, language `EN` (case-insensitive), not already rewritten by a network site (`source_item_id`) (D4, D6, D9).
- External AI summary input: only "What It Covers" (or "What It Appears To Cover") and "Why It Matters Now"; ~120–150 words; one `## ` + 1–3 `### `.
- Aggregator base URL: `CONTENT_API_BASE_URL` first, then `CONTENT_AGGREGATOR_URL`, strip trailing `/api`, append `/api/...` (CLAUDE.md #19/#20).
- Worker runtime defaults must be inline in `src/lib/grid/normalize.ts` (shared-types values can't be imported at build time — see the comment there).
- No commits to `main`; stage specific files only; commit trailer `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`.

## Review Focus
1. **A Grid site with no bundles** must render byte-identical feed HTML and `/api/pool` items to today → regression test in Task 5.
2. **An aggregator outage during sync** must leave existing `grid-ext-*` KV untouched (not empty it) → test in Task 4.
3. **An aggregator summary with odd headings** (missing "What It Covers", "What It Appears To Cover", bold variants, CRLF) must parse or skip, never throw → tests in Task 3.
4. **A shared/old external URL** whose title changed must 301 to the new slug, and a garbage slug must 404 (no KV read for non-hex ids) → tests in Task 7.
5. **Pinned summary on a site whose mode is What It Covers** must show the summary, and unpinning must restore What It Covers without deleting the file → tests in Tasks 6 and 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared-types/src/grid.ts` (modify) | New config fields, external record/index types, pool item `kind`/`sourceName`, summary `pinned` |
| `packages/site-worker/src/lib/kv-schema.ts` (modify) | `externalItemKey`, `externalIndexKey`, `AGGREGATOR_SOURCE_ID` |
| `packages/site-worker/src/lib/grid/normalize.ts` (modify) | Runtime defaults for new fields |
| `packages/site-worker/scripts/lib/resolve-grid.ts` (modify) | `blocked_sources` array-merge semantics |
| `packages/site-worker/scripts/lib/grid-bundles.ts` (create) | Pure sync logic: parse brief sections, filter → record, merge index, collect bundle ids / rewritten ids |
| `packages/site-worker/scripts/lib/aggregator-client.ts` (create) | Fetch bundle items + bundle names from the aggregator |
| `packages/site-worker/scripts/seed-grid.ts` (modify) | Wire bundle sync into the hourly job |
| `packages/site-worker/scripts/lib/grid-summary-html.ts` (modify) | Carry `pinned` into `GridSummaryRecord` |
| `packages/site-worker/src/lib/grid/external.ts` (create) | External slug/path helpers, slug parsing |
| `packages/site-worker/src/lib/grid/sources.ts` (modify) | `resolveBundleSources` |
| `packages/site-worker/src/lib/grid/feed.ts` (modify) | Merge external entries into the pool |
| `packages/site-worker/src/lib/grid/load.ts` (modify) | Read bundle indexes; cache key |
| `packages/site-worker/src/lib/grid/render.ts` (modify) | External card href/source line, image fallback |
| `packages/site-worker/src/lib/grid/story.ts` (modify) | `pinned` handling + `externalStoryText` |
| `packages/site-worker/src/lib/grid/summaries.ts` (modify) | Report `pinned` in summary status |
| `packages/site-worker/src/pages/grid/story/aggregator/[slug].astro` (create) | External story page |
| `services/content-pipeline/src/agents/grid-summaries/{targets,files,prompt,http,index,types}.ts` (modify) | Per-kind targeting, external prompt, pin/unpin |
| `services/content-pipeline/src/agents/content-generation/index.ts` (modify) | `POST /grid-summaries/pin` route |
| `services/dashboard/src/types/grid.ts` (modify) | Mirror types |
| `services/dashboard/src/components/config/grid/{TopicsEditor,GridSettingsForm,GridSettingsSection}.tsx` (modify) | Bundles per pill, new settings |
| `services/dashboard/src/components/config/grid/BlockedSourcesPicker.tsx` (create) | Source multi-select |
| `services/dashboard/src/app/api/aggregator/sources/route.ts` (create) | Proxy aggregator `/api/sources` |
| `services/dashboard/src/app/api/grid/pin/route.ts` (create) | Proxy pin/unpin to pipeline |
| `services/dashboard/src/components/site-detail/grid/{StoriesTable,GridSiteTab}.tsx` (modify) | External badge, Use AI summary / Back to default |
| `services/dashboard/src/components/wizard/StepGridFeed.tsx` (modify) | `isGridFeedReady` accepts bundle-only pills |
| `services/dashboard/public/guide/` Grid page (modify) | "Aggregator bundles" section |
| network repo `.github/workflows/sync-grid.yml` (modify, approval required) | `CONTENT_API_BASE_URL` env |

---

### Task 1: Shared types and KV keys

**Files:**
- Modify: `packages/shared-types/src/grid.ts`
- Modify: `packages/site-worker/src/lib/kv-schema.ts`
- Test: `packages/site-worker/src/lib/__tests__/kv-schema.test.ts`

**Interfaces:**
- Produces (shared-types):
  ```ts
  export type GridExternalStoryMode = "what_it_covers" | "ai_summary";
  // GridTopic: bundles?: string[]; ResolvedGridTopic: bundles: string[]
  // GridConfig: external_story_mode?, blocked_sources?: string[], per_bundle_limit?: number
  // ResolvedGridConfig: external_story_mode: GridExternalStoryMode; blocked_sources: string[]; per_bundle_limit: number
  export interface ExternalStoryRecord { id: string; slug: string; title: string; description: string; imageUrl: string; url: string; sourceName: string; author: string | null; publishedAt: string; categories: string[]; tags: string[]; whatItCovers: string; whyItMatters: string; syncedAt: string }
  export interface ExternalIndexEntry { id: string; slug: string; title: string; description: string; imageUrl: string; sourceName: string; publishedAt: string }
  export interface ExternalBundleIndex { bundleId: string; name: string; updatedAt: string; items: ExternalIndexEntry[] }
  // GridPoolItem: kind?: "network" | "external"; sourceName?: string; summary?: { status; generatedAt?; pinned?: boolean }
  // GridSummaryRecord: pinned?: boolean
  // GridSourceStatus unchanged
  ```
- Produces (kv-schema): `externalItemKey(id: string): string`, `externalIndexKey(bundleId: string): string`, `AGGREGATOR_SOURCE_ID = 'aggregator'`.

- [ ] **Step 1: Write the failing test** (append to `kv-schema.test.ts`)

```ts
import { externalIndexKey, externalItemKey, AGGREGATOR_SOURCE_ID, gridSummaryKey } from '../kv-schema';

describe('external (aggregator) keys', () => {
  it('builds item, index and summary keys', () => {
    expect(externalItemKey('6ac4931364df7692b392bfcb')).toBe('grid-ext-item:6ac4931364df7692b392bfcb');
    expect(externalIndexKey('6ac4c3d064df7692b392c02d')).toBe('grid-ext-index:6ac4c3d064df7692b392c02d');
    expect(gridSummaryKey(AGGREGATOR_SOURCE_ID, 'abc')).toBe('grid-summary:aggregator:abc');
  });
});
```

- [ ] **Step 2: Run** `cd packages/site-worker && npx vitest run src/lib/__tests__/kv-schema.test.ts` — expect FAIL (`externalItemKey` not exported).

- [ ] **Step 3: Implement**

`kv-schema.ts` (after `gridSummaryKey`):
```ts
/** Grid: source id used for Content Aggregator stories (reserved — no network site may use it). */
export const AGGREGATOR_SOURCE_ID = 'aggregator';
/** Grid: one aggregator story, permanent (written by scripts/seed-grid.ts). */
export const externalItemKey = (itemId: string): string => `grid-ext-item:${itemId}`;
/** Grid: a bundle's newest stories, max 300 (written by scripts/seed-grid.ts). */
export const externalIndexKey = (bundleId: string): string => `grid-ext-index:${bundleId}`;
```

`shared-types/src/grid.ts`: add the types listed under Interfaces; extend `GRID_DEFAULTS` with `external_story_mode: "what_it_covers", blocked_sources: [], per_bundle_limit: 20`; `GridTopic.bundles?: string[]`, `ResolvedGridTopic.bundles: string[]`. Then `pnpm --filter @atomic-platform/shared-types build`.

- [ ] **Step 4: Run** the test again — PASS; `pnpm --filter @atomic-platform/site-worker typecheck` will fail in normalize.ts until Task 2 (expected).

- [ ] **Step 5: Commit** — `feat(shared-types): grid aggregator source types and KV keys`

---

### Task 2: Config defaults (runtime + seed-time)

**Files:**
- Modify: `packages/site-worker/src/lib/grid/normalize.ts`
- Modify: `packages/site-worker/scripts/lib/resolve-grid.ts:4`
- Test: `packages/site-worker/src/lib/grid/__tests__/normalize.test.ts`, `packages/site-worker/scripts/__tests__/resolve-grid.test.ts`

**Interfaces:** Consumes Task 1 types. Produces `normalizeGridConfig` returning the new fields.

- [ ] **Step 1: Failing tests**

```ts
// normalize.test.ts
it('defaults the aggregator fields', () => {
  const g = normalizeGridConfig({});
  expect(g.external_story_mode).toBe('what_it_covers');
  expect(g.blocked_sources).toEqual([]);
  expect(g.per_bundle_limit).toBe(20);
});
it('normalises topic bundles and clamps per_bundle_limit', () => {
  const g = normalizeGridConfig({
    topics: [{ label: 'Celebs', verticals: [], bundles: [' b1 ', '', 'b1', 'b2'] }],
    per_bundle_limit: 500, external_story_mode: 'ai_summary', blocked_sources: ['Conspiracy', ' '],
  });
  expect(g.topics[0]!.bundles).toEqual(['b1', 'b2']);
  expect(g.per_bundle_limit).toBe(100);
  expect(g.external_story_mode).toBe('ai_summary');
  expect(g.blocked_sources).toEqual(['Conspiracy']);
});
it('keeps a vertical-less, bundle-only pill', () => {
  expect(normalizeGridConfig({ topics: [{ label: 'X', verticals: [], bundles: ['b'] }] }).topics).toHaveLength(1);
});

// resolve-grid.test.ts
it('blocked_sources: last non-empty layer wins', () => {
  expect(mergeGridLayers([{ blocked_sources: ['A'] }, { blocked_sources: [] }]).blocked_sources).toEqual(['A']);
});
```

- [ ] **Step 2: Run** both test files — FAIL.

- [ ] **Step 3: Implement**

In `normalize.ts`: add the three fields to the inline `GRID_DEFAULTS`; in `normalizeTopics` read `bundles: [...new Set(stringList(t.bundles))]` (type the raw as `{ label?; slug?; verticals?; bundles? }`); in `normalizeGridConfig` add:
```ts
    external_story_mode: g.external_story_mode === 'ai_summary' ? 'ai_summary' : 'what_it_covers',
    blocked_sources: stringList(g.blocked_sources),
    per_bundle_limit: clampInt(g.per_bundle_limit, 1, 100, GRID_DEFAULTS.per_bundle_limit),
```
In `resolve-grid.ts`: `const ARRAY_KEYS = new Set(['topics', 'include_sites', 'exclude_sites', 'pinned', 'blocked_sources']);`

- [ ] **Step 4: Run** tests + `pnpm --filter @atomic-platform/site-worker typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(site-worker): grid aggregator config defaults`

---

### Task 3: Sync logic (pure)

**Files:**
- Create: `packages/site-worker/scripts/lib/grid-bundles.ts`
- Test: `packages/site-worker/scripts/__tests__/grid-bundles.test.ts`

**Interfaces:**
- Consumes: `ExternalStoryRecord`, `ExternalBundleIndex`, `ExternalIndexEntry` (Task 1); `slugifyTopic` from `src/lib/grid/normalize`.
- Produces:
  ```ts
  export interface AggregatorItem { id: string; url: string; title: string; description: string | null; summary: string | null; thumbnail: { url?: string } | null; content_type: string; language: string; source: { name: string }; author: string | null; published_at: string; categories?: Array<{ name: string }>; tags?: Array<{ name: string }> }
  export function parseBriefSections(summary: string | null): { whatItCovers: string; whyItMatters: string }
  export function externalSlug(title: string): string            // kebab, ≤ 80 chars, never empty ("story")
  export function toExternalRecord(item: AggregatorItem, rewritten: ReadonlySet<string>, now: Date): ExternalStoryRecord | null
  export function toIndexEntry(r: ExternalStoryRecord): ExternalIndexEntry
  export function mergeBundleIndex(existing: ExternalBundleIndex | null, bundleId: string, name: string, records: readonly ExternalStoryRecord[], now: Date, cap?: number): ExternalBundleIndex
  export function collectBundleIds(configs: Iterable<{ grid?: { topics?: Array<{ bundles?: unknown }> } } | null>): string[]
  export function rewrittenIdsFromFrontmatter(frontmatters: Iterable<Record<string, unknown>>): Set<string>
  ```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseBriefSections, externalSlug, toExternalRecord, mergeBundleIndex, collectBundleIds, rewrittenIdsFromFrontmatter, type AggregatorItem } from '../lib/grid-bundles';

const NOW = new Date('2026-10-07T12:00:00Z');
const item = (o: Partial<AggregatorItem> = {}): AggregatorItem => ({
  id: 'a1', url: 'https://www.instyle.com/x', title: 'Dakota Johnson’s $15 Phone Case',
  description: 'Fall in accessory form.', thumbnail: { url: 'https://img/x.jpg' },
  content_type: 'article', language: 'EN', source: { name: 'WS Insider - Lifestyle' }, author: 'Us Weekly',
  published_at: '2026-10-06T05:30:00.000Z', categories: [{ name: 'Pop Culture' }], tags: [{ name: 'dakota-johnson' }],
  summary: '**What It Covers:**\nDakota carried a burgundy case.\n\n**Why It Matters Now:**\nFall trend.\n\n**Content Opportunity:**\nMake a reel.\n\n**Key Angles:**\n- angle',
  ...o,
});

describe('parseBriefSections', () => {
  it('keeps only What It Covers and Why It Matters Now', () => {
    expect(parseBriefSections(item().summary)).toEqual({ whatItCovers: 'Dakota carried a burgundy case.', whyItMatters: 'Fall trend.' });
  });
  it('accepts "What It Appears To Cover", CRLF and missing sections', () => {
    expect(parseBriefSections('**What It Appears To Cover:**\r\nA thing.\r\n').whatItCovers).toBe('A thing.');
    expect(parseBriefSections(null)).toEqual({ whatItCovers: '', whyItMatters: '' });
    expect(parseBriefSections('no headings here')).toEqual({ whatItCovers: '', whyItMatters: '' });
  });
});

describe('toExternalRecord', () => {
  it('maps an eligible article', () => {
    const r = toExternalRecord(item(), new Set(), NOW)!;
    expect(r).toMatchObject({ id: 'a1', slug: 'dakota-johnson-s-15-phone-case', sourceName: 'WS Insider - Lifestyle', imageUrl: 'https://img/x.jpg', whatItCovers: 'Dakota carried a burgundy case.', syncedAt: NOW.toISOString() });
  });
  it.each([
    ['non-article', { content_type: 'trend' }],
    ['no image', { thumbnail: null }],
    ['empty image url', { thumbnail: { url: '' } }],
    ['non-English', { language: 'FR' }],
    ['no What It Covers and no description', { summary: 'x', description: null }],
  ])('skips %s', (_l, o) => {
    expect(toExternalRecord(item(o as Partial<AggregatorItem>), new Set(), NOW)).toBeNull();
  });
  it('skips items a network site already rewrote (D6)', () => {
    expect(toExternalRecord(item(), new Set(['a1']), NOW)).toBeNull();
  });
  it('accepts lower-case "en"', () => {
    expect(toExternalRecord(item({ language: 'en' }), new Set(), NOW)).not.toBeNull();
  });
});

describe('externalSlug', () => {
  it('is kebab, capped at 80, never empty', () => {
    expect(externalSlug('A'.repeat(200)).length).toBeLessThanOrEqual(80);
    expect(externalSlug('!!!')).toBe('story');
  });
});

describe('mergeBundleIndex', () => {
  const rec = (id: string, at: string) => toExternalRecord(item({ id, published_at: at }), new Set(), NOW)!;
  it('merges newest first and never drops old entries (D7)', () => {
    const first = mergeBundleIndex(null, 'b', 'Scoopella', [rec('old', '2026-10-01T00:00:00Z')], NOW);
    const second = mergeBundleIndex(first, 'b', 'Scoopella', [rec('new', '2026-10-06T00:00:00Z')], NOW);
    expect(second.items.map((i) => i.id)).toEqual(['new', 'old']);
  });
  it('updates an existing entry in place (title change) and caps at 300', () => {
    const many = Array.from({ length: 305 }, (_, i) => rec(`i${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    const idx = mergeBundleIndex(null, 'b', 'n', many, NOW);
    expect(idx.items).toHaveLength(300);
    expect(idx.items[0]!.id).toBe('i304');
  });
});

describe('collectBundleIds / rewrittenIdsFromFrontmatter', () => {
  it('collects unique bundle ids from Grid configs', () => {
    expect(collectBundleIds([{ grid: { topics: [{ bundles: ['b1', 'b2'] }, { bundles: ['b1'] }] } }, null, {}])).toEqual(['b1', 'b2']);
  });
  it('reads source_item_id from article frontmatter', () => {
    expect([...rewrittenIdsFromFrontmatter([{ source_item_id: 'a1' }, { title: 'x' }, { source_item_id: 7 }])]).toEqual(['a1', '7']);
  });
});
```

- [ ] **Step 2: Run** `cd packages/site-worker && npx vitest run scripts/__tests__/grid-bundles.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** `scripts/lib/grid-bundles.ts`

```ts
import type { ExternalBundleIndex, ExternalIndexEntry, ExternalStoryRecord } from '@atomic-platform/shared-types';
import { slugifyTopic } from '../../src/lib/grid/normalize';

/** Content Aggregator item fields the sync uses (GET /api/content). */
export interface AggregatorItem {
  id: string; url: string; title: string; description: string | null; summary: string | null;
  thumbnail: { url?: string } | null; content_type: string; language: string;
  source: { name: string }; author: string | null; published_at: string;
  categories?: Array<{ name: string }>; tags?: Array<{ name: string }>;
}

const INDEX_CAP = 300;
const HEADING = /^\s*\*\*([^*]+?):?\*\*:?\s*$/;

/** "What It Covers" + "Why It Matters Now" from the aggregator's editorial brief. Other sections are dropped. */
export function parseBriefSections(summary: string | null): { whatItCovers: string; whyItMatters: string } {
  const out = { whatItCovers: '', whyItMatters: '' };
  if (!summary) return out;
  let current: keyof typeof out | null = null;
  const buf: Record<keyof typeof out, string[]> = { whatItCovers: [], whyItMatters: [] };
  for (const line of summary.replace(/\r\n?/g, '\n').split('\n')) {
    const h = HEADING.exec(line);
    if (h) {
      const name = h[1]!.trim().toLowerCase();
      current = /^what it (covers|appears to cover)$/.test(name) ? 'whatItCovers'
        : name === 'why it matters now' ? 'whyItMatters' : null;
      continue;
    }
    if (current) buf[current].push(line);
  }
  out.whatItCovers = buf.whatItCovers.join('\n').trim();
  out.whyItMatters = buf.whyItMatters.join('\n').trim();
  return out;
}

/** URL slug for an external story (the item id is appended separately). */
export function externalSlug(title: string): string {
  const s = slugifyTopic(title).slice(0, 80).replace(/-+$/, '');
  return s || 'story';
}

/** Aggregator item → KV record, or null when it isn't eligible (D4, D6, D9). */
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
    id: item.id, slug: externalSlug(item.title), title: item.title.trim(), description, imageUrl,
    url: item.url, sourceName: item.source?.name ?? '', author: item.author ?? null,
    publishedAt: item.published_at, categories: (item.categories ?? []).map((c) => c.name),
    tags: (item.tags ?? []).map((t) => t.name), whatItCovers, whyItMatters, syncedAt: now.toISOString(),
  };
}

export function toIndexEntry(r: ExternalStoryRecord): ExternalIndexEntry {
  return { id: r.id, slug: r.slug, title: r.title, description: r.description, imageUrl: r.imageUrl, sourceName: r.sourceName, publishedAt: r.publishedAt };
}

/** Existing index + this run's records → newest-first, de-duplicated, capped. Never drops entries the aggregator stopped returning (D7). */
export function mergeBundleIndex(
  existing: ExternalBundleIndex | null, bundleId: string, name: string,
  records: readonly ExternalStoryRecord[], now: Date, cap: number = INDEX_CAP,
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
  for (const c of configs) {
    for (const t of c?.grid?.topics ?? []) {
      if (!Array.isArray(t.bundles)) continue;
      for (const b of t.bundles) if (typeof b === 'string' && b.trim()) ids.add(b.trim());
    }
  }
  return [...ids];
}

/** Aggregator item ids our network articles were generated from (frontmatter `source_item_id`). */
export function rewrittenIdsFromFrontmatter(frontmatters: Iterable<Record<string, unknown>>): Set<string> {
  const ids = new Set<string>();
  for (const fm of frontmatters) {
    const v = fm.source_item_id;
    if (typeof v === 'string' || typeof v === 'number') ids.add(String(v));
  }
  return ids;
}
```

- [ ] **Step 4: Run** the test — PASS. (If `slugifyTopic` turns `’` differently, adjust the expected slug in the test to the helper's actual output and note it.)
- [ ] **Step 5: Commit** — `feat(site-worker): pure sync logic for grid aggregator bundles`

---

### Task 4: Wire the sync into `seed-grid.ts`

**Files:**
- Create: `packages/site-worker/scripts/lib/aggregator-client.ts`
- Modify: `packages/site-worker/scripts/seed-grid.ts`, `packages/site-worker/scripts/lib/grid-directory.ts` (`SiteConfigSummary.grid?`), `packages/site-worker/scripts/lib/grid-summary-html.ts`
- Test: `packages/site-worker/scripts/__tests__/aggregator-client.test.ts`, `packages/site-worker/scripts/__tests__/grid-bundle-sync.test.ts`, `packages/site-worker/scripts/__tests__/grid-summary-html.test.ts`

**Interfaces:**
- Consumes Task 3.
- Produces:
  ```ts
  // aggregator-client.ts
  export function aggregatorBase(env: NodeJS.ProcessEnv): string   // CONTENT_API_BASE_URL ?? CONTENT_AGGREGATOR_URL ?? default, trailing /api stripped
  export async function fetchBundleItems(base: string, bundleId: string, fetchFn?: typeof fetch, maxPages?: number): Promise<AggregatorItem[]>
  export async function fetchBundleNames(base: string, fetchFn?: typeof fetch): Promise<Map<string, string>>
  // grid-bundles.ts (added here, uses I/O via injected deps)
  export interface BundleSyncDeps { fetchItems(bundleId: string): Promise<AggregatorItem[]>; readIndex(bundleId: string): Promise<ExternalBundleIndex | null>; now(): Date }
  export async function syncBundles(bundleIds: readonly string[], names: ReadonlyMap<string, string>, rewritten: ReadonlySet<string>, deps: BundleSyncDeps): Promise<{ entries: Array<{ key: string; value: string }>; failed: string[] }>
  ```

- [ ] **Step 1: Failing tests**

```ts
// grid-bundle-sync.test.ts
import { describe, it, expect, vi } from 'vitest';
import { syncBundles, type AggregatorItem } from '../lib/grid-bundles';

const art = (id: string): AggregatorItem => ({ id, url: `https://x/${id}`, title: `T ${id}`, description: 'd', summary: '**What It Covers:**\nw', thumbnail: { url: 'https://i' }, content_type: 'article', language: 'EN', source: { name: 'S' }, author: null, published_at: '2026-10-06T00:00:00Z' });
const NOW = new Date('2026-10-07T00:00:00Z');

describe('syncBundles', () => {
  it('writes one item record per new story and the merged index', async () => {
    const out = await syncBundles(['b'], new Map([['b', 'Scoopella']]), new Set(), {
      fetchItems: async () => [art('a'), art('c')], readIndex: async () => null, now: () => NOW,
    });
    expect(out.entries.map((e) => e.key).sort()).toEqual(['grid-ext-index:b', 'grid-ext-item:a', 'grid-ext-item:c']);
    expect(out.failed).toEqual([]);
  });
  it('leaves a bundle untouched when the aggregator fails (Review Focus 2)', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(), {
      fetchItems: vi.fn().mockRejectedValue(new Error('502')), readIndex: async () => null, now: () => NOW,
    });
    expect(out.entries).toEqual([]);
    expect(out.failed).toEqual(['b']);
  });
  it('writes nothing for a bundle whose fetch returned zero eligible items', async () => {
    const out = await syncBundles(['b'], new Map(), new Set(['a']), { fetchItems: async () => [art('a')], readIndex: async () => null, now: () => NOW });
    expect(out.entries).toEqual([]);
  });
});

// aggregator-client.test.ts
import { aggregatorBase, fetchBundleItems } from '../lib/aggregator-client';
it('prefers CONTENT_API_BASE_URL and strips /api', () => {
  expect(aggregatorBase({ CONTENT_API_BASE_URL: 'https://agg.example/api/', CONTENT_AGGREGATOR_URL: 'https://stale' })).toBe('https://agg.example');
});
it('pages until total_pages and requests active enriched bundle content', async () => {
  const fetchFn = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: '1' }], total_pages: 2 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: '2' }], total_pages: 2 })));
  const items = await fetchBundleItems('https://agg', 'b1', fetchFn as unknown as typeof fetch);
  expect(items.map((i) => i.id)).toEqual(['1', '2']);
  expect(String(fetchFn.mock.calls[0]![0])).toContain('/api/content?bundle_id=b1&status=active&enriched=true&page_size=100&page=1');
});
it('throws on a non-2xx response (so the bundle is skipped, not emptied)', async () => {
  const fetchFn = vi.fn().mockResolvedValue(new Response('x', { status: 502 }));
  await expect(fetchBundleItems('https://agg', 'b1', fetchFn as unknown as typeof fetch)).rejects.toThrow(/502/);
});

// grid-summary-html.test.ts (append)
it('carries pinned from frontmatter', () => {
  const parsed = parseSummaryFile('grid-summaries/aggregator/abc123.md', '---\npinned: true\n---\n## H\n\ntext');
  expect(parsed?.site).toBe('aggregator');
  expect(parsed?.record.pinned).toBe(true);
});
```

- [ ] **Step 2: Run** the three test files — FAIL.

- [ ] **Step 3: Implement**

`aggregator-client.ts`:
```ts
import type { AggregatorItem } from './grid-bundles';

const DEFAULT_BASE = 'https://content-aggregator-v2-34cd.atomic.cloudgrid.io';

/** CONTENT_API_BASE_URL first — CloudGrid injects a stale CONTENT_AGGREGATOR_URL (CLAUDE.md #20). */
export function aggregatorBase(env: NodeJS.ProcessEnv): string {
  const raw = env.CONTENT_API_BASE_URL || env.CONTENT_AGGREGATOR_URL || DEFAULT_BASE;
  return raw.replace(/\/+$/, '').replace(/\/api$/, '');
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`[seed-grid] ${url} → ${res.status}`);
  return res.json();
}

/** Active items of one bundle (newest first per the aggregator), up to maxPages × 100. */
export async function fetchBundleItems(base: string, bundleId: string, fetchFn: typeof fetch = fetch, maxPages = 3): Promise<AggregatorItem[]> {
  const items: AggregatorItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}/api/content?bundle_id=${encodeURIComponent(bundleId)}&status=active&enriched=true&page_size=100&page=${page}`;
    const body = (await getJson(url, fetchFn)) as { items?: AggregatorItem[]; total_pages?: number };
    items.push(...(body.items ?? []));
    if (page >= (body.total_pages ?? 1) || (body.items ?? []).length === 0) break;
  }
  return items;
}

/** id → bundle name (for the index's `name`); empty map on failure — names are cosmetic. */
export async function fetchBundleNames(base: string, fetchFn: typeof fetch = fetch): Promise<Map<string, string>> {
  try {
    const body = (await getJson(`${base}/api/bundles?page_size=100`, fetchFn)) as { items?: Array<{ id: string; name: string }> };
    return new Map((body.items ?? []).map((b) => [b.id, b.name]));
  } catch (err) {
    console.warn('[seed-grid] bundle names unavailable:', err instanceof Error ? err.message : err);
    return new Map();
  }
}
```

Append to `grid-bundles.ts`:
```ts
import { externalIndexKey, externalItemKey } from '../../src/lib/kv-schema';

export interface BundleSyncDeps {
  fetchItems(bundleId: string): Promise<AggregatorItem[]>;
  readIndex(bundleId: string): Promise<ExternalBundleIndex | null>;
  now(): Date;
}

/** KV entries for every bundle; a failing bundle produces no entries (its KV stays as-is). */
export async function syncBundles(
  bundleIds: readonly string[], names: ReadonlyMap<string, string>, rewritten: ReadonlySet<string>, deps: BundleSyncDeps,
): Promise<{ entries: Array<{ key: string; value: string }>; failed: string[] }> {
  const entries: Array<{ key: string; value: string }> = [];
  const failed: string[] = [];
  const written = new Set<string>();
  for (const bundleId of bundleIds) {
    try {
      const now = deps.now();
      const records = (await deps.fetchItems(bundleId))
        .map((i) => toExternalRecord(i, rewritten, now))
        .filter((r): r is ExternalStoryRecord => r !== null);
      if (records.length === 0) continue;
      const index = mergeBundleIndex(await deps.readIndex(bundleId), bundleId, names.get(bundleId) ?? '', records, now);
      for (const r of records) {
        if (written.has(r.id)) continue; // same item in two bundles → one record
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
```

`grid-summary-html.ts` → in the returned record add `pinned: f.pinned === true,`.

`grid-directory.ts` → `SiteConfigSummary` gains `grid?: { topics?: Array<{ bundles?: string[] }> };`.

`seed-grid.ts` → after `buildNetworkDirectory(...)` and before the summary block:
```ts
  // Aggregator bundles used by any Grid site's pills (spec D8).
  const bundleIds = collectBundleIds(configs.values());
  if (bundleIds.length > 0) {
    const base = aggregatorBase(process.env);
    const rewritten = rewrittenIdsFromFrontmatter(await readNetworkArticleFrontmatter(root, entries.map((e) => e.domain)));
    const readIndex = local ? localIndexReader(process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT) : restIndexReader(requireEnv('CLOUDFLARE_ACCOUNT_ID'), requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('KV_NAMESPACE_ID_PROD'));
    const { entries: bundleEntries, failed } = await syncBundles(bundleIds, await fetchBundleNames(base), rewritten, {
      fetchItems: (id) => fetchBundleItems(base, id), readIndex, now: () => new Date(),
    });
    kvEntries.push(...bundleEntries);
    console.log(`[seed-grid] bundles: ${bundleIds.length} (${failed.length} failed), entries: ${bundleEntries.length}`);
  }
```
Add `readNetworkArticleFrontmatter(root, domains)` to `grid-bundles.ts` (reads `sites/<d>/articles/*.md` frontmatter via `splitFrontmatter` from `./resolve`, skipping missing dirs), and `restIndexReader` / `localIndexReader` to `grid-config-readers.ts`, mirroring `restConfigReader`/`localConfigReader` but for key `externalIndexKey(bundleId)` returning `ExternalBundleIndex | null`.

- [ ] **Step 4: Run** the three tests + `npx vitest run scripts` — PASS. Smoke: `NETWORK_DATA_PATH=../../../atomic-labs-network pnpm exec tsx scripts/seed-grid.ts --local` with a local test site config whose pill has bundle `6ac4c3d064df7692b392c02d`; expect a log `bundles: 1 (0 failed)`.
- [ ] **Step 5: Commit** — `feat(site-worker): sync grid aggregator bundles into KV`

---

### Task 5: Feed — bundle sources in the pool

**Files:**
- Modify: `packages/site-worker/src/lib/grid/sources.ts`, `feed.ts`, `load.ts`
- Test: `packages/site-worker/src/lib/grid/__tests__/sources.test.ts`, `feed.test.ts`, `load.test.ts`

**Interfaces:**
- Consumes Tasks 1–2.
- Produces:
  ```ts
  // sources.ts
  export interface BundleSource { bundleId: string; pills: string[] }
  export function resolveBundleSources(grid: ResolvedGridConfig): BundleSource[]
  // feed.ts
  export interface ExternalSourceEntries { bundleId: string; pills: string[]; entries: readonly ExternalIndexEntry[] }
  export function buildPool(sources: readonly SourceArticles[], grid: ResolvedGridConfig, now: Date, external?: readonly ExternalSourceEntries[]): BuiltPool
  // load.ts — GridPoolData unchanged shape; loadGridPool reads bundle indexes
  ```

- [ ] **Step 1: Failing tests**

```ts
// sources.test.ts
it('maps bundles to the pills that use them', () => {
  const grid = normalizeGridConfig({ topics: [{ label: 'Celebs', verticals: [], bundles: ['b1'] }, { label: 'Style', verticals: [], bundles: ['b1', 'b2'] }] });
  expect(resolveBundleSources(grid)).toEqual([{ bundleId: 'b1', pills: ['celebs', 'style'] }, { bundleId: 'b2', pills: ['style'] }]);
});

// feed.test.ts
const ext = (id: string, at: string, sourceName = 'InStyle') => ({ id, slug: `t-${id}`, title: `T ${id}`, description: '', imageUrl: 'https://i', sourceName, publishedAt: at });
it('merges external entries newest-first with network items', () => {
  const grid = normalizeGridConfig({});
  const pool = buildPool([network('site-a', [art('n1', '2026-10-05T00:00:00Z')])], grid, NOW, [{ bundleId: 'b', pills: ['celebs'], entries: [ext('x1', '2026-10-06T00:00:00Z')] }]);
  expect(pool.items.map((i) => [i.site, i.kind])).toEqual([['aggregator', 'external'], ['site-a', 'network']]);
  expect(pool.items[0]).toMatchObject({ slug: 't-x1-x1', sourceName: 'InStyle', featuredImage: 'https://i', pills: ['celebs'] });
});
it('applies per_bundle_limit, blocked_sources (case-insensitive) and max_age_days', () => {
  const grid = normalizeGridConfig({ per_bundle_limit: 1, blocked_sources: ['conspiracy'], max_age_days: 3 });
  const pool = buildPool([], grid, NOW, [{ bundleId: 'b', pills: [], entries: [
    ext('a', '2026-10-06T00:00:00Z', 'Conspiracy'), ext('b', '2026-10-06T00:00:00Z'), ext('c', '2026-10-05T00:00:00Z'), ext('old', '2026-09-01T00:00:00Z'),
  ] }]);
  expect(pool.items.map((i) => i.slug)).toEqual(['t-b-b']);
});
it('dedupes an item present in two bundles and unions its pills', () => {
  const e = ext('dup', '2026-10-06T00:00:00Z');
  const pool = buildPool([], normalizeGridConfig({}), NOW, [{ bundleId: 'b1', pills: ['a'], entries: [e] }, { bundleId: 'b2', pills: ['b'], entries: [e] }]);
  expect(pool.items).toHaveLength(1);
  expect(pool.items[0]!.pills.sort()).toEqual(['a', 'b']);
});
it('pins an external story by aggregator slug', () => {
  const grid = normalizeGridConfig({ pinned: [{ site: 'aggregator', slug: 't-x1-x1' }] });
  const pool = buildPool([network('site-a', [art('n1', '2026-10-06T10:00:00Z')])], grid, NOW, [{ bundleId: 'b', pills: [], entries: [ext('x1', '2026-10-01T00:00:00Z')] }]);
  expect(pool.items[0]).toMatchObject({ site: 'aggregator', pinned: true });
});
it('REGRESSION: no bundles → identical pool to the pre-change call', () => {
  const sources = [network('site-a', [art('n1', '2026-10-05T00:00:00Z'), art('n2', '2026-10-04T00:00:00Z')])];
  const grid = normalizeGridConfig({});
  const pool = buildPool(sources, grid, NOW);
  expect(pool.items.every((i) => i.kind === undefined && i.sourceName === undefined)).toBe(true);
  expect(buildPool(sources, grid, NOW, [])).toEqual(pool);
});

// load.test.ts
it('reads each bundle index and passes it to the pool', async () => { /* Map-backed KvReader with grid-ext-index:b → { items:[ext(...)] }; expect data.pool.items to contain kind "external" */ });
it('a missing bundle index is skipped, not an error', async () => { /* index absent → pool has only network items; no throw */ });
```
(`network`/`art`/`NOW` are the helpers already in `feed.test.ts`; reuse them. Fill the two load tests with the existing `load.test.ts` Map-backed `KvReader` fixture.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`sources.ts`:
```ts
export interface BundleSource { bundleId: string; pills: string[] }

/** Bundles referenced by the site's pills, with the pills each one feeds (D1). */
export function resolveBundleSources(grid: ResolvedGridConfig): BundleSource[] {
  const pills = new Map<string, string[]>();
  for (const t of grid.topics) for (const b of t.bundles) pills.set(b, [...(pills.get(b) ?? []), t.slug]);
  return [...pills].map(([bundleId, p]) => ({ bundleId, pills: p }));
}
```

`feed.ts` — add, then use in `buildPool`:
```ts
import { AGGREGATOR_SOURCE_ID } from '../kv-schema';
import type { ExternalIndexEntry } from '@atomic-platform/shared-types';

export interface ExternalSourceEntries { bundleId: string; pills: string[]; entries: readonly ExternalIndexEntry[] }

/** Story URL slug for an external entry: "<title-slug>-<itemId>". */
export function externalPoolSlug(e: Pick<ExternalIndexEntry, 'slug' | 'id'>): string { return `${e.slug}-${e.id}`; }

function externalItems(external: readonly ExternalSourceEntries[], grid: ResolvedGridConfig, minTime: number): GridPoolItem[] {
  const blocked = new Set(grid.blocked_sources.map((s) => s.trim().toLowerCase()));
  const byId = new Map<string, GridPoolItem>();
  for (const src of external) {
    src.entries
      .filter((e) => !blocked.has(e.sourceName.trim().toLowerCase()) && time(e.publishedAt) >= minTime)
      .sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
      .slice(0, grid.per_bundle_limit)
      .forEach((e) => {
        const prev = byId.get(e.id);
        if (prev) { prev.pills = [...new Set([...prev.pills, ...src.pills])]; return; }
        byId.set(e.id, {
          site: AGGREGATOR_SOURCE_ID, slug: externalPoolSlug(e), title: e.title, publishDate: e.publishedAt,
          featuredImage: e.imageUrl, ...(e.description ? { description: e.description } : {}),
          pills: [...src.pills], pinned: false, kind: 'external', sourceName: e.sourceName,
        });
      });
  }
  return [...byId.values()];
}
```
In `buildPool(sources, grid, now, external = [])`: after building `natural` from network sources, `natural.push(...externalItems(external, grid, minTime))` before the sort. For pins: if `pin.site === AGGREGATOR_SOURCE_ID`, look the slug up among the external items (`natural.find(i => i.site === pin.site && i.slug === pin.slug)`) instead of `bySite`; when not found → `inactivePins` with reason `'not_source'`. Network items keep no `kind`/`sourceName` fields (regression test).

`load.ts` — in `loadGridPool`, after resolving network sources:
```ts
  const bundleSources = resolveBundleSources(grid);
  const bundleIndexes = await Promise.all(bundleSources.map(async (b) => ({ ...b, index: await safeGet<ExternalBundleIndex>(kv, externalIndexKey(b.bundleId)) })));
  const external: ExternalSourceEntries[] = bundleIndexes.filter((b) => b.index).map((b) => ({ bundleId: b.bundleId, pills: b.pills, entries: b.index!.items }));
```
Move the KV reads before the cache lookup only for the index `updatedAt` values; cache key becomes
`pool:${siteId}:${directory.generatedAt}:${bundleIndexes.map((b) => b.index?.updatedAt ?? '-').join(',')}:${hashString(JSON.stringify(grid))}`, and call `buildPool(sourceArticles, grid, now, external)`. Note: reading indexes before the cache check adds one KV read per bundle per request; acceptable (spec: reads stay well under the limit).

- [ ] **Step 4: Run** `npx vitest run src/lib/grid` — PASS including the regression test.
- [ ] **Step 5: Commit** — `feat(site-worker): mix aggregator bundle stories into the grid feed`

---

### Task 6: Cards and story text

**Files:**
- Modify: `packages/site-worker/src/lib/grid/render.ts`, `story.ts`, `summaries.ts`; `src/themes/grid/grid.css` (placeholder style); card script in `src/themes/grid/components/CardGrid.astro` (image error handler)
- Test: `render.test.ts`, `story.test.ts`, `summaries.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // story.ts
  export function storyText(input: { body: string; summary: GridSummaryRecord | null; mode: GridStoryMode; paragraphs: number; hostname: string }): { html: string; source: 'summary' | 'excerpt' }   // now also honours summary.pinned
  export function externalStoryText(input: { record: ExternalStoryRecord; summary: GridSummaryRecord | null; mode: GridExternalStoryMode }): { html: string; source: 'summary' | 'what_it_covers' | 'description' }
  // summaries.ts: lookupSummaryStatuses sets summary.pinned when the record is pinned
  ```

- [ ] **Step 1: Failing tests**

```ts
// story.test.ts
const rec = { html: '<h2>S</h2>', bodyHash: '', generatedAt: '', model: '', edited: false, sourceChanged: false };
it('a pinned summary shows even in excerpt mode', () => {
  expect(storyText({ body: '<p>a</p><p>b</p>', summary: { ...rec, pinned: true }, mode: 'excerpt', paragraphs: 1, hostname: 'h' }).source).toBe('summary');
});
it('an unpinned summary in excerpt mode still shows the excerpt (unchanged behaviour)', () => {
  expect(storyText({ body: '<p>a</p><p>b</p>', summary: rec, mode: 'excerpt', paragraphs: 1, hostname: 'h' }).source).toBe('excerpt');
});
describe('externalStoryText', () => {
  const record = { whatItCovers: 'Covers <b>this</b>.', description: 'Desc', whyItMatters: 'Why' } as ExternalStoryRecord;
  it.each([
    ['what_it_covers', null, 'what_it_covers'],
    ['ai_summary', null, 'what_it_covers'],            // summary not generated yet
    ['ai_summary', rec, 'summary'],
    ['what_it_covers', rec, 'what_it_covers'],          // unpinned summary ignored
    ['what_it_covers', { ...rec, pinned: true }, 'summary'],
  ] as const)('mode %s, summary %o → %s', (mode, summary, source) => {
    expect(externalStoryText({ record, summary, mode }).source).toBe(source);
  });
  it('escapes What It Covers and falls back to the description', () => {
    expect(externalStoryText({ record, summary: null, mode: 'what_it_covers' }).html).toBe('<p>Covers &lt;b&gt;this&lt;/b&gt;.</p>');
    expect(externalStoryText({ record: { ...record, whatItCovers: '' }, summary: null, mode: 'what_it_covers' })).toEqual({ html: '<p>Desc</p>', source: 'description' });
  });
});

// render.test.ts
it('external cards link to /story/aggregator/<slug> and name the publisher', () => {
  const html = renderTilesHtml([{ kind: 'story', item: { site: 'aggregator', slug: 't-x1', title: 'T', publishDate: '2026-10-06T00:00:00Z', featuredImage: 'https://img', pills: [], pinned: false, kind: 'external', sourceName: 'InStyle' }, index: 0 }], ctx);
  expect(html).toContain('href="/story/aggregator/t-x1"');
  expect(html).toContain('<span class="g-card__site">InStyle</span>');
  expect(html).toContain('data-fallback="/placeholder.svg"');
});

// summaries.test.ts
it('reports pinned', async () => {
  const items = await lookupSummaryStatuses([poolItem], async () => ({ ...rec, pinned: true }));
  expect(items[0]!.summary).toMatchObject({ status: 'generated', pinned: true });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`story.ts`:
```ts
/** Story body: summary when mode says so or the story is pinned (D3), else excerpt. */
export function storyText(input: { body: string; summary: GridSummaryRecord | null; mode: GridStoryMode; paragraphs: number; hostname: string }): { html: string; source: 'summary' | 'excerpt' } {
  const useSummary = input.summary?.html && (input.mode === 'ai_summary' || input.summary.pinned === true);
  if (useSummary) return { html: input.summary!.html, source: 'summary' };
  return { html: buildExcerpt(absolutizeLinks(input.body, input.hostname), input.paragraphs), source: 'excerpt' };
}

const paragraphs = (text: string): string => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');

/** External story body (D2/D3): pinned or mode summary → What It Covers → description. */
export function externalStoryText(input: { record: ExternalStoryRecord; summary: GridSummaryRecord | null; mode: GridExternalStoryMode }): { html: string; source: 'summary' | 'what_it_covers' | 'description' } {
  if (input.summary?.html && (input.mode === 'ai_summary' || input.summary.pinned === true)) return { html: input.summary.html, source: 'summary' };
  if (input.record.whatItCovers) return { html: paragraphs(input.record.whatItCovers), source: 'what_it_covers' };
  return { html: paragraphs(input.record.description), source: 'description' };
}
```
(import `escapeHtml` from `./format`.)

`render.ts`:
- `renderSourceLineHtml`: `const name = escapeHtml(item.kind === 'external' ? (item.sourceName || 'Source') : (site?.name ?? item.site));` and pass `item.kind === 'external' ? undefined : site` to `faviconHtml` with fallbackName = that name.
- `renderCardHtml`: `<img src="${img}" data-fallback="/placeholder.svg" alt="" .../>`.
`CardGrid.astro` inline script: after `runScripts`, add a delegated listener once:
```js
document.addEventListener('error', function (e) {
  var t = e.target;
  if (t && t.tagName === 'IMG' && t.dataset.fallback && t.src.indexOf(t.dataset.fallback) === -1) t.src = t.dataset.fallback;
}, true);
```
`summaries.ts`: `summary: rec ? { status: summaryStatusOf(rec), generatedAt: rec.generatedAt, ...(rec.pinned ? { pinned: true } : {}) } : { status: 'none' }`.

- [ ] **Step 4: Run** `npx vitest run src/lib/grid` — PASS.
- [ ] **Step 5: Commit** — `feat(site-worker): external grid cards and story text selection`

---

### Task 7: External story page

**Files:**
- Create: `packages/site-worker/src/lib/grid/external.ts`
- Create: `packages/site-worker/src/pages/grid/story/aggregator/[slug].astro`
- Modify: `packages/site-worker/src/lib/grid/format.ts` (`buildExternalOutboundUrl`)
- Test: `packages/site-worker/src/lib/grid/__tests__/external.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function parseExternalSlug(param: string): { itemId: string; slugPart: string } | null   // itemId = trailing 24-hex
  export function resolveExternalRequest(param: string, record: ExternalStoryRecord | null): { kind: 'ok'; record: ExternalStoryRecord } | { kind: 'redirect'; location: string } | { kind: 'not_found' }
  export function buildExternalOutboundUrl(url: string, gridHost: string, utm: boolean): string
  ```

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { parseExternalSlug, resolveExternalRequest } from '../external';
import { buildExternalOutboundUrl } from '../format';

const ID = '6ac4931364df7692b392bfcb';
const record = { id: ID, slug: 'batman-paused' } as ExternalStoryRecord;

describe('parseExternalSlug', () => {
  it('splits slug and 24-hex id', () => expect(parseExternalSlug(`batman-paused-${ID}`)).toEqual({ itemId: ID, slugPart: 'batman-paused' }));
  it.each(['', 'batman', `x-${ID}zz`, '../../etc'])('rejects %s', (p) => expect(parseExternalSlug(p)).toBeNull());
});

describe('resolveExternalRequest', () => {
  it('serves the canonical slug', () => expect(resolveExternalRequest(`batman-paused-${ID}`, record)).toEqual({ kind: 'ok', record }));
  it('301s an old slug to the current one (Review Focus 4)', () => {
    expect(resolveExternalRequest(`old-title-${ID}`, record)).toEqual({ kind: 'redirect', location: `/story/aggregator/batman-paused-${ID}` });
  });
  it('404s a missing record or a bad slug', () => {
    expect(resolveExternalRequest(`batman-paused-${ID}`, null).kind).toBe('not_found');
    expect(resolveExternalRequest('nope', record).kind).toBe('not_found');
  });
});

it('adds UTM to the publisher URL only when enabled', () => {
  expect(buildExternalOutboundUrl('https://www.instyle.com/x?a=1', 'grid.example', true)).toBe('https://www.instyle.com/x?a=1&utm_source=grid.example&utm_medium=grid');
  expect(buildExternalOutboundUrl('https://www.instyle.com/x', 'grid.example', false)).toBe('https://www.instyle.com/x');
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`external.ts`:
```ts
import type { ExternalStoryRecord } from '@atomic-platform/shared-types';
import { AGGREGATOR_SOURCE_ID } from '../kv-schema';

const SLUG_RE = /^([a-z0-9-]*?)-?([0-9a-f]{24})$/;

/** "<title-slug>-<24-hex id>" → parts; null for anything else (no KV read for junk). */
export function parseExternalSlug(param: string): { itemId: string; slugPart: string } | null {
  const m = SLUG_RE.exec(param);
  return m ? { itemId: m[2]!, slugPart: m[1]! } : null;
}

export function externalStoryPath(r: Pick<ExternalStoryRecord, 'slug' | 'id'>): string {
  return `/story/${AGGREGATOR_SOURCE_ID}/${r.slug}-${r.id}`;
}

export function resolveExternalRequest(param: string, record: ExternalStoryRecord | null):
  { kind: 'ok'; record: ExternalStoryRecord } | { kind: 'redirect'; location: string } | { kind: 'not_found' } {
  const parsed = parseExternalSlug(param);
  if (!parsed || !record || record.id !== parsed.itemId) return { kind: 'not_found' };
  if (parsed.slugPart !== record.slug) return { kind: 'redirect', location: externalStoryPath(record) };
  return { kind: 'ok', record };
}
```

`format.ts`:
```ts
/** "Read full story" on the publisher's site (UTM tags when enabled). */
export function buildExternalOutboundUrl(url: string, gridHost: string, utm: boolean): string {
  const u = new URL(url);
  if (utm) { u.searchParams.set('utm_source', gridHost); u.searchParams.set('utm_medium', 'grid'); }
  return u.toString();
}
```

`pages/grid/story/aggregator/[slug].astro` — copy the structure of `story/[sourceSiteId]/[slug].astro` with these differences:
```astro
---
import { externalItemKey, gridSummaryKey, AGGREGATOR_SOURCE_ID } from '../../../../lib/kv-schema';
import { parseExternalSlug, resolveExternalRequest } from '../../../../lib/grid/external';
import { externalStoryText, relatedItems } from '../../../../lib/grid/story';
import { buildExternalOutboundUrl } from '../../../../lib/grid/format';
// …same layout/component imports as the network story page…
export const prerender = false;
const g = getGridContext(Astro);
if (!g) return notFound();
const param = Astro.params.slug ?? '';
const parsed = parseExternalSlug(param);
if (!parsed) return notFound();
const record = await env.CONFIG_KV.get<ExternalStoryRecord>(externalItemKey(parsed.itemId), 'json');
const resolved = resolveExternalRequest(param, record);
if (resolved.kind === 'not_found') return notFound();
if (resolved.kind === 'redirect') return Astro.redirect(resolved.location, 301);
const now = new Date();
const data = await loadGridPool(kvReader(env.CONFIG_KV), g.staging ? NO_CACHE : edgeCache(), g.siteId, g.grid, now);
const summary = await env.CONFIG_KV.get<GridSummaryRecord>(gridSummaryKey(AGGREGATOR_SOURCE_ID, record!.id), 'json');
const text = externalStoryText({ record: record!, summary, mode: g.grid.external_story_mode });
const poolItem = data.pool.items.find((i) => i.site === AGGREGATOR_SOURCE_ID && i.slug === param);
const pills = poolItem?.pills ?? [];
// Body ads: same injectInlineAds call as the network page; byline "Original story by <sourceName>"; hero = record.imageUrl;
// CTA href = buildExternalOutboundUrl(record.url, g.canonicalHost, g.grid.outbound_utm); related = relatedItems(data.pool.items, { site: AGGREGATOR_SOURCE_ID, slug: param }, pills, 3);
Astro.response.headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
---
```
Body markup: identical to the network story page, with the byline using `record.sourceName` and `<img class="g-story__hero" src={record.imageUrl} data-fallback="/placeholder.svg" …>`.

- [ ] **Step 4: Run** tests; then `pnpm dev` (Vite), open `/story/aggregator/<slug>-<id>?_atl_site=<grid-site>` against local KV seeded by Task 4's `--local` run: 200 page, old slug → 301, junk → 404.
- [ ] **Step 5: Commit** — `feat(site-worker): grid story page for aggregator stories`

---

### Task 8: Pipeline — per-kind summaries, external prompt, pin/unpin

**Files:**
- Modify: `services/content-pipeline/src/agents/grid-summaries/{targets,files,prompt,http,index,types}.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (route `POST /grid-summaries/pin`)
- Test: `services/content-pipeline/src/__tests__/grid-summaries-core.test.ts`, `grid-summaries-run.test.ts`, `grid-summaries-http.test.ts`

**Interfaces:**
- Consumes: pool items with `kind`, `ExternalStoryRecord` in KV.
- Produces:
  ```ts
  // targets.ts
  export function gridSummaryModes(config: unknown): { network: boolean; external: boolean } | null   // null = not a Grid site
  export function needsSummary(item: { site: string }, modes: { network: boolean; external: boolean }): boolean
  // files.ts: SummaryFrontmatter.pinned: boolean (parse default false)
  // prompt.ts
  export const EXTERNAL_SUMMARY_SYSTEM_PROMPT: string
  export function buildExternalUserPrompt(r: { title: string; whatItCovers: string; whyItMatters: string }): string
  export function isValidExternalSummary(md: string): boolean   // 1 H2, 1–3 H3, 60–250 words
  // index.ts
  export async function regenerateSummary(config, site, slug, deps?, opts?: { pin?: boolean }): Promise<{ path: string }>
  export async function setSummaryPinned(config: AgentConfig, site: string, slug: string, pinned: boolean): Promise<{ path: string }>
  // http.ts
  export function parseRegenerateBody(raw: string): { site: string; slug: string; pin: boolean }
  export function parsePinBody(raw: string): { site: string; slug: string; pinned: boolean }
  ```

- [ ] **Step 1: Failing tests**

```ts
// grid-summaries-core.test.ts
it.each([
  [{ theme: { template: 'grid' }, grid: { story_mode: 'ai_summary' } }, { network: true, external: false }],
  [{ theme: { template: 'grid' }, grid: { external_story_mode: 'ai_summary' } }, { network: false, external: true }],
  [{ theme: { template: 'grid' }, grid: {} }, { network: false, external: false }],
  [{ theme: { template: 'modern' } }, null],
])('gridSummaryModes(%o)', (cfg, expected) => expect(gridSummaryModes(cfg)).toEqual(expected));
it('needsSummary picks by kind', () => {
  expect(needsSummary({ site: 'aggregator' }, { network: false, external: true })).toBe(true);
  expect(needsSummary({ site: 'coolnews' }, { network: false, external: true })).toBe(false);
});
it('external prompt only uses What It Covers / Why It Matters', () => {
  const p = buildExternalUserPrompt({ title: 'T', whatItCovers: 'W', whyItMatters: 'Y' });
  expect(p).toContain('W'); expect(p).toContain('Y'); expect(p).not.toMatch(/Content Opportunity|Key Angles/);
});
it('isValidExternalSummary accepts the short shape', () => {
  const md = `## Headline\n\n${'word '.repeat(50)}\n\n### One\n\n${'word '.repeat(40)}\n\n### Two\n\n${'word '.repeat(30)}`;
  expect(isValidExternalSummary(md)).toBe(true);
  expect(isValidExternalSummary('## H\n\ntoo short')).toBe(false);
});
it('frontmatter round-trips pinned, defaulting to false', () => {
  expect(parseSummaryFile('---\nsource_site: aggregator\nslug: abc\n---\nx')!.fm.pinned).toBe(false);
});

// grid-summaries-http.test.ts
it('parses regenerate pin flag and the pin body', () => {
  expect(parseRegenerateBody('{"site":"aggregator","slug":"abc","pin":true}')).toEqual({ site: 'aggregator', slug: 'abc', pin: true });
  expect(parsePinBody('{"site":"aggregator","slug":"abc","pinned":false}')).toEqual({ site: 'aggregator', slug: 'abc', pinned: false });
  expect(() => parsePinBody('{"site":"aggregator","slug":"abc"}')).toThrow(/pinned/);
});

// grid-summaries-run.test.ts (uses the existing deps fakes)
it('generates external summaries from the ext record when external mode is ai_summary', async () => { /* config grid.external_story_mode ai_summary; pool item {site:'aggregator', slug:'t-<id>'}; readKv('grid-ext-item:<id>') returns record; expect mockGenerate called with system EXTERNAL_SUMMARY_SYSTEM_PROMPT and a commit to grid-summaries/aggregator/<id>.md */ });
it('does not summarise external stories when only network mode is ai_summary', async () => { /* expect no generate for aggregator items */ });
it('setSummaryPinned flips only the pinned flag and keeps the text (Review Focus 5)', async () => { /* existing file with markdown M → after unpin, committed content has pinned:false and body M */ });
```

- [ ] **Step 2: Run** `cd services/content-pipeline && npx vitest run src/__tests__/grid-summaries-*.test.ts` — FAIL.

- [ ] **Step 3: Implement**

`targets.ts`:
```ts
export function gridSummaryModes(config: unknown): { network: boolean; external: boolean } | null {
  const c = (config ?? {}) as { theme?: { template?: unknown }; grid?: { story_mode?: unknown; external_story_mode?: unknown } };
  if (c.theme?.template !== "grid") return null;
  return { network: c.grid?.story_mode === "ai_summary", external: c.grid?.external_story_mode === "ai_summary" };
}
export function needsSummary(item: { site: string }, modes: { network: boolean; external: boolean }): boolean {
  return item.site === "aggregator" ? modes.external : modes.network;
}
/** @deprecated kept for callers outside the run loop. */
export function isAiGridConfig(config: unknown): boolean { const m = gridSummaryModes(config); return !!m && (m.network || m.external); }
```
External summary file slug = the item id: pool slug `"<title-slug>-<id>"` → `id = slug.slice(-24)`; summary path `summaryPath("aggregator", id)`.

`prompt.ts`:
```ts
export const EXTERNAL_SUMMARY_SYSTEM_PROMPT = [
  "You write short story summaries for a news feed.",
  "Use only the facts given; add nothing, never speculate. Write in your own words.",
  "Output GitHub-flavoured markdown only: one line starting with '## ' (a fresh headline), one short intro paragraph,",
  "then 2 sections, each a '### ' heading followed by one paragraph.",
  "120 to 150 words in total. No links, URLs, HTML, images, lists or quotes.",
].join(" ");
export function buildExternalUserPrompt(r: { title: string; whatItCovers: string; whyItMatters: string }): string {
  return `Story title: ${r.title}\n\nWhat happened:\n${r.whatItCovers}${r.whyItMatters ? `\n\nWhy it matters now:\n${r.whyItMatters}` : ""}`;
}
export function isValidExternalSummary(md: string): boolean {
  const h2 = (md.match(/^## /gm) ?? []).length;
  const h3 = (md.match(/^### /gm) ?? []).length;
  const words = md.replace(/[#*_>`]/g, " ").split(/\s+/).filter(Boolean).length;
  return h2 === 1 && h3 >= 1 && h3 <= 3 && words >= 60 && words <= 250;
}
```

`index.ts`:
- Step 1 of `runGridSummaries`: replace `isAiGridConfig(cfg)` with `const modes = gridSummaryModes(cfg); if (!modes || !(modes.network || modes.external)) continue;` and keep `modes` alongside the pool (`pools.push({ pool, modes })`).
- Step 2: `for (const { pool, modes } of pools) for (const i of pool.items) if (needsSummary(i, modes)) needed.set(...)`.
- Step 3: branch on `site === "aggregator"`: read `grid-ext-item:<id>` via `deps.readKv(site, key, "prod") ?? staging` → `{ title, whatItCovers, whyItMatters }`; `hash = sha256(whatItCovers + "\n" + whyItMatters)`; generate with `EXTERNAL_SUMMARY_SYSTEM_PROMPT` / `buildExternalUserPrompt` / `isValidExternalSummary`; path `summaryPath("aggregator", id)`. Extract the existing `generateSummary` into `generateSummaryWith(prompt: { system: string; user: string; validate: (md: string) => boolean }, site)` so both kinds share cost recording.
- `freshFrontmatter(..., pinned = false)`; preserve `existing.fm.pinned` on regenerate unless `opts.pin` is set.
- `regenerateSummary(config, site, slug, deps, opts)`: when `site === "aggregator"` read the ext record instead of the article; set `pinned: opts?.pin ?? existing?.fm.pinned ?? false`.
- `setSummaryPinned`: read existing (404 `GridSummaryError` if none), write same markdown with `pinned` flipped; commit message `grid summaries: pin|unpin <site>/<slug>`.
- `saveEditedSummary` / readArticle: for `site === "aggregator"` read the ext record (hash as above); keep `pinned` from the existing file.

`http.ts`: `parseRegenerateBody` returns `pin: b.pin === true`; add `parsePinBody` (requires boolean `pinned`, else `GridSummaryError("pinned (boolean) is required", 400)`).

`content-generation/index.ts`: next to the existing `/grid-summaries/regenerate` handler, add `POST /grid-summaries/pin` → `parsePinBody` → `setSummaryPinned` → `sendJson(res, 200, { status: "ok", path })`; pass `{ pin }` through on regenerate.

- [ ] **Step 4: Run** the grid-summaries tests + full `npx vitest run` + `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(content-pipeline): grid summaries for aggregator stories with per-story pin`

---

### Task 9: Dashboard settings — bundles per pill, aggregator story mode, limits, blocked sources

**Files:**
- Modify: `services/dashboard/src/types/grid.ts`, `components/config/grid/TopicsEditor.tsx`, `GridSettingsForm.tsx`, `GridSettingsSection.tsx`, `components/wizard/StepGridFeed.tsx`
- Create: `components/config/grid/BlockedSourcesPicker.tsx`, `app/api/aggregator/sources/route.ts`
- Test: `components/config/grid/__tests__/TopicsEditor.test.tsx` (create), `GridSettingsForm.test.tsx`, `components/wizard/__tests__/StepGridFeed.test.tsx`, `app/api/aggregator/sources/__tests__/route.test.ts`

**Interfaces:**
- Produces (types/grid.ts):
  ```ts
  export type GridExternalStoryMode = "what_it_covers" | "ai_summary";
  export interface GridTopicFields { label: string; slug?: string; verticals: string[]; bundles?: string[] }
  // GridFields: external_story_mode?, blocked_sources?: string[], per_bundle_limit?: number
  export interface BundleOption { id: string; name: string; count: number }
  // GridPoolItem: kind?, sourceName?, summary?.pinned?
  ```
- `TopicsEditor` new prop `bundles: BundleOption[]`; `GridSettingsForm` new props `bundles: BundleOption[]`, `sources: string[]`.

- [ ] **Step 1: Failing tests**

```tsx
// TopicsEditor.test.tsx
it('adds a bundle to a pill', async () => {
  const onChange = vi.fn();
  render(<TopicsEditor value={[{ label: 'Celebs', verticals: [] }]} onChange={onChange} verticals={[]} bundles={[{ id: 'b1', name: 'Scoopella', count: 347 }]} />);
  await userEvent.click(screen.getByRole('checkbox', { name: /Scoopella \(347\)/ }));
  expect(onChange).toHaveBeenCalledWith([{ label: 'Celebs', verticals: [], bundles: ['b1'] }]);
});
it('shows a removed/unknown bundle id so it can be cleared', () => {
  render(<TopicsEditor value={[{ label: 'X', verticals: [], bundles: ['gone'] }]} onChange={vi.fn()} verticals={[]} bundles={[]} />);
  expect(screen.getByText(/gone \(missing\)/)).toBeInTheDocument();
});

// GridSettingsForm.test.tsx
it('sets the aggregator story mode, per-bundle limit and blocked sources', async () => {
  const onChange = vi.fn();
  render(<GridSettingsForm value={{}} onChange={onChange} sites={[]} verticals={[]} bundles={[]} sources={['Conspiracy', 'InStyle']} />);
  await userEvent.selectOptions(screen.getByLabelText('Aggregator stories'), 'ai_summary');
  expect(onChange).toHaveBeenLastCalledWith({ external_story_mode: 'ai_summary' });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Conspiracy' }));
  expect(onChange).toHaveBeenLastCalledWith({ blocked_sources: ['Conspiracy'] });
});
it('relabels the existing story mode as Network stories', () => {
  render(<GridSettingsForm value={{}} onChange={vi.fn()} sites={[]} verticals={[]} bundles={[]} sources={[]} />);
  expect(screen.getByLabelText('Network stories')).toBeInTheDocument();
});

// StepGridFeed.test.tsx (extend the it.each table)
["bundle-only pill", { topics: [{ label: "Celebs", verticals: [], bundles: ["b1"] }] }, true],

// sources route.test.ts
it('returns sorted unique source names from the aggregator', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ name: 'InStyle' }, { name: 'Conspiracy' }, { name: 'InStyle' }] }) });
  const res = await GET();
  expect(await res.json()).toEqual({ sources: ['Conspiracy', 'InStyle'] });
});
```

- [ ] **Step 2: Run** `cd services/dashboard && npx vitest run src/components/config/grid src/components/wizard src/app/api/aggregator` — FAIL.

- [ ] **Step 3: Implement**

- `types/grid.ts`: add the fields/types listed (mirror shared-types).
- `TopicsEditor.tsx`: under each pill's verticals, a fieldset "Bundles" rendering one checkbox per `bundles` option labelled `` `${b.name} (${b.count})` ``; toggling calls `update(i, { bundles: next.length ? next : undefined })`; ids in `topic.bundles` not in options render as a checked checkbox labelled `` `${id} (missing)` `` so they can be unticked. Update the doc comment: "pulls in stories from network sites in the selected verticals and from the selected aggregator bundles".
- `GridSettingsForm.tsx`: change the `story_mode` select's visible label and `aria-label` to "Network stories"; add a sibling select `aria-label="Aggregator stories"` with options `"" → "Inherit (default: What It Covers)"`, `what_it_covers → "What It Covers (from the aggregator)"`, `ai_summary → "AI summary (editable)"`; add `{ key: "per_bundle_limit", label: "Stories per bundle", min: 1, max: 100, hint: "Newest N stories pulled from each aggregator bundle (default 20)." }` to `NUMBER_FIELDS` (extend `NumberKey`); render `<BlockedSourcesPicker value={value.blocked_sources ?? []} options={sources} onChange={(v) => set("blocked_sources", v.length ? v : undefined)} />` in a new section "Blocked sources" with hint "Stories from these aggregator sources never appear on this site."
- `BlockedSourcesPicker.tsx`: checkbox list (same styling as `SiteMultiPicker`), plus any `value` entry missing from `options` shown checked.
- `GridSettingsSection.tsx`: fetch `/api/bundles` (existing) → `BundleOption[]` (`{ id, name, count: content_count }`) and `/api/aggregator/sources` → `string[]`; pass both to `GridSettingsForm`; on failure pass `[]` (form still works).
- `app/api/aggregator/sources/route.ts`:
  ```ts
  import { NextResponse } from "next/server";
  const AGGREGATOR_URL = process.env.CONTENT_API_BASE_URL ?? process.env.CONTENT_AGGREGATOR_URL ?? "https://content-aggregator-v2-34cd--atomic.cloudgrid.io";
  /** Aggregator source names for the Grid "Blocked sources" picker. */
  export async function GET(): Promise<NextResponse> {
    try {
      const base = AGGREGATOR_URL.replace(/\/+$/, "").replace(/\/api$/, "");
      const res = await fetch(`${base}/api/sources?page_size=200`, { headers: { Accept: "application/json" }, next: { revalidate: 300 } });
      if (!res.ok) return NextResponse.json({ sources: [] }, { status: res.status });
      const data = (await res.json()) as { items?: Array<{ name?: string }> };
      const sources = [...new Set((data.items ?? []).map((s) => s.name?.trim()).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b));
      return NextResponse.json({ sources });
    } catch (error) {
      console.error("[aggregator/sources] error:", error);
      return NextResponse.json({ sources: [] }, { status: 500 });
    }
  }
  ```
- `StepGridFeed.tsx` `isGridFeedReady`: a topic counts when `label.trim() && (verticals.length > 0 || (bundles?.length ?? 0) > 0)`; update the reason text to "Add a topic pill with a label and a vertical or bundle, or include at least one site".
- Config save: grid fields are saved through the existing site/group/override config flows (git → Mongo → revalidate); verify `config-normalizers.ts` has no Grid-field whitelist that would drop the new keys (`grep -n "grid" src/lib/config-normalizers.ts`); if it does, add the new keys there with a test.

- [ ] **Step 4: Run** the tests + `pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** — `feat(dashboard): grid bundles per pill, aggregator story mode and blocked sources`

---

### Task 10: Dashboard Stories tab — external rows and per-story AI summary

**Files:**
- Modify: `services/dashboard/src/components/site-detail/grid/StoriesTable.tsx`, `GridSiteTab.tsx`, `app/api/grid/regenerate/route.ts`
- Create: `services/dashboard/src/app/api/grid/pin/route.ts`
- Test: `components/site-detail/grid/__tests__/StoriesTable.test.tsx`, `app/api/grid/pin/__tests__/route.test.ts`

**Interfaces:**
- `StoriesTable` new props: `onUseAiSummary: (item: GridPoolItem) => void; onBackToDefault: (item: GridPoolItem) => void`.
- `POST /api/grid/pin` body `{ site, slug, pinned }` → pipeline `POST /grid-summaries/pin`. `/api/grid/regenerate` accepts `pin?: boolean` and forwards it.

- [ ] **Step 1: Failing tests**

```tsx
const external: GridPoolItem = { site: 'aggregator', slug: `t-${'a'.repeat(24)}`, title: 'Batman paused', publishDate: '2026-10-06T00:00:00Z', pills: [], pinned: false, kind: 'external', sourceName: 'Daily Mail' };
it('badges external stories with the publisher', () => {
  render(<StoriesTable pool={{ ...pool, items: [external] }} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={vi.fn()} onBackToDefault={vi.fn()} />);
  expect(screen.getByText('External · Daily Mail')).toBeInTheDocument();
});
it('offers Use AI summary when not pinned, Back to default when pinned', async () => {
  const onUse = vi.fn(); const onBack = vi.fn();
  const { rerender } = render(<StoriesTable pool={{ ...pool, items: [external] }} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={onUse} onBackToDefault={onBack} />);
  await userEvent.click(screen.getByRole('button', { name: /Use AI summary for Batman paused/ }));
  expect(onUse).toHaveBeenCalledWith(external);
  rerender(<StoriesTable pool={{ ...pool, items: [{ ...external, summary: { status: 'generated', pinned: true } }] }} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={onUse} onBackToDefault={onBack} />);
  await userEvent.click(screen.getByRole('button', { name: /Back to default for Batman paused/ }));
  expect(onBack).toHaveBeenCalled();
});
it('always shows the Summary column (overrides work in any mode)', () => {
  render(<StoriesTable pool={{ ...pool, storyMode: 'excerpt', items: [external] }} onTogglePin={vi.fn()} onEdit={vi.fn()} onUseAiSummary={vi.fn()} onBackToDefault={vi.fn()} />);
  expect(screen.getByRole('columnheader', { name: 'Summary' })).toBeInTheDocument();
});

// pin route.test.ts
it('forwards pin/unpin to the pipeline and validates input', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) });
  const res = await POST(jsonReq({ site: 'aggregator', slug: 'abc', pinned: true }));
  expect(res.status).toBe(200);
  expect(fetchMock.mock.calls[0]![0]).toMatch(/\/grid-summaries\/pin$/);
  expect((await POST(jsonReq({ site: 'aggregator', slug: 'abc' }))).status).toBe(400);
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**
- `StoriesTable.tsx`: remove the `ai` gate on the Summary column (always render); for `item.kind === "external"` render `<Badge variant="info">External · {item.sourceName}</Badge>` in the Source cell instead of the site id; status label for `none` on external rows = "What It Covers"; actions: `item.summary?.pinned ? <Button aria-label={`Back to default for ${item.title}`} …>Back to default</Button> : <Button aria-label={`Use AI summary for ${item.title}`} …>Use AI summary</Button>`, plus the existing Edit button when `item.summary && item.summary.status !== "none"`.
- `GridSiteTab.tsx`: `onUseAiSummary` → `POST /api/grid/regenerate { site, slug: summarySlug(item), pin: true }` then reload the pool; `onBackToDefault` → `POST /api/grid/pin { site, slug: summarySlug(item), pinned: false }`; `summarySlug(item) = item.site === "aggregator" ? item.slug.slice(-24) : item.slug`. Show the existing toast patterns; confirm before "Use AI summary" overwrites an edited summary (reuse the regenerate confirm).
- `app/api/grid/pin/route.ts`: mirror `regenerate/route.ts` (validate `isSafeId(site)`, `isSafeId(slug)`, `typeof pinned === "boolean"`; forward to `${getAgentUrl()}/grid-summaries/pin`).
- `regenerate/route.ts`: forward `pin: body.pin === true`.

- [ ] **Step 4: Run** tests + full dashboard suite + typecheck — PASS.
- [ ] **Step 5: Commit** — `feat(dashboard): external stories and per-story AI summary in the grid stories tab`

---

### Task 11: Docs, workflow, full verification, staging end-to-end

**Files:**
- Modify: `services/dashboard/public/guide/<grid guide page>.md` (find with `grep -ln "Grid" services/dashboard/public/guide/*.md`), `CLAUDE.md` (landmine #34: add `grid-ext-item:*` / `grid-ext-index:*`; note reserved source id `aggregator` next to #33)
- Modify (network repo, **after explicit approval**): `.github/workflows/sync-grid.yml` — add `CONTENT_API_BASE_URL: https://content-aggregator-v2-34cd.atomic.cloudgrid.io` to the seed step's `env`
- Create: `docs/test-results/2026-10-07-grid-aggregator-sources.txt`

- [ ] **Step 1:** Guide section "Aggregator bundles": attaching a bundle to a pill, the two story modes, per-story "Use AI summary", blocked sources, per-bundle limit, hourly refresh, stories never expire.
- [ ] **Step 2:** Full suites with output saved:
  ```bash
  { (cd packages/site-worker && pnpm typecheck && npx vitest run --exclude 'tests/integration/**'); \
    (cd services/content-pipeline && pnpm typecheck && npx vitest run); \
    (cd services/dashboard && pnpm typecheck && npx vitest run); } 2>&1 | tee docs/test-results/2026-10-07-grid-aggregator-sources.txt
  ```
  Record before/after test counts in the file.
- [ ] **Step 3:** Staging end-to-end (Worker deploy to staging needs the user's go-ahead): create/choose a Grid test site on staging with a pill "Celebs" → bundle Scoopella; run `seed-grid.ts` against staging KV; deploy worker to staging; verify feed mixes stories, external card → story page (What It Covers), old slug 301, blocked source hidden, an existing bundle-less Grid site unchanged (compare `/api/pool` items before/after), "Use AI summary" pins and shows the summary.
- [ ] **Step 4:** Ask for approval, then push the `sync-grid.yml` change to the network repo.
- [ ] **Step 4b:** After the production Worker deploy, re-seed every Grid site (staging + prod KV) so the new config fields reach KV (CLAUDE.md "KV Schema Evolution" step 3): for each Grid site id, `CLOUDFLARE_ACCOUNT_ID=4a8cfd85d617b38ce1813a552132bc86 pnpm seed:kv <siteId>` and again with `KV_NAMESPACE_ID=b258e47065274b8b8af1a0b6d6529c1d` for prod. List Grid sites with `grep -l "template: grid" sites/*/site.yaml` on each staging branch (or the dashboard's Template column).
- [ ] **Step 5: Commit** — `docs(grid): aggregator bundles guide, CLAUDE.md keys, test results`
