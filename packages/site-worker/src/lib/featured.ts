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
 *
 * `seed` is ignored when `fallbackOrder !== 'random'` (e.g. `'newest'`);
 * passing a seed with a non-random fallback order has no effect.
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
      ? (seed !== undefined ? shuffleSeeded(remaining, seed) : shuffleRandom(remaining))
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
