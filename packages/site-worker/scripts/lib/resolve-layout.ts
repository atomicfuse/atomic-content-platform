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
 *   - `must_reads.count` and `load_more.page_size` are clamped to >= 1.
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
    sidebar_topics: {
      auto: input?.sidebar_topics?.auto ?? LAYOUT_DEFAULTS.sidebar_topics.auto,
      explicit: input?.sidebar_topics?.explicit ?? LAYOUT_DEFAULTS.sidebar_topics.explicit,
    },
    load_more: {
      page_size: Math.max(1, input?.load_more?.page_size ?? LAYOUT_DEFAULTS.load_more.page_size),
    },
  };
}
