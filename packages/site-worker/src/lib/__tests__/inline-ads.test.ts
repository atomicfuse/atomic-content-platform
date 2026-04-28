import { describe, expect, it } from 'vitest';
import { injectInlineAds } from '../inline-ads';

describe('injectInlineAds', () => {
  const html = '<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p><p>Five.</p>';

  it('inserts a slot after the Nth paragraph', () => {
    const out = injectInlineAds(html, [
      { id: 'in-content-3', position: 'after-paragraph-3' },
    ]);
    // After the third </p> there should be a slot div with empty sizes
    // arrays (none provided in this placement).
    const expected =
      '<p>One.</p><p>Two.</p><p>Three.</p>'
      + '<div data-ad-id="in-content-3" data-ad-position="after-paragraph-3"'
      + ' data-sizes-desktop="[]" data-sizes-mobile="[]"'
      + ' class="atl-ad-slot atl-ad-after-paragraph-3"></div>'
      + '<p>Four.</p><p>Five.</p>';
    expect(out).toBe(expected);
  });

  it('emits size attributes that mock-ad-fill.js reads', () => {
    const out = injectInlineAds(html, [
      {
        id: 'in-content-x',
        position: 'after-paragraph-1',
        sizes: { desktop: [[728, 90], [970, 90]], mobile: [[320, 50]] },
      },
    ]);
    expect(out).toContain('data-sizes-desktop="[[728,90],[970,90]]"');
    expect(out).toContain('data-sizes-mobile="[[320,50]]"');
  });

  it('handles multiple after-paragraph placements at different positions', () => {
    const out = injectInlineAds(html, [
      { id: 'a', position: 'after-paragraph-1' },
      { id: 'b', position: 'after-paragraph-4' },
    ]);
    expect(out).toContain('<p>One.</p><div data-ad-id="a"');
    expect(out).toContain('<p>Four.</p><div data-ad-id="b"');
    // The 'a' slot should come BEFORE 'b' in the output.
    expect(out.indexOf('data-ad-id="a"')).toBeLessThan(out.indexOf('data-ad-id="b"'));
  });

  it('skips placements with non-after-paragraph positions', () => {
    const out = injectInlineAds(html, [
      { id: 'top-banner', position: 'above-content' },
      { id: 'sidebar', position: 'sidebar' },
      { id: 'sticky', position: 'sticky-bottom' },
    ]);
    expect(out).toBe(html); // no changes
  });

  it('returns input unchanged when placements is empty', () => {
    expect(injectInlineAds(html, [])).toBe(html);
  });

  it('returns input unchanged when N is greater than paragraph count', () => {
    const out = injectInlineAds(html, [
      { id: 'too-far', position: 'after-paragraph-99' },
    ]);
    expect(out).toBe(html);
  });

  it('preserves existing markup attributes inside paragraphs', () => {
    const richHtml = '<p>Hello <a href="https://example.com">world</a>.</p><p>Second.</p>';
    const out = injectInlineAds(richHtml, [
      { id: 'x', position: 'after-paragraph-1' },
    ]);
    expect(out).toContain('<p>Hello <a href="https://example.com">world</a>.</p>');
    expect(out).toContain('data-ad-id="x"');
  });

  it('escapes attributes in id / position', () => {
    const out = injectInlineAds(html, [
      { id: '"><script>alert(1)</script>', position: 'after-paragraph-1' },
    ]);
    expect(out).not.toContain('<script>');
    expect(out).toContain('data-ad-id="&quot;&gt;&lt;script&gt;');
  });

  it('handles uppercase </P> tags (just in case)', () => {
    const upperHtml = '<P>One.</P><P>Two.</P>';
    const out = injectInlineAds(upperHtml, [
      { id: 'x', position: 'after-paragraph-1' },
    ]);
    expect(out).toContain('data-ad-id="x"');
  });

  it('does not match after-paragraph-0 or negative N', () => {
    expect(injectInlineAds(html, [{ id: 'a', position: 'after-paragraph-0' }])).toBe(html);
    expect(injectInlineAds(html, [{ id: 'b', position: 'after-paragraph--1' }])).toBe(html);
  });

  it('multiple placements at the SAME N both inject after the same paragraph', () => {
    const out = injectInlineAds(html, [
      { id: 'a', position: 'after-paragraph-2' },
      { id: 'b', position: 'after-paragraph-2' },
    ]);
    expect(out.match(/data-ad-id="a"/g)).toHaveLength(1);
    expect(out.match(/data-ad-id="b"/g)).toHaveLength(1);
    // Both should appear after the second </p>.
    expect(out).toMatch(/<p>Two\.<\/p><div data-ad-id="a"[^>]*><\/div><div data-ad-id="b"[^>]*><\/div>/);
  });

  it('escapes JSON quotes in size attributes', () => {
    // sizes are numbers but verify the attribute is properly escaped if
    // anything weird leaked through.
    const out = injectInlineAds(html, [
      {
        id: 'ok',
        position: 'after-paragraph-1',
        sizes: { desktop: [[300, 250]], mobile: [] },
      },
    ]);
    // " in JSON should be escaped to &quot;
    expect(out).toContain('data-sizes-desktop="[[300,250]]"');
    expect(out).not.toContain('data-sizes-desktop=""[[300,250]]""');
  });
});
