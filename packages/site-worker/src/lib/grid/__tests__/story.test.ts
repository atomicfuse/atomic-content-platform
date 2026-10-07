import { describe, expect, it } from 'vitest';
import type { ExternalStoryRecord, GridPoolItem, GridSummaryRecord } from '@atomic-platform/shared-types';
import { externalStoryText, relatedItems, storyText } from '../story';

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

describe('storyText — pinned summaries', () => {
  it('a pinned summary shows even in excerpt mode', () => {
    expect(storyText({ body, summary: { ...summary, pinned: true }, mode: 'excerpt', paragraphs: 1, hostname: 'h' }).source).toBe('summary');
  });
  it('an unpinned summary in excerpt mode still shows the excerpt (unchanged behaviour)', () => {
    expect(storyText({ body, summary, mode: 'excerpt', paragraphs: 1, hostname: 'h' }).source).toBe('excerpt');
  });
});

describe('externalStoryText', () => {
  const record = { whatItCovers: 'Covers <b>this</b>.', description: 'Desc', whyItMatters: 'Why' } as ExternalStoryRecord;
  it.each([
    ['what_it_covers', null, 'what_it_covers'],
    ['ai_summary', null, 'what_it_covers'],
    ['ai_summary', summary, 'summary'],
    ['what_it_covers', summary, 'what_it_covers'],
    ['what_it_covers', { ...summary, pinned: true }, 'summary'],
  ] as const)('mode %s with summary %o → %s', (mode, s, source) => {
    expect(externalStoryText({ record, summary: s, mode }).source).toBe(source);
  });
  it('escapes What It Covers, keeps paragraphs, and falls back to the description', () => {
    expect(externalStoryText({ record: { ...record, whatItCovers: 'One <b>.\n\nTwo.' }, summary: null, mode: 'what_it_covers' }).html)
      .toBe('<p>One &lt;b&gt;.</p>\n<p>Two.</p>');
    expect(externalStoryText({ record: { ...record, whatItCovers: '' }, summary: null, mode: 'what_it_covers' }))
      .toEqual({ html: '<p>Desc</p>', source: 'description' });
  });
});
