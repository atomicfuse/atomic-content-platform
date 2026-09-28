import { describe, expect, it } from 'vitest';
import type { GridPoolItem, GridSummaryRecord } from '@atomic-platform/shared-types';
import { relatedItems, storyText } from '../story';

const body = '<p>One <a href="/x">x</a></p><p>Two</p><p>Three</p><p>Four</p><p>Five</p><p>Six</p>';
const summary: GridSummaryRecord = { html: '<h2>S</h2><p>Sum</p>', bodyHash: 'h', generatedAt: 't', model: 'm', edited: false, sourceChanged: false };

describe('storyText', () => {
  it('excerpt mode ignores any summary and absolutises links', () => {
    const r = storyText({ body, summary, mode: 'excerpt', paragraphs: 2, hostname: 'a.com' });
    expect(r).toEqual({ source: 'excerpt', html: '<p>One <a href="https://a.com/x">x</a></p>\n<p>Two</p>' });
  });
  it('ai_summary mode uses the summary when present', () => {
    expect(storyText({ body, summary, mode: 'ai_summary', paragraphs: 2, hostname: 'a.com' })).toEqual({ source: 'summary', html: summary.html });
  });
  it('ai_summary mode falls back to the excerpt when no summary exists yet', () => {
    expect(storyText({ body, summary: null, mode: 'ai_summary', paragraphs: 2, hostname: 'a.com' }).source).toBe('excerpt');
  });
});

describe('relatedItems', () => {
  const it0 = (slug: string, pills: string[]): GridPoolItem => ({ site: 'a', slug, title: slug, publishDate: 'x', pills, pinned: false });
  const pool = [it0('cur', ['t']), it0('r1', ['t']), it0('r2', ['h']), it0('r3', ['t']), it0('r4', ['t'])];
  it('same pill, excludes current, max n', () => {
    expect(relatedItems(pool, { site: 'a', slug: 'cur' }, ['t'], 2).map((i) => i.slug)).toEqual(['r1', 'r3']);
  });
  it('no pills (include_sites source) → newest from All', () => {
    expect(relatedItems(pool, { site: 'a', slug: 'cur' }, [], 3).map((i) => i.slug)).toEqual(['r1', 'r2', 'r3']);
  });
});
