import { describe, expect, it } from 'vitest';
import {
  isPreviewableHost,
  parseCookie,
  resolvePreview,
  generatePreviewScript,
} from '../preview-override';

describe('isPreviewableHost', () => {
  it('allows workers.dev subdomains', () => {
    expect(isPreviewableHost('atomic-site-worker-staging.dev1-953.workers.dev')).toBe(true);
    expect(isPreviewableHost('foo.workers.dev')).toBe(true);
  });

  it('allows localhost', () => {
    expect(isPreviewableHost('localhost')).toBe(true);
  });

  it('rejects production custom domains', () => {
    expect(isPreviewableHost('coolnews.dev')).toBe(false);
    expect(isPreviewableHost('example.com')).toBe(false);
  });

  it('rejects `.pages.dev` (legacy Pages, not the Worker)', () => {
    expect(isPreviewableHost('staging-coolnews-atl.coolnews-atl.pages.dev')).toBe(false);
  });

  it('rejects subdomain look-alikes', () => {
    expect(isPreviewableHost('attacker-workers.dev')).toBe(false); // no dot prefix
    expect(isPreviewableHost('localhost.evil.com')).toBe(false);
  });
});

describe('parseCookie', () => {
  it('extracts a single cookie', () => {
    expect(parseCookie('atl_preview_site=scienceworld', 'atl_preview_site')).toBe('scienceworld');
  });

  it('extracts from a multi-cookie header', () => {
    const h = 'foo=1; atl_preview_site=scienceworld; bar=2';
    expect(parseCookie(h, 'atl_preview_site')).toBe('scienceworld');
  });

  it('returns null when cookie not present', () => {
    expect(parseCookie('foo=1; bar=2', 'atl_preview_site')).toBeNull();
  });

  it('returns null on empty / missing header', () => {
    expect(parseCookie(null, 'x')).toBeNull();
    expect(parseCookie('', 'x')).toBeNull();
  });

  it('handles URL-encoded values', () => {
    expect(parseCookie('foo=hello%20world', 'foo')).toBe('hello world');
  });

  it('does not match name as a prefix', () => {
    // `atl_preview_site_other=...` should not match `atl_preview_site`.
    expect(parseCookie('atl_preview_site_other=x', 'atl_preview_site')).toBeNull();
  });
});

describe('resolvePreview', () => {
  const wdHost = 'atomic-site-worker-staging.dev1-953.workers.dev';
  const prodHost = 'coolnews.dev';

  it('returns null on non-previewable hosts', () => {
    const r = resolvePreview({
      hostname: prodHost,
      searchParams: new URLSearchParams('_atl_site=scienceworld'),
    });
    expect(r).toEqual({ siteIdOverride: null, setCookie: null });
  });

  it('honours ?_atl_site=<id> on workers.dev', () => {
    const r = resolvePreview({
      hostname: wdHost,
      searchParams: new URLSearchParams('_atl_site=scienceworld'),
    });
    expect(r.siteIdOverride).toBe('scienceworld');
    // Now emits a deletion cookie (legacy cleanup), not a persistence cookie.
    expect(r.setCookie).toContain('atl_preview_site=;');
    expect(r.setCookie).toContain('Max-Age=0');
  });

  it('does NOT fall back to cookie (cookie mechanism removed)', () => {
    // Previously this would use the cookie value. Now it returns no
    // override — the cookie is no longer read because it caused
    // cross-tab leakage.
    const r = resolvePreview({
      hostname: wdHost,
      searchParams: new URLSearchParams(),
    });
    expect(r.siteIdOverride).toBeNull();
    expect(r.setCookie).toBeNull();
  });

  it('?_atl_site=clear emits a deletion cookie + no override', () => {
    const r = resolvePreview({
      hostname: wdHost,
      searchParams: new URLSearchParams('_atl_site=clear'),
    });
    expect(r.siteIdOverride).toBeNull();
    expect(r.setCookie).toContain('atl_preview_site=;');
    expect(r.setCookie).toContain('Max-Age=0');
  });

  it('rejects malformed siteIds (injection guard)', () => {
    const r = resolvePreview({
      hostname: wdHost,
      searchParams: new URLSearchParams('_atl_site=../../etc/passwd'),
    });
    expect(r).toEqual({ siteIdOverride: null, setCookie: null });
  });

  it('localhost is also previewable', () => {
    const r = resolvePreview({
      hostname: 'localhost',
      searchParams: new URLSearchParams('_atl_site=scienceworld'),
    });
    expect(r.siteIdOverride).toBe('scienceworld');
  });
});

describe('generatePreviewScript', () => {
  it('produces a script tag with the siteId embedded', () => {
    const script = generatePreviewScript('coolnews-atl');
    expect(script).toContain('<script data-atl-preview>');
    expect(script).toContain("'coolnews-atl'");
    expect(script).toContain('</script>');
  });

  it('escapes single quotes in siteId', () => {
    const script = generatePreviewScript("site'name");
    expect(script).toContain("site\\'name");
    expect(script).not.toContain("site'name'");
  });

  it('escapes backslashes in siteId', () => {
    const script = generatePreviewScript('site\\name');
    expect(script).toContain("site\\\\name");
  });

  it('sets _atl_site param via click handler', () => {
    const script = generatePreviewScript('test-site');
    expect(script).toContain('_atl_site');
    expect(script).toContain('.closest');
    expect(script).toContain('addEventListener');
  });

  it('patches fetch for server island requests', () => {
    const script = generatePreviewScript('test-site');
    expect(script).toContain('window.fetch');
    expect(script).toContain('_server-islands/');
    expect(script).toContain('_atl_site');
  });
});
