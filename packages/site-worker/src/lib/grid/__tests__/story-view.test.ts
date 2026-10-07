import { describe, expect, it } from 'vitest';
import type { ExternalStoryRecord, GridSummaryRecord, NetworkDirectorySite } from '@atomic-platform/shared-types';
import { GRID_DEFAULTS } from '@atomic-platform/shared-types';
import { buildExternalStoryView, buildNetworkStoryView, renderNextStoryHtml, renderStoryArticleHtml } from '../story-view';
import type { ArticleRecord } from '../../kv-schema';

const NOW = new Date('2026-10-07T12:00:00Z');
const site: NetworkDirectorySite = { siteId: 'scoopella', hostname: 'scoopella.com', name: 'Scoopella', favicon: null } as NetworkDirectorySite;
const sites = new Map([[site.siteId, site]]);
const grid = { ...GRID_DEFAULTS, topics: [{ label: 'Celebs', slug: 'celebs', verticals: [], bundles: [] }] };
const record: ArticleRecord = {
  frontmatter: { slug: 'big-news', title: 'Big <News>', author: 'E', publishDate: '2026-10-06T00:00:00Z', tags: [], type: 'standard', status: 'published', featuredImage: '/scoopella/assets/a.jpg', description: 'd' },
  body: '<p>One</p><p>Two</p><p>Three</p><p>Four</p>',
};
const pinnedSummary: GridSummaryRecord = { html: '<p>AI words</p>', bodyHash: 'h', generatedAt: 't', model: 'm', edited: false, sourceChanged: false, pinned: true };
const ctx = { grid, canonicalHost: 'grid.example', sites, now: NOW };

describe('buildNetworkStoryView', () => {
  it('shows a story-level (pinned) AI summary even when the site is in excerpt mode', () => {
    const v = buildNetworkStoryView({ ...ctx, sourceSiteId: 'scoopella', hostname: 'scoopella.com', record, summary: pinnedSummary, pills: ['celebs'] });
    expect(v.bodyHtml).toBe('<p>AI words</p>');
    expect(v).toMatchObject({ key: 'scoopella/big-news', path: '/story/scoopella/big-news', pillLabel: 'Celebs', title: 'Big <News>' });
  });
  it('uses the excerpt without a summary', () => {
    const v = buildNetworkStoryView({ ...ctx, sourceSiteId: 'scoopella', hostname: 'scoopella.com', record, summary: null, pills: [] });
    expect(v.bodyHtml).toContain('<p>One</p>');
    expect(v.pillLabel).toBeUndefined();
  });
});

describe('buildExternalStoryView', () => {
  const ID = '6ac4931364df7692b392bfce';
  const ext = { id: ID, slug: 'teachers', title: 'Teachers', description: 'desc', imageUrl: 'https://img/x.jpg', url: 'https://pub.com/a', sourceName: 'pub.com', whatItCovers: 'Covers it.', publishedAt: '2026-10-06T00:00:00Z' } as ExternalStoryRecord;
  it('uses What It Covers by default and links to the publisher', () => {
    const v = buildExternalStoryView({ ...ctx, record: ext, summary: null, pills: [] });
    expect(v).toMatchObject({ key: `aggregator/teachers-${ID}`, path: `/story/aggregator/teachers-${ID}`, heroFallback: true });
    expect(v.bodyHtml).toBe('<p>Covers it.</p>');
    expect(v.outbound).toContain('https://pub.com/a');
  });
});

describe('renderStoryArticleHtml', () => {
  const v = buildNetworkStoryView({ ...ctx, sourceSiteId: 'scoopella', hostname: 'scoopella.com', record, summary: null, pills: ['celebs'] });
  it('escapes the title and uses h1 on the page, h2 for appended stories', () => {
    expect(renderStoryArticleHtml(v, v.bodyHtml, 'h1')).toContain('<h1 class="g-story__title">Big &lt;News&gt;</h1>');
    expect(renderStoryArticleHtml(v, v.bodyHtml, 'h2')).toContain('<h2 class="g-story__title">');
  });
  it('has the topic, byline, hero and CTA', () => {
    const html = renderStoryArticleHtml(v, v.bodyHtml, 'h1');
    expect(html).toContain('<p class="g-story__topic">Celebs</p>');
    expect(html).toContain('Original story by');
    expect(html).toContain('class="g-story__hero" src="/scoopella/assets/a.jpg"');
    expect(html).toContain('class="g-story__cta"');
  });
});

describe('renderNextStoryHtml', () => {
  const v = buildNetworkStoryView({ ...ctx, sourceSiteId: 'scoopella', hostname: 'scoopella.com', record, summary: null, pills: ['celebs'] });
  const placements = [
    { id: 'top', position: 'above-content', code: '<i>ad</i>' },
    { id: 'mid', position: 'after-paragraph-2', code: '<i>mid</i>' },
    { id: 'bottom', position: 'below-content', code: '<i>ad</i>' },
    { id: 'side', position: 'sidebar', code: '<i>no</i>' },
  ];
  it('wraps the story with its key, path and title for the address bar', () => {
    const html = renderNextStoryHtml(v, { placements, staging: false, index: 2 });
    expect(html).toMatch(/^<section class="g-next" data-story-key="scoopella\/big-news" data-story-path="\/story\/scoopella\/big-news" data-story-title="Big &lt;News&gt;">/);
  });
  it('gives the story its own above/inline/below ads with unique ids, but no sidebar ad', () => {
    const html = renderNextStoryHtml(v, { placements, staging: false, index: 2 });
    expect(html).toContain('data-ad-id="top-n2"');
    expect(html).toContain('data-ad-id="bottom-n2"');
    expect(html).toContain('<i>mid</i>');
    expect(html).not.toContain('side');
    expect(html.indexOf('top-n2')).toBeLessThan(html.indexOf('g-story__title'));
  });
  it('leaves ad code out on staging (mock fill)', () => {
    expect(renderNextStoryHtml(v, { placements, staging: true, index: 3 })).not.toContain('<i>ad</i>');
  });
});
