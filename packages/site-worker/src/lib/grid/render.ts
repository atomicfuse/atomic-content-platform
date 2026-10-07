import type { GridPoolItem, NetworkDirectorySite, ResolvedGridCardConfig } from '@atomic-platform/shared-types';
import { escapeHtml, formatAge } from './format';
import type { Tile } from './tiles';

/** Structural subset of AdPlacement used by the Grid renderers. */
export interface AdPlacementLike {
  id?: string; position?: string; device?: string;
  sizes?: { desktop?: number[][]; mobile?: number[][] };
  pages?: string[]; code?: string; page_types?: string[]; exclude_pages?: string[];
}

/** Page types as understood by ad placement filters. */
export type GridPageType = 'homepage' | 'category' | 'article';

const EXCLUDE_MAP: Record<GridPageType, string> = { homepage: 'homepage', article: 'articles', category: 'categories' };

/** Same filter semantics as src/components/AdSlot.astro (kept in sync by render.test.ts). */
export function selectPlacements(placements: readonly AdPlacementLike[], position: string, pageType: GridPageType): AdPlacementLike[] {
  return placements.filter((p) => {
    if (p.position !== position) return false;
    if (p.pages && !p.pages.includes(pageType)) return false;
    const pt = p.page_types ?? ['all'];
    if (!pt.includes('all') && !pt.includes(pageType)) return false;
    return !p.exclude_pages?.includes(EXCLUDE_MAP[pageType]);
  });
}

/** Everything the tile renderer needs; built once per request. */
export interface TileRenderContext {
  now: Date;
  card: ResolvedGridCardConfig;
  showIntro: boolean;
  sites: ReadonlyMap<string, NetworkDirectorySite>;
  placements: readonly AdPlacementLike[];
  pageType: GridPageType;
  staging: boolean;
  reservedHeight: number;
}

function faviconHtml(site: NetworkDirectorySite | undefined, fallbackName: string): string {
  if (site?.favicon) {
    return `<img class="g-card__favicon" src="${escapeHtml(site.favicon)}" width="16" height="16" alt="" loading="lazy" decoding="async" />`;
  }
  const letter = escapeHtml((site?.name ?? fallbackName).trim().charAt(0).toUpperCase() || '•');
  return `<span class="g-card__favicon g-card__favicon--letter" aria-hidden="true">${letter}</span>`;
}

/** "[favicon] Site Name · 5d" — shared by cards and the story header. */
export function renderSourceLineHtml(item: GridPoolItem, ctx: TileRenderContext): string {
  // External stories name the publisher (no favicon available → letter badge).
  const external = item.kind === 'external';
  const site = external ? undefined : ctx.sites.get(item.site);
  const rawName = external ? (item.sourceName || 'Source') : (site?.name ?? item.site);
  return `<p class="g-card__source">${faviconHtml(site, rawName)}<span class="g-card__site">${escapeHtml(rawName)}</span>`
    + `<span class="g-card__dot" aria-hidden="true">·</span><time datetime="${escapeHtml(item.publishDate)}">${escapeHtml(formatAge(item.publishDate, ctx.now))}</time></p>`;
}

function renderCardHtml(item: GridPoolItem, index: number, ctx: TileRenderContext): string {
  const href = `/story/${encodeURIComponent(item.site)}/${encodeURIComponent(item.slug)}`;
  const img = escapeHtml(item.featuredImage || '/placeholder.svg');
  const source = renderSourceLineHtml(item, ctx);
  const badge = ctx.card.source_position === 'badge';
  const intro = ctx.showIntro && item.description ? `<p class="g-card__intro">${escapeHtml(item.description)}</p>` : '';
  return `<article class="g-tile g-card" style="--g-i:${index % 20}"${item.pinned ? ' data-pinned="true"' : ''}>`
    + `<a class="g-card__link" href="${href}">`
    + `<div class="g-card__media"><img src="${img}" data-fallback="/placeholder.svg" alt="" loading="lazy" decoding="async" />${badge ? source : ''}</div>`
    + `<div class="g-card__body">${badge ? '' : source}<h3 class="g-card__title">${escapeHtml(item.title)}</h3>${intro}</div>`
    + `</a></article>`;
}

function renderAdHtml(adIndex: number, ctx: TileRenderContext): string {
  const placements = selectPlacements(ctx.placements, 'grid-feed', ctx.pageType);
  if (placements.length === 0) return '';
  const minHeight = ctx.reservedHeight ? ` style="min-height:${ctx.reservedHeight}px"` : '';
  const slots = placements.map((p) => {
    const id = `${p.id ?? 'grid-feed'}-${adIndex}`;
    const code = ctx.staging ? '' : (p.code ?? '');
    return `<div data-ad-id="${escapeHtml(id)}" data-ad-position="grid-feed" data-ad-page-type="${ctx.pageType}"`
      + ` data-ad-device="${escapeHtml(p.device ?? 'all')}" data-sizes-desktop="${escapeHtml(JSON.stringify(p.sizes?.desktop ?? []))}"`
      + ` data-sizes-mobile="${escapeHtml(JSON.stringify(p.sizes?.mobile ?? []))}" class="atl-ad-slot atl-ad-grid-feed"${minHeight}>${code}</div>`;
  }).join('');
  return `<div class="g-tile g-tile--ad">${slots}</div>`;
}

/** Server-side and /api/feed share this renderer so both produce identical markup. */
export function renderTilesHtml(tiles: readonly Tile[], ctx: TileRenderContext): string {
  return tiles.map((t) => (t.kind === 'story' ? renderCardHtml(t.item, t.index, ctx) : renderAdHtml(t.adIndex, ctx))).join('\n');
}
