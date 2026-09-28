import { describe, expect, it } from 'vitest';
import { absolutizeLinks, buildExcerpt, splitTopLevelBlocks, stripUnsafe } from '../excerpt';

const P = (n: number): string => Array.from({ length: n }, (_, i) => `<p>P${i + 1}</p>`).join('\n');

describe('buildExcerpt', () => {
  it('takes N paragraphs, keeping headings in between', () => {
    const html = `<p>P1</p><h2>H</h2><p>P2</p><p>P3</p><p>P4</p><p>P5</p><p>P6</p><p>P7</p>`;
    expect(buildExcerpt(html, 3)).toBe('<p>P1</p>\n<h2>H</h2>\n<p>P2</p>\n<p>P3</p>');
  });
  it('caps at half the article (never most of it)', () => {
    expect(buildExcerpt(P(4), 3)).toBe('<p>P1</p>\n<p>P2</p>');
    expect(buildExcerpt(P(3), 3)).toBe('<p>P1</p>');
  });
  it('single-paragraph article shows that paragraph; none → empty', () => {
    expect(buildExcerpt('<p>Only</p>', 3)).toBe('<p>Only</p>');
    expect(buildExcerpt('<h2>No paragraphs</h2>', 3)).toBe('');
  });
  it('takes lists whole, never splitting nested lists', () => {
    const html = '<p>P1</p><ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><p>P2</p><p>P3</p><p>P4</p><p>P5</p><p>P6</p>';
    expect(buildExcerpt(html, 2)).toBe('<p>P1</p>\n<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>\n<p>P2</p>');
  });
  it('drops iframes, scripts, figures, images and the image-only paragraphs they leave behind', () => {
    const html = '<p><img src="x.jpg"></p><iframe src="y"></iframe><script>bad()</script><figure><img src="z"/></figure><p>Real 1</p><p>Real 2</p><p>Real 3</p>';
    expect(buildExcerpt(html, 3)).toBe('<p>Real 1</p>');
  });
  it('drops top-level divs and h1', () => {
    expect(buildExcerpt('<h1>T</h1><div class="embed">x</div><p>A</p><p>B</p>', 3)).toBe('<p>A</p>');
  });
});

describe('absolutizeLinks', () => {
  it('rewrites root-relative hrefs to the source host, leaves others alone', () => {
    const html = '<a href="/other-article">x</a><a href="https://ext.com/a">y</a><a href="//cdn.com/z">z</a><a href="#top">t</a>';
    expect(absolutizeLinks(html, 'travel-a.com')).toBe(
      '<a href="https://travel-a.com/other-article">x</a><a href="https://ext.com/a">y</a><a href="//cdn.com/z">z</a><a href="#top">t</a>',
    );
  });
});

describe('helpers', () => {
  it('stripUnsafe removes comments and paired unsafe tags', () => {
    expect(stripUnsafe('<!-- c --><p>a</p><style>p{}</style><video><source src="v"></video>')).toBe('<p>a</p>');
  });
  it('splitTopLevelBlocks ignores void tags when tracking depth', () => {
    expect(splitTopLevelBlocks('<p>a<br>b</p><hr><p>c</p>').map((b) => b.tag)).toEqual(['p', 'p']);
  });
});

describe('stripUnsafe — event handlers and javascript: URLs', () => {
  it('removes on* attributes in double-quoted, single-quoted and unquoted forms', () => {
    expect(stripUnsafe('<p onclick="alert(1)">a</p>')).toBe('<p>a</p>');
    expect(stripUnsafe("<a href=\"/x\" onMouseOver='steal()'>b</a>")).toBe('<a href="/x">b</a>');
    expect(stripUnsafe('<p class="k" onload=go()>c</p>')).toBe('<p class="k">c</p>');
  });
  it('neutralises javascript: href/src values (any case, leading whitespace) to #', () => {
    expect(stripUnsafe('<a href="javascript:alert(1)">x</a>')).toBe('<a href="#">x</a>');
    expect(stripUnsafe("<a href=' JavaScript:alert(1)'>x</a>")).toBe("<a href='#'>x</a>");
    expect(stripUnsafe('<a HREF=JAVASCRIPT:void(0)>x</a>')).toBe('<a HREF=#>x</a>');
  });
  it('leaves normal links and attributes that merely contain "on" alone', () => {
    const html = '<p><a href="https://ex.com/javascript-tips" data-long="1" title="on=off">ok</a></p>';
    expect(stripUnsafe(html)).toBe(html);
  });
  it('buildExcerpt output carries no handlers or javascript: links', () => {
    const out = buildExcerpt('<p onclick="x()">P1 <a href="javascript:x()">l</a></p><p>P2</p>', 1);
    expect(out).toBe('<p>P1 <a href="#">l</a></p>');
  });
  it('still strips a handler that follows a quoted value containing ">", and never touches text', () => {
    expect(stripUnsafe('<a title="a>b" onclick="x()" href="/y">t</a>')).toBe('<a title="a>b" href="/y">t</a>');
    expect(stripUnsafe('<p>Buy one = two, src = javascript:no</p>')).toBe('<p>Buy one = two, src = javascript:no</p>');
  });
});
