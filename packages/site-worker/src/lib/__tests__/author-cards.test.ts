import { describe, expect, it } from 'vitest';
import { renderAuthorCardsHtml } from '../../themes/modern/components/_render-author-cards';
import type { ArticleIndexEntry } from '../kv-schema';

const art = (over: Partial<ArticleIndexEntry> = {}): ArticleIndexEntry => ({
  slug: 'guy-remmers-rain-spencer', title: 'Examining Guy Remmers & Rain', description: 'Guy Remmers and Rain Spencer <b>soft</b> launch.',
  publishDate: '2026-10-08T10:00:00.000Z', featuredImage: '/assets/images/guy.webp', type: 'standard', status: 'published', tags: [],
  ...over,
} as ArticleIndexEntry);

describe('author page cards', () => {
  it('stack vertically: image, date, title, then the excerpt', () => {
    const html = renderAuthorCardsHtml([art()]);
    const order = ['author-card-thumb', 'author-card-date', 'author-card-title', 'author-card-excerpt'].map((c) => html.indexOf(c));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('href="/guy-remmers-rain-spencer"');
    expect(html).toContain('October 8, 2026');
  });

  it('escapes text and leaves out an empty excerpt or image', () => {
    const html = renderAuthorCardsHtml([art({ description: '', featuredImage: undefined })]);
    expect(html).toContain('Examining Guy Remmers &amp; Rain');
    expect(html).not.toContain('author-card-excerpt');
    expect(html).not.toContain('<img');
    expect(renderAuthorCardsHtml([art()])).toContain('&lt;b&gt;soft&lt;/b&gt;');
  });
});
