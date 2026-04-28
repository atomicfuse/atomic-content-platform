import { describe, expect, it } from 'vitest';
import {
  deepMerge,
  mergeScriptLayers,
  mergeAdPlacementLayers,
  splitFrontmatter,
  rewriteAssetUrls,
  rewriteFrontmatterUrl,
  selectMatchingOverrides,
  stripModeKeys,
  stripOverrideMetaFields,
  type OverrideConfig,
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

describe('selectMatchingOverrides', () => {
  const overrides: OverrideConfig[] = [
    { override_id: 'targets-by-site', priority: 100, targets: { sites: ['coolnews-atl'] } },
    { override_id: 'targets-by-group', priority: 50, targets: { groups: ['taboola'] } },
    { override_id: 'targets-other-site', priority: 200, targets: { sites: ['otherthing'] } },
    { override_id: 'no-targets', priority: 10 },
  ];

  it('matches by sites list', () => {
    const result = selectMatchingOverrides(overrides, 'coolnews-atl', []);
    expect(result.map((o) => o.override_id)).toContain('targets-by-site');
  });

  it('matches by groups intersection', () => {
    const result = selectMatchingOverrides(overrides, 'someother', ['taboola']);
    expect(result.map((o) => o.override_id)).toContain('targets-by-group');
  });

  it('does NOT match overrides with no targets', () => {
    const result = selectMatchingOverrides(overrides, 'anything', ['anything']);
    expect(result.map((o) => o.override_id)).not.toContain('no-targets');
  });

  it('does NOT match overrides targeting different sites', () => {
    const result = selectMatchingOverrides(overrides, 'coolnews-atl', []);
    expect(result.map((o) => o.override_id)).not.toContain('targets-other-site');
  });

  it('site OR group match (UNION not intersection)', () => {
    // Site matches (coolnews-atl) AND group matches (taboola) — both selected.
    const result = selectMatchingOverrides(overrides, 'coolnews-atl', ['taboola']);
    expect(result.map((o) => o.override_id)).toEqual(
      expect.arrayContaining(['targets-by-site', 'targets-by-group']),
    );
  });

  it('sorts by priority ascending (lowest first; highest applied LAST so it WINS)', () => {
    const result = selectMatchingOverrides(overrides, 'coolnews-atl', ['taboola']);
    const ps = result.map((o) => o.priority ?? 0);
    expect(ps).toEqual([...ps].sort((a, b) => a - b));
  });

  it('handles missing targets / sites / groups gracefully', () => {
    const messy: OverrideConfig[] = [
      { override_id: 'a', targets: undefined },
      { override_id: 'b', targets: {} },
      { override_id: 'c', targets: { sites: undefined, groups: undefined } },
    ];
    const result = selectMatchingOverrides(messy, 'x', ['y']);
    expect(result).toHaveLength(0);
  });
});

describe('stripModeKeys', () => {
  it('removes _mode from objects recursively', () => {
    const input = {
      ads_config: { _mode: 'replace', ad_placements: [{ id: 'x' }] },
      tracking: { _mode: 'merge', ga4: 'G-1' },
    };
    expect(stripModeKeys(input)).toEqual({
      ads_config: { ad_placements: [{ id: 'x' }] },
      tracking: { ga4: 'G-1' },
    });
  });

  it('removes _values directives (used by ads_txt _mode: add)', () => {
    expect(stripModeKeys({ ads_txt: { _mode: 'add', _values: ['a', 'b'] } })).toEqual({
      ads_txt: {},
    });
  });

  it('preserves arrays untouched', () => {
    expect(stripModeKeys({ list: [1, 2, 3] })).toEqual({ list: [1, 2, 3] });
  });

  it('preserves scalars untouched', () => {
    expect(stripModeKeys('hello')).toBe('hello');
    expect(stripModeKeys(42)).toBe(42);
    expect(stripModeKeys(null)).toBe(null);
  });
});

describe('stripOverrideMetaFields', () => {
  it('strips override-only meta keys', () => {
    const input = {
      override_id: 'x',
      name: 'X',
      priority: 10,
      targets: { sites: ['a'] },
      ads_config: { ad_placements: [] },
      tracking: { ga4: 'G-1' },
    };
    expect(stripOverrideMetaFields(input)).toEqual({
      ads_config: { ad_placements: [] },
      tracking: { ga4: 'G-1' },
    });
  });

  it('preserves config when no meta fields present', () => {
    const input = { ads_config: { ad_placements: [] } };
    expect(stripOverrideMetaFields(input)).toEqual(input);
  });
});

describe('mergeScriptLayers', () => {
  it('appends new script IDs across layers', () => {
    const org = { scripts: { head: [{ id: 'gtag', src: 'https://gtag.js' }] } };
    const site = { scripts: { head: [{ id: 'bg-test', inline: 'document.body.style.backgroundColor="red"' }] } };
    const result = mergeScriptLayers([org, site]);
    expect(result.head).toHaveLength(2);
    expect(result.head[0].id).toBe('gtag');
    expect(result.head[1].id).toBe('bg-test');
  });

  it('same ID in later layer replaces earlier entry', () => {
    const org = { scripts: { head: [{ id: 'gtag', src: 'https://gtag-old.js' }] } };
    const site = { scripts: { head: [{ id: 'gtag', src: 'https://gtag-new.js' }] } };
    const result = mergeScriptLayers([org, site]);
    expect(result.head).toHaveLength(1);
    expect(result.head[0].src).toBe('https://gtag-new.js');
  });

  it('skips layers without scripts', () => {
    const org = { scripts: { head: [{ id: 'a', inline: 'a()' }] } };
    const group = { tracking: { ga4: 'G-1' } }; // no scripts
    const site = { scripts: { head: [{ id: 'b', inline: 'b()' }] } };
    const result = mergeScriptLayers([org, group, site]);
    expect(result.head).toHaveLength(2);
    expect(result.head.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('empty array in a layer does NOT wipe inherited scripts', () => {
    const org = { scripts: { head: [{ id: 'gtag', src: 'https://gtag.js' }] } };
    const site = { scripts: { head: [] } };
    const result = mergeScriptLayers([org, site]);
    expect(result.head).toHaveLength(1);
    expect(result.head[0].id).toBe('gtag');
  });

  it('merges across all three positions independently', () => {
    const org = {
      scripts: {
        head: [{ id: 'h1', inline: 'h1()' }],
        body_start: [{ id: 'bs1', inline: 'bs1()' }],
        body_end: [{ id: 'be1', inline: 'be1()' }],
      },
    };
    const site = {
      scripts: {
        head: [{ id: 'h2', inline: 'h2()' }],
        body_end: [{ id: 'be1', inline: 'be1_v2()' }],
      },
    };
    const result = mergeScriptLayers([org, site]);
    expect(result.head.map((s) => s.id)).toEqual(['h1', 'h2']);
    expect(result.body_start.map((s) => s.id)).toEqual(['bs1']);
    expect(result.body_end).toHaveLength(1);
    expect(result.body_end[0].inline).toBe('be1_v2()'); // replaced by site
  });

  it('returns empty arrays when no layers have scripts', () => {
    const result = mergeScriptLayers([{ tracking: {} }, { ads_config: {} }]);
    expect(result).toEqual({ head: [], body_start: [], body_end: [] });
  });

  it('handles org → group → override → site (4-layer chain)', () => {
    const org = { scripts: { head: [{ id: 'analytics', inline: 'org()' }] } };
    const group = { scripts: { head: [{ id: 'group-tag', inline: 'grp()' }] } };
    const override = { scripts: { head: [{ id: 'analytics', inline: 'override()' }] } };
    const site = { scripts: { head: [{ id: 'bg-test', inline: 'bg()' }] } };
    const result = mergeScriptLayers([org, group, override, site]);
    expect(result.head).toHaveLength(3);
    expect(result.head[0]).toEqual({ id: 'analytics', inline: 'override()' }); // override replaced org
    expect(result.head[1]).toEqual({ id: 'group-tag', inline: 'grp()' });
    expect(result.head[2]).toEqual({ id: 'bg-test', inline: 'bg()' });
  });

  it('replace mode: last layer with merge_modes.scripts="replace" discards inherited', () => {
    const org = { scripts: { head: [{ id: 'analytics', inline: 'org()' }] } };
    const site = {
      scripts: { head: [{ id: 'custom', inline: 'custom()' }] },
      merge_modes: { scripts: 'replace' },
    };
    const result = mergeScriptLayers([org, site]);
    expect(result.head).toHaveLength(1);
    expect(result.head[0].id).toBe('custom');
  });
});

describe('mergeAdPlacementLayers', () => {
  it('add mode (default): appends site placements to inherited', () => {
    const org = { ads_config: { ad_placements: [{ id: 'sidebar', position: 'left' }] } };
    const site = { ads_config: { ad_placements: [{ id: 'banner', position: 'top' }] } };
    const result = mergeAdPlacementLayers([org, site]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('sidebar');
    expect(result[1].id).toBe('banner');
  });

  it('add mode: duplicate IDs result in both entries', () => {
    const org = { ads_config: { ad_placements: [{ id: 'sidebar', position: 'left' }] } };
    const site = { ads_config: { ad_placements: [{ id: 'sidebar', position: 'right' }] } };
    const result = mergeAdPlacementLayers([org, site]);
    expect(result).toHaveLength(2);
  });

  it('merge_placements mode: same ID replaced, new ID appended', () => {
    const org = { ads_config: { ad_placements: [{ id: 'sidebar', w: 300 }, { id: 'sticky', w: 100 }] } };
    const site = {
      ads_config: { ad_placements: [{ id: 'sidebar', w: 600 }, { id: 'banner', w: 728 }] },
      merge_modes: { ads_config: 'merge_placements' },
    };
    const result = mergeAdPlacementLayers([org, site]);
    expect(result).toHaveLength(3);
    expect(result.find((p) => p.id === 'sidebar')?.w).toBe(600); // replaced
    expect(result.find((p) => p.id === 'sticky')).toBeDefined(); // kept
    expect(result.find((p) => p.id === 'banner')).toBeDefined(); // added
  });

  it('replace mode: only site placements remain', () => {
    const org = { ads_config: { ad_placements: [{ id: 'sidebar', w: 300 }] } };
    const site = {
      ads_config: { ad_placements: [{ id: 'banner', w: 728 }] },
      merge_modes: { ads_config: 'replace' },
    };
    const result = mergeAdPlacementLayers([org, site]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('banner');
  });

  it('handles empty site placements with add mode', () => {
    const org = { ads_config: { ad_placements: [{ id: 'sidebar', w: 300 }] } };
    const site = { ads_config: {} };
    const result = mergeAdPlacementLayers([org, site]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('sidebar');
  });
});

describe('layout merge across layers', () => {
  it('site layout deep-merges over org', () => {
    const org = { layout: { hero: { count: 4 }, must_reads: { enabled: true, count: 5 } } };
    const site = { layout: { hero: { count: 3 } } };
    const merged = deepMerge(org, site);
    expect(merged).toEqual({
      layout: {
        hero: { count: 3 },
        must_reads: { enabled: true, count: 5 },
      },
    });
  });

  it('group layer overrides org but is overridden by site', () => {
    const org = { layout: { load_more: { page_size: 10 } } };
    const group = { layout: { load_more: { page_size: 20 } } };
    const site = { layout: { load_more: { page_size: 5 } } };
    const merged = deepMerge(deepMerge(org, group), site);
    expect(merged).toEqual({ layout: { load_more: { page_size: 5 } } });
  });

  it('null in site does not erase org layout', () => {
    const org = { layout: { hero: { count: 4 } } };
    const site = { layout: null };
    expect(deepMerge(org, site)).toEqual({ layout: { hero: { count: 4 } } });
  });
});
