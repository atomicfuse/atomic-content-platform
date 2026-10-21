import type { GridPoolItem, NetworkDirectorySite, ResolvedGridCardConfig } from '@atomic-platform/shared-types';
import { escapeHtml, formatAge } from './format';
import type { Tile } from './tiles';
import { uniqueAdCode } from '../ad-code';

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

function faviconHtml(site: NetworkDirectorySite | undefined, fallbackName: string, src?: string | null): string {
  const icon = src ?? site?.favicon;
  if (icon) {
    return `<img class="g-card__favicon" src="${escapeHtml(icon)}" width="16" height="16" alt="" loading="lazy" decoding="async" />`;
  }
  const letter = escapeHtml((site?.name ?? fallbackName).trim().charAt(0).toUpperCase() || '•');
  return `<span class="g-card__favicon g-card__favicon--letter" aria-hidden="true">${letter}</span>`;
}

/**
 * Display name of a story's source: the publisher's domain for aggregator stories, the network
 * site's domain (e.g. "popstorylab.com") for network stories — falling back to its name when the
 * directory has no real domain for it.
 */
export function sourceNameOf(item: GridPoolItem, sites: ReadonlyMap<string, NetworkDirectorySite>): string {
  if (item.kind === 'external') return item.sourceName || 'Source';
  const site = sites.get(item.site);
  if (site?.hostname.includes('.')) return site.hostname;
  return site?.name ?? item.site;
}

/** "[favicon] Site Name · 5d" — shared by cards and the story header. */
export function renderSourceLineHtml(item: GridPoolItem, ctx: TileRenderContext): string {
  // External stories use the publisher favicon stored by the sync, else a letter badge from the publisher name.
  const site = item.kind === 'external' ? undefined : ctx.sites.get(item.site);
  const rawName = sourceNameOf(item, ctx.sites);
  const icon = item.kind === 'external' ? item.favicon : undefined;
  return `<p class="g-card__source">${faviconHtml(site, rawName, icon)}<span class="g-card__site">${escapeHtml(rawName)}</span>`
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
    + `<div class="g-card__media"><img src="${img}"${item.kind === 'external' ? ' data-fallback="/placeholder.svg"' : ''} alt="" loading="lazy" decoding="async" />${badge ? source : ''}</div>`
    + `<div class="g-card__body">${badge ? '' : source}<h3 class="g-card__title">${escapeHtml(item.title)}</h3>${intro}</div>`
    + `</a></article>`;
}

function slotHtml(p: AdPlacementLike, position: string, id: string, ctx: Pick<TileRenderContext, 'pageType' | 'staging'>, device = p.device ?? 'all'): string {
  const code = ctx.staging ? '' : uniqueAdCode(p.code ?? '', id);
  return `<div data-ad-id="${escapeHtml(id)}" data-ad-position="${escapeHtml(position)}" data-ad-page-type="${ctx.pageType}"`
    + ` data-ad-device="${escapeHtml(device)}" data-sizes-desktop="${escapeHtml(JSON.stringify(p.sizes?.desktop ?? []))}"`
    + ` data-sizes-mobile="${escapeHtml(JSON.stringify(p.sizes?.mobile ?? []))}" class="atl-ad-slot atl-ad-${escapeHtml(position)}">${code}</div>`;
}

/**
 * What ad tile `adIndex` (1-based) shows. Several grid-feed placements take turns, one per tile (a blend, e.g.
 * three native widgets and one display ad), separately for desktop and mobile so a device-only placement never
 * leaves a tile empty on the other device. When the two devices get different placements, each is pinned to its
 * device so a tile never shows two ads.
 */
export function rotatePlacements(placements: readonly AdPlacementLike[], adIndex: number): Array<{ placement: AdPlacementLike; device: string }> {
  const pick = (device: 'desktop' | 'mobile'): AdPlacementLike | undefined => {
    const list = placements.filter((p) => (p.device ?? 'all') === 'all' || p.device === device);
    return list.length ? list[(adIndex - 1) % list.length] : undefined;
  };
  const desktop = pick('desktop');
  const mobile = pick('mobile');
  if (desktop === mobile) return desktop ? [{ placement: desktop, device: desktop.device ?? 'all' }] : [];
  return [
    ...(desktop ? [{ placement: desktop, device: 'desktop' }] : []),
    ...(mobile ? [{ placement: mobile, device: 'mobile' }] : []),
  ];
}

/** In-feed ad tile: card-shaped (grid.css), one rotating placement per tile. */
function renderAdHtml(adIndex: number, ctx: TileRenderContext): string {
  const picks = rotatePlacements(selectPlacements(ctx.placements, 'grid-feed', ctx.pageType), adIndex);
  if (picks.length === 0) return '';
  const minHeight = ctx.reservedHeight ? ` style="min-height:${ctx.reservedHeight}px"` : '';
  const slots = picks.map(({ placement: p, device }) => slotHtml(p, 'grid-feed', `${p.id ?? 'grid-feed'}-${adIndex}`, ctx, device)).join('');
  return `<div class="g-tile g-tile--ad"${minHeight}>${slots}</div>`;
}

/** Full-width banner row between feed batches (`grid-divider` placements); empty when none is configured. */
export function renderDividerHtml(page: number, ctx: Pick<TileRenderContext, 'placements' | 'pageType' | 'staging'>): string {
  const placements = selectPlacements(ctx.placements, 'grid-divider', ctx.pageType);
  if (placements.length === 0) return '';
  const slots = placements.map((p) => slotHtml(p, 'grid-divider', `${p.id ?? 'grid-divider'}-p${page}`, ctx)).join('');
  return `<div class="g-tile g-tile--divider">${slots}</div>`;
}

/** Server-side and /api/feed share this renderer so both produce identical markup. */
export function renderTilesHtml(tiles: readonly Tile[], ctx: TileRenderContext): string {
  return tiles.map((t) => (t.kind === 'story' ? renderCardHtml(t.item, t.index, ctx) : renderAdHtml(t.adIndex, ctx))).join('\n');
}
