import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseRssFeed, parseHtmlContent } from "../agents/content-generation/rss.js";

describe("parseRssFeed", () => {
  it("returns the latest item from an RSS feed", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Latest Article</title>
          <link>https://example.com/latest</link>
          <pubDate>Wed, 25 Mar 2026 10:00:00 GMT</pubDate>
          <description><![CDATA[<p>Some content</p>]]></description>
        </item>
        <item>
          <title>Older Article</title>
          <link>https://example.com/older</link>
          <pubDate>Mon, 23 Mar 2026 10:00:00 GMT</pubDate>
          <description><![CDATA[<p>Older content</p>]]></description>
        </item>
      </channel>
    </rss>`;

    const item = parseRssFeed(xml);
    expect(item.title).toBe("Latest Article");
    expect(item.link).toBe("https://example.com/latest");
    expect(item.htmlContent).toContain("<p>Some content</p>");
  });

  it("uses content:encoded over description when both present", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel>
        <item>
          <title>Article</title>
          <link>https://example.com/article</link>
          <description><![CDATA[<p>Short</p>]]></description>
          <content:encoded><![CDATA[<p>Full content with <img src="https://img.com/a.jpg" /></p>]]></content:encoded>
        </item>
      </channel>
    </rss>`;

    const item = parseRssFeed(xml);
    expect(item.htmlContent).toContain("Full content");
  });

  it("extracts enclosure URL when present", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Article</title>
          <link>https://example.com/article</link>
          <description><![CDATA[content]]></description>
          <enclosure url="https://img.com/hero.jpg" type="image/jpeg" />
        </item>
      </channel>
    </rss>`;

    const item = parseRssFeed(xml);
    expect(item.enclosureUrl).toBe("https://img.com/hero.jpg");
  });

  it("throws if feed has no items", () => {
    const xml = `<?xml version="1.0"?><rss><channel></channel></rss>`;
    expect(() => parseRssFeed(xml)).toThrow("RSS feed contains no items");
  });
});

describe("parseHtmlContent", () => {
  it("extracts first image as featured and rest inline", () => {
    const html = `<p>Intro</p>
      <img src="https://img.com/hero.jpg" alt="Hero" />
      <p>Body</p>
      <img src="https://img.com/inline.jpg" alt="Inline" />`;

    const result = parseHtmlContent(html, undefined);
    expect(result.featuredImageUrl).toBe("https://img.com/hero.jpg");
    expect(result.inlineImages).toEqual([{ src: "https://img.com/inline.jpg", alt: "Inline" }]);
  });

  it("uses enclosureUrl as featured image, all body images become inline", () => {
    const html = `<img src="https://img.com/body.jpg" alt="Body" /><p>Text</p>`;
    const result = parseHtmlContent(html, "https://img.com/enclosure.jpg");
    expect(result.featuredImageUrl).toBe("https://img.com/enclosure.jpg");
    expect(result.inlineImages).toEqual([{ src: "https://img.com/body.jpg", alt: "Body" }]);
  });

  it("extracts YouTube iframes", () => {
    const html = `<p>Watch this:</p>
      <iframe width="560" height="315" src="https://www.youtube.com/embed/abc123" frameborder="0" allowfullscreen></iframe>`;

    const result = parseHtmlContent(html, undefined);
    expect(result.youtubeEmbeds).toHaveLength(1);
    expect(result.youtubeEmbeds[0]).toContain('src="https://www.youtube.com/embed/abc123"');
  });

  it("returns null featuredImageUrl when no images and no enclosure", () => {
    const result = parseHtmlContent("<p>Text only</p>", undefined);
    expect(result.featuredImageUrl).toBeNull();
  });

  it("produces clean text body (no script/style tags)", () => {
    const html = `<script>alert('x')</script><style>.a{}</style><p>Clean text</p>`;
    const result = parseHtmlContent(html, undefined);
    expect(result.textBody).not.toContain("alert");
    expect(result.textBody).not.toContain(".a{}");
    expect(result.textBody).toContain("Clean text");
  });
});
