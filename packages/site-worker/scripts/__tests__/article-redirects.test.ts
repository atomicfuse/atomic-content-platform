import { describe, expect, it } from 'vitest';
import { parseRedirectFrom, redirectEntries } from '../lib/article-redirects';

describe('parseRedirectFrom', () => {
  it('accepts a string or a list of old slugs, dropping junk', () => {
    expect(parseRedirectFrom({ redirect_from: 'old-slug' })).toEqual(['old-slug']);
    expect(parseRedirectFrom({ redirect_from: ['a-b', ' c-d ', '', 5, '../x', 'Has Space'] })).toEqual(['a-b', 'c-d']);
    expect(parseRedirectFrom({})).toEqual([]);
  });
});

describe('redirectEntries', () => {
  it('writes redirect:<site>:<old> → { to } for each old slug', () => {
    expect(redirectEntries('wk', [{ slug: 'teen-health-guide', from: ['eating-disorders-teens'] }], new Set(['teen-health-guide']))).toEqual([
      { key: 'redirect:wk:eating-disorders-teens', value: JSON.stringify({ to: 'teen-health-guide' }) },
    ]);
  });
  it('never redirects a slug that is a live article, or to itself', () => {
    expect(redirectEntries('wk', [{ slug: 'a', from: ['a', 'b'] }], new Set(['a', 'b']))).toEqual([]);
  });
});
