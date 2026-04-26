import { describe, expect, it } from 'vitest';
import {
  deepMerge,
  splitFrontmatter,
  rewriteAssetUrls,
  rewriteFrontmatterUrl,
} from '../lib/resolve';

describe('deepMerge', () => {
  it('scalar values: later wins', () => {
    expect(deepMerge({ x: 1 }, { x: 2 })).toEqual({ x: 2 });
  });

  it('arrays REPLACE — they do not concatenate', () => {
    // This is the load-bearing behaviour for `ad_placements` in the
    // legacy resolver. Concatenation would double-render placements
    // when a group both extends and is extended.
    expect(deepMerge({ list: [1, 2, 3] }, { list: [99] })).toEqual({ list: [99] });
  });

  it('deep merges nested objects', () => {
    const merged = deepMerge(
      { a: { b: 1, c: 2 }, top: 'A' },
      { a: { c: 3, d: 4 } },
    );
    expect(merged).toEqual({ a: { b: 1, c: 3, d: 4 }, top: 'A' });
  });

  it('null in `b` does NOT erase a value in `a`', () => {
    expect(deepMerge({ x: 1 }, { x: null })).toEqual({ x: 1 });
  });

  it('undefined in `b` does NOT erase a value in `a`', () => {
    expect(deepMerge({ x: 1 }, { x: undefined })).toEqual({ x: 1 });
  });

  it('returns `b` when `a` is non-object (scalar -> object replacement)', () => {
    expect(deepMerge(5, { x: 1 })).toEqual({ x: 1 });
  });

  it('handles deeply nested override chains (org → group → site)', () => {
    const org = {
      tracking: { ga4: 'G-ORG', gtm: null, custom: [] },
      ads_config: { ad_placements: [] },
      site_name: 'Org default',
    };
    const group = {
      ads_config: { ad_placements: [{ id: 'top-banner', position: 'above-content' }] },
    };
    const site = {
      tracking: { ga4: 'G-SITE' },
      site_name: 'Cool News',
    };
    const merged = [org, group, site].reduce((acc, layer) => deepMerge(acc, layer), {} as Record<string, unknown>);
    // Site wins on tracking.ga4 (scalar).
    expect((merged as { tracking: { ga4: string } }).tracking.ga4).toBe('G-SITE');
    // Group wins on ad_placements (array replacement); site doesn't define it so group's stays.
    expect((merged as { ads_config: { ad_placements: unknown[] } }).ads_config.ad_placements).toHaveLength(1);
    // Site wins on site_name.
    expect((merged as { site_name: string }).site_name).toBe('Cool News');
  });
});

describe('splitFrontmatter', () => {
  it('parses standard frontmatter', () => {
    const raw = '---\ntitle: Hello\nauthor: T\n---\nBody text here.';
    const { front, body } = splitFrontmatter(raw);
    expect(front).toEqual({ title: 'Hello', author: 'T' });
    expect(body).toBe('Body text here.');
  });

  it('returns empty front + full body when no delimiters', () => {
    const raw = '# Just markdown\nNo frontmatter here.';
    const { front, body } = splitFrontmatter(raw);
    expect(front).toEqual({});
    expect(body).toBe(raw);
  });

  it('returns empty front when only opening delimiter (malformed)', () => {
    const raw = '---\ntitle: Broken\nNo closing delimiter.';
    const { front, body } = splitFrontmatter(raw);
    expect(front).toEqual({});
    expect(body).toBe(raw);
  });

  it('handles CRLF line endings', () => {
    const raw = '---\r\ntitle: Windows\r\n---\r\nBody.';
    const { front, body } = splitFrontmatter(raw);
    expect(front).toEqual({ title: 'Windows' });
    expect(body).toBe('Body.');
  });

  it('handles empty body after frontmatter', () => {
    const raw = '---\ntitle: Empty\n---\n';
    const { front, body } = splitFrontmatter(raw);
    expect(front).toEqual({ title: 'Empty' });
    expect(body).toBe('');
  });
});

describe('rewriteAssetUrls', () => {
  const sid = 'coolnews-atl';

  it('rewrites src= references', () => {
    expect(rewriteAssetUrls('<img src="/assets/foo.png">', sid)).toBe(
      '<img src="/coolnews-atl/assets/foo.png">',
    );
  });

  it('rewrites src= with single quotes', () => {
    expect(rewriteAssetUrls("<img src='/assets/foo.png'>", sid)).toBe(
      "<img src='/coolnews-atl/assets/foo.png'>",
    );
  });

  it('rewrites href= references', () => {
    expect(rewriteAssetUrls('<a href="/assets/x.pdf">link</a>', sid)).toBe(
      '<a href="/coolnews-atl/assets/x.pdf">link</a>',
    );
  });

  it('rewrites markdown-style (/assets/x.png) parens', () => {
    expect(rewriteAssetUrls('![alt](/assets/y.jpg)', sid)).toBe(
      '![alt](/coolnews-atl/assets/y.jpg)',
    );
  });

  it('does NOT rewrite absolute URLs that happen to contain /assets/', () => {
    const html = '<img src="https://cdn.example.com/assets/foo.png">';
    expect(rewriteAssetUrls(html, sid)).toBe(html);
  });

  it('preserves query strings on asset URLs', () => {
    expect(rewriteAssetUrls('<img src="/assets/foo.png?v=2">', sid)).toBe(
      '<img src="/coolnews-atl/assets/foo.png?v=2">',
    );
  });

  it('rewrites multiple references in a single pass', () => {
    const html = '<img src="/assets/a.png"><a href="/assets/b.pdf">B</a><img src="/assets/c.png">';
    expect(rewriteAssetUrls(html, sid)).toBe(
      '<img src="/coolnews-atl/assets/a.png"><a href="/coolnews-atl/assets/b.pdf">B</a><img src="/coolnews-atl/assets/c.png">',
    );
  });

  it('is idempotent — second call is a no-op (already prefixed paths do not re-match)', () => {
    const once = rewriteAssetUrls('<img src="/assets/foo.png">', sid);
    expect(rewriteAssetUrls(once, sid)).toBe(once);
  });
});

describe('rewriteFrontmatterUrl', () => {
  const sid = 'coolnews-atl';

  it('rewrites a /assets/... URL', () => {
    expect(rewriteFrontmatterUrl('/assets/images/foo.png', sid)).toBe(
      '/coolnews-atl/assets/images/foo.png',
    );
  });

  it('returns absolute URLs unchanged', () => {
    expect(rewriteFrontmatterUrl('https://cdn.com/x.png', sid)).toBe('https://cdn.com/x.png');
  });

  it('returns undefined for undefined input', () => {
    expect(rewriteFrontmatterUrl(undefined, sid)).toBeUndefined();
  });

  it('returns empty-string input unchanged (falsy short-circuit)', () => {
    expect(rewriteFrontmatterUrl('', sid)).toBe('');
  });

  it('does NOT rewrite paths that merely contain /assets/ but do not start with it', () => {
    expect(rewriteFrontmatterUrl('/foo/assets/x.png', sid)).toBe('/foo/assets/x.png');
  });
});
