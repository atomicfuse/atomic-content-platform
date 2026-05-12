import { describe, it, expect } from "vitest";
import { wpHtmlToMarkdown } from "../../agents/migration/html-to-md.js";

describe("wpHtmlToMarkdown", () => {
  it("converts basic HTML headings and paragraphs to markdown", () => {
    const html = "<h2>Hello World</h2><p>This is a paragraph.</p>";
    const result = wpHtmlToMarkdown(html);
    expect(result).toContain("## Hello World");
    expect(result).toContain("This is a paragraph.");
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>";
    const result = wpHtmlToMarkdown(html);
    expect(result).toMatch(/-\s+Item one/);
    expect(result).toMatch(/-\s+Item two/);
    expect(result).toMatch(/-\s+Item three/);
  });

  it("strips WP shortcodes", () => {
    const html =
      '<p>Before</p>[gallery ids="1,2,3"]<p>Middle</p>[caption width="300"]Some caption[/caption]<p>After</p>';
    const result = wpHtmlToMarkdown(html);
    expect(result).toContain("Before");
    expect(result).toContain("Middle");
    expect(result).toContain("After");
    expect(result).not.toContain("[gallery");
    expect(result).not.toContain("[caption");
    expect(result).not.toContain("Some caption");
  });

  it("strips Elementor wrapper divs but keeps inner content", () => {
    const html =
      '<div class="elementor-widget-container"><p>Keep this content</p></div>';
    const result = wpHtmlToMarkdown(html);
    expect(result).toContain("Keep this content");
    expect(result).not.toContain("elementor");
  });

  it("removes inline images", () => {
    const html =
      '<p>Text before</p><img src="https://example.com/photo.jpg" alt="Photo"><p>Text after</p>';
    const result = wpHtmlToMarkdown(html);
    expect(result).toContain("Text before");
    expect(result).toContain("Text after");
    expect(result).not.toContain("photo.jpg");
    expect(result).not.toContain("![");
  });

  it("preserves links", () => {
    const html =
      '<p>Visit <a href="https://example.com">Example Site</a> for more.</p>';
    const result = wpHtmlToMarkdown(html);
    expect(result).toContain("[Example Site](https://example.com)");
  });

  it("handles empty content gracefully", () => {
    expect(wpHtmlToMarkdown("")).toBe("");
    expect(wpHtmlToMarkdown("   ")).toBe("");
    expect(wpHtmlToMarkdown("  \n  ")).toBe("");
  });

  it("strips wp-block wrapper divs but keeps inner content", () => {
    const html =
      '<div class="wp-block-group"><p>Block content here</p></div>';
    const result = wpHtmlToMarkdown(html);
    expect(result).toContain("Block content here");
    expect(result).not.toContain("wp-block");
  });
});
