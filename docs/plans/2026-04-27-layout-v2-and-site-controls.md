# Layout v2 & Per-Site Theme Controls — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current homepage and article-page layouts with a magazine-style design (sticky header → hero grid → 2-col What's New + sticky sidebar → Must Reads band → More On grid → Load More → footer; article = header band → 2-col body + sticky sidebar → newsletter band → Related Posts → footer), and add per-site control surface (main + accent colors, font registry, layout knobs) in the wizard and site settings page.

**Architecture:** Layout markup lives in `themes/modern/components/`; a per-site `theme.layout_v2: true` toggle gates the new layout during rollout. `layout.*` block on `site.yaml` carries layout knobs and flows through the existing 5-layer config inheritance chain. Articles can carry `featured: hero | must-read` frontmatter; `selectFeatured()` helper auto-fills slots from latest articles when frontmatter is missing. Load More uses progressive enhancement: server-rendered `?page=N` URL fallback + JS fetch of `/api/articles?page=N`.

**Tech Stack:** Astro 6 + Cloudflare Workers, React 19 + Next.js 15 (dashboard), TypeScript strict, Vitest, Tailwind CSS v4, pnpm + Turborepo.

**Reference:** [docs/plans/2026-04-27-layout-v2-and-site-controls-design.md](./2026-04-27-layout-v2-and-site-controls-design.md)

**Branch:** Continue on `feat/wizard-post-migration-rewrite` (current). All commits use the conventional format and `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**Test patterns in this repo:**
- Site-worker pure-function unit tests live at `packages/site-worker/{scripts,src}/__tests__/*.test.ts`. Run with `cd packages/site-worker && pnpm vitest run --project unit`.
- Snapshot tests for Astro components: render through a small harness in `__tests__/`; we'll create the harness in Task 2.4.
- Dashboard typecheck: `cd services/dashboard && pnpm typecheck`.
- Always typecheck after type changes: `pnpm typecheck` at repo root.

---

## Phase 1 — Schema & Types

Goal: every new field exists in types + resolver + KV writer, with code-level defaults that keep all existing sites rendering identically. No UI / no layout changes yet.

### Task 1.1: Add `LayoutConfig` to shared-types

**Files:**
- Modify: `packages/shared-types/src/config.ts`
- Test: (none — type-only change, validated via `pnpm typecheck`)

**Step 1: Edit `packages/shared-types/src/config.ts`**

After the `ResolvedThemeConfig` interface (~line 147), insert:

```ts
// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface HeroLayoutConfig {
  enabled?: boolean;
  count?: 3 | 4;
}

export interface MustReadsLayoutConfig {
  enabled?: boolean;
  count?: number;
}

export interface SidebarTopicsConfig {
  auto?: boolean;
  explicit?: string[];
}

export interface LoadMoreConfig {
  page_size?: number;
}

export interface LayoutConfig {
  hero?: HeroLayoutConfig;
  must_reads?: MustReadsLayoutConfig;
  sidebar_topics?: SidebarTopicsConfig;
  load_more?: LoadMoreConfig;
}

export interface ResolvedLayoutConfig {
  hero: { enabled: boolean; count: 3 | 4 };
  must_reads: { enabled: boolean; count: number };
  sidebar_topics: { auto: boolean; explicit: string[] };
  load_more: { page_size: number };
}

export const LAYOUT_DEFAULTS: ResolvedLayoutConfig = {
  hero: { enabled: true, count: 4 },
  must_reads: { enabled: true, count: 5 },
  sidebar_topics: { auto: true, explicit: [] },
  load_more: { page_size: 10 },
};
```

In `OrgConfig` (line ~255), `GroupConfig` (line ~331), and `SiteConfig` (line ~379), add:

```ts
  /** Layout knobs for the new magazine-style layout. */
  layout?: LayoutConfig;
```

In `ThemeConfig` (line ~103) and `ResolvedThemeConfig` (line ~129), add:

```ts
  /** Toggle for the v2 magazine layout. Once all sites are migrated, this field is removed. */
  layout_v2?: boolean;
```

Make `layout_v2` required in `ResolvedThemeConfig` (`layout_v2: boolean`).

In `ResolvedConfig` (line ~460), after `theme: ResolvedThemeConfig;`, add:

```ts
  /** Fully-resolved layout configuration (all fields required). */
  layout: ResolvedLayoutConfig;
```

In `OrgConfig`, alongside `default_fonts`, add:

```ts
  default_colors?: {
    primary?: string;
    accent?: string;
  };
```

**Step 2: Verify build**

Run: `cd packages/shared-types && pnpm typecheck`
Expected: PASS, no errors.

**Step 3: Verify downstream typecheck still passes**

Run: `pnpm -w typecheck`
Expected: errors in `packages/site-worker` and `services/dashboard` because `ResolvedConfig.layout` is required but not yet provided. **This is expected** — the next tasks add the resolver. Note them in your scratch and continue.

**Step 4: Commit**

```bash
git add packages/shared-types/src/config.ts
git commit -m "feat(shared-types): add LayoutConfig and theme.layout_v2 toggle

Adds optional layout.* block to OrgConfig/GroupConfig/SiteConfig and
the ResolvedLayoutConfig + LAYOUT_DEFAULTS used by the resolver.
ResolvedConfig.layout is required so worker code can assume defaults
have already been applied. theme.layout_v2 gates the new layout per
site during rollout. default_colors added at org level for new-site
defaults flowing through inheritance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Add `featured` to ArticleIndexEntry

**Files:**
- Modify: `packages/site-worker/src/lib/kv-schema.ts`

**Step 1: Edit kv-schema.ts**

In `ArticleIndexEntry` (line 25), add the field at the end:

```ts
export interface ArticleIndexEntry {
  slug: string;
  title: string;
  description?: string;
  author: string;
  publishDate: string;
  featuredImage?: string;
  tags: string[];
  type: 'listicle' | 'how-to' | 'review' | 'standard';
  status: 'draft' | 'review' | 'published';
  /** Editorial featured flags. Empty/missing = not featured (auto-fallback fills the slot). */
  featured?: ('hero' | 'must-read')[];
}
```

**Step 2: Verify**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: existing errors only (the resolver still hasn't been updated to set `layout`); no new ones.

**Step 3: Commit**

```bash
git add packages/site-worker/src/lib/kv-schema.ts
git commit -m "feat(site-worker): add featured flags to ArticleIndexEntry

Optional featured: ('hero' | 'must-read')[] field. Empty/missing means
the article is eligible for auto-fallback, so old articles with no
frontmatter flag keep working unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Resolver test — layout merge across layers

**Files:**
- Test: `packages/site-worker/scripts/__tests__/resolve.test.ts`

**Step 1: Append failing test to resolve.test.ts**

Add at the end of the file:

```ts
describe('layout merge across layers', () => {
  it('site layout deep-merges over org', () => {
    const org = { layout: { hero: { count: 4 }, must_reads: { enabled: true, count: 5 } } };
    const site = { layout: { hero: { count: 3 } } };
    const merged = deepMerge(org, site);
    expect(merged).toEqual({
      layout: {
        hero: { count: 3 },
        must_reads: { enabled: true, count: 5 },
      },
    });
  });

  it('group layer overrides org but is overridden by site', () => {
    const org = { layout: { load_more: { page_size: 10 } } };
    const group = { layout: { load_more: { page_size: 20 } } };
    const site = { layout: { load_more: { page_size: 5 } } };
    const merged = deepMerge(deepMerge(org, group), site);
    expect(merged).toEqual({ layout: { load_more: { page_size: 5 } } });
  });

  it('null in site does not erase org layout', () => {
    const org = { layout: { hero: { count: 4 } } };
    const site = { layout: null };
    expect(deepMerge(org, site)).toEqual({ layout: { hero: { count: 4 } } });
  });
});
```

**Step 2: Run — should PASS without code changes**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "layout merge"`
Expected: PASS — `deepMerge` is generic and already handles this. We're explicitly locking in the behavior as a regression test.

**Step 3: Commit**

```bash
git add packages/site-worker/scripts/__tests__/resolve.test.ts
git commit -m "test(site-worker): lock in layout merge semantics across layers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.4: `resolveLayout()` helper with defaults

**Files:**
- Create: `packages/site-worker/scripts/lib/resolve-layout.ts`
- Test: `packages/site-worker/scripts/__tests__/resolve-layout.test.ts`

**Step 1: Write the failing test**

Create `packages/site-worker/scripts/__tests__/resolve-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveLayout } from '../lib/resolve-layout';

describe('resolveLayout', () => {
  it('returns defaults when input is undefined', () => {
    const out = resolveLayout(undefined);
    expect(out.hero).toEqual({ enabled: true, count: 4 });
    expect(out.must_reads).toEqual({ enabled: true, count: 5 });
    expect(out.sidebar_topics).toEqual({ auto: true, explicit: [] });
    expect(out.load_more).toEqual({ page_size: 10 });
  });

  it('overrides only the fields supplied; the rest stay default', () => {
    const out = resolveLayout({ hero: { count: 3 } });
    expect(out.hero).toEqual({ enabled: true, count: 3 });
    expect(out.must_reads.enabled).toBe(true);
  });

  it('clamps page_size to a sane minimum', () => {
    const out = resolveLayout({ load_more: { page_size: 0 } });
    expect(out.load_more.page_size).toBe(1);
  });

  it('coerces hero.count to 3 or 4 only', () => {
    expect(resolveLayout({ hero: { count: 7 as 3 } }).hero.count).toBe(4);
  });
});
```

**Step 2: Run — should FAIL (module not found)**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "resolveLayout"`
Expected: FAIL — "Cannot find module '../lib/resolve-layout'".

**Step 3: Implement**

Create `packages/site-worker/scripts/lib/resolve-layout.ts`:

```ts
import {
  LAYOUT_DEFAULTS,
  type LayoutConfig,
  type ResolvedLayoutConfig,
} from '@atomic-platform/shared-types';

const VALID_HERO_COUNTS = new Set([3, 4]);

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
    sidebar_topics: {
      auto: input?.sidebar_topics?.auto ?? LAYOUT_DEFAULTS.sidebar_topics.auto,
      explicit: input?.sidebar_topics?.explicit ?? [],
    },
    load_more: {
      page_size: Math.max(1, input?.load_more?.page_size ?? LAYOUT_DEFAULTS.load_more.page_size),
    },
  };
}
```

**Step 4: Run — should PASS**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "resolveLayout"`
Expected: PASS, all 4 tests green.

**Step 5: Commit**

```bash
git add packages/site-worker/scripts/lib/resolve-layout.ts \
        packages/site-worker/scripts/__tests__/resolve-layout.test.ts
git commit -m "feat(site-worker): add resolveLayout() with defaults and clamping

Pure helper that maps a partial LayoutConfig into a fully-resolved
ResolvedLayoutConfig with sane fallbacks. Page size is clamped to
>= 1 and hero count is coerced to {3, 4} so an editor cannot break
the page from yaml.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.5: Wire resolveLayout into seed-kv

**Files:**
- Modify: `packages/site-worker/scripts/seed-kv.ts`

**Step 1: Find the resolved-config assembly**

Run: `cd packages/site-worker && grep -nE "ResolvedConfig|resolveTheme|resolveAdsConfig" scripts/seed-kv.ts | head`

Locate where the per-site `ResolvedConfig` object is built (search for `theme: resolveTheme` or similar). Add to the import block:

```ts
import { resolveLayout } from './lib/resolve-layout';
```

In the resolved-config object construction, add:

```ts
  layout: resolveLayout(merged.layout as LayoutConfig | undefined),
  theme: {
    ...resolvedTheme,
    layout_v2: Boolean((merged.theme as Record<string, unknown> | undefined)?.layout_v2),
  },
```

(Where `resolvedTheme` was the previous expression. We're adding `layout_v2` to it explicitly.)

Also import `LayoutConfig` from `@atomic-platform/shared-types`.

**Step 2: Run typecheck**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: PASS now (the missing `layout` property on `ResolvedConfig` is filled in).

**Step 3: Run full unit suite**

Run: `cd packages/site-worker && pnpm vitest run --project unit`
Expected: PASS, no regressions.

**Step 4: Commit**

```bash
git add packages/site-worker/scripts/seed-kv.ts
git commit -m "feat(site-worker): seed-kv writes resolved layout + theme.layout_v2

ResolvedConfig.layout is now populated for every site; missing yaml
yields LAYOUT_DEFAULTS. theme.layout_v2 defaults to false until the
site explicitly opts in.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.6: Parse `featured` frontmatter into ArticleIndexEntry

**Files:**
- Modify: `packages/site-worker/scripts/seed-kv.ts:191` (the `frontmatter` object literal)
- Test: `packages/site-worker/scripts/__tests__/featured-frontmatter.test.ts`

**Step 1: Write a failing test for the parser**

Create `packages/site-worker/scripts/__tests__/featured-frontmatter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFeatured } from '../lib/parse-featured';

describe('parseFeatured', () => {
  it('returns undefined when missing', () => {
    expect(parseFeatured(undefined)).toBeUndefined();
  });

  it('accepts a single string', () => {
    expect(parseFeatured('hero')).toEqual(['hero']);
    expect(parseFeatured('must-read')).toEqual(['must-read']);
  });

  it('accepts an array', () => {
    expect(parseFeatured(['hero', 'must-read'])).toEqual(['hero', 'must-read']);
  });

  it('strips unknown values silently', () => {
    expect(parseFeatured(['hero', 'banana'])).toEqual(['hero']);
    expect(parseFeatured('garbage')).toEqual([]);
  });

  it('returns undefined for empty array (treat as not-featured)', () => {
    expect(parseFeatured([])).toBeUndefined();
  });
});
```

**Step 2: Run — should FAIL**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "parseFeatured"`
Expected: FAIL — module not found.

**Step 3: Implement parser**

Create `packages/site-worker/scripts/lib/parse-featured.ts`:

```ts
const VALID = new Set(['hero', 'must-read'] as const);

export function parseFeatured(
  raw: unknown,
): ('hero' | 'must-read')[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  const filtered = arr
    .map((v) => String(v).trim())
    .filter((v): v is 'hero' | 'must-read' => VALID.has(v as 'hero' | 'must-read'));
  return filtered.length > 0 ? filtered : Array.isArray(raw) && raw.length === 0 ? undefined : [];
}
```

(Note: empty *input* array → undefined; non-empty input with all invalid values → `[]`. The latter encodes "the editor tried to set this but used invalid values" — surfaces in the article index so we can detect bad data.)

**Step 4: Run — should PASS**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "parseFeatured"`
Expected: PASS, all 5 tests.

**Step 5: Wire into seed-kv**

In `packages/site-worker/scripts/seed-kv.ts`, add to imports:

```ts
import { parseFeatured } from './lib/parse-featured';
```

Modify the `frontmatter` object at line ~191 to include:

```ts
      featured: parseFeatured(front.featured),
```

**Step 6: Verify**

Run: `cd packages/site-worker && pnpm typecheck && pnpm vitest run --project unit`
Expected: PASS.

**Step 7: Commit**

```bash
git add packages/site-worker/scripts/lib/parse-featured.ts \
        packages/site-worker/scripts/__tests__/featured-frontmatter.test.ts \
        packages/site-worker/scripts/seed-kv.ts
git commit -m "feat(site-worker): parse 'featured' frontmatter into article index

Accepts string ('hero' | 'must-read') or array. Unknown values silently
stripped; missing field becomes undefined (auto-fallback eligible).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.7: `selectFeatured()` helper with auto-fallback

**Files:**
- Create: `packages/site-worker/src/lib/featured.ts`
- Test: `packages/site-worker/src/lib/__tests__/featured.test.ts`

**Step 1: Failing test**

Create `packages/site-worker/src/lib/__tests__/featured.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { selectFeatured } from '../featured';
import type { ArticleIndexEntry } from '../kv-schema';

const A = (slug: string, featured?: ('hero' | 'must-read')[]): ArticleIndexEntry => ({
  slug, title: slug, author: 'X', publishDate: '2026-01-01', tags: [],
  type: 'standard', status: 'published', featured,
});

describe('selectFeatured', () => {
  const articles = [
    A('a', ['hero']),
    A('b'),
    A('c', ['hero']),
    A('d'),
    A('e', ['must-read']),
    A('f'),
    A('g'),
    A('h'),
    A('i'),
  ];

  it('uses tagged hero articles first, in input order', () => {
    expect(selectFeatured(articles, 'hero', 4).map((a) => a.slug)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('fills remaining slots from non-featured articles', () => {
    expect(selectFeatured(articles, 'hero', 4).length).toBe(4);
  });

  it('does not duplicate when fallback overlaps with tagged', () => {
    const slugs = selectFeatured(articles, 'hero', 4).map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('excludes already-used slugs (e.g. hero) from must-reads fallback', () => {
    const hero = selectFeatured(articles, 'hero', 4);
    const reads = selectFeatured(articles, 'must-read', 5, new Set(hero.map((a) => a.slug)));
    expect(reads.some((r) => hero.some((h) => h.slug === r.slug))).toBe(false);
  });

  it('returns fewer items if the pool is smaller than count', () => {
    expect(selectFeatured([A('a')], 'hero', 4).length).toBe(1);
  });
});
```

**Step 2: Run — should FAIL**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "selectFeatured"`
Expected: FAIL — module not found.

**Step 3: Implement**

Create `packages/site-worker/src/lib/featured.ts`:

```ts
import type { ArticleIndexEntry } from './kv-schema';

export type FeaturedSlot = 'hero' | 'must-read';

/**
 * Pick `count` articles for a featured slot. Articles tagged with the slot
 * come first (input order = sorted-by-date order from the caller). Remaining
 * slots fall back to the latest non-featured articles, skipping any slugs
 * already exhausted via `exclude`.
 */
export function selectFeatured(
  articles: ArticleIndexEntry[],
  slot: FeaturedSlot,
  count: number,
  exclude: Set<string> = new Set(),
): ArticleIndexEntry[] {
  const out: ArticleIndexEntry[] = [];
  const used = new Set(exclude);

  for (const a of articles) {
    if (out.length >= count) break;
    if (used.has(a.slug)) continue;
    if (a.featured?.includes(slot)) {
      out.push(a);
      used.add(a.slug);
    }
  }

  for (const a of articles) {
    if (out.length >= count) break;
    if (used.has(a.slug)) continue;
    out.push(a);
    used.add(a.slug);
  }

  return out;
}
```

**Step 4: Run — should PASS**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "selectFeatured"`
Expected: PASS, all 5 tests.

**Step 5: Commit**

```bash
git add packages/site-worker/src/lib/featured.ts \
        packages/site-worker/src/lib/__tests__/featured.test.ts
git commit -m "feat(site-worker): add selectFeatured() with auto-fallback

Picks tagged articles first, fills remaining slots from latest. The
'exclude' set lets the homepage avoid duplicating hero articles into
must-reads.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.8: Org defaults — extend `org.yaml` schema reader

**Files:**
- Modify: `atomic-labs-network/org.yaml` (separate repo at `~/Documents/ATL-content-network/atomic-labs-network/`)

**Step 1: Edit org.yaml**

Append to `~/Documents/ATL-content-network/atomic-labs-network/org.yaml`:

```yaml
default_colors:
  primary: "#1a1a2e"
  accent: "#f4c542"
layout:
  hero:
    enabled: true
    count: 4
  must_reads:
    enabled: true
    count: 5
  sidebar_topics:
    auto: true
  load_more:
    page_size: 10
```

In the `ads_config.ad_placements` array, append:

```yaml
  - id: homepage-sidebar
    type: display
    size: medium-rectangle
  - id: article-sidebar
    type: display
    size: medium-rectangle
```

(Confirm the existing `ad_placements` is empty `[]` — if so, replace `[]` with the inline list above.)

**Step 2: Verify a re-seed picks it up**

Run: `cd ~/Documents/ATL-content-network/atomic-content-platform/packages/site-worker && CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network pnpm seed:kv coolnews-atl --dry-run 2>&1 | tail -20`

(If seed:kv has no --dry-run flag, skip the run; the next step's typecheck is sufficient.)

Expected: no errors; the dry output (if available) shows the new fields in the resolved config.

**Step 3: Commit (separate repo)**

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git checkout main
git pull
git add org.yaml
git commit -m "feat(org): add default layout, default_colors, sidebar ad placements

Defaults flow into every site via the 5-layer resolver. Existing sites
that don't set theme.layout_v2 keep rendering the old layout — the new
fields are read but not used until the toggle flips.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
cd -  # back to atomic-content-platform
```

---

## Phase 2 — Components & Layout (gated by `theme.layout_v2`)

Goal: build all new components in `themes/modern/`, wire up the new homepage and article-page paths gated by the `layout_v2` toggle. Existing sites untouched.

### Task 2.1: Theme registry

**Files:**
- Create: `packages/site-worker/src/themes/registry.ts`

**Step 1: Create the registry**

```ts
export interface ThemeVariant {
  id: string;
  label: string;
  enabled: boolean;
}

export const THEME_REGISTRY: Readonly<ThemeVariant[]> = [
  { id: 'modern',    label: 'Modern',    enabled: true  },
  { id: 'editorial', label: 'Editorial', enabled: false },
  { id: 'bold',      label: 'Bold',      enabled: false },
  { id: 'classic',   label: 'Classic',   enabled: false },
] as const;

export function isEnabledTheme(id: string): boolean {
  return THEME_REGISTRY.some((t) => t.id === id && t.enabled);
}
```

**Step 2: Verify typecheck**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/site-worker/src/themes/registry.ts
git commit -m "feat(site-worker): add theme variant registry (modern enabled, others stubbed)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: Card components — HeroCard, FeedCard, ThumbCard, MustReadHeroCard

Each is a small Astro file (~40-60 lines including styles). Build all 4 in one task; commit per file is overkill.

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/HeroCard.astro`
- Create: `packages/site-worker/src/themes/modern/components/FeedCard.astro`
- Create: `packages/site-worker/src/themes/modern/components/ThumbCard.astro`
- Create: `packages/site-worker/src/themes/modern/components/MustReadHeroCard.astro`

**Step 1: HeroCard.astro** — full-bleed image with overlaid white title; used by the homepage hero grid.

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; }
const { article } = Astro.props;
const href = `/${article.slug}`;
---

<a class="hero-card" href={href} aria-label={article.title}>
  {article.featuredImage && (
    <img class="hero-card-image" src={article.featuredImage} alt="" loading="lazy" />
  )}
  <div class="hero-card-overlay" aria-hidden="true"></div>
  <h2 class="hero-card-title">{article.title}</h2>
</a>

<style>
  .hero-card {
    position: relative;
    display: block;
    aspect-ratio: 3/4;
    overflow: hidden;
    text-decoration: none;
    background: var(--color-secondary, #1a1a2e);
  }
  .hero-card-image {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    transition: transform 400ms ease;
  }
  .hero-card:hover .hero-card-image { transform: scale(1.04); }
  .hero-card-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.75) 100%);
  }
  .hero-card-title {
    position: absolute; left: 1.25rem; right: 1.25rem; bottom: 1.25rem;
    color: #fff;
    font-family: var(--fontHeading, sans-serif);
    font-size: clamp(1.25rem, 1.6vw, 1.875rem);
    font-weight: 700;
    line-height: 1.15;
    margin: 0;
    text-shadow: 0 2px 8px rgba(0,0,0,0.5);
  }
</style>
```

**Step 2: FeedCard.astro** — landscape thumb left, title + date + 2-line snippet right; used in What's New + More On.

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; }
const { article } = Astro.props;
const href = `/${article.slug}`;
const dateLabel = new Date(article.publishDate).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric',
});
---

<article class="feed-card">
  <a class="feed-card-thumb" href={href} aria-hidden="true" tabindex="-1">
    {article.featuredImage && <img src={article.featuredImage} alt="" loading="lazy" />}
  </a>
  <div class="feed-card-body">
    <a class="feed-card-title-link" href={href}>
      <h3 class="feed-card-title">{article.title}</h3>
    </a>
    <p class="feed-card-date">{dateLabel}</p>
    {article.description && <p class="feed-card-snippet">{article.description}</p>}
  </div>
</article>

<style>
  .feed-card {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    padding: 1.25rem 0;
    border-bottom: 1px solid var(--color-border, #e5e7eb);
  }
  @media (min-width: 640px) {
    .feed-card { grid-template-columns: 240px 1fr; gap: 1.5rem; }
  }
  .feed-card-thumb {
    display: block;
    aspect-ratio: 16/10;
    overflow: hidden;
    border-radius: var(--radius-md, 8px);
    background: var(--color-surface, #f8f9fa);
  }
  .feed-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .feed-card-title-link { color: inherit; text-decoration: none; }
  .feed-card-title {
    font-size: var(--text-xl, 1.25rem);
    font-weight: 700;
    line-height: 1.25;
    margin: 0 0 0.5rem;
  }
  .feed-card-date {
    font-size: var(--text-sm, 0.875rem);
    color: var(--color-muted, #6b7280);
    margin: 0 0 0.5rem;
  }
  .feed-card-snippet {
    font-size: var(--text-base, 1rem);
    color: var(--color-text, #1a1a2e);
    line-height: 1.6;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
```

**Step 3: ThumbCard.astro** — small image + overlaid title (used in MustReads 2x2 grid and CategoryList).

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; }
const { article } = Astro.props;
const href = `/${article.slug}`;
---

<a class="thumb-card" href={href}>
  {article.featuredImage && (
    <img class="thumb-card-image" src={article.featuredImage} alt="" loading="lazy" />
  )}
  <div class="thumb-card-overlay" aria-hidden="true"></div>
  <h4 class="thumb-card-title">{article.title}</h4>
</a>

<style>
  .thumb-card {
    position: relative;
    display: block;
    aspect-ratio: 4/3;
    overflow: hidden;
    border-radius: var(--radius-md, 8px);
    text-decoration: none;
    background: var(--color-secondary, #1a1a2e);
  }
  .thumb-card-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .thumb-card-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.75) 100%);
  }
  .thumb-card-title {
    position: absolute; left: 0.875rem; right: 0.875rem; bottom: 0.875rem;
    color: #fff;
    font-size: var(--text-base, 1rem);
    font-weight: 600;
    line-height: 1.25;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
```

**Step 4: MustReadHeroCard.astro** — large image + headline + 3-line description, dark variant.

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; }
const { article } = Astro.props;
const href = `/${article.slug}`;
---

<a class="mr-hero" href={href}>
  {article.featuredImage && (
    <img class="mr-hero-image" src={article.featuredImage} alt="" loading="lazy" />
  )}
  <div class="mr-hero-body">
    <h3 class="mr-hero-title">{article.title}</h3>
    {article.description && <p class="mr-hero-desc">{article.description}</p>}
  </div>
</a>

<style>
  .mr-hero {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--radius-md, 8px);
    text-decoration: none;
    color: #fff;
    background: rgba(0,0,0,0.2);
    height: 100%;
  }
  .mr-hero-image { width: 100%; aspect-ratio: 16/9; object-fit: cover; }
  .mr-hero-body { padding: 1.25rem; }
  .mr-hero-title {
    font-size: var(--text-2xl, 1.5rem);
    font-weight: 700;
    line-height: 1.2;
    margin: 0 0 0.5rem;
    color: #fff;
  }
  .mr-hero-desc {
    font-size: var(--text-base, 1rem);
    line-height: 1.5;
    color: rgba(255,255,255,0.85);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
```

**Step 5: Verify**

Run: `cd packages/site-worker && pnpm typecheck`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/HeroCard.astro \
        packages/site-worker/src/themes/modern/components/FeedCard.astro \
        packages/site-worker/src/themes/modern/components/ThumbCard.astro \
        packages/site-worker/src/themes/modern/components/MustReadHeroCard.astro
git commit -m "feat(site-worker/modern): add 4 card components for layout v2

HeroCard (overlay), FeedCard (landscape thumb + body), ThumbCard
(small overlay), MustReadHeroCard (dark variant). Each is independent;
no variant prop. Color tokens come from --color-* CSS vars.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: HeroGrid + MustReads

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/HeroGrid.astro`
- Create: `packages/site-worker/src/themes/modern/components/MustReads.astro`

**Step 1: HeroGrid.astro**

```astro
---
import HeroCard from './HeroCard.astro';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { articles: ArticleIndexEntry[]; }
const { articles } = Astro.props;
---

{articles.length > 0 && (
  <section class="hero-grid" aria-label="Top stories">
    {articles.map((article) => <HeroCard article={article} />)}
  </section>
)}

<style>
  .hero-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
  }
  @media (min-width: 640px) { .hero-grid { grid-template-columns: 1fr 1fr; } }
  @media (min-width: 1024px) { .hero-grid { grid-template-columns: repeat(4, 1fr); } }
</style>
```

**Step 2: MustReads.astro**

```astro
---
import MustReadHeroCard from './MustReadHeroCard.astro';
import ThumbCard from './ThumbCard.astro';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { articles: ArticleIndexEntry[]; }
const { articles } = Astro.props;
const [hero, ...rest] = articles;
const thumbs = rest.slice(0, 4);
---

{hero && (
  <section class="must-reads" aria-label="Must reads">
    <div class="must-reads-inner">
      <h2 class="must-reads-heading">Must Reads</h2>
      <div class="must-reads-grid">
        <div class="must-reads-hero"><MustReadHeroCard article={hero} /></div>
        <div class="must-reads-thumbs">
          {thumbs.map((article) => <ThumbCard article={article} />)}
        </div>
      </div>
    </div>
  </section>
)}

<style>
  .must-reads {
    background: var(--color-secondary, #1a1a2e);
    color: #fff;
    padding: 3rem 0;
  }
  .must-reads-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    padding: 0 1rem;
  }
  .must-reads-heading {
    color: #fff;
    font-size: var(--text-2xl, 1.5rem);
    margin-bottom: 1.5rem;
  }
  .must-reads-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  @media (min-width: 960px) { .must-reads-grid { grid-template-columns: 1.4fr 1fr; } }
  .must-reads-thumbs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
</style>
```

**Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/HeroGrid.astro \
        packages/site-worker/src/themes/modern/components/MustReads.astro
git commit -m "feat(site-worker/modern): add HeroGrid and MustReads sections

HeroGrid hides itself when articles array is empty. MustReads renders a
hero card + 4 thumbs; renders nothing if no articles.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.4: ArticleFeed + MoreOn (uses FeedCard)

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/ArticleFeed.astro`
- Create: `packages/site-worker/src/themes/modern/components/MoreOn.astro`

**Step 1: ArticleFeed.astro** — `What's New?` left column on homepage.

```astro
---
import FeedCard from './FeedCard.astro';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { articles: ArticleIndexEntry[]; heading?: string; }
const { articles, heading = "What's New?" } = Astro.props;
---

<section class="article-feed">
  <h2 class="article-feed-heading">{heading}</h2>
  {articles.map((article) => <FeedCard article={article} />)}
</section>

<style>
  .article-feed-heading {
    font-size: var(--text-2xl, 1.5rem);
    font-weight: 700;
    margin: 0 0 1rem;
  }
</style>
```

**Step 2: MoreOn.astro** — 2-col grid below MustReads.

```astro
---
import FeedCard from './FeedCard.astro';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { articles: ArticleIndexEntry[]; siteName: string; }
const { articles, siteName } = Astro.props;
---

<section class="more-on">
  <div class="more-on-inner">
    <h2 class="more-on-heading">More On {siteName}</h2>
    <div class="more-on-grid" id="more-on-feed">
      {articles.map((article) => <FeedCard article={article} />)}
    </div>
  </div>
</section>

<style>
  .more-on { padding: 2.5rem 0; }
  .more-on-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    padding: 0 1rem;
  }
  .more-on-heading {
    font-size: var(--text-2xl, 1.5rem);
    margin: 0 0 1rem;
  }
  .more-on-grid {
    display: grid;
    grid-template-columns: 1fr;
    column-gap: 2rem;
  }
  @media (min-width: 768px) { .more-on-grid { grid-template-columns: 1fr 1fr; } }
</style>
```

The `id="more-on-feed"` is the JS append target; matches the design doc.

**Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/ArticleFeed.astro \
        packages/site-worker/src/themes/modern/components/MoreOn.astro
git commit -m "feat(site-worker/modern): add ArticleFeed + MoreOn sections

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.5: Newsletter form unification

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/_newsletter-form.astro`
- Create: `packages/site-worker/src/themes/modern/components/NewsletterBox.astro`
- Create: `packages/site-worker/src/themes/modern/components/NewsletterBand.astro`
- Modify: `packages/site-worker/src/layouts/BaseLayout.astro`
- Modify: `packages/site-worker/src/themes/modern/components/Footer.astro`

**Step 1: Shared form partial** (filename starts with `_` so Astro doesn't route it).

`_newsletter-form.astro`:

```astro
---
interface Props {
  source: 'homepage' | 'article' | 'footer';
  domain: string;
  buttonLabel?: string;
  inputClass?: string;
  buttonClass?: string;
}
const { source, domain, buttonLabel = 'Subscribe', inputClass = '', buttonClass = '' } = Astro.props;
---

<form class="atl-newsletter-form" data-newsletter-form data-source={source} data-domain={domain}>
  <input
    type="email"
    name="email"
    placeholder="Your email address"
    required
    class={`atl-newsletter-email ${inputClass}`}
  />
  <button type="submit" class={`atl-newsletter-submit ${buttonClass}`}>{buttonLabel}</button>
  <input name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true" />
</form>
```

**Step 2: NewsletterBox.astro** — sidebar variant (yellow band).

```astro
---
import NewsletterForm from './_newsletter-form.astro';
interface Props { domain: string; }
const { domain } = Astro.props;
---

<aside class="newsletter-box">
  <h3 class="newsletter-box-heading">Subscribe to our newsletter</h3>
  <NewsletterForm source="homepage" domain={domain} />
  <p class="newsletter-box-status" data-newsletter-status></p>
</aside>

<style>
  .newsletter-box {
    background: var(--color-accent, #f4c542);
    padding: 1.5rem;
    border-radius: var(--radius-md, 8px);
    color: var(--color-secondary, #1a1a2e);
  }
  .newsletter-box-heading {
    font-size: var(--text-base, 1rem);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    margin: 0 0 0.75rem;
  }
  .newsletter-box :global(.atl-newsletter-form) {
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .newsletter-box :global(.atl-newsletter-email) {
    padding: 0.75rem; border: 0; border-radius: var(--radius-sm, 4px);
    background: #fff; font-size: 0.9375rem;
  }
  .newsletter-box :global(.atl-newsletter-submit) {
    padding: 0.75rem; border: 0; cursor: pointer;
    background: var(--color-secondary, #1a1a2e); color: #fff;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: var(--radius-sm, 4px);
  }
  .newsletter-box-status:empty { display: none; }
  .newsletter-box-status { margin: 0.5rem 0 0; font-size: 0.8125rem; }
</style>
```

**Step 3: NewsletterBand.astro** — full-width band on article page.

```astro
---
import NewsletterForm from './_newsletter-form.astro';
interface Props { domain: string; }
const { domain } = Astro.props;
---

<section class="newsletter-band">
  <div class="newsletter-band-inner">
    <h2 class="newsletter-band-heading">Sign up to our Newsletter</h2>
    <NewsletterForm source="article" domain={domain} buttonLabel="Subscribe" />
    <p class="newsletter-band-status" data-newsletter-status></p>
  </div>
</section>

<style>
  .newsletter-band {
    background: var(--color-accent, #f4c542);
    padding: 4rem 1rem;
    color: var(--color-secondary, #1a1a2e);
    text-align: center;
  }
  .newsletter-band-inner {
    max-width: 480px;
    margin: 0 auto;
  }
  .newsletter-band-heading {
    font-size: var(--text-3xl, 1.875rem);
    margin: 0 0 1.5rem;
    font-weight: 700;
  }
  .newsletter-band :global(.atl-newsletter-form) {
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .newsletter-band :global(.atl-newsletter-email) {
    padding: 0.875rem; border: 0; background: #fff;
    font-size: 1rem; border-radius: 4px;
  }
  .newsletter-band :global(.atl-newsletter-submit) {
    padding: 0.875rem; border: 0; cursor: pointer;
    background: var(--color-secondary, #1a1a2e); color: #fff;
    font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
    border-radius: 4px;
  }
  .newsletter-band-status:empty { display: none; }
</style>
```

**Step 4: Move handler into BaseLayout**

Edit `packages/site-worker/src/layouts/BaseLayout.astro`. Inside the `<body>`, just before the closing `</body>`, add:

```astro
    <script is:inline>
      (function() {
        document.querySelectorAll('form[data-newsletter-form]').forEach(function(form) {
          form.addEventListener('submit', async function(e) {
            e.preventDefault();
            var hp = form.querySelector('input[name="_hp"]');
            if (hp && hp.value) return;
            var emailEl = form.querySelector('input[type="email"]');
            var status = form.parentElement.querySelector('[data-newsletter-status]');
            var email = emailEl && emailEl.value && emailEl.value.trim();
            if (!email) return;
            if (status) status.textContent = 'Subscribing…';
            try {
              var res = await fetch('https://atomic-content-platform.apps.cloudgrid.io/api/subscribe', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  email: email,
                  domain: form.dataset.domain,
                  source: form.dataset.source,
                }),
              });
              if (res.ok) {
                if (status) status.textContent = 'Thanks — check your inbox.';
                form.reset();
              } else {
                if (status) status.textContent = 'Hmm, that didn\'t work. Please try again.';
              }
            } catch {
              if (status) status.textContent = 'Network error. Please try again.';
            }
          });
        });
      })();
    </script>
```

**Step 5: Update Footer.astro** to use the shared partial.

Replace the existing `<form class="footer-newsletter" ...>` block (~lines 57-67) with:

```astro
      <NewsletterForm source="footer" domain={config.domain} />
```

Add to the imports at the top of Footer.astro:

```astro
import NewsletterForm from './_newsletter-form.astro';
```

Remove the now-unused `.footer-newsletter`, `.footer-email-input`, `.footer-subscribe-btn` style rules and replace with overrides for `.atl-newsletter-form` if needed (footer keeps the dark "input + button on one line" look — only the markup is shared, the styles can differ).

**Step 6: Verify**

Run: `cd packages/site-worker && pnpm typecheck && pnpm build`
Expected: PASS.

**Step 7: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/_newsletter-form.astro \
        packages/site-worker/src/themes/modern/components/NewsletterBox.astro \
        packages/site-worker/src/themes/modern/components/NewsletterBand.astro \
        packages/site-worker/src/layouts/BaseLayout.astro \
        packages/site-worker/src/themes/modern/components/Footer.astro
git commit -m "feat(site-worker/modern): unify newsletter forms behind one handler

Single inline handler on BaseLayout for any data-newsletter-form. Three
visual containers (sidebar box, full-width band, footer row), three
data-source values written to the Google Sheet so we can A/B placements.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.6: Sidebar component (variant home + article)

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/Sidebar.astro`
- Create: `packages/site-worker/src/themes/modern/components/FollowUs.astro`
- Create: `packages/site-worker/src/themes/modern/components/CategoryList.astro`

**Step 1: FollowUs.astro**

```astro
---
import type { ResolvedConfig } from '@atomic-platform/shared-types';

interface Props { config: ResolvedConfig; }
const { config } = Astro.props;

// Pull socials from config.theme — schema TBD; for now assume strings on theme.
const socials = [
  { id: 'instagram', href: '#', label: 'Instagram' },
  { id: 'facebook',  href: '#', label: 'Facebook'  },
  { id: 'youtube',   href: '#', label: 'YouTube'   },
  { id: 'x',         href: '#', label: 'X'         },
];
---

<aside class="follow-us">
  <h3 class="follow-us-heading">Follow Us</h3>
  <div class="follow-us-icons">
    {socials.map((s) => (
      <a class={`follow-us-icon follow-us-icon-${s.id}`} href={s.href} aria-label={s.label}>
        <span class="visually-hidden">{s.label}</span>
      </a>
    ))}
  </div>
</aside>

<style>
  .follow-us-heading {
    background: var(--color-primary, #1a1a2e);
    color: #fff;
    text-align: center;
    padding: 0.75rem;
    margin: 0 0 1rem;
    font-size: var(--text-base, 1rem);
    border-radius: var(--radius-sm, 4px);
  }
  .follow-us-icons {
    display: flex; gap: 0.5rem; justify-content: center;
  }
  .follow-us-icon {
    width: 36px; height: 36px;
    border-radius: 50%;
    background: var(--color-secondary, #1a1a2e);
    display: inline-block;
  }
</style>
```

(Social icon SVGs can be swapped in later — for v1 the colored circles match the screenshot's visual rhythm and are accessible.)

**Step 2: CategoryList.astro**

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { topic: string; articles: ArticleIndexEntry[]; }
const { topic, articles } = Astro.props;
---

{articles.length > 0 && (
  <section class="category-list">
    <h3 class="category-list-heading">{topic}</h3>
    <ul class="category-list-items">
      {articles.map((article) => (
        <li>
          <a href={`/${article.slug}`} class="category-list-link">
            {article.featuredImage && (
              <img src={article.featuredImage} alt="" loading="lazy" />
            )}
            <span>{article.title}</span>
          </a>
        </li>
      ))}
    </ul>
  </section>
)}

<style>
  .category-list { margin-top: 1.5rem; }
  .category-list-heading {
    background: var(--color-primary, #1a1a2e);
    color: #fff;
    text-align: center;
    padding: 0.75rem;
    margin: 0 0 1rem;
    font-size: var(--text-base, 1rem);
    border-radius: var(--radius-sm, 4px);
  }
  .category-list-items { list-style: none; padding: 0; margin: 0; }
  .category-list-items li { margin-bottom: 0.75rem; }
  .category-list-link {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.75rem;
    color: inherit; text-decoration: none;
    font-size: 0.875rem;
  }
  .category-list-link img {
    width: 100%; aspect-ratio: 1; object-fit: cover;
    border-radius: var(--radius-sm, 4px);
  }
</style>
```

**Step 3: Sidebar.astro**

```astro
---
import AdSlot from '../../../components/AdSlot.astro';
import NewsletterBox from './NewsletterBox.astro';
import FollowUs from './FollowUs.astro';
import CategoryList from './CategoryList.astro';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

type Props =
  | { variant: 'home'; config: ResolvedConfig }
  | { variant: 'article'; config: ResolvedConfig; categories: { topic: string; articles: ArticleIndexEntry[] }[] };
const props = Astro.props as Props;
const { config, variant } = props;
---

<aside class="sidebar">
  {variant === 'home' && (
    <>
      <AdSlot position="homepage-sidebar" pageType="homepage" server:defer />
      <NewsletterBox domain={config.domain} />
    </>
  )}
  {variant === 'article' && (
    <>
      <AdSlot position="article-sidebar" pageType="article" server:defer />
      <FollowUs config={config} />
      {(props as Extract<Props, { variant: 'article' }>).categories.map((c) => (
        <CategoryList topic={c.topic} articles={c.articles} />
      ))}
    </>
  )}
</aside>

<style>
  .sidebar { display: flex; flex-direction: column; gap: 1.5rem; }
  @media (min-width: 960px) {
    .sidebar { position: sticky; top: calc(64px + 1rem); }
  }
</style>
```

**Step 4: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/Sidebar.astro \
        packages/site-worker/src/themes/modern/components/FollowUs.astro \
        packages/site-worker/src/themes/modern/components/CategoryList.astro
git commit -m "feat(site-worker/modern): add Sidebar with home/article variants

Sticky on >=960px. Home variant: ad slot + newsletter box. Article
variant: ad slot + Follow Us + N category lists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.7: LoadMoreButton + `/api/articles` endpoint

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/LoadMoreButton.astro`
- Create: `packages/site-worker/src/themes/modern/components/_render-feed-cards.ts`
- Create: `packages/site-worker/src/pages/api/articles.ts`
- Test: `packages/site-worker/src/lib/__tests__/articles-api.test.ts`

**Step 1: Failing test for slicing math**

Create `packages/site-worker/src/lib/__tests__/articles-api.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sliceForPage } from '../articles-pagination';

const fixtures = Array.from({ length: 50 }, (_, i) => ({ slug: `s${i}`, title: `T${i}` }));

describe('sliceForPage', () => {
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
```

**Step 2: Run — should FAIL**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "sliceForPage"`
Expected: FAIL — module not found.

**Step 3: Implement helper**

Create `packages/site-worker/src/lib/articles-pagination.ts`:

```ts
export function sliceForPage<T>(all: T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.floor(page));
  const initialCount = pageSize * 2;
  if (safePage === 1) return all.slice(0, initialCount);
  const start = initialCount + (safePage - 2) * pageSize;
  return all.slice(start, start + pageSize);
}
```

**Step 4: Run — should PASS**

Run: `cd packages/site-worker && pnpm vitest run --project unit -t "sliceForPage"`
Expected: PASS.

**Step 5: API endpoint**

Create `packages/site-worker/src/pages/api/articles.ts`:

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig, getSiteId } from '../../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { isVisibleArticle } from '../../utils/article-status';
import { sliceForPage } from '../../lib/articles-pagination';
import { renderFeedCardsHtml } from '../../themes/modern/components/_render-feed-cards';

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const page = parseInt(url.searchParams.get('page') ?? '2', 10);
  const config = getConfig(ctx);
  const siteId = getSiteId(ctx);
  const pageSize = config.layout.load_more.page_size;

  const all =
    (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];
  const visible = all
    .filter((a) => isVisibleArticle(a.status))
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

  const slice = sliceForPage(visible, page, pageSize);
  const html = renderFeedCardsHtml(slice);

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
};
```

**Step 6: Render helper** — server-side string render so the API doesn't have to instantiate Astro components.

Create `packages/site-worker/src/themes/modern/components/_render-feed-cards.ts`:

```ts
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderFeedCardsHtml(articles: ArticleIndexEntry[]): string {
  return articles
    .map((a) => {
      const date = new Date(a.publishDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      return `
<article class="feed-card">
  <a class="feed-card-thumb" href="/${escape(a.slug)}" aria-hidden="true" tabindex="-1">
    ${a.featuredImage ? `<img src="${escape(a.featuredImage)}" alt="" loading="lazy" />` : ''}
  </a>
  <div class="feed-card-body">
    <a class="feed-card-title-link" href="/${escape(a.slug)}">
      <h3 class="feed-card-title">${escape(a.title)}</h3>
    </a>
    <p class="feed-card-date">${escape(date)}</p>
    ${a.description ? `<p class="feed-card-snippet">${escape(a.description)}</p>` : ''}
  </div>
</article>`;
    })
    .join('\n');
}
```

The CSS lives on the homepage (already shipped in FeedCard.astro's `<style>` block), so injected HTML inherits the same styles.

**Step 7: LoadMoreButton.astro**

```astro
---
interface Props { nextPage: number; hasMore: boolean; }
const { nextPage, hasMore } = Astro.props;
---

{hasMore && (
  <div class="load-more-wrap">
    <a href={`?page=${nextPage}`} data-load-more class="load-more-btn">Load More</a>
    <p class="load-more-status" data-load-more-status></p>
  </div>
)}

<script is:inline>
  (function () {
    var btn = document.querySelector('a[data-load-more]');
    if (!btn) return;
    var feed = document.getElementById('more-on-feed');
    var status = document.querySelector('[data-load-more-status]');
    var page = parseInt(new URL(btn.href, window.location.href).searchParams.get('page'), 10) || 2;
    var loading = false;

    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      if (loading) return;
      loading = true;
      btn.setAttribute('aria-disabled', 'true');
      try {
        var res = await fetch('/api/articles?page=' + page);
        if (!res.ok) throw new Error('http ' + res.status);
        var html = (await res.text()).trim();
        if (!html) {
          btn.style.display = 'none';
          return;
        }
        feed.insertAdjacentHTML('beforeend', html);
        page += 1;
        btn.href = '?page=' + page;
      } catch (err) {
        if (status) status.textContent = "Couldn't load more — please try again.";
      } finally {
        loading = false;
        btn.removeAttribute('aria-disabled');
      }
    });
  })();
</script>

<style>
  .load-more-wrap { text-align: center; padding: 2rem 0; }
  .load-more-btn {
    display: inline-block;
    padding: 0.75rem 2rem;
    background: var(--color-primary, #1a1a2e);
    color: #fff;
    text-decoration: none;
    border-radius: var(--radius-md, 8px);
    font-weight: 600;
  }
  .load-more-btn[aria-disabled="true"] { opacity: 0.5; pointer-events: none; }
  .load-more-status { font-size: 0.8125rem; color: var(--color-muted, #6b7280); }
  .load-more-status:empty { display: none; }
</style>
```

**Step 8: Verify**

Run: `cd packages/site-worker && pnpm typecheck && pnpm vitest run --project unit && pnpm build`
Expected: PASS.

**Step 9: Commit**

```bash
git add packages/site-worker/src/lib/articles-pagination.ts \
        packages/site-worker/src/lib/__tests__/articles-api.test.ts \
        packages/site-worker/src/pages/api/articles.ts \
        packages/site-worker/src/themes/modern/components/_render-feed-cards.ts \
        packages/site-worker/src/themes/modern/components/LoadMoreButton.astro
git commit -m "feat(site-worker): /api/articles + LoadMoreButton with no-JS fallback

Server returns 20 on first paint, 10 per click thereafter (page_size
configurable via layout.load_more.page_size). Button is a real <a>
with ?page=N href so non-JS clients get full pagination; inline JS
upgrades to fetch+append.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.8: ArticleHero + RelatedPosts

**Files:**
- Create: `packages/site-worker/src/themes/modern/components/ArticleHero.astro`
- Create: `packages/site-worker/src/themes/modern/components/RelatedPosts.astro`

**Step 1: ArticleHero.astro**

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; }
const { article } = Astro.props;
const date = new Date(article.publishDate).toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric',
});
---

<section class="article-hero">
  <div class="article-hero-inner">
    <div class="article-hero-text">
      <h1 class="article-hero-title">{article.title}</h1>
      <p class="article-hero-date">{date}</p>
    </div>
    {article.featuredImage && (
      <div class="article-hero-image-wrap">
        <img src={article.featuredImage} alt="" />
      </div>
    )}
  </div>
</section>

<style>
  .article-hero {
    background: var(--color-primary, #1a1a2e);
    padding: 4rem 1rem;
  }
  .article-hero-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    align-items: center;
  }
  @media (min-width: 960px) {
    .article-hero-inner { grid-template-columns: 1fr 1fr; }
  }
  .article-hero-title {
    color: #fff;
    font-size: clamp(1.875rem, 3vw, 3rem);
    line-height: 1.15;
    margin: 0 0 1rem;
  }
  .article-hero-date {
    color: var(--color-accent, #f4c542);
    font-weight: 600;
    margin: 0;
  }
  .article-hero-image-wrap img {
    width: 100%; height: auto;
    border-radius: var(--radius-md, 8px);
  }
</style>
```

**Step 2: RelatedPosts.astro** — uses FeedCard.

```astro
---
import FeedCard from './FeedCard.astro';
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { articles: ArticleIndexEntry[]; }
const { articles } = Astro.props;
---

{articles.length > 0 && (
  <section class="related-posts">
    <div class="related-posts-inner">
      <h2 class="related-posts-heading">Related Posts</h2>
      <div class="related-posts-grid">
        {articles.map((a) => <FeedCard article={a} />)}
      </div>
    </div>
  </section>
)}

<style>
  .related-posts { padding: 3rem 0; }
  .related-posts-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    padding: 0 1rem;
  }
  .related-posts-heading {
    font-size: var(--text-2xl, 1.5rem);
    margin: 0 0 1rem;
  }
  .related-posts-grid {
    display: grid;
    grid-template-columns: 1fr;
    column-gap: 2rem;
  }
  @media (min-width: 768px) { .related-posts-grid { grid-template-columns: 1fr 1fr; } }
</style>
```

**Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/ArticleHero.astro \
        packages/site-worker/src/themes/modern/components/RelatedPosts.astro
git commit -m "feat(site-worker/modern): add ArticleHero + RelatedPosts sections

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.9: Header restyle — use --color-primary background

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/Header.astro`

**Step 1: Update Header background**

In Header.astro line ~111, change:

```css
  .site-nav {
    position: fixed;
    ...
    background: var(--color-background, #fff);
    border-bottom: 1px solid var(--color-border, #e5e7eb);
    backdrop-filter: blur(8px);
    background-color: rgba(255, 255, 255, 0.95);
  }
```

To:

```css
  .site-nav {
    position: fixed;
    top: 0; left: 0; right: 0; z-index: 100;
    background: var(--color-primary, #1a1a2e);
    color: #fff;
  }
```

Update `.nav-link`, `.logo-text`, `.nav-icon-btn`, `.hamburger-line` colors to white. Hover states tint to `var(--color-accent)`.

```css
  .nav-link { color: #fff; }
  .nav-link:hover { background: rgba(255,255,255,0.1); color: var(--color-accent, #f4c542); }
  .logo-text { color: #fff; }
  .nav-icon-btn { color: #fff; }
  .nav-icon-btn:hover { background: rgba(255,255,255,0.1); }
  .hamburger-line { background: #fff; }
  .mobile-drawer { background: var(--color-primary, #1a1a2e); color: #fff; }
  .drawer-link { color: #fff; border-bottom-color: rgba(255,255,255,0.1); }
  .drawer-link:hover { background: rgba(255,255,255,0.1); color: var(--color-accent); }
```

**Step 2: Verify**

Run: `cd packages/site-worker && pnpm build`
Expected: PASS.

**Step 3: Commit**

```bash
git add packages/site-worker/src/themes/modern/components/Header.astro
git commit -m "feat(site-worker/modern): header now uses --color-primary background

Matches the magazine reference: dark navy / purple band, white text,
accent-colored hover. Site picks the colors via theme.colors.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.10: Wire homepage to layout v2 (gated by `theme.layout_v2`)

**Files:**
- Modify: `packages/site-worker/src/pages/index.astro`

**Step 1: Replace homepage body**

Rewrite `index.astro` to:

```astro
---
export const prerender = false;

import BaseLayout from '../layouts/BaseLayout.astro';
import SEOHead from '../components/SEOHead.astro';
import Header from '../themes/modern/components/Header.astro';
import Footer from '../themes/modern/components/Footer.astro';
import HeroGrid from '../themes/modern/components/HeroGrid.astro';
import ArticleFeed from '../themes/modern/components/ArticleFeed.astro';
import Sidebar from '../themes/modern/components/Sidebar.astro';
import MustReads from '../themes/modern/components/MustReads.astro';
import MoreOn from '../themes/modern/components/MoreOn.astro';
import LoadMoreButton from '../themes/modern/components/LoadMoreButton.astro';
import ArticleCard from '../themes/modern/components/ArticleCard.astro'; // legacy
import AdSlot from '../components/AdSlot.astro';
import { env } from 'cloudflare:workers';
import { getConfig, getSiteId } from '../lib/config';
import { articleIndexKey, type ArticleIndexEntry } from '../lib/kv-schema';
import { isVisibleArticle } from '../utils/article-status';
import { selectFeatured } from '../lib/featured';
import { sliceForPage } from '../lib/articles-pagination';

const config = getConfig(Astro);
const siteId = getSiteId(Astro);

const allArticles =
  (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];

const visible = allArticles
  .filter((a) => isVisibleArticle(a.status))
  .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

const useV2 = config.theme.layout_v2 === true;

const url = new URL(Astro.request.url);
const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
const pageSize = config.layout.load_more.page_size;
const initialCount = pageSize * 2;

const heroArticles = useV2
  ? selectFeatured(visible, 'hero', config.layout.hero.count)
  : [];
const heroSlugs = new Set(heroArticles.map((a) => a.slug));

const mustReadArticles = useV2 && config.layout.must_reads.enabled
  ? selectFeatured(visible, 'must-read', config.layout.must_reads.count, heroSlugs)
  : [];

const feedSlice = sliceForPage(visible, page, pageSize);
const hasMore = visible.length > initialCount + (page - 1) * pageSize;
---

<BaseLayout
  title={config.site_name}
  description={config.site_tagline ?? `${config.site_name} — latest articles`}
>
  <Fragment slot="head">
    <SEOHead
      title={config.site_name}
      description={config.site_tagline ?? `${config.site_name} — latest articles`}
      canonicalUrl={`https://${config.domain}`}
      siteName={config.site_name}
    />
  </Fragment>

  <Header config={config} currentPath="/" />

  {useV2 ? (
    <main class="homepage-v2">
      {config.layout.hero.enabled && <HeroGrid articles={heroArticles} />}
      <AdSlot position="homepage-top" pageType="homepage" server:defer />
      <section class="whats-new">
        <div class="whats-new-inner">
          <ArticleFeed articles={feedSlice} />
          <Sidebar variant="home" config={config} />
        </div>
      </section>
      {config.layout.must_reads.enabled && <MustReads articles={mustReadArticles} />}
      <MoreOn articles={[]} siteName={config.site_name} />
      <LoadMoreButton nextPage={page + 1} hasMore={hasMore} />
    </main>
  ) : (
    <main class="homepage">
      <div class="container">
        <AdSlot position="homepage-top" pageType="homepage" server:defer />
        <section class="section">
          <h2 class="section-heading">Latest Articles</h2>
          <div class="article-grid">
            {visible.slice(0, 12).map((article) => (
              <ArticleCard
                title={article.title}
                slug={article.slug}
                featuredImage={article.featuredImage}
                description={article.description}
                author={article.author}
                publishDate={article.publishDate}
                tags={article.tags}
                type={article.type}
              />
            ))}
          </div>
          {visible.length === 0 && (
            <p class="empty-state">
              No published articles yet for <code>{config.domain}</code>.
            </p>
          )}
        </section>
      </div>
    </main>
  )}

  <Footer config={config} />
  <AdSlot position="sticky-bottom" pageType="homepage" server:defer />
</BaseLayout>

<style>
  .homepage, .homepage-v2 { min-height: 60vh; }
  .container {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    padding: 0 1rem;
  }
  .whats-new {
    padding: 2.5rem 0;
  }
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
  .section { padding: 2.5rem 0 1rem; }
  .section-heading {
    font-family: var(--fontHeading, sans-serif);
    font-size: var(--text-2xl, 1.5rem);
    font-weight: 700;
    margin-bottom: 1.5rem;
    color: var(--color-text, #1a1a2e);
  }
  .article-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  @media (min-width: 640px) { .article-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 960px) { .article-grid { grid-template-columns: repeat(3, 1fr); } }
  .empty-state {
    grid-column: 1 / -1;
    text-align: center;
    color: var(--color-muted, #9ca3af);
    padding: 4rem 0;
    font-size: 1.125rem;
  }
</style>
```

The `MoreOn articles={[]}` is intentional — its grid is the JS append target. Initial `feedSlice` is rendered into `ArticleFeed`. **Hmm — design says feed is in the What's New section and MoreOn is the Load-More section**. Re-read carefully:

Per the design doc:
- `ArticleFeed` = What's New left column (paginated content)
- `MoreOn` = below MustReads, Load More target

So actually `<ArticleFeed articles={feedSlice}>` should be the slice tied to `?page` (since the feed paginates). And `<MoreOn>` is a separate, independent section. Looking at the screenshots again, the "What's New?" section is *also* the load-more target — there isn't a clean break.

For simplicity and to match the screenshots: **the What's New feed is the load-more target** (not "More On"). Update accordingly:

- Remove `<MoreOn>` from this implementation; What's New is the only paginated section.
- Change `<div class="more-on-grid" id="more-on-feed">` to `<div id="article-feed-list">` in ArticleFeed.astro, and update LoadMoreButton.astro to target `#article-feed-list`.
- Delete the `<MoreOn>` import + usage in index.astro.

**(Action: edit ArticleFeed.astro and LoadMoreButton.astro accordingly before committing.)**

Edit ArticleFeed.astro:

```astro
<section class="article-feed">
  <h2 class="article-feed-heading">{heading}</h2>
  <div id="article-feed-list">
    {articles.map((article) => <FeedCard article={article} />)}
  </div>
</section>
```

Edit LoadMoreButton.astro inline script: change `document.getElementById('more-on-feed')` to `document.getElementById('article-feed-list')`.

Delete `MoreOn.astro` (created in task 2.4) since it's redundant. Adjust the task 2.4 commit retroactively only if executor catches it during review; otherwise this task absorbs the cleanup.

**Step 2: Verify**

Run: `cd packages/site-worker && pnpm typecheck && pnpm build`
Expected: PASS.

**Step 3: Set the toggle on coolnews-atl for testing**

Edit `~/Documents/ATL-content-network/atomic-labs-network/sites/coolnews-atl/site.yaml` (on its `staging/coolnews-atl` branch):

```yaml
theme:
  base: modern
  logo: /assets/logo.png
  favicon: /assets/logo.png
  layout_v2: true       # NEW
  colors:
    primary: "#243447"
    accent: "#f4c542"
```

Commit + push to staging branch in the network repo.

**Step 4: Re-seed and visually verify**

Run from the platform repo:
```bash
cd packages/site-worker
NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network \
CLOUDFLARE_ACCOUNT_ID=953511f6356ff606d84ac89bba3eff50 \
pnpm seed:kv coolnews-atl
pnpm dev:worker
```

Open the staging Worker URL with `?_atl_site=coolnews-atl`. Check:
- Hero grid renders 4 cards (or fewer if not enough articles)
- What's New shows paginated feed (left) + sidebar (right) with ad placeholder + yellow newsletter box
- Click Load More → URL becomes ?page=2 (no JS) or feed grows in place (JS)
- MustReads band appears with hero + 4 thumbs
- Footer renders

**Step 5: Commit**

```bash
git add packages/site-worker/src/pages/index.astro \
        packages/site-worker/src/themes/modern/components/ArticleFeed.astro \
        packages/site-worker/src/themes/modern/components/LoadMoreButton.astro
git rm packages/site-worker/src/themes/modern/components/MoreOn.astro
git commit -m "feat(site-worker): wire homepage to layout v2 behind theme.layout_v2

The What's New feed is the paginated section + load-more target. Old
layout still serves any site that hasn't flipped layout_v2: true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.11: Wire article page to layout v2

**Files:**
- Modify: `packages/site-worker/src/pages/[slug]/index.astro`

**Step 1: Read the current file**

Run: `cat packages/site-worker/src/pages/[slug]/index.astro`
Note the existing structure so we can preserve fields like SEO, AdSlots, prose rendering.

**Step 2: Add v2 branch**

Below the existing data-loading block, compute related articles and category-list articles:

```ts
const useV2 = config.theme.layout_v2 === true;

let related: ArticleIndexEntry[] = [];
let categoryLists: { topic: string; articles: ArticleIndexEntry[] }[] = [];

if (useV2) {
  const sortedAll = (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];
  const visible = sortedAll
    .filter((a) => isVisibleArticle(a.status) && a.slug !== article.frontmatter.slug)
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());

  // Related: same primary tag, fallback to latest
  const primaryTag = article.frontmatter.tags[0];
  related = (primaryTag
    ? visible.filter((a) => a.tags.includes(primaryTag))
    : visible
  ).slice(0, 4);

  // Category lists: brief.topics, max 2, exclude the article's primary topic if listed
  const allTopics = config.layout.sidebar_topics.auto
    ? (config.brief.topics ?? [])
    : config.layout.sidebar_topics.explicit;
  const otherTopics = allTopics.filter((t) => t !== primaryTag).slice(0, 2);
  categoryLists = otherTopics.map((topic) => ({
    topic,
    articles: visible
      .filter((a) => a.tags.some((t) => t.toLowerCase() === topic.toLowerCase()))
      .slice(0, 4),
  }));
}
```

Wrap the existing markup with the v2 toggle:

```astro
{useV2 ? (
  <>
    <Header config={config} currentPath={`/${article.frontmatter.slug}`} />
    <ArticleHero article={article.frontmatter} />
    <main class="article-page-v2">
      <div class="article-page-inner">
        <article class="article-prose prose">
          <Fragment set:html={article.body} />
          {article.frontmatter.tags.length > 0 && (
            <p class="article-tags">{article.frontmatter.tags.map((t) => `#${t}`).join(' ')}</p>
          )}
        </article>
        <Sidebar variant="article" config={config} categories={categoryLists} />
      </div>
      <NewsletterBand domain={config.domain} />
      <RelatedPosts articles={related} />
    </main>
    <Footer config={config} />
  </>
) : (
  <!-- existing legacy markup here -->
)}
```

Add styles:

```css
  .article-page-inner {
    max-width: var(--container-max, 1200px);
    margin: 0 auto;
    padding: 2.5rem 1rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
  @media (min-width: 960px) {
    .article-page-inner { grid-template-columns: 1fr 320px; }
  }
  .article-tags { color: var(--color-muted, #6b7280); margin-top: 2rem; }
```

Add imports for `ArticleHero`, `Sidebar`, `NewsletterBand`, `RelatedPosts`, `Footer`, `Header` if not already present.

**Step 3: Verify**

Run: `cd packages/site-worker && pnpm typecheck && pnpm build`
Expected: PASS.

**Step 4: Visual smoke test**

Re-seed coolnews-atl and open any article URL on the staging Worker. Verify:
- Hero band with title + image
- 2-column body + sticky sidebar
- Newsletter band below body
- Related Posts section
- Footer

**Step 5: Commit**

```bash
git add packages/site-worker/src/pages/[slug]/index.astro
git commit -m "feat(site-worker): wire article page to layout v2

ArticleHero band, 2-col body + sticky sidebar (ad + Follow Us +
category lists), newsletter band, related posts. Old layout untouched
when theme.layout_v2 = false.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Wizard & Site Settings UI

### Task 3.1: Font registry

**Files:**
- Create: `services/dashboard/src/lib/font-registry.ts`

**Step 1: Create the registry**

```ts
export interface FontEntry {
  id: string;
  family: string;
  category: 'sans-serif' | 'serif' | 'display';
  weights: number[];
}

export const FONT_REGISTRY: readonly FontEntry[] = [
  { id: 'inter',         family: 'Inter',            category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'poppins',       family: 'Poppins',          category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'manrope',       family: 'Manrope',          category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'dm-sans',       family: 'DM Sans',          category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'ibm-plex-sans', family: 'IBM Plex Sans',    category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'source-sans-3', family: 'Source Sans 3',    category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'roboto',        family: 'Roboto',           category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'space-grotesk', family: 'Space Grotesk',    category: 'sans-serif', weights: [400, 500, 600, 700] },
  { id: 'lora',          family: 'Lora',             category: 'serif',      weights: [400, 500, 600, 700] },
  { id: 'merriweather',  family: 'Merriweather',     category: 'serif',      weights: [400, 700] },
  { id: 'playfair',      family: 'Playfair Display', category: 'serif',      weights: [400, 500, 600, 700] },
  { id: 'bebas-neue',    family: 'Bebas Neue',       category: 'display',    weights: [400] },
] as const;

export function findFontByFamily(family: string): FontEntry | undefined {
  const norm = family.trim().toLowerCase();
  return FONT_REGISTRY.find((f) => f.family.toLowerCase() === norm);
}
```

**Step 2: Verify**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS.

**Step 3: Commit**

```bash
git add services/dashboard/src/lib/font-registry.ts
git commit -m "feat(dashboard): add curated Google Fonts registry (12 fonts)

Used by wizard color/font picker and site settings Theme tab. Free-text
font names still accepted at runtime as a fallback.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: ColorPickerField + FontPickerField components

**Files:**
- Create: `services/dashboard/src/components/wizard/ColorPickerField.tsx`
- Create: `services/dashboard/src/components/wizard/FontPickerField.tsx`

**Step 1: ColorPickerField**

```tsx
"use client";

import { useState } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (HEX_RE.test(trimmed)) return trimmed;
  if (/^[a-z]+$/i.test(trimmed)) {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillStyle = trimmed;
    return ctx.fillStyle;
  }
  return null;
}

export function ColorPickerField({ label, value, onChange, helperText }: Props): React.ReactElement {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);

  function commit(raw: string): void {
    const normalized = normalizeColor(raw);
    if (!normalized) {
      setError("Invalid color");
      return;
    }
    setError(null);
    setText(normalized);
    onChange(normalized);
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => { setText(e.target.value); onChange(e.target.value); }}
          className="h-10 w-12 cursor-pointer border rounded"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          className="flex-1 px-2 py-1.5 border rounded text-sm font-mono"
          placeholder="#1a1a2e or red"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {helperText && !error && <p className="text-xs text-gray-500">{helperText}</p>}
    </div>
  );
}
```

**Step 2: FontPickerField**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { FONT_REGISTRY, type FontEntry } from "@/lib/font-registry";

interface Props {
  label: string;
  value: string;
  onChange: (family: string) => void;
}

export function FontPickerField({ label, value, onChange }: Props): React.ReactElement {
  const loadedRef = useRef(new Set<string>());

  function ensureLoaded(family: string): void {
    if (loadedRef.current.has(family)) return;
    loadedRef.current.add(family);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }

  useEffect(() => { ensureLoaded(value); }, [value]);

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => { ensureLoaded(e.target.value); onChange(e.target.value); }}
        className="w-full px-2 py-1.5 border rounded"
      >
        {FONT_REGISTRY.map((f: FontEntry) => (
          <option key={f.id} value={f.family} style={{ fontFamily: `'${f.family}', sans-serif` }}>
            {f.family} — {f.category}
          </option>
        ))}
      </select>
      <p
        className="text-base text-gray-700 mt-1"
        style={{ fontFamily: `'${value}', sans-serif` }}
      >
        The quick brown fox jumps over the lazy dog
      </p>
    </div>
  );
}
```

**Step 3: Verify**

Run: `cd services/dashboard && pnpm typecheck`
Expected: PASS.

**Step 4: Commit**

```bash
git add services/dashboard/src/components/wizard/ColorPickerField.tsx \
        services/dashboard/src/components/wizard/FontPickerField.tsx
git commit -m "feat(dashboard): ColorPickerField + FontPickerField components

Color: native picker + hex/named text input with validation.
Font: dropdown over font registry with live preview, lazy-loads the
font stylesheet on render/change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.3: Extend StepTheme + WizardFormData + wizard server action

**Files:**
- Modify: `services/dashboard/src/components/wizard/StepTheme.tsx`
- Modify: `services/dashboard/src/types/dashboard.ts` (or wherever `WizardFormData` lives)
- Modify: `services/dashboard/src/app/wizard/page.tsx` (DEFAULT_FORM)
- Modify: `services/dashboard/src/actions/wizard.ts`

**Step 1: Extend WizardFormData**

Add fields:

```ts
  primaryColor: string;
  accentColor: string;
  fontHeading: string;
  fontBody: string;
```

**Step 2: Extend DEFAULT_FORM**

```ts
  primaryColor: "#1a1a2e",
  accentColor: "#f4c542",
  fontHeading: "Inter",
  fontBody: "Inter",
```

**Step 3: Add inputs to StepTheme.tsx**

After the existing theme tile picker block, add a Brand Colors section using `ColorPickerField` twice and a Typography section using `FontPickerField` twice. Use existing `data` + `onChange` props of the wizard step (read existing props by reading `StepTheme.tsx`).

```tsx
import { ColorPickerField } from "./ColorPickerField";
import { FontPickerField } from "./FontPickerField";

// inside the component, below the existing theme tile picker:
<div className="grid grid-cols-2 gap-4 mt-6">
  <ColorPickerField
    label="Main color (header / nav)"
    value={data.primaryColor}
    onChange={(v) => onChange({ primaryColor: v })}
    helperText="Used for the header band and accents"
  />
  <ColorPickerField
    label="Accent color (CTA / newsletter)"
    value={data.accentColor}
    onChange={(v) => onChange({ accentColor: v })}
    helperText="Used for the subscribe band and call-to-action buttons"
  />
</div>
<div className="grid grid-cols-2 gap-4 mt-6">
  <FontPickerField
    label="Heading font"
    value={data.fontHeading}
    onChange={(v) => onChange({ fontHeading: v })}
  />
  <FontPickerField
    label="Body font"
    value={data.fontBody}
    onChange={(v) => onChange({ fontBody: v })}
  />
</div>
```

**Step 4: Wire wizard.ts server action to write the new fields**

Read `services/dashboard/src/actions/wizard.ts`. Locate where the `site.yaml` payload is built. Extend the `theme` block:

```ts
  theme: {
    base: data.themeBase,
    logo: data.logoUrl,
    favicon: data.faviconUrl,
    layout_v2: true,        // every new site uses the new layout
    colors: {
      primary: data.primaryColor,
      accent: data.accentColor,
    },
    fonts: {
      heading: data.fontHeading,
      body: data.fontBody,
    },
  },
```

**Step 5: Verify**

Run: `cd services/dashboard && pnpm typecheck && pnpm build`
Expected: PASS.

**Step 6: Commit**

```bash
git add services/dashboard/src/components/wizard/StepTheme.tsx \
        services/dashboard/src/types/dashboard.ts \
        services/dashboard/src/app/wizard/page.tsx \
        services/dashboard/src/actions/wizard.ts
git commit -m "feat(dashboard): wizard captures brand colors + fonts

StepTheme picks main + accent colors and heading + body fonts via the
shared ColorPickerField / FontPickerField. Server action writes them
to site.yaml's theme block. New sites default to layout_v2: true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.4: Site Settings — Theme sub-tab

**Files:**
- Create: `services/dashboard/src/components/site-detail/SiteThemeTab.tsx`
- Modify: `services/dashboard/src/app/sites/[domain]/page.tsx` (or wherever the tab list is registered)
- Modify: `services/dashboard/src/app/api/sites/save/route.ts` (accept new fields)
- Modify: any GET route returning the site config (`/api/sites/site-config`) to include the new fields if not already returned.

**Step 1: Create SiteThemeTab.tsx**

A client component with a form that:
- Renders theme variant tile picker (modern enabled, others disabled).
- Uses `ColorPickerField` for primary + accent.
- Uses `FontPickerField` for heading + body.
- Renders Logo + Favicon uploaders (move from Identity tab — or leave them duplicated for v1).
- Renders Layout Knobs:
  - Hero enabled (checkbox), count radio (3 / 4)
  - Must Reads enabled (checkbox)
  - Sidebar topics radio (auto / explicit) with chip input for explicit list
  - Load more page size (number input)
- Each row has a "Reset to org default" link if the value differs from org/group inheritance (use the inheritance object from `/api/sites/site-config`).
- Save button POSTs to `/api/sites/save` with the patched config.

Skeleton:

```tsx
"use client";

import { useState } from "react";
import { ColorPickerField } from "@/components/wizard/ColorPickerField";
import { FontPickerField } from "@/components/wizard/FontPickerField";

interface SiteThemeTabProps {
  domain: string;
  initial: {
    primaryColor: string;
    accentColor: string;
    fontHeading: string;
    fontBody: string;
    layout: {
      hero: { enabled: boolean; count: 3 | 4 };
      must_reads: { enabled: boolean };
      sidebar_topics: { auto: boolean; explicit: string[] };
      load_more: { page_size: number };
    };
  };
}

export function SiteThemeTab({ domain, initial }: SiteThemeTabProps): React.ReactElement {
  const [state, setState] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain,
          patch: {
            theme: {
              colors: { primary: state.primaryColor, accent: state.accentColor },
              fonts: { heading: state.fontHeading, body: state.fontBody },
            },
            layout: state.layout,
          },
        }),
      });
      setStatus(res.ok ? "Saved" : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-lg font-semibold mb-3">Brand Colors</h3>
        <div className="grid grid-cols-2 gap-4">
          <ColorPickerField label="Main color" value={state.primaryColor}
            onChange={(v) => setState((s) => ({ ...s, primaryColor: v }))} />
          <ColorPickerField label="Accent color" value={state.accentColor}
            onChange={(v) => setState((s) => ({ ...s, accentColor: v }))} />
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-3">Typography</h3>
        <div className="grid grid-cols-2 gap-4">
          <FontPickerField label="Heading font" value={state.fontHeading}
            onChange={(v) => setState((s) => ({ ...s, fontHeading: v }))} />
          <FontPickerField label="Body font" value={state.fontBody}
            onChange={(v) => setState((s) => ({ ...s, fontBody: v }))} />
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold mb-3">Layout</h3>
        <label className="block">
          <input type="checkbox"
            checked={state.layout.hero.enabled}
            onChange={(e) => setState((s) => ({ ...s, layout: { ...s.layout, hero: { ...s.layout.hero, enabled: e.target.checked } } }))} />
          {" "}Show hero grid
        </label>
        <label className="block mt-1">
          Hero count:&nbsp;
          <select
            value={state.layout.hero.count}
            onChange={(e) => setState((s) => ({ ...s, layout: { ...s.layout, hero: { ...s.layout.hero, count: parseInt(e.target.value, 10) as 3 | 4 } } }))}
          >
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
        <label className="block mt-1">
          <input type="checkbox"
            checked={state.layout.must_reads.enabled}
            onChange={(e) => setState((s) => ({ ...s, layout: { ...s.layout, must_reads: { ...s.layout.must_reads, enabled: e.target.checked } } }))} />
          {" "}Show Must Reads section
        </label>
        <label className="block mt-1">
          Load more page size:&nbsp;
          <input type="number" min={1} max={50}
            value={state.layout.load_more.page_size}
            onChange={(e) => setState((s) => ({ ...s, layout: { ...s.layout, load_more: { page_size: parseInt(e.target.value, 10) || 10 } } }))}
          />
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded">
          {saving ? "Saving…" : "Save"}
        </button>
        {status && <span className="text-sm text-gray-600">{status}</span>}
      </div>
    </div>
  );
}
```

**Step 2: Register the tab**

Read the current site detail tab list (`services/dashboard/src/app/sites/[domain]/page.tsx` or its sub-component) and add a new sub-tab `Theme` between `Identity` and `Content Brief`. Pass the tab the `initial` data shaped from the existing `/api/sites/site-config` response.

**Step 3: Extend `/api/sites/save` to accept the new fields**

Read `services/dashboard/src/app/api/sites/save/route.ts`. The handler should already do a generic deep-merge on the request `patch` into the site's yaml. Confirm (or add) that `theme.colors`, `theme.fonts`, and `layout.*` are persisted. If the route filters allowed keys, add the new ones.

**Step 4: Verify typecheck and build**

Run: `cd services/dashboard && pnpm typecheck && pnpm build`
Expected: PASS.

**Step 5: Smoke test in dev**

```bash
cloudgrid dev
```

Open `http://localhost:3001/sites/coolnews-atl`, click Theme tab, change a color, click Save. Reload — value persists.

**Step 6: Commit**

```bash
git add services/dashboard/src/components/site-detail/SiteThemeTab.tsx \
        services/dashboard/src/app/sites/[domain]/page.tsx \
        services/dashboard/src/app/api/sites/save/route.ts
git commit -m "feat(dashboard): site detail Theme sub-tab

Editor changes brand colors, fonts, and layout knobs after a site is
created. Writes via existing /api/sites/save.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.5: Org Settings — defaults

**Files:**
- Modify: `services/dashboard/src/app/settings/page.tsx` (or the Org tab component)
- Modify: `services/dashboard/src/app/api/settings/org/route.ts`

**Step 1: Add inputs to the Org tab**

Mirror the Theme tab's color picker pair, font picker pair, and layout knobs in a new "Defaults" section of the Org tab. They write to:

```yaml
default_colors:
  primary: ...
  accent: ...
default_fonts:
  heading: ...
  body: ...
layout:
  ...
```

**Step 2: Verify the GET/PUT route accepts these fields**

Read `services/dashboard/src/app/api/settings/org/route.ts`. Confirm the PUT handler writes the request body to `org.yaml`. If it filters keys, allow `default_colors` and `layout`.

**Step 3: Verify**

Run: `cd services/dashboard && pnpm typecheck && pnpm build`
Expected: PASS.

**Step 4: Commit**

```bash
git add services/dashboard/src/app/settings/page.tsx \
        services/dashboard/src/app/api/settings/org/route.ts
git commit -m "feat(dashboard): Org Settings exposes default colors + layout

Wizard and new sites read these as the seed values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.6: Guide page

**Files:**
- Create: `services/dashboard/public/guide/13-theme-and-layout.md`
- Modify: `services/dashboard/src/app/guide/page.tsx` — register the new page in `GUIDE_PAGES`.

**Step 1: Write the guide**

Cover: theme variants, two-color model, font registry, layout knobs, featured frontmatter flag, how to flip layout_v2 on existing sites, troubleshooting.

**Step 2: Register**

Read `services/dashboard/src/app/guide/page.tsx`, append:

```ts
{ slug: '13-theme-and-layout', title: 'Theme & Layout' },
```

(Match the existing entry shape — read first, copy.)

**Step 3: Commit**

```bash
git add services/dashboard/public/guide/13-theme-and-layout.md \
        services/dashboard/src/app/guide/page.tsx
git commit -m "docs(dashboard): add Theme & Layout guide page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Rollout & Cleanup

### Task 4.1: Flip remaining sites to layout_v2

For each existing site listed in `dashboard-index.yaml`:

```bash
cd ~/Documents/ATL-content-network/atomic-labs-network
git checkout staging/<domain>
```

Edit `sites/<domain>/site.yaml` and add `layout_v2: true` under `theme:`. Optionally set `theme.colors.primary` / `theme.colors.accent` to brand-appropriate values (or leave to inherit from org).

Commit + push the staging branch. Re-seed via the GitHub Actions sync-kv workflow (or manually with `pnpm seed:kv <siteId>`). Open the staging Worker URL `?_atl_site=<domain>` and visually confirm the new layout renders.

When satisfied, merge staging branch → main per the existing publish workflow.

(Repeat for every site. Track progress in a checklist.)

---

### Task 4.2: Remove the toggle and delete legacy templates

**Once all sites have `layout_v2: true` and have been verified:**

**Files:**
- Modify: `packages/site-worker/src/pages/index.astro` — strip the `useV2 ? ... : ...` branches, keep only the v2 path.
- Modify: `packages/site-worker/src/pages/[slug]/index.astro` — same.
- Modify: `packages/shared-types/src/config.ts` — remove `layout_v2` from `ThemeConfig` and `ResolvedThemeConfig`.
- Modify: `packages/site-worker/scripts/seed-kv.ts` — remove the `layout_v2` write.
- Delete: `packages/site-worker/src/themes/modern/components/ArticleCard.astro` (legacy, no longer used).
- For each `sites/<domain>/site.yaml`, remove the `layout_v2: true` line — it's now implicit.

**Step 1: Verify no references remain**

Run: `grep -r "layout_v2" packages/ services/`
Expected: zero results after edits.

**Step 2: Verify builds + tests**

Run from repo root: `pnpm typecheck && cd packages/site-worker && pnpm vitest run --project unit && pnpm build`
Expected: PASS.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore(site-worker): remove layout_v2 toggle, drop legacy templates

All sites are on the new layout. The v1 homepage / article templates
and ArticleCard are removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Verification Checklist

When all tasks are done:

- [ ] `pnpm -w typecheck` clean
- [ ] `cd packages/site-worker && pnpm vitest run --project unit` passes (all new tests + originals)
- [ ] `cd packages/site-worker && pnpm build` succeeds
- [ ] `cd services/dashboard && pnpm typecheck && pnpm build` succeeds
- [ ] `coolnews-atl` staging Worker renders the new homepage matching the reference screenshots at 1440px and 375px
- [ ] `coolnews-atl` article page renders matching reference screenshots
- [ ] Newsletter form on each placement (sidebar / band / footer) appends to the Google Sheet with the correct `source` value
- [ ] Load More button paginates with JS on (fetch + append) AND with JS off (`?page=N` navigation)
- [ ] Wizard: creating a new site captures colors + fonts; new site renders with chosen palette
- [ ] Site Settings → Theme sub-tab: changes save and re-render after seed-kv

## Notes for the Executor

- **Read before you write.** Several tasks (Task 3.3, 3.4, 3.5) say to "extend" or "match the existing pattern" — actually `cat` the file first; the codebase has its own conventions (e.g. how form state is handled, how `/api/sites/save` shapes its patch).
- **Type changes ripple.** After Task 1.1 the typecheck will fail in downstream packages until Task 1.5. That's intentional. Don't try to "fix" the errors — Task 1.5 fixes them.
- **The two repos.** `theme.layout_v2` and `featured` flags live in the *network* repo (atomic-labs-network), not this repo. Task 1.8 and Task 4.1 cross repo boundaries — read CLAUDE.md's "Two-Repo Architecture" section before touching network yaml.
- **Snapshot tests.** I deliberately skipped Astro component snapshot tests — they're heavy to set up for a first pass and visual diff is more useful. Add them as a follow-up if regressions creep in.
- **Hot-button: editing existing tabs.** Task 3.3 modifies `StepTheme` and Task 3.4 modifies the site detail page. These files have specific patterns for state handling, save buttons, and source badges. Mirror what's already there — do NOT invent a new pattern.
