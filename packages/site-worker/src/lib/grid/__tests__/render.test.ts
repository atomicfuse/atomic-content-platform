import { describe, expect, it } from 'vitest';
import { GRID_CARD_DEFAULTS, type GridPoolItem, type NetworkDirectorySite } from '@atomic-platform/shared-types';
import { renderTilesHtml, selectPlacements, type TileRenderContext } from '../render';
import { uniqueAdCode } from '../../ad-code';
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
    expect(html).toContain('scienceworld.com');
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

describe('uniqueAdCode', () => {
  const snippet = `<div id="widget1" style='background-color:#fcfbf7'></div>
<script>
    _sf_loadWidget("widget1", {qs: "g_lo=v&layout=vsm&count=1&obj_id=0"});
</script>`;
  it('suffixes every declared element id, wherever the snippet quotes it', () => {
    const out = uniqueAdCode(snippet, 'block3-2');
    expect(out).toContain('<div id="widget1-block3-2"');
    expect(out).toContain('_sf_loadWidget("widget1-block3-2",');
    expect(out).toContain('obj_id=0'); // query params named *_id are not element ids
    expect(uniqueAdCode(`<div id='w'></div><script>document.querySelector('#w')</script>`, 's1'))
      .toBe(`<div id='w-s1'></div><script>document.querySelector('#w-s1')</script>`);
  });
  it('leaves snippets without element ids unchanged', () => {
    expect(uniqueAdCode('<script>window.x=1</script>', 'gf-1')).toBe('<script>window.x=1</script>');
  });
  it('gives each feed ad tile its own widget id', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b'), item('c'), item('d')], 0, 3),
      ctx({ placements: [{ id: 'block3', position: 'grid-feed', code: snippet }] }));
    expect(html.match(/id="widget1[^"]*"/g)).toEqual(['id="widget1-block3-1"', 'id="widget1-block3-2"']);
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
  it('shows the publisher favicon from R2 when the sync stored one', () => {
    const ext = item('t-x1', { site: 'aggregator', kind: 'external', sourceName: 'instyle.com', favicon: '/aggregator/assets/favicons/instyle.com.png' });
    const html = renderTilesHtml(buildTiles([ext], 0, 0), ctx());
    expect(html).toContain('<img class="g-card__favicon" src="/aggregator/assets/favicons/instyle.com.png" width="16" height="16"');
    expect(html).not.toContain('g-card__favicon--letter');
  });
  it('network cards are byte-identical to before (no image fallback attribute)', () => {
    const html = renderTilesHtml(buildTiles([item('a')], 0, 0), ctx());
    expect(html).toContain('<span class="g-card__site">scienceworld.com</span>');
    expect(html).toContain('src="/sw/assets/fav.png"');
    expect(html).not.toContain('data-fallback');
  });
});

describe('sourceNameOf', () => {
  it('uses the publisher for external stories and the directory name for network ones', async () => {
    const { sourceNameOf } = await import('../render');
    expect(sourceNameOf(item('x', { site: 'aggregator', kind: 'external', sourceName: 'InStyle' }), sites)).toBe('InStyle');
    expect(sourceNameOf(item('x', { site: 'aggregator', kind: 'external' }), sites)).toBe('Source');
    expect(sourceNameOf(item('a'), sites)).toBe('scienceworld.com');
    expect(sourceNameOf(item('a', { site: 'unknown' }), sites)).toBe('unknown');
  });
});

describe('injectInlineAds — uniqueIds (Grid story pages)', () => {
  it('suffixes snippet ids with the slot id only when asked', async () => {
    const { injectInlineAds } = await import('../../inline-ads');
    const placements = [{ id: 'block4', position: 'after-paragraph-1', code: '<div id="widget1"></div><script>_sf_loadWidget("widget1")</script>' }];
    expect(injectInlineAds('<p>a</p>', placements, { uniqueIds: true })).toContain('_sf_loadWidget("widget1-block4")');
    expect(injectInlineAds('<p>a</p>', placements)).toContain('_sf_loadWidget("widget1")');
  });
});

describe('grid-feed rotation and divider', () => {
  const p = (id: string, device?: string) => ({ id, position: 'grid-feed', code: `<i>${id}</i>`, ...(device ? { device } : {}) });
  it('several placements take turns, one per ad tile', async () => {
    const { rotatePlacements } = await import('../render');
    const list = [p('n1'), p('n2'), p('d1')];
    expect([1, 2, 3, 4].map((i) => rotatePlacements(list, i).map((x) => x.placement.id).join())).toEqual(['n1', 'n2', 'd1', 'n1']);
  });
  it('pins different desktop / mobile picks to their device so a tile never shows two ads', async () => {
    const { rotatePlacements } = await import('../render');
    expect(rotatePlacements([p('all'), p('mob', 'mobile')], 2)).toEqual([
      { placement: p('all'), device: 'desktop' }, { placement: p('mob', 'mobile'), device: 'mobile' },
    ]);
    expect(rotatePlacements([p('all'), p('mob', 'mobile')], 1)).toEqual([{ placement: p('all'), device: 'all' }]);
  });
  it('renders one placement per tile in the feed', () => {
    const html = renderTilesHtml(buildTiles([item('a'), item('b'), item('c'), item('d')], 0, 3), ctx({ placements: [p('n1'), p('n2')] }));
    expect(html.match(/data-ad-id="[^"]+"/g)).toEqual(['data-ad-id="n1-1"', 'data-ad-id="n2-2"']);
  });
  it('divider: a full-width banner row per batch, only when a grid-divider placement exists', async () => {
    const { renderDividerHtml } = await import('../render');
    const base = { pageType: 'homepage' as const, staging: false };
    expect(renderDividerHtml(1, { ...base, placements: [p('n1')] })).toBe('');
    const html = renderDividerHtml(2, { ...base, placements: [{ id: 'banner', position: 'grid-divider', code: '<b>x</b>' }] });
    expect(html).toContain('class="g-tile g-tile--divider"');
    expect(html).toContain('data-ad-id="banner-p2"');
  });
});
