import { describe, expect, it } from 'vitest';
import { publicPath, toGridPath } from '../route';

describe('toGridPath', () => {
  it.each([
    ['/', '/grid'],
    ['/topic/travel', '/grid/topic/travel'],
    ['/story/scienceworld/best-telescopes', '/grid/story/scienceworld/best-telescopes'],
    ['/about', '/grid/about'],
    ['/search', '/grid/search'],
    ['/api/feed', '/grid/api/feed'],
    ['/api/pool', '/grid/api/pool'],
  ])('rewrites %s → %s', (input, expected) => {
    expect(toGridPath(input)).toBe(expected);
  });
  it.each([
    '/_server-islands/AdSlot', '/_astro/index.abc123.css', '/_ping',
    '/ads.txt', '/robots.txt', '/sitemap.xml', '/sitemap-index.xml',
    '/mock-ad-fill.js', '/placeholder.svg', '/favicon.ico',
    '/api/v1/articles/latest-by-domain',
    '/grid', '/grid/topic/x',
  ])('passes through %s', (input) => {
    expect(toGridPath(input)).toBeNull();
  });
});

describe('publicPath', () => {
  it('strips the internal /grid prefix', () => {
    expect(publicPath('/grid')).toBe('/');
    expect(publicPath('/grid/topic/travel')).toBe('/topic/travel');
    expect(publicPath('/about')).toBe('/about');
  });
});
