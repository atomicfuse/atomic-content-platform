import { describe, expect, it } from 'vitest';
import { parseSummaryFile, renderSummaryHtml } from '../lib/grid-summary-html';

describe('renderSummaryHtml', () => {
  it('renders headings/paragraphs and strips HTML, links and images', () => {
    const html = renderSummaryHtml('## Title\n\nHello <b>x</b> [link](https://e.com) ![i](a.png) https://bare.com\n\n### Part\n\nText');
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<h3>Part</h3>');
    expect(html).not.toMatch(/<a\b|<img\b|<b>/);
    expect(html).toContain('link');
  });
});

describe('parseSummaryFile', () => {
  const raw = '---\nsource_site: a\nslug: s\nbody_hash: h1\ngenerated_at: "2026-09-27T00:00:00Z"\nmodel: m\nedited: true\nsource_changed: true\n---\n## H\n\nBody\n';
  it('parses path + frontmatter into a KV record', () => {
    expect(parseSummaryFile('grid-summaries/a/s.md', raw)).toEqual({
      site: 'a', slug: 's',
      record: { html: expect.stringContaining('<h2>H</h2>'), bodyHash: 'h1', generatedAt: '2026-09-27T00:00:00Z', model: 'm', edited: true, sourceChanged: true },
    });
  });
  it('rejects paths outside grid-summaries/<site>/<slug>.md and empty bodies', () => {
    expect(parseSummaryFile('sites/a/s.md', raw)).toBeNull();
    expect(parseSummaryFile('grid-summaries/a/b/c.md', raw)).toBeNull();
    expect(parseSummaryFile('grid-summaries/a/s.md', '---\nslug: s\n---\n  \n')).toBeNull();
  });
});
