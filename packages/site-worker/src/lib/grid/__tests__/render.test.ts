import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS, type GridPoolItem, type NetworkDirectorySite } from '@atomic-platform/shared-types';
import { renderTilesHtml, selectPlacements, type TileRenderContext } from '../render';
import { buildTiles } from '../tiles';

const item = (slug: string, over: Partial<GridPoolItem> = {}): GridPoolItem => ({
  site: 'sw', slug, title: `T <${slug}>`, publishDate: '2026-09-26T12:00:00Z', pills: [], pinned: false, ...over,
});
const sites = new Map<string, NetworkDirectorySite>([['sw', {
  siteId: 'sw', hostname: 'scienceworld.com', name: 'Science World', favicon: '/sw/assets/fav.png',
  vertical: 'Science', status: 'Live', isGrid: false, account: 'assets',
}]]);
const ctx = (over: Partial<TileRenderContext> = {}): TileRenderContext => ({
  now: new Date('2026-09-27T12:00:00Z'), card: GRID_CARD_DEFAULTS, showIntro: false, sites,
  placements: [{ id: 'gf', position: 'grid-feed', code: '<script>window.x=1</script>', sizes: { desktop: [[300, 250]] } }],
  pageType: 'homepage', staging: false, reservedHeight: 250, ...over,
});

describe('renderTilesHtml', () => {
  it('renders cards with escaped text, story link, source line and age', () => {
    const html = renderTilesHtml(buildTiles([item('a')], 0, 0), ctx());
    expect(html).toContain('href="/story/sw/a"');
    expect(html).toContain('T &lt;a&gt;');
    expect(html).toContain('Science World');
    expect(html).toContain('>1d<');
    expect(html).toContain('src="/sw/assets/fav.png"');
  });
  it('ad slot ids are unique per tile and carry the AdSlot data contract', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b'), item('c'), item('d')], 0, 3), ctx());
    expect(html.match(/data-ad-id="gf-\d+"/g)).toEqual(['data-ad-id="gf-1"', 'data-ad-id="gf-2"']);
    expect(html).toContain('data-ad-position="grid-feed"');
    expect(html).toContain('class="atl-ad-slot atl-ad-grid-feed"');
    expect(html).toContain('<script>window.x=1</script>');
  });
  it('no grid-feed placement → no ad tile markup at all', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b')], 0, 3), ctx({ placements: [] }));
    expect(html).not.toContain('g-tile--ad');
  });
  it('staging strips widget code but keeps the slot', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b')], 0, 3), ctx({ staging: true }));
    expect(html).toContain('data-ad-id="gf-1"');
    expect(html).not.toContain('<script>');
  });
  it('badge mode puts the source line inside the media block; intro only when enabled', () => {
    const html = renderTilesHtml(buildTiles([item('a', { description: 'Desc' })], 0, 0),
      ctx({ card: { ...GRID_CARD_DEFAULTS, source_position: 'badge' }, showIntro: true }));
    expect(html.indexOf('g-card__source')).toBeLessThan(html.indexOf('g-card__body'));
    expect(html).toContain('<p class="g-card__intro">Desc</p>');
  });
  it('missing favicon → letter avatar; missing image → placeholder', () => {
    const noFav = new Map(sites); noFav.set('sw', { ...sites.get('sw')!, favicon: null });
    const html = renderTilesHtml(buildTiles([item('a')], 0, 0), ctx({ sites: noFav }));
    expect(html).toContain('g-card__favicon--letter');
    expect(html).toContain('src="/placeholder.svg"');
  });
});

describe('selectPlacements', () => {
  it('mirrors AdSlot filtering (page_types, exclude_pages, legacy pages)', () => {
    const p = [
      { id: '1', position: 'grid-feed' },
      { id: '2', position: 'grid-feed', page_types: ['category'] },
      { id: '3', position: 'grid-feed', exclude_pages: ['homepage'] },
      { id: '4', position: 'grid-feed', pages: ['article'] },
      { id: '5', position: 'sidebar' },
    ];
    expect(selectPlacements(p, 'grid-feed', 'homepage').map((x) => x.id)).toEqual(['1']);
    expect(selectPlacements(p, 'grid-feed', 'category').map((x) => x.id)).toEqual(['1', '2', '3']);
  });
});

describe('renderTilesHtml — external stories', () => {
  it('links to /story/aggregator/<slug>, names the publisher with a letter badge, and has an image fallback', () => {
    const ext = item('t-x1', { site: 'aggregator', kind: 'external', sourceName: 'InStyle', featuredImage: 'https://img/x.jpg' });
    const html = renderTilesHtml(buildTiles([ext], 0, 0), ctx());
    expect(html).toContain('href="/story/aggregator/t-x1"');
    expect(html).toContain('<span class="g-card__site">InStyle</span>');
    expect(html).toContain('g-card__favicon--letter" aria-hidden="true">I<');
    expect(html).toContain('data-fallback="/placeholder.svg"');
  });
  it('network cards are unchanged apart from the image fallback attribute', () => {
    const html = renderTilesHtml(buildTiles([item('a')], 0, 0), ctx());
    expect(html).toContain('Science World');
    expect(html).toContain('src="/sw/assets/fav.png"');
  });
});
