import type {
  GridCardConfig, GridConfig, GridPin, ResolvedGridCardConfig,
  ResolvedGridConfig, ResolvedGridTopic,
} from '@atomic-platform/shared-types';

/**
 * Runtime defaults — mirrors GRID_DEFAULTS / GRID_CARD_DEFAULTS / GRID_CARD_OPTIONS from
 * shared-types/src/grid.ts. Defined inline (same reason as LAYOUT_DEFAULTS in
 * ../config.ts): shared-types emits CJS which Rollup/Vite can't tree-shake as named ESM
 * exports at build time — importing these as values from '@atomic-platform/shared-types'
 * breaks `astro build`'s production bundle (works fine under vitest/dev, fails under
 * Rollup). Keep these in sync with shared-types/src/grid.ts if it changes.
 */
const GRID_CARD_OPTIONS = {
  style: ['bordered', 'shadow', 'flat'],
  corners: ['square', 'small', 'rounded'],
  image_ratio: ['4:3', '16:9', '1:1'],
  image_position: ['top', 'left'],
  density: ['comfortable', 'compact'],
  source_position: ['below', 'badge'],
} as const;

const GRID_DEFAULTS: ResolvedGridConfig = {
  topics: [],
  include_sites: [],
  exclude_sites: [],
  per_site_limit: 10,
  max_age_days: null,
  story_mode: 'excerpt',
  excerpt_paragraphs: 3,
  feed_ad_every: 3,
  page_size: 20,
  show_intro: false,
  outbound_utm: true,
  pinned: [],
};

export const GRID_CARD_DEFAULTS: ResolvedGridCardConfig = {
  style: 'bordered',
  corners: 'rounded',
  image_ratio: '4:3',
  image_position: 'top',
  density: 'comfortable',
  source_position: 'below',
};

const UNTIL_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

/** Kebab-case slug for a topic label or explicit slug. */
export function slugifyTopic(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTopics(value: unknown): ResolvedGridTopic[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const topics: ResolvedGridTopic[] = [];
  for (const raw of value) {
    const t = (raw ?? {}) as { label?: unknown; slug?: unknown; verticals?: unknown };
    const label = typeof t.label === 'string' ? t.label.trim() : '';
    if (!label) continue;
    const source = typeof t.slug === 'string' && t.slug.trim() ? t.slug : label;
    const base = slugifyTopic(source) || 'topic';
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    topics.push({ label, slug, verticals: stringList(t.verticals) });
  }
  return topics;
}

function normalizePins(value: unknown): GridPin[] {
  if (!Array.isArray(value)) return [];
  const pins: GridPin[] = [];
  for (const raw of value) {
    const p = (raw ?? {}) as { site?: unknown; slug?: unknown; until?: unknown };
    if (typeof p.site !== 'string' || !p.site.trim() || typeof p.slug !== 'string' || !p.slug.trim()) continue;
    const until = typeof p.until === 'string' && UNTIL_RE.test(p.until) ? p.until : null;
    pins.push({ site: p.site.trim(), slug: p.slug.trim(), until });
  }
  return pins;
}

/**
 * Resolves a `grid` section to a fully-populated config, clamping out-of-range values.
 * Idempotent: used at seed time and again at runtime (the `??=` KV-evolution safety net).
 */
export function normalizeGridConfig(input: GridConfig | undefined): ResolvedGridConfig {
  const g = (input ?? {}) as GridConfig;
  const every = clampInt(g.feed_ad_every, 0, 50, GRID_DEFAULTS.feed_ad_every);
  return {
    topics: normalizeTopics(g.topics),
    include_sites: stringList(g.include_sites),
    exclude_sites: stringList(g.exclude_sites),
    per_site_limit: clampInt(g.per_site_limit, 1, 100, GRID_DEFAULTS.per_site_limit),
    max_age_days: g.max_age_days === null || g.max_age_days === undefined
      ? null
      : clampInt(g.max_age_days, 1, 3650, 30),
    story_mode: g.story_mode === 'ai_summary' ? 'ai_summary' : 'excerpt',
    excerpt_paragraphs: clampInt(g.excerpt_paragraphs, 1, 10, GRID_DEFAULTS.excerpt_paragraphs),
    // Note: 1 would make every tile an ad — minimum cadence is 2.
    feed_ad_every: every === 1 ? 2 : every,
    page_size: clampInt(g.page_size, 6, 60, GRID_DEFAULTS.page_size),
    show_intro: g.show_intro === true,
    outbound_utm: g.outbound_utm !== false,
    pinned: normalizePins(g.pinned),
  };
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Resolves `theme.card` to a fully-populated card look. */
export function normalizeGridCard(input: GridCardConfig | undefined): ResolvedGridCardConfig {
  const c = (input ?? {}) as GridCardConfig;
  return {
    style: pick(c.style, GRID_CARD_OPTIONS.style, GRID_CARD_DEFAULTS.style),
    corners: pick(c.corners, GRID_CARD_OPTIONS.corners, GRID_CARD_DEFAULTS.corners),
    image_ratio: pick(c.image_ratio, GRID_CARD_OPTIONS.image_ratio, GRID_CARD_DEFAULTS.image_ratio),
    image_position: pick(c.image_position, GRID_CARD_OPTIONS.image_position, GRID_CARD_DEFAULTS.image_position),
    density: pick(c.density, GRID_CARD_OPTIONS.density, GRID_CARD_DEFAULTS.density),
    source_position: pick(c.source_position, GRID_CARD_OPTIONS.source_position, GRID_CARD_DEFAULTS.source_position),
  };
}
