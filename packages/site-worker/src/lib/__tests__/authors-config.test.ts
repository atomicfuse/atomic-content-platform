import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { AUTHOR_ID_RE, normalizeSiteAuthors } from '../authors';
import { authorKey } from '../kv-schema';
import { getConfig } from '../config';

describe('normalizeSiteAuthors', () => {
  it('keeps valid assignments, trims topics, drops bad ids and duplicates', () => {
    expect(normalizeSiteAuthors([
      { id: 'ella-hughes', topics: [' Celebrities ', '', 'Royals'] },
      { id: 'Ella Hughes', topics: [] },
      { id: 'ella-hughes', topics: ['TV'] },
      { id: 'ben-foster' },
      'nope',
      null,
    ])).toEqual([
      { id: 'ella-hughes', topics: ['Celebrities', 'Royals'] },
      { id: 'ben-foster', topics: [] },
    ]);
  });
  it('returns [] for anything that is not an array', () => {
    expect(normalizeSiteAuthors(undefined)).toEqual([]);
    expect(normalizeSiteAuthors({ id: 'x' })).toEqual([]);
  });
  it('id format', () => {
    expect(AUTHOR_ID_RE.test('ella-hughes')).toBe(true);
    expect(AUTHOR_ID_RE.test('ella--hughes')).toBe(false);
    expect(AUTHOR_ID_RE.test('-ella')).toBe(false);
  });
});

describe('author KV key', () => {
  it('is author:<id>', () => {
    expect(authorKey('ella-hughes')).toBe('author:ella-hughes');
  });
});

describe('getConfig runtime default', () => {
  it('a KV config seeded before authors existed gets authors: []', () => {
    const config = { layout: {}, scripts: {} } as unknown as ResolvedConfig;
    const out = getConfig({ locals: { site: { siteId: 's', hostname: 'h', config, isPreview: false, isStaging: false } } } as never);
    expect(out.authors).toEqual([]);
  });
});
