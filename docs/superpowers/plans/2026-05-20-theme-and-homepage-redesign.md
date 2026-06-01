# Theme polish + homepage redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four post-yesterday theme bugs (logo overflow, footer logo R2 path, footer site_name leak, hardcoded menu hover) and restructure the homepage into four disjoint sections: Hero / What's New (2×2 grid) / Must Reads / More on {site_name} (2-col with Show More +4).

**Architecture:** Pure utility changes first (shared-types, `selectFeatured`, pagination, `resolveLayout`), then the `seed-kv` footer-logo path fix, then Astro component edits (Header, Footer, Sidebar) and new components (WhatsNewGrid, WhatsNewCard, MoreOnSection), then the homepage wiring, then dashboard UI to expose the new config knobs. All changes are additive with defaults; no migration needed for existing site.yaml files.

**Tech Stack:** TypeScript (strict), Astro 6 (`site-worker`), Vitest (`vitest run --project unit`), Next.js 15 (`dashboard`), shared-types workspace package, Cloudflare KV + R2 (no schema changes).

**Spec:** `docs/superpowers/specs/2026-05-20-theme-and-homepage-redesign-design.md`

**Branch:** `asaf-new` (already current — do NOT create new branches; commit directly).

---

## Pre-flight

- [ ] **Step 0a: Confirm branch + clean tree**

Run:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git branch --show-current
git status --short
```

Expected: branch is `asaf-new`, working tree clean (or only contains this plan file). If not on `asaf-new`, stop and ask. Do not create new branches.

- [ ] **Step 0b: Quick baseline — site-worker unit tests green**

Run:
```bash
cd packages/site-worker && pnpm test
```

Expected: all tests pass. If anything is red **before** any of our changes, note it and ask — don't try to fix unrelated failures.

---

## Task 1: Extend `selectFeatured` with `fallbackOrder` param

**Files:**
- Modify: `packages/site-worker/src/lib/featured.ts`
- Modify: `packages/site-worker/src/lib/__tests__/featured.test.ts`

- [ ] **Step 1.1: Add failing test for `fallbackOrder: 'random'`**

Append to `packages/site-worker/src/lib/__tests__/featured.test.ts`:

```ts
describe("selectFeatured — fallbackOrder", () => {
  const tagged = A('m1', ['must-read']);
  const pool = [
    tagged,
    A('p1'), A('p2'), A('p3'), A('p4'), A('p5'),
  ];

  it("defaults to newest-order fallback (current behavior)", () => {
    const out = selectFeatured(pool, 'must-read', 3).map((a) => a.slug);
    expect(out).toEqual(['m1', 'p1', 'p2']); // tagged first, then input order
  });

  it("with fallbackOrder='random', still puts tagged articles first", () => {
    const out = selectFeatured(pool, 'must-read', 3, new Set(), 'random');
    expect(out[0].slug).toBe('m1');
    expect(out).toHaveLength(3);
    // remaining 2 are some subset of p1..p5
    expect(out.slice(1).every((a) => a.slug.startsWith('p'))).toBe(true);
    expect(new Set(out.map((a) => a.slug)).size).toBe(3); // no duplicates
  });

  it("with fallbackOrder='random', respects exclude set", () => {
    const exclude = new Set(['p1', 'p2', 'p3']);
    const out = selectFeatured(pool, 'must-read', 5, exclude, 'random');
    expect(out.map((a) => a.slug)).not.toContain('p1');
    expect(out.map((a) => a.slug)).not.toContain('p2');
    expect(out.map((a) => a.slug)).not.toContain('p3');
  });

  it("with fallbackOrder='random' and small pool, returns fewer (no duplicates)", () => {
    const out = selectFeatured([A('only', ['must-read'])], 'must-read', 5, new Set(), 'random');
    expect(out).toHaveLength(1);
    expect(out[0].slug).toBe('only');
  });

  it("with fallbackOrder='random' + seed, output is deterministic", () => {
    const a = selectFeatured(pool, 'must-read', 4, new Set(), 'random', '2026-05-20');
    const b = selectFeatured(pool, 'must-read', 4, new Set(), 'random', '2026-05-20');
    expect(a.map((x) => x.slug)).toEqual(b.map((x) => x.slug));
  });

  it("with fallbackOrder='random' + different seeds, output may differ", () => {
    // Same input, different seeds -> at least one pair of seeds yields a
    // different ordering. We assert on a small set of seeds rather than
    // a single pair, because by chance two specific seeds could collide.
    const seeds = ['2026-05-20', '2026-05-21', '2026-05-22', '2026-05-23'];
    const orderings = new Set(
      seeds.map((s) =>
        selectFeatured(pool, 'must-read', 4, new Set(), 'random', s)
          .map((x) => x.slug)
          .join(','),
      ),
    );
    expect(orderings.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 1.2: Run test — expect failure**

Run:
```bash
cd packages/site-worker && pnpm vitest run --project unit src/lib/__tests__/featured.test.ts
```

Expected: the new `fallbackOrder` tests fail (function only takes 4 args today).

- [ ] **Step 1.3: Implement `fallbackOrder` param with optional seed**

Replace contents of `packages/site-worker/src/lib/featured.ts`:

```ts
import type { ArticleIndexEntry } from './kv-schema';

export type FeaturedSlot = 'hero' | 'must-read';
export type FallbackOrder = 'newest' | 'random';

/**
 * Pick `count` articles for a featured slot. Articles tagged with the slot
 * come first (input order = sorted-by-date order from the caller). Remaining
 * slots fall back to articles from the pool — by input order ('newest', the
 * default) or in a seeded Fisher–Yates shuffle ('random') — skipping any
 * slugs already used via `exclude`.
 *
 * When `fallbackOrder === 'random'` and `seed` is provided, the shuffle is
 * deterministic: same seed + same input -> same output. This lets the
 * homepage SSR and the /api/articles endpoint agree on which articles got
 * "consumed" by the random fallback within a given seed window (typically
 * one day), so an article never appears in two sections at once.
 *
 * When `fallbackOrder === 'random'` and `seed` is omitted, the shuffle uses
 * `Math.random()` — fine for tests and one-off renders, not safe for
 * multi-endpoint coordination.
 */
export function selectFeatured(
  articles: ArticleIndexEntry[],
  slot: FeaturedSlot,
  count: number,
  exclude: Set<string> = new Set(),
  fallbackOrder: FallbackOrder = 'newest',
  seed?: string,
): ArticleIndexEntry[] {
  const out: ArticleIndexEntry[] = [];
  const used = new Set(exclude);

  // Pass 1 — tagged articles, in input order (deterministic regardless of
  // fallbackOrder so editors stay in control of curated slots).
  for (const a of articles) {
    if (out.length >= count) break;
    if (used.has(a.slug)) continue;
    if (a.featured?.includes(slot)) {
      out.push(a);
      used.add(a.slug);
    }
  }

  if (out.length >= count) return out;

  // Pass 2 — fallback from the remaining pool.
  const remaining = articles.filter((a) => !used.has(a.slug));
  const ordered =
    fallbackOrder === 'random'
      ? (seed ? shuffleSeeded(remaining, seed) : shuffleRandom(remaining))
      : remaining;

  for (const a of ordered) {
    if (out.length >= count) break;
    out.push(a);
    used.add(a.slug);
  }

  return out;
}

/** Fisher–Yates shuffle using Math.random. Returns a new array. */
function shuffleRandom<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Fisher–Yates shuffle seeded by a string. Deterministic for a given seed. */
export function shuffleSeeded<T>(arr: T[], seed: string): T[] {
  const rng = mulberry32(hashString(seed));
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** FNV-1a hash to a 32-bit unsigned int. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG. Deterministic output for a given seed. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 1.4: Run test — expect pass**

Run:
```bash
cd packages/site-worker && pnpm vitest run --project unit src/lib/__tests__/featured.test.ts
```

Expected: all tests pass (including pre-existing ones — the default-arg behavior is unchanged).

- [ ] **Step 1.5: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/lib/featured.ts packages/site-worker/src/lib/__tests__/featured.test.ts
git commit -m "$(cat <<'EOF'
feat(site-worker): add fallbackOrder + seed params to selectFeatured

Tagged articles still come first in input order. Random fallback uses
Fisher-Yates on the remaining pool — seeded (Mulberry32 + FNV-1a) when
a seed string is supplied, so homepage SSR and /api/articles can agree
on must-reads picks within a UTC day. Default stays 'newest' so
existing callers are unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `sliceMoreOn` / `hasMoreOnAfter` pagination helpers

**Files:**
- Modify: `packages/site-worker/src/lib/articles-pagination.ts`
- Modify: `packages/site-worker/src/lib/__tests__/articles-api.test.ts`

- [ ] **Step 2.1: Add failing tests**

Replace contents of `packages/site-worker/src/lib/__tests__/articles-api.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { sliceForPage, sliceMoreOn, hasMoreOnAfter } from '../articles-pagination';

const fixtures = Array.from({ length: 50 }, (_, i) => ({ slug: `s${i}`, title: `T${i}` }));

describe('sliceForPage (legacy — preserved for non-homepage callers)', () => {
  it('page 1 returns first initialCount items (page_size * 2)', () => {
    expect(sliceForPage(fixtures, 1, 10).map((x) => x.slug)).toEqual(
      Array.from({ length: 20 }, (_, i) => `s${i}`),
    );
  });
  it('page 2 returns items page_size after the initial batch', () => {
    expect(sliceForPage(fixtures, 2, 10).map((x) => x.slug)).toEqual(
      Array.from({ length: 10 }, (_, i) => `s${20 + i}`),
    );
  });
  it('page beyond end returns empty', () => {
    expect(sliceForPage(fixtures, 99, 10)).toEqual([]);
  });
  it('page < 1 clamps to 1', () => {
    expect(sliceForPage(fixtures, 0, 10).length).toBe(20);
  });
});

describe('sliceMoreOn (new — initial 8, then +4 per page)', () => {
  it('page 1 returns first `initialSize` items', () => {
    expect(sliceMoreOn(fixtures, 1, 8, 4).map((x) => x.slug)).toEqual(
      Array.from({ length: 8 }, (_, i) => `s${i}`),
    );
  });
  it('page 2 returns `loadMoreSize` items after the initial batch', () => {
    expect(sliceMoreOn(fixtures, 2, 8, 4).map((x) => x.slug)).toEqual(
      ['s8', 's9', 's10', 's11'],
    );
  });
  it('page 3 returns next chunk of `loadMoreSize`', () => {
    expect(sliceMoreOn(fixtures, 3, 8, 4).map((x) => x.slug)).toEqual(
      ['s12', 's13', 's14', 's15'],
    );
  });
  it('returns empty when start is past the end', () => {
    expect(sliceMoreOn(fixtures.slice(0, 8), 2, 8, 4)).toEqual([]);
  });
  it('page < 1 returns empty', () => {
    expect(sliceMoreOn(fixtures, 0, 8, 4)).toEqual([]);
    expect(sliceMoreOn(fixtures, -1, 8, 4)).toEqual([]);
  });
});

describe('hasMoreOnAfter', () => {
  it('page 1: true when pool > initialSize', () => {
    expect(hasMoreOnAfter(fixtures, 1, 8, 4)).toBe(true);
    expect(hasMoreOnAfter(fixtures.slice(0, 8), 1, 8, 4)).toBe(false);
    expect(hasMoreOnAfter(fixtures.slice(0, 7), 1, 8, 4)).toBe(false);
  });
  it('page N>=2: true when pool > initialSize + (N-1)*loadMoreSize', () => {
    // After page 2, 12 articles consumed. 50 > 12 → more exists.
    expect(hasMoreOnAfter(fixtures, 2, 8, 4)).toBe(true);
    // 50 > 8 + (10-1)*4 = 44 → still more.
    expect(hasMoreOnAfter(fixtures, 10, 8, 4)).toBe(true);
    // 50 > 8 + (11-1)*4 = 48 → still more (50 > 48).
    expect(hasMoreOnAfter(fixtures, 11, 8, 4)).toBe(true);
    // 50 > 8 + (12-1)*4 = 52 → false.
    expect(hasMoreOnAfter(fixtures, 12, 8, 4)).toBe(false);
  });
});
```

- [ ] **Step 2.2: Run tests — expect failure**

Run:
```bash
cd packages/site-worker && pnpm vitest run --project unit src/lib/__tests__/articles-api.test.ts
```

Expected: new `sliceMoreOn` / `hasMoreOnAfter` tests fail (functions not defined).

- [ ] **Step 2.3: Implement helpers**

Replace contents of `packages/site-worker/src/lib/articles-pagination.ts` with:

```ts
/**
 * Legacy slice used by non-homepage callers (kept for backward compat).
 * Page 1 returns the first `pageSize * 2` items; later pages return
 * `pageSize` items each, starting after that initial batch.
 */
export function sliceForPage<T>(all: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.floor(page));
  const initialCount = pageSize * 2;
  if (safePage === 1) return all.slice(0, initialCount);
  const start = initialCount + (safePage - 2) * pageSize;
  return all.slice(start, start + pageSize);
}

/**
 * Homepage "More on …" slicer.
 * Page 1 returns the first `initialSize` items.
 * Page N >= 2 returns the next `loadMoreSize` items per click.
 * Page < 1 returns an empty array.
 */
export function sliceMoreOn<T>(
  moreOn: T[],
  page: number,
  initialSize: number,
  loadMoreSize: number,
): T[] {
  if (!Number.isFinite(page) || page < 1) return [];
  const p = Math.floor(page);
  if (p === 1) return moreOn.slice(0, initialSize);
  const start = initialSize + (p - 2) * loadMoreSize;
  return moreOn.slice(start, start + loadMoreSize);
}

/**
 * Whether a "Show More" click on the given page would yield more items.
 * Mirrors `sliceMoreOn`'s page semantics.
 */
export function hasMoreOnAfter<T>(
  moreOn: T[],
  page: number,
  initialSize: number,
  loadMoreSize: number,
): boolean {
  if (page < 1) return moreOn.length > 0;
  if (page === 1) return moreOn.length > initialSize;
  return moreOn.length > initialSize + (page - 1) * loadMoreSize;
}
```

- [ ] **Step 2.4: Run tests — expect pass**

Run:
```bash
cd packages/site-worker && pnpm vitest run --project unit src/lib/__tests__/articles-api.test.ts
```

Expected: all tests pass.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/lib/articles-pagination.ts packages/site-worker/src/lib/__tests__/articles-api.test.ts
git commit -m "$(cat <<'EOF'
feat(site-worker): add sliceMoreOn + hasMoreOnAfter pagination helpers

For the new homepage "More on {site}" section: initial 8 articles,
+4 per Show More click. Legacy sliceForPage preserved for any
non-homepage callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend shared-types — `nav_link_hover`, `whats_new`, `more_on`, `load_more` default change

**Files:**
- Modify: `packages/shared-types/src/config.ts`

- [ ] **Step 3.1: Edit `LayoutConfig` and add new sub-types**

In `packages/shared-types/src/config.ts`, find the existing layout interfaces (around lines 188–275). Insert two new interfaces just above `LayoutConfig`:

```ts
/**
 * Configuration for the homepage "What's New" grid in the v2 magazine layout.
 */
export interface WhatsNewLayoutConfig {
  /** Whether the What's New grid is rendered. Default: true. */
  enabled?: boolean;

  /** Number of cards to display (>= 1; values < 1 are clamped at runtime). Default: 4. */
  count?: number;
}

/**
 * Configuration for the homepage "More on {site_name}" section in the v2 magazine layout.
 */
export interface MoreOnLayoutConfig {
  /** Whether the More on section is rendered. Default: true. */
  enabled?: boolean;

  /** Initial articles rendered before any "Show More" click (>= 1; clamped). Default: 8. */
  page_size?: number;
}
```

Add `whats_new` and `more_on` fields to `LayoutConfig`:

```ts
export interface LayoutConfig {
  /** Hero block configuration. */
  hero?: HeroLayoutConfig;

  /** Must-reads strip configuration. */
  must_reads?: MustReadsLayoutConfig;

  /** What's New grid configuration. */
  whats_new?: WhatsNewLayoutConfig;

  /** More on {site_name} section configuration. */
  more_on?: MoreOnLayoutConfig;

  /** Sidebar topics list configuration. */
  sidebar_topics?: SidebarTopicsConfig;

  /** Homepage "load more" pagination configuration. */
  load_more?: LoadMoreConfig;
}
```

Update `ResolvedLayoutConfig`:

```ts
export interface ResolvedLayoutConfig {
  /** Resolved hero block configuration. */
  hero: { enabled: boolean; count: 3 | 4 };

  /** Resolved must-reads strip configuration (count clamped to >= 1). */
  must_reads: { enabled: boolean; count: number };

  /** Resolved What's New grid (count clamped to >= 1). */
  whats_new: { enabled: boolean; count: number };

  /** Resolved More on section (page_size clamped to >= 1). */
  more_on: { enabled: boolean; page_size: number };

  /** Resolved sidebar topics configuration. */
  sidebar_topics: { auto: boolean; explicit: string[] };

  /** Resolved load-more pagination configuration (page_size clamped to >= 1). */
  load_more: { page_size: number };
}
```

Update `LAYOUT_DEFAULTS`:

```ts
export const LAYOUT_DEFAULTS: ResolvedLayoutConfig = {
  hero: { enabled: true, count: 4 },
  must_reads: { enabled: true, count: 5 },
  whats_new: { enabled: true, count: 4 },
  more_on: { enabled: true, page_size: 8 },
  sidebar_topics: { auto: true, explicit: [] },
  load_more: { page_size: 4 },
};
```

- [ ] **Step 3.2: Add `nav_link_hover` to `ThemeConfig.colors`** *(no change to shape required — `colors` is already `Record<string, string>`. Just document the new key in the JSDoc above `colors`.)*

Find the `ThemeConfig.colors` field (around line 122) and update the JSDoc:

```ts
  /**
   * Named colour overrides (e.g. { primary: "#1a73e8", background: "#fff" }).
   * Recognised keys include: primary, accent, background, secondary, text,
   * muted, surface, border, heading, link, link_hover, nav_link_hover,
   * footer_bg, must_reads_bg, hero_title, must_reads_title,
   * article_hero_title, article_hero_meta, feed_title, feed_desc, feed_date,
   * prose_heading, prose_body, category_header_text, footer_text,
   * footer_heading, footer_link, footer_link_hover.
   */
  colors?: Record<string, string>;
```

- [ ] **Step 3.3: Typecheck shared-types**

Run:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/shared-types && pnpm build
```

Expected: clean build, no TS errors. (`shared-types` uses `tsc` to emit to `dist/`.)

- [ ] **Step 3.4: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/shared-types/src/config.ts packages/shared-types/dist/
git commit -m "$(cat <<'EOF'
feat(shared-types): add whats_new + more_on layout blocks; nav_link_hover

LayoutConfig grows two new optional sub-configs with sensible defaults
in LAYOUT_DEFAULTS (whats_new.count=4, more_on.page_size=8).
load_more.page_size default changes from 10 to 4 to match the new
"Show More" chunk size. ResolvedLayoutConfig requires both new blocks.
Theme colors JSDoc documents the new nav_link_hover key.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `resolveLayout` for new fields

**Files:**
- Modify: `packages/site-worker/scripts/lib/resolve-layout.ts`
- Modify: `packages/site-worker/scripts/__tests__/resolve-layout.test.ts`

- [ ] **Step 4.1: Add failing tests**

Append to `packages/site-worker/scripts/__tests__/resolve-layout.test.ts`:

```ts
  it('returns defaults for whats_new when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.whats_new).toEqual({ enabled: true, count: 4 });
  });

  it('returns defaults for more_on when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.more_on).toEqual({ enabled: true, page_size: 8 });
  });

  it('default load_more.page_size is now 4 (was 10)', () => {
    const out = resolveLayout(undefined);
    expect(out.load_more.page_size).toBe(4);
  });

  it('clamps whats_new.count to a sane minimum', () => {
    const out = resolveLayout({ whats_new: { count: 0 } });
    expect(out.whats_new.count).toBe(1);
  });

  it('clamps more_on.page_size to a sane minimum', () => {
    const out = resolveLayout({ more_on: { page_size: 0 } });
    expect(out.more_on.page_size).toBe(1);
  });

  it('respects explicit whats_new.enabled: false', () => {
    const out = resolveLayout({ whats_new: { enabled: false } });
    expect(out.whats_new.enabled).toBe(false);
  });

  it('respects explicit more_on.enabled: false', () => {
    const out = resolveLayout({ more_on: { enabled: false } });
    expect(out.more_on.enabled).toBe(false);
  });
```

Also update the existing "returns defaults when input is undefined" test — change `page_size: 10` to `page_size: 4` and add `whats_new` / `more_on` assertions. Final state of that test:

```ts
  it('returns defaults when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.hero).toEqual({ enabled: true, count: 4 });
    expect(out.must_reads).toEqual({ enabled: true, count: 5 });
    expect(out.whats_new).toEqual({ enabled: true, count: 4 });
    expect(out.more_on).toEqual({ enabled: true, page_size: 8 });
    expect(out.sidebar_topics).toEqual({ auto: true, explicit: [] });
    expect(out.load_more).toEqual({ page_size: 4 });
  });
```

- [ ] **Step 4.2: Run tests — expect failure**

Run:
```bash
cd packages/site-worker && pnpm vitest run --project unit scripts/__tests__/resolve-layout.test.ts
```

Expected: new + updated tests fail (resolver doesn't yet populate whats_new/more_on; load_more still defaults to 10).

- [ ] **Step 4.3: Implement**

Replace contents of `packages/site-worker/scripts/lib/resolve-layout.ts` with:

```ts
/**
 * Pure helper used by `scripts/seed-kv.ts` (and by the unit tests) to
 * map a partial `LayoutConfig` (the merged-yaml product of the
 * org -> group -> site inheritance chain) into a fully-resolved
 * `ResolvedLayoutConfig` with every field populated.
 *
 * Anything in this file must be:
 *   - synchronous and pure (no fs / network / wrangler calls);
 *   - deterministic given identical input;
 *   - importable by both the script and `vitest` without extra setup.
 *
 * Defensive coercions:
 *   - `hero.count` is constrained to {3, 4}; anything else falls back
 *     to the default so an editor cannot break the page from yaml.
 *   - `must_reads.count`, `whats_new.count`, `more_on.page_size`, and
 *     `load_more.page_size` are clamped to >= 1.
 */
import {
  LAYOUT_DEFAULTS,
  type LayoutConfig,
  type ResolvedLayoutConfig,
} from '@atomic-platform/shared-types';

const VALID_HERO_COUNTS = new Set([3, 4]);

/**
 * Resolves a partial `LayoutConfig` into a fully-populated
 * `ResolvedLayoutConfig` by layering it over `LAYOUT_DEFAULTS`.
 * Returns the defaults verbatim when `input` is `undefined`.
 */
export function resolveLayout(input: LayoutConfig | undefined): ResolvedLayoutConfig {
  const heroCount = input?.hero?.count;
  return {
    hero: {
      enabled: input?.hero?.enabled ?? LAYOUT_DEFAULTS.hero.enabled,
      count: VALID_HERO_COUNTS.has(heroCount as number)
        ? (heroCount as 3 | 4)
        : LAYOUT_DEFAULTS.hero.count,
    },
    must_reads: {
      enabled: input?.must_reads?.enabled ?? LAYOUT_DEFAULTS.must_reads.enabled,
      count: Math.max(1, input?.must_reads?.count ?? LAYOUT_DEFAULTS.must_reads.count),
    },
    whats_new: {
      enabled: input?.whats_new?.enabled ?? LAYOUT_DEFAULTS.whats_new.enabled,
      count: Math.max(1, input?.whats_new?.count ?? LAYOUT_DEFAULTS.whats_new.count),
    },
    more_on: {
      enabled: input?.more_on?.enabled ?? LAYOUT_DEFAULTS.more_on.enabled,
      page_size: Math.max(1, input?.more_on?.page_size ?? LAYOUT_DEFAULTS.more_on.page_size),
    },
    sidebar_topics: {
      auto: input?.sidebar_topics?.auto ?? LAYOUT_DEFAULTS.sidebar_topics.auto,
      explicit: input?.sidebar_topics?.explicit ?? LAYOUT_DEFAULTS.sidebar_topics.explicit,
    },
    load_more: {
      page_size: Math.max(1, input?.load_more?.page_size ?? LAYOUT_DEFAULTS.load_more.page_size),
    },
  };
}
```

- [ ] **Step 4.4: Run tests — expect pass**

Run:
```bash
cd packages/site-worker && pnpm vitest run --project unit scripts/__tests__/resolve-layout.test.ts
```

Expected: all tests pass (old + new).

- [ ] **Step 4.5: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/scripts/lib/resolve-layout.ts packages/site-worker/scripts/__tests__/resolve-layout.test.ts
git commit -m "$(cat <<'EOF'
feat(site-worker): resolve whats_new + more_on layout; load_more default 4

Defaults: whats_new { enabled: true, count: 4 }, more_on { enabled: true,
page_size: 8 }, load_more.page_size: 4 (was 10). Existing sites with an
explicit load_more.page_size keep their value.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix footer logo R2 path rewrite in seed-kv

**Files:**
- Modify: `packages/site-worker/scripts/seed-kv.ts`
- Modify: `packages/site-worker/scripts/__tests__/resolve.test.ts` (or wherever footer_logo round-trip can be tested)

- [ ] **Step 5.1: Locate existing rewrite block**

Run:
```bash
grep -n "theme.logo\|theme.favicon\|rewriteFrontmatterUrl" packages/site-worker/scripts/seed-kv.ts | head -20
```

Confirm there's an existing block around line 440 that calls `rewriteFrontmatterUrl(theme.logo, siteId)` and `rewriteFrontmatterUrl(theme.favicon, siteId)` but not `theme.footer_logo`.

- [ ] **Step 5.2: Add a failing test**

Check whether there's an existing test for the rewrite block. If `resolve.test.ts` covers `rewriteFrontmatterUrl` directly (it does — see lines 224+), we instead want a test at the seed-kv level. Open `packages/site-worker/scripts/__tests__/` and look for any existing seed-kv tests:

```bash
ls packages/site-worker/scripts/__tests__/
```

If there's a `seed-kv.test.ts`, append a test there. If not, add a focused unit test in a new file `packages/site-worker/scripts/__tests__/theme-asset-rewrite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rewriteFrontmatterUrl } from '../lib/resolve';

/**
 * Sanity test that mirrors the seed-kv block: theme.logo, theme.favicon,
 * AND theme.footer_logo must all be rewritten to per-site R2 paths.
 * Regression guard for the original bug where footer_logo was skipped.
 */
describe('theme asset path rewriting (seed-kv contract)', () => {
  const siteId = 'wineoceans';

  function rewriteThemeAssets(theme: Record<string, unknown>): Record<string, unknown> {
    const next = { ...theme };
    if (typeof next.logo === 'string') next.logo = rewriteFrontmatterUrl(next.logo, siteId);
    if (typeof next.favicon === 'string') next.favicon = rewriteFrontmatterUrl(next.favicon, siteId);
    if (typeof next.footer_logo === 'string') next.footer_logo = rewriteFrontmatterUrl(next.footer_logo, siteId);
    return next;
  }

  it('rewrites logo, favicon, and footer_logo to /<siteId>/assets/...', () => {
    const out = rewriteThemeAssets({
      logo: '/assets/logo.png',
      favicon: '/assets/favicon.png',
      footer_logo: '/assets/logo-footer.png',
    });
    expect(out.logo).toBe('/wineoceans/assets/logo.png');
    expect(out.favicon).toBe('/wineoceans/assets/favicon.png');
    expect(out.footer_logo).toBe('/wineoceans/assets/logo-footer.png');
  });

  it('leaves footer_logo untouched when absent', () => {
    const out = rewriteThemeAssets({ logo: '/assets/logo.png' });
    expect(out.footer_logo).toBeUndefined();
  });
});
```

Note: this test verifies the helper does the right thing. The real proof point is in step 5.3 where seed-kv invokes it.

- [ ] **Step 5.3: Add the one-line fix in seed-kv**

In `packages/site-worker/scripts/seed-kv.ts`, find the existing rewrite block (around lines 440–447). Add the footer_logo line:

```ts
  // Rewrite theme.logo / theme.favicon / theme.footer_logo `/assets/...` paths
  // the same way as article images so they resolve against the per-site R2
  // bundle. Bare `/assets/logo.png` 404s on the Worker.
  {
    const theme = config.theme as Record<string, unknown> | undefined;
    if (theme) {
      if (typeof theme.logo === 'string') theme.logo = rewriteFrontmatterUrl(theme.logo, siteId);
      if (typeof theme.favicon === 'string') theme.favicon = rewriteFrontmatterUrl(theme.favicon, siteId);
      if (typeof theme.footer_logo === 'string') theme.footer_logo = rewriteFrontmatterUrl(theme.footer_logo, siteId);
    }
  }
```

(Preserve the exact structure of the existing block — only add the third `if`. If the surrounding code differs slightly, only add the footer_logo line; don't restructure.)

- [ ] **Step 5.4: Run tests — expect pass**

Run:
```bash
cd packages/site-worker && pnpm test
```

Expected: all unit tests pass (including the new one).

- [ ] **Step 5.5: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/scripts/seed-kv.ts packages/site-worker/scripts/__tests__/theme-asset-rewrite.test.ts
git commit -m "$(cat <<'EOF'
fix(site-worker): rewrite theme.footer_logo to per-site R2 path in seed-kv

seed-kv was rewriting theme.logo and theme.favicon from /assets/... to
/<siteId>/assets/... but skipping theme.footer_logo, so any site with a
separate footer logo 404'd the image on every render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Fix nav-bar logo overflow + nav_link_hover (Header + BaseLayout)

**Files:**
- Modify: `packages/site-worker/src/layouts/BaseLayout.astro`
- Modify: `packages/site-worker/src/themes/modern/components/Header.astro`

- [ ] **Step 6.1: Emit `--nav-height` and clamp `--logo-height` in BaseLayout**

In `packages/site-worker/src/layouts/BaseLayout.astro`, find lines 49–62 (the cssVars block). Replace:

```ts
const logoHeight = typeof theme.logo_height === 'number' ? theme.logo_height : 52;
const logoHeightFooter = typeof theme.logo_height_footer === 'number' ? theme.logo_height_footer : null;

const colorVars = Object.entries(theme.colors)
  .map(([key, value]) => `--color-${key}: ${value};`)
  .join(' ');

const cssVars = [
  colorVars,
  `--logo-height: ${logoHeight}px;`,
  logoHeightFooter != null ? `--logo-height-footer: ${logoHeightFooter}px;` : '',
]
  .filter(Boolean)
  .join(' ');
```

with:

```ts
const rawLogoHeight = typeof theme.logo_height === 'number' ? theme.logo_height : 52;
const logoHeight = Math.min(rawLogoHeight, 104); // clamp so logo never overflows nav cap
const logoHeightFooter = typeof theme.logo_height_footer === 'number' ? theme.logo_height_footer : null;
// Nav grows with the logo (8px padding top + 8px bottom), min 64px (mobile), max 120px.
const navHeight = Math.min(Math.max(64, logoHeight + 16), 120);

const colorVars = Object.entries(theme.colors)
  .map(([key, value]) => `--color-${key}: ${value};`)
  .join(' ');

const cssVars = [
  colorVars,
  `--logo-height: ${logoHeight}px;`,
  `--nav-height: ${navHeight}px;`,
  logoHeightFooter != null ? `--logo-height-footer: ${logoHeightFooter}px;` : '',
]
  .filter(Boolean)
  .join(' ');
```

- [ ] **Step 6.2: Rewrite the nav sizing in `Header.astro`**

In `packages/site-worker/src/themes/modern/components/Header.astro`, find the `.nav-inner` rule (around line 115) and change `height: 64px` to `min-height: var(--nav-height, 64px)` plus vertical padding:

```css
  .nav-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 1rem;
    min-height: var(--nav-height, 64px);
  }
```

Find `.nav-spacer` (around line 275) and change:

```css
  .nav-spacer {
    height: var(--nav-height, 64px);
  }
```

Find `.mobile-drawer` (around line 234) and change `top: 64px` to:

```css
  .mobile-drawer {
    position: fixed;
    top: var(--nav-height, 64px);
    right: 0;
    bottom: 0;
    ...
  }
```

(Don't change other properties in that selector — only `top`.)

- [ ] **Step 6.3: Wire `nav_link_hover` in `.nav-link` and `.drawer-link` hover states**

In the same file, find `.nav-link:hover` (around line 173) and change `color: var(--color-accent, #f4c542)` to `color: var(--color-nav_link_hover, var(--color-accent, #f4c542))`:

```css
  .nav-link:hover {
    background: rgba(255,255,255,0.1);
    color: var(--color-nav_link_hover, var(--color-accent, #f4c542));
  }
```

Find `.drawer-link:hover` (around line 269) and change the same way:

```css
  .drawer-link:hover {
    background: rgba(255,255,255,0.1);
    color: var(--color-nav_link_hover, var(--color-accent, #f4c542));
  }
```

- [ ] **Step 6.4: Typecheck site-worker**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/layouts/BaseLayout.astro packages/site-worker/src/themes/modern/components/Header.astro
git commit -m "$(cat <<'EOF'
fix(site-worker): nav bar grows with logo height (capped); add nav_link_hover

BaseLayout emits --nav-height = clamp(64, logoHeight + 16, 120) and
clamps --logo-height to 104px max. Header uses min-height + padding
instead of a fixed 64px so the bar grows for taller logos without
clipping. Nav and drawer hover colors now read --color-nav_link_hover
with --color-accent as the fallback (existing sites unchanged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Fix Footer site_name leak under logo

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/Footer.astro`

- [ ] **Step 7.1: Make tagline rendering conditional**

In `packages/site-worker/src/themes/modern/components/Footer.astro`, find the about column (lines 33–44):

```astro
    <div class="footer-col footer-about">
      <div class="footer-logo-group">
        {footerLogoSrc ? (
          <img src={footerLogoSrc} alt={config.site_name} class="footer-logo" />
        ) : (
          <span class="footer-logo-text">{config.site_name}</span>
        )}
      </div>
      <p class="footer-tagline">
        {config.site_tagline ?? config.site_name}
      </p>
    </div>
```

Replace with:

```astro
    <div class="footer-col footer-about">
      <div class="footer-logo-group">
        {footerLogoSrc ? (
          <img src={footerLogoSrc} alt={config.site_name} class="footer-logo" />
        ) : (
          <span class="footer-logo-text">{config.site_name}</span>
        )}
      </div>
      {/* Tagline rules:
          - logo present: never render tagline (the brand image is enough)
          - no logo + tagline set: render tagline below the site_name
          - no logo + no tagline: render nothing below site_name */}
      {!footerLogoSrc && config.site_tagline && (
        <p class="footer-tagline">{config.site_tagline}</p>
      )}
    </div>
```

- [ ] **Step 7.2: Typecheck**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean.

- [ ] **Step 7.3: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/themes/modern/components/Footer.astro
git commit -m "$(cat <<'EOF'
fix(site-worker): never render site_name under footer logo

Footer tagline now renders only when there is no logo (and a tagline
is explicitly set). With a logo, the about column shows only the
brand image — no duplicated text below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Remove "More" widget from Sidebar

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/Sidebar.astro`

- [ ] **Step 8.1: Remove `sidebar-more` block from both variants**

In `packages/site-worker/src/themes/modern/components/Sidebar.astro`, replace the entire `<aside>` body with:

```astro
<aside class="sidebar">
  <div class="sidebar-sticky">
    {variant === 'home' && (
      <>
        <AdSlot position="sidebar" pageType="homepage" server:defer />
        <NewsletterBox domain={config.domain} />
      </>
    )}
    {variant === 'article' && (
      <>
        <AdSlot position="sidebar" pageType="article" server:defer />
        <NewsletterBox domain={config.domain} />
        {categories.map((c) => (
          <CategoryList topic={c.topic} articles={c.articles} />
        ))}
      </>
    )}
  </div>
</aside>
```

Also remove the now-unused `latestArticles` prop and the CSS rules `.sidebar-more-heading`, `.sidebar-more-list`, `.sidebar-more-link` from the `<style>` block (entire blocks; not just selectors). The new Props interface:

```ts
interface Props {
  variant: 'home' | 'article';
  config: ResolvedConfig;
  categories?: { topic: string; articles: ArticleIndexEntry[] }[];
}
const { config, variant, categories = [] } = Astro.props;
```

Also remove the now-unused `ArticleIndexEntry` import if no other reference uses it. Verify:

```bash
grep -n "ArticleIndexEntry" packages/site-worker/src/themes/modern/components/Sidebar.astro
```

If `categories` still uses it (it does — in the Props type), keep the import.

- [ ] **Step 8.2: Find callers of the removed `latestArticles` prop**

Run:
```bash
grep -rn "latestArticles" packages/site-worker/src/
```

Expected callers: `pages/index.astro` and `pages/[slug]/index.astro` (or similar). Note them — they'll be fixed in Task 12 (homepage) and a small edit to the article page below.

- [ ] **Step 8.3: Remove `latestArticles` from article-page Sidebar call**

Find each remaining `<Sidebar` usage that still passes `latestArticles=`. For the article page(s) only (NOT index.astro — that's handled in Task 12), drop the `latestArticles={...}` attribute and remove the surrounding `latestArticles` variable if it's now unused. Use:

```bash
grep -rn "<Sidebar\b" packages/site-worker/src/
```

For each file other than `pages/index.astro`, open it, remove `latestArticles={...}` from the `<Sidebar` tag and remove any now-dead `const ... = visible.filter(...).slice(0, 2)` lines. Do not change behavior of categories or any other prop.

- [ ] **Step 8.4: Typecheck**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean.

- [ ] **Step 8.5: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/themes/modern/components/Sidebar.astro packages/site-worker/src/pages/
git commit -m "$(cat <<'EOF'
refactor(site-worker): remove sidebar "More" widget; drop latestArticles prop

Per the homepage redesign, overflow articles now live in the new
"More on {site_name}" section. The sidebar keeps only the ad slot,
newsletter box, and (on article pages) category lists. Callers no
longer pass latestArticles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Create `WhatsNewCard` + `WhatsNewGrid` components

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/WhatsNewCard.astro`
- Create: `packages/site-worker/src/themes/modern/components/WhatsNewGrid.astro`

- [ ] **Step 9.1: Create `WhatsNewCard.astro`**

```astro
---
/**
 * Modern theme — image-prominent card used by the "What's New" homepage grid.
 *
 * Image on top (16:10), title below (clamped 2 lines), date in muted color.
 * No excerpt — the grid is visual, not text-heavy.
 */
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; }
const { article } = Astro.props;
const href = `/${article.slug}`;
const dateLabel = new Date(article.publishDate).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric',
});
---

<article class="whats-new-card">
  <a class="whats-new-card-thumb" href={href} aria-hidden="true" tabindex="-1">
    {article.featuredImage && <img src={article.featuredImage} alt="" loading="lazy" />}
  </a>
  <div class="whats-new-card-body">
    <a class="whats-new-card-title-link" href={href}>
      <h3 class="whats-new-card-title">{article.title}</h3>
    </a>
    <p class="whats-new-card-date">{dateLabel}</p>
  </div>
</article>

<style>
  .whats-new-card {
    display: flex;
    flex-direction: column;
    background: var(--color-surface, #f8f9fa);
    border-radius: var(--radius-md, 8px);
    overflow: hidden;
    transition: transform 200ms ease;
  }
  .whats-new-card:hover { transform: translateY(-2px); }

  .whats-new-card-thumb {
    display: block;
    aspect-ratio: 16/10;
    overflow: hidden;
    background: var(--color-border, #e5e7eb);
  }
  .whats-new-card-thumb img {
    width: 100%; height: 100%; object-fit: cover;
    transition: transform 400ms ease;
  }
  .whats-new-card-thumb:hover img { transform: scale(1.05); }

  .whats-new-card-body { padding: 0.875rem 1rem 1rem; }
  .whats-new-card-title-link { color: inherit; text-decoration: none; }
  .whats-new-card-title {
    font-size: var(--text-lg, 1.125rem);
    font-weight: 700;
    line-height: 1.3;
    margin: 0 0 0.375rem;
    color: var(--color-feed_title, var(--color-text, #1a1a2e));
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .whats-new-card-date {
    font-size: var(--text-sm, 0.875rem);
    color: var(--color-feed_date, var(--color-muted, #6b7280));
    margin: 0;
  }
</style>
```

- [ ] **Step 9.2: Create `WhatsNewGrid.astro`**

```astro
---
/**
 * Modern theme — "What's New" homepage grid.
 *
 * 2×2 grid of image-prominent cards on desktop; 1-column on mobile.
 */
import WhatsNewCard from './WhatsNewCard.astro';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { articles: ArticleIndexEntry[]; heading?: string; }
const { articles, heading = "What's New?" } = Astro.props;
---

{articles.length > 0 && (
  <section class="whats-new-grid">
    <h2 class="whats-new-grid-heading">{heading}</h2>
    <div class="whats-new-grid-cards">
      {articles.map((article) => <WhatsNewCard article={article} />)}
    </div>
  </section>
)}

<style>
  .whats-new-grid-heading {
    font-size: var(--text-2xl, 1.5rem);
    font-weight: 700;
    margin: 0 0 1.25rem;
    color: var(--color-heading, var(--color-text, #1a1a2e));
  }
  .whats-new-grid-cards {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
  @media (min-width: 640px) {
    .whats-new-grid-cards { grid-template-columns: repeat(2, 1fr); }
  }
</style>
```

- [ ] **Step 9.3: Typecheck**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean (components are not yet imported anywhere — that happens in Task 12).

- [ ] **Step 9.4: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/themes/modern/components/WhatsNewCard.astro packages/site-worker/src/themes/modern/components/WhatsNewGrid.astro
git commit -m "$(cat <<'EOF'
feat(site-worker): add WhatsNewCard + WhatsNewGrid components

2×2 image-prominent grid for the homepage's new "What's New?" section
(image on top, title, date). Wired into the homepage in a later task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Create `MoreOnSection` component

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/MoreOnSection.astro`

- [ ] **Step 10.1: Create the component**

```astro
---
/**
 * Modern theme — "More on {site_name}" homepage section.
 *
 * 2-column grid of horizontal FeedCards (thumb left, title/date/excerpt right)
 * with Show More button below. The cards container id (`more-on-list`) is
 * the LoadMoreButton's append target.
 */
import FeedCard from './FeedCard.astro';
import LoadMoreButton from './LoadMoreButton.astro';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props {
  siteName: string;
  articles: ArticleIndexEntry[];
  nextPage: number;
  hasMore: boolean;
}
const { siteName, articles, nextPage, hasMore } = Astro.props;
---

{articles.length > 0 && (
  <section class="more-on">
    <div class="more-on-inner">
      <h2 class="more-on-heading">More on {siteName}</h2>
      <div class="more-on-grid" id="more-on-list">
        {articles.map((article) => <FeedCard article={article} />)}
      </div>
      <LoadMoreButton nextPage={nextPage} hasMore={hasMore} />
    </div>
  </section>
)}

<style>
  .more-on { padding: 2rem 0 1rem; }
  .more-on-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    padding: 0 1rem;
  }
  .more-on-heading {
    font-size: var(--text-2xl, 1.5rem);
    font-weight: 700;
    margin: 0 0 1.25rem;
    color: var(--color-heading, var(--color-text, #1a1a2e));
  }
  .more-on-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0 2rem;
  }
  @media (min-width: 768px) {
    .more-on-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
```

- [ ] **Step 10.2: Typecheck**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean.

- [ ] **Step 10.3: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/themes/modern/components/MoreOnSection.astro
git commit -m "$(cat <<'EOF'
feat(site-worker): add MoreOnSection component

Wraps the heading "More on {site_name}", a 2-col FeedCard grid (id
#more-on-list), and the LoadMoreButton. Used on the homepage after
the Must Reads strip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Repoint `LoadMoreButton` to `#more-on-list`

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/LoadMoreButton.astro`

- [ ] **Step 11.1: Change the inline script's target id**

In `LoadMoreButton.astro`, find this line:
```js
var feed = document.getElementById('article-feed-list');
```

Change to:
```js
var feed = document.getElementById('more-on-list');
```

No other changes in this file.

- [ ] **Step 11.2: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/themes/modern/components/LoadMoreButton.astro
git commit -m "$(cat <<'EOF'
refactor(site-worker): LoadMoreButton appends to #more-on-list

The homepage feed grid id moved from #article-feed-list to #more-on-list
along with the section rename. ArticleFeed.astro is no longer used on
the homepage; the legacy id is no longer rendered.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Rewire `index.astro` homepage

**Files:**
- Modify: `packages/site-worker/src/pages/index.astro`

- [ ] **Step 12.1: Replace homepage body with the new article allocation and section order**

Replace the entire contents of `packages/site-worker/src/pages/index.astro` with:

```astro
---
export const prerender = false;

import BaseLayout from '../layouts/BaseLayout.astro';
import SEOHead from '../components/SEOHead.astro';
import Header from '../themes/modern/components/Header.astro';
import Footer from '../themes/modern/components/Footer.astro';
import HeroGrid from '../themes/modern/components/HeroGrid.astro';
import WhatsNewGrid from '../themes/modern/components/WhatsNewGrid.astro';
import Sidebar from '../themes/modern/components/Sidebar.astro';
import MustReads from '../themes/modern/components/MustReads.astro';
import MoreOnSection from '../themes/modern/components/MoreOnSection.astro';
import AdSlot from '../components/AdSlot.astro';
import { env } from 'cloudflare:workers';
import { getConfig, getSiteId, isPreviewMode, getCanonicalDomain } from '../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../lib/kv-schema';
import { isVisibleArticle } from '../utils/article-status';
import { selectFeatured } from '../lib/featured';
import { sliceMoreOn, hasMoreOnAfter } from '../lib/articles-pagination';

const config = getConfig(Astro);
const siteId = getSiteId(Astro);
const preview = isPreviewMode(Astro);

const allArticles =
  (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];

const visible = allArticles
  .filter((a) => preview || isVisibleArticle(a.status))
  .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

const url = new URL(Astro.request.url);
const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));

// Daily-stable random seed — the homepage SSR and /api/articles must
// pass the SAME seed so they agree on which articles got "consumed"
// by the must-reads random fallback, keeping section allocation
// strictly disjoint within the day.
const randomSeed = `${siteId}:${new Date().toISOString().slice(0, 10)}`;

// --- Section: Hero -----------------------------------------------------------
const heroArticles = config.layout.hero.enabled
  ? selectFeatured(visible, 'hero', config.layout.hero.count)
  : [];
const heroSlugs = new Set(heroArticles.map((a) => a.slug));

// --- Section: What's New (next N newest after hero) --------------------------
const whatsNewArticles = config.layout.whats_new.enabled
  ? visible.filter((a) => !heroSlugs.has(a.slug)).slice(0, config.layout.whats_new.count)
  : [];
const whatsNewSlugs = new Set(whatsNewArticles.map((a) => a.slug));

const consumed = new Set<string>([...heroSlugs, ...whatsNewSlugs]);

// --- Section: Must Reads (tagged first, random fallback) ---------------------
const mustReadArticles = config.layout.must_reads.enabled
  ? selectFeatured(visible, 'must-read', config.layout.must_reads.count, consumed, 'random', randomSeed)
  : [];
for (const a of mustReadArticles) consumed.add(a.slug);

// --- Section: More on {site} -------------------------------------------------
const moreOnPool = config.layout.more_on.enabled
  ? visible.filter((a) => !consumed.has(a.slug))
  : [];
const moreOnArticles = sliceMoreOn(
  moreOnPool,
  page,
  config.layout.more_on.page_size,
  config.layout.load_more.page_size,
);
const hasMore = hasMoreOnAfter(
  moreOnPool,
  page,
  config.layout.more_on.page_size,
  config.layout.load_more.page_size,
);
---

<BaseLayout
  title={config.site_name}
  description={config.site_tagline ?? `${config.site_name} — latest articles`}
  pageType="homepage"
>
  <Fragment slot="head">
    <SEOHead
      title={config.site_name}
      description={config.site_tagline ?? `${config.site_name} — latest articles`}
      canonicalUrl={`https://${getCanonicalDomain(Astro)}`}
      siteName={config.site_name}
    />
  </Fragment>

  <Header config={config} currentPath="/" />

  <main class="homepage">
    {config.layout.hero.enabled && <HeroGrid articles={heroArticles} />}
    <AdSlot position="homepage-top" pageType="homepage" server:defer />
    <section class="whats-new">
      <div class="whats-new-inner">
        <WhatsNewGrid articles={whatsNewArticles} />
        <Sidebar variant="home" config={config} />
      </div>
    </section>
    {config.layout.must_reads.enabled && <MustReads articles={mustReadArticles} />}
    {config.layout.more_on.enabled && (
      <MoreOnSection
        siteName={config.site_name}
        articles={moreOnArticles}
        nextPage={page + 1}
        hasMore={hasMore}
      />
    )}
  </main>

  <Footer config={config} />
  <AdSlot position="sticky-bottom" pageType="homepage" server:defer />
</BaseLayout>

<style>
  .homepage { min-height: 60vh; }
  .whats-new { padding: 2.5rem 0; }
  .whats-new-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    padding: 0 1rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
  @media (min-width: 960px) {
    .whats-new-inner { grid-template-columns: 1fr 320px; }
  }
</style>
```

- [ ] **Step 12.2: Typecheck**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean. Any "Property 'whats_new' does not exist on type ..." means shared-types didn't build — re-run `pnpm build` in `packages/shared-types`.

- [ ] **Step 12.3: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/pages/index.astro
git commit -m "$(cat <<'EOF'
refactor(site-worker): homepage uses disjoint Hero/WhatsNew/MustReads/MoreOn

- Hero: newest N (existing behavior)
- What's New: next N newest after hero (new grid)
- Must Reads: tagged-first with random fallback
- More on {site_name}: everything else, paginated 8 initial + 4 per click

Article allocation is strictly disjoint via a shared `consumed` slug set.
Sidebar no longer receives latestArticles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Update `/api/articles` to slice from the More-on pool

**Files:**
- Modify: `packages/site-worker/src/pages/api/articles.ts`

- [ ] **Step 13.1: Mirror the homepage's disjoint computation in the API**

Replace contents of `packages/site-worker/src/pages/api/articles.ts` with:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig, getSiteId, isPreviewMode } from '../../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { isVisibleArticle } from '../../utils/article-status';
import { selectFeatured } from '../../lib/featured';
import { sliceMoreOn } from '../../lib/articles-pagination';
import { renderFeedCardsHtml } from '../../themes/modern/components/_render-feed-cards';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const page = parseInt(url.searchParams.get('page') ?? '2', 10);
  const config = getConfig(ctx);
  const siteId = getSiteId(ctx);
  const preview = isPreviewMode(ctx);

  const all =
    (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];
  const visible = all
    .filter((a) => preview || isVisibleArticle(a.status))
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

  // Mirror the homepage's disjoint allocation so Load More never re-shows
  // articles already on the page (hero, what's new, or must reads).
  const heroArticles = config.layout.hero.enabled
    ? selectFeatured(visible, 'hero', config.layout.hero.count)
    : [];
  const heroSlugs = new Set(heroArticles.map((a) => a.slug));

  const whatsNewArticles = config.layout.whats_new.enabled
    ? visible.filter((a) => !heroSlugs.has(a.slug)).slice(0, config.layout.whats_new.count)
    : [];
  const consumed = new Set<string>([
    ...heroSlugs,
    ...whatsNewArticles.map((a) => a.slug),
  ]);

  // Same daily-stable seed as the homepage so both endpoints pick the
  // same must-reads — guaranteeing the "more on" pool here matches what
  // the homepage actually rendered.
  const randomSeed = `${siteId}:${new Date().toISOString().slice(0, 10)}`;

  const mustReadArticles = config.layout.must_reads.enabled
    ? selectFeatured(visible, 'must-read', config.layout.must_reads.count, consumed, 'random', randomSeed)
    : [];
  for (const a of mustReadArticles) consumed.add(a.slug);

  const moreOnPool = visible.filter((a) => !consumed.has(a.slug));
  const slice = sliceMoreOn(
    moreOnPool,
    page,
    config.layout.more_on.page_size,
    config.layout.load_more.page_size,
  );

  const html = renderFeedCardsHtml(slice);

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
```

Note: the seed (`<siteId>:<YYYY-MM-DD>`) refreshes daily, so the random must-reads pick cycles each UTC day. Within a day, every request — homepage SSR and every "Load More" page — agrees on the must-reads pick, keeping section allocation strictly disjoint.

- [ ] **Step 13.2: Typecheck**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean.

- [ ] **Step 13.3: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/pages/api/articles.ts
git commit -m "$(cat <<'EOF'
refactor(site-worker): /api/articles slices from More-on pool only

The Load More endpoint mirrors the homepage's disjoint Hero/WhatsNew/
MustReads/MoreOn allocation so subsequent pages never re-show articles
already on the page. Uses sliceMoreOn (initial 8, +4 per page).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Decide fate of `ArticleFeed.astro`

**Files:**
- Inspect: `packages/site-worker/src/themes/modern/components/ArticleFeed.astro`
- Optional delete depending on grep result.

- [ ] **Step 14.1: Check for remaining callers**

Run:
```bash
grep -rn "ArticleFeed\b" packages/site-worker/src/ packages/site-worker/scripts/ packages/site-worker/tests/
```

- If **no callers** remain (only the file itself shows up), delete it:
  ```bash
  rm packages/site-worker/src/themes/modern/components/ArticleFeed.astro
  ```
- If callers remain (e.g., category pages), **leave the file in place** — it's still valid. Skip the delete.

- [ ] **Step 14.2: Typecheck**

Run:
```bash
cd packages/site-worker && pnpm typecheck
```

Expected: clean.

- [ ] **Step 14.3: Commit (only if a file was deleted)**

If you deleted the file:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add packages/site-worker/src/themes/modern/components/ArticleFeed.astro
git commit -m "$(cat <<'EOF'
chore(site-worker): remove unused ArticleFeed.astro

Homepage now uses WhatsNewGrid + MoreOnSection; no remaining callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If you skipped the delete (callers remain), commit nothing and move on.

---

## Task 15: Dashboard — add `nav_link_hover` color picker

**Files:**
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`

- [ ] **Step 15.1: Add the field to the `ColorState` interface**

In `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`, find the `ColorState` interface (around line 16) and add `nav_link_hover: string;` next to `link_hover`:

```ts
interface ColorState {
  primary: string;
  accent: string;
  background: string;
  secondary: string;
  text: string;
  muted: string;
  surface: string;
  border: string;
  // New globals (Tier 4 — decouple from text/primary/accent)
  heading: string;
  link: string;
  link_hover: string;
  nav_link_hover: string;
  footer_bg: string;
  // ... (rest unchanged)
```

- [ ] **Step 15.2: Add `nav_link_hover` to every preset's `colors` block**

Find each `PRESETS.<name>.colors` object (around lines 71–151). For each preset, add `nav_link_hover: "<value>"` right after `link_hover`. Use the same color as the preset's `link_hover` so existing presets render identically to today:

- `classic`: `nav_link_hover: "#f4c542"` (matches link_hover)
- `bold`: `nav_link_hover: "#B81D24"`
- `ocean`: `nav_link_hover: "#10b981"`
- `editorial`: `nav_link_hover: "#ea580c"`
- (continue for any remaining presets — match each preset's `link_hover` value)

Run after editing to verify:
```bash
grep -n "nav_link_hover" services/dashboard/src/components/site-detail/SiteThemeTab.tsx
```

Expected: each preset has one occurrence.

- [ ] **Step 15.3: Add `nav_link_hover` to the COLOR_KEYS arrays**

Find the constant arrays around line 157 (`"heading", "link", "link_hover", ...`) and around line 162 (`"footer_text", "footer_heading", ...`). Insert `"nav_link_hover"` in the first group, right after `"link_hover"`:

```ts
const ADVANCED_TEXT_KEYS = [
  "heading", "link", "link_hover", "nav_link_hover",
  // ... rest unchanged
];
```

(Adjust to whatever variable names already exist — the goal is that `nav_link_hover` participates in `detectPreset` and `defaultColors`.)

- [ ] **Step 15.4: Render the picker in the Advanced text colors section**

Find the block around line 500 with `<ColorPickerField label="Link hover" ... />`. Insert a new `ColorPickerField` right after it:

```tsx
<ColorPickerField
  label="Menu item hover"
  value={state.colors.nav_link_hover}
  onChange={(v): void => setColor("nav_link_hover", v)}
  helperText="Color of nav-bar menu items on hover. Defaults to accent."
/>
```

- [ ] **Step 15.5: Typecheck dashboard**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: clean.

- [ ] **Step 15.6: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add services/dashboard/src/components/site-detail/SiteThemeTab.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): expose nav_link_hover color in Theme tab

Adds a ColorPickerField in the Advanced text colors section. Presets
seed it with each preset's existing link_hover value so theme presets
render identically to today; users can now diverge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Dashboard — add `whats_new` + `more_on` layout blocks; change `load_more` default to 4

**Files:**
- Modify: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`
- Modify: `services/dashboard/src/app/wizard/page.tsx`

- [ ] **Step 16.1: Update `LayoutState` and `DEFAULT_LAYOUT` in SiteThemeTab**

In `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`, change the `LayoutState` interface (around line 9) to:

```ts
interface LayoutState {
  hero: { enabled: boolean; count: 3 | 4 };
  must_reads: { enabled: boolean; count: number };
  whats_new: { enabled: boolean; count: number };
  more_on: { enabled: boolean; page_size: number };
  sidebar_topics: { auto: boolean; explicit: string[] };
  load_more: { page_size: number };
}
```

Change `DEFAULT_LAYOUT` (around line 61) to:

```ts
const DEFAULT_LAYOUT: LayoutState = {
  hero: { enabled: true, count: 4 },
  must_reads: { enabled: true, count: 5 },
  whats_new: { enabled: true, count: 4 },
  more_on: { enabled: true, page_size: 8 },
  sidebar_topics: { auto: true, explicit: [] },
  load_more: { page_size: 4 },
};
```

- [ ] **Step 16.2: Update the layout init block in the form's `useEffect`**

Find the block around line 196–203 that reads `(mr?.count as number) ?? DEFAULT_LAYOUT.must_reads.count` and the matching `lm?.page_size` block. Add `wn` (whats_new) and `mo` (more_on) reads alongside:

```ts
const hero = layout.hero ?? {};
const mr = layout.must_reads ?? {};
const wn = layout.whats_new ?? {};
const mo = layout.more_on ?? {};
const st = layout.sidebar_topics ?? {};
const lm = layout.load_more ?? {};

setState((s) => ({
  ...s,
  layout: {
    hero: {
      enabled: (hero.enabled as boolean) ?? DEFAULT_LAYOUT.hero.enabled,
      count: ((hero.count as 3 | 4) ?? DEFAULT_LAYOUT.hero.count),
    },
    must_reads: {
      enabled: (mr.enabled as boolean) ?? DEFAULT_LAYOUT.must_reads.enabled,
      count: (mr.count as number) ?? DEFAULT_LAYOUT.must_reads.count,
    },
    whats_new: {
      enabled: (wn.enabled as boolean) ?? DEFAULT_LAYOUT.whats_new.enabled,
      count: (wn.count as number) ?? DEFAULT_LAYOUT.whats_new.count,
    },
    more_on: {
      enabled: (mo.enabled as boolean) ?? DEFAULT_LAYOUT.more_on.enabled,
      page_size: (mo.page_size as number) ?? DEFAULT_LAYOUT.more_on.page_size,
    },
    sidebar_topics: {
      auto: (st.auto as boolean) ?? DEFAULT_LAYOUT.sidebar_topics.auto,
      explicit: (st.explicit as string[]) ?? DEFAULT_LAYOUT.sidebar_topics.explicit,
    },
    load_more: {
      page_size: (lm.page_size as number) ?? DEFAULT_LAYOUT.load_more.page_size,
    },
  },
}));
```

(Match the existing pattern — names of local vars may vary slightly. The point is: any unset field falls back to `DEFAULT_LAYOUT`.)

- [ ] **Step 16.3: Add "What's New" + "More on …" UI blocks**

In the Layout Knobs section (around line 679), after the existing "Must Reads" checkbox block (which ends around line 735) and before the `<div className="flex items-center gap-2 text-sm ...">` "Load more page size" block, insert:

```tsx
{/* What's New */}
<label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
  <input
    type="checkbox"
    checked={state.layout.whats_new.enabled}
    onChange={(e): void =>
      setState((s) => ({
        ...s,
        layout: {
          ...s.layout,
          whats_new: { ...s.layout.whats_new, enabled: e.target.checked },
        },
      }))
    }
    className="accent-cyan"
  />
  Show "What's New" grid
</label>
{state.layout.whats_new.enabled && (
  <div className="flex items-center gap-2 ml-6 text-sm text-[var(--text-secondary)]">
    <span>What's New count:</span>
    <input
      type="number"
      min={1}
      max={12}
      value={state.layout.whats_new.count}
      onChange={(e): void =>
        setState((s) => ({
          ...s,
          layout: {
            ...s.layout,
            whats_new: { ...s.layout.whats_new, count: parseInt(e.target.value, 10) || 4 },
          },
        }))
      }
      className="w-20 px-2 py-1 border rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
    />
  </div>
)}

{/* More on {site_name} */}
<label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
  <input
    type="checkbox"
    checked={state.layout.more_on.enabled}
    onChange={(e): void =>
      setState((s) => ({
        ...s,
        layout: {
          ...s.layout,
          more_on: { ...s.layout.more_on, enabled: e.target.checked },
        },
      }))
    }
    className="accent-cyan"
  />
  Show "More on {`{site_name}`}" section
</label>
{state.layout.more_on.enabled && (
  <div className="flex items-center gap-2 ml-6 text-sm text-[var(--text-secondary)]">
    <span>Initial articles:</span>
    <input
      type="number"
      min={1}
      max={50}
      value={state.layout.more_on.page_size}
      onChange={(e): void =>
        setState((s) => ({
          ...s,
          layout: {
            ...s.layout,
            more_on: { ...s.layout.more_on, page_size: parseInt(e.target.value, 10) || 8 },
          },
        }))
      }
      className="w-20 px-2 py-1 border rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
    />
  </div>
)}
```

- [ ] **Step 16.4: Update the "Load more page size" fallback default in the existing onChange**

Find the existing `onChange` for the Load-more input (around line 749): `load_more: { page_size: parseInt(e.target.value, 10) || 10 }`. Change `|| 10` to `|| 4`:

```tsx
load_more: { page_size: parseInt(e.target.value, 10) || 4 },
```

- [ ] **Step 16.5: Update wizard `page.tsx` defaults**

In `services/dashboard/src/app/wizard/page.tsx`, find the layout default block (around line 37):

```ts
load_more: { page_size: 10 },
```

Replace the whole layout default block with:

```ts
hero: { enabled: true, count: 4 },
must_reads: { enabled: true, count: 5 },
whats_new: { enabled: true, count: 4 },
more_on: { enabled: true, page_size: 8 },
sidebar_topics: { auto: true, explicit: [] },
load_more: { page_size: 4 },
```

(If the surrounding object has fewer fields, match the existing shape — the goal is: new sites pick up the new defaults. Don't add fields unrelated to layout.)

- [ ] **Step 16.6: Typecheck dashboard**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: clean.

- [ ] **Step 16.7: Commit**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add services/dashboard/src/components/site-detail/SiteThemeTab.tsx services/dashboard/src/app/wizard/page.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): expose whats_new + more_on layout knobs; default load_more=4

SiteThemeTab grows two new layout blocks (What's New, More on {site})
matching the Hero/MustReads pattern: enabled toggle + count input.
Default load_more.page_size changes 10 → 4 to match the new "Show
More" chunk. Wizard seeds the same defaults for new sites.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Update wizard's initial site.yaml theme/layout writer

**Files:**
- Modify: `services/dashboard/src/actions/wizard.ts`

- [ ] **Step 17.1: Check the wizard's site.yaml writer for layout defaults**

Run:
```bash
grep -n "layout\|whats_new\|more_on\|load_more" services/dashboard/src/actions/wizard.ts | head -20
```

If the wizard already writes `layout:` to site.yaml at site creation, add `whats_new: { enabled: true, count: 4 }` and `more_on: { enabled: true, page_size: 8 }` to that block, and change `load_more.page_size` from 10 → 4 if present.

If the wizard does NOT write a `layout:` block (defaults are pulled at seed time), there's nothing to change — skip to Task 18. Note in the commit message whichever applies.

- [ ] **Step 17.2: Typecheck**

Run:
```bash
cd services/dashboard && pnpm typecheck
```

Expected: clean.

- [ ] **Step 17.3: Commit (if there were any changes)**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git add services/dashboard/src/actions/wizard.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): seed whats_new + more_on layout defaults in wizard

New sites get whats_new (4 cards) and more_on (8 initial, +4 per click)
written into site.yaml at creation time. Brings the wizard in line with
the dashboard form defaults.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no changes were needed in Step 17.1, skip the commit.

---

## Task 18: Full typecheck + test sweep

- [ ] **Step 18.1: Run all per-package typechecks**

Run:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
cd packages/shared-types && pnpm build && cd -
cd packages/site-worker && pnpm typecheck && cd -
cd services/dashboard && pnpm typecheck && cd -
cd services/content-pipeline && pnpm typecheck && cd -
```

Expected: every package clean.

- [ ] **Step 18.2: Run all unit tests**

Run:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/site-worker
pnpm test
```

Expected: all unit tests pass (incl. the new tests from tasks 1, 2, 4, 5).

- [ ] **Step 18.3: If any failure — diagnose and fix**

Do NOT mark this task complete with a red bar. Fix and re-run. Common categories:

- Type errors after shared-types rebuild — re-run `pnpm build` in `packages/shared-types`.
- Snapshot mismatches in unrelated tests — read the diff first, don't blindly update snapshots.
- Sidebar callers with stale `latestArticles` — grep again and clean.

---

## Task 19: Manual visual smoke test (developer-driven)

This is the only human-in-the-loop step. Treat it as a checklist for the developer; nothing to commit unless a problem is found.

- [ ] **Step 19.1: Seed KV against the wineoceans local network repo**

Per `CLAUDE.md`:
```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform/packages/site-worker
CLOUDFLARE_ACCOUNT_ID=4a8cfd85d617b38ce1813a552132bc86 \
NETWORK_DATA_PATH=/Users/asafcohen/Desktop/ATL-Content-Network/atomic-labs-network \
pnpm seed:kv wineoceans wineoceans.com
```

Expected: seed succeeds; KV `site-config:wineoceans` updated.

- [ ] **Step 19.2: Start the dev server**

```bash
pnpm dev
```

Expected: Astro dev server listens on `:4321`.

- [ ] **Step 19.3: Visual check — wineoceans homepage**

Open `http://localhost:4321/?_atl_site=wineoceans` in a browser. Verify:

1. Nav bar grows with the 96px wineoceans logo, no clipping.
2. Footer logo renders (no broken image icon). Inspect: `<img src="/wineoceans/assets/logo-footer.png">` (not `/assets/logo-footer.png`).
3. Footer about column shows the logo only, with no site_name text under it.
4. Hover over a menu item — color changes (accent fallback applies if no `nav_link_hover` set).
5. "What's New?" section is a 2×2 grid of image-on-top cards.
6. Must Reads section renders as before.
7. "More on Wineoceans" section is a 2-column grid of 8 horizontal cards.
8. "Load More" button appears below; click it → 4 more cards append.
9. Sidebar shows the ad slot + newsletter only — no "MORE" widget.

- [ ] **Step 19.4: Visual check — a site with no separate footer logo**

If another local site exists without `theme.footer_logo`, repeat steps 19.1–19.3 against it. Verify footer falls back to `theme.logo` (not broken).

If only wineoceans is locally seeded, skip this sub-step.

- [ ] **Step 19.5: Mobile viewport check**

In the same browser, resize to 375px wide. Verify:

1. Nav bar height drops to 64px (the clamp's lower bound).
2. What's New grid becomes 1-column.
3. More on grid becomes 1-column.
4. Mobile drawer opens from the right and aligns with the (smaller) nav.

If any of 19.3–19.5 fail, **do not mark complete**. Open the relevant file from the relevant task and fix; commit the fix; re-test.

---

## Task 20: Push branch

- [ ] **Step 20.1: Push asaf-new**

```bash
cd /Users/asafcohen/Desktop/ATL-Content-Network/atomic-content-platform
git status --short
git push origin asaf-new
```

Expected: push succeeds. No PR is opened here — that's a separate user-initiated step.

---

## Self-review checklist (for the implementer before declaring done)

- [ ] Every task's tests pass on their own (`pnpm vitest run ...`)
- [ ] `pnpm test` in site-worker is green end-to-end
- [ ] `pnpm typecheck` clean in shared-types, site-worker, dashboard, content-pipeline
- [ ] Manual checks in Task 19 all green
- [ ] No `console.log` left in modified files
- [ ] No backwards-compat shims, dead code, or unused imports introduced
- [ ] Every commit message uses the format from the plan (conventional + Co-Authored-By)
