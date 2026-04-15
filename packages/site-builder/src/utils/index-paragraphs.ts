/**
 * Rehype plugin that adds a `data-p-index` attribute to every paragraph
 * element in the rendered article HTML.
 *
 * The runtime ad-loader.js queries `[data-p-index="N"]` to position
 * `after-paragraph-N` ad placements without any build-time knowledge of the
 * configured placements. Build-time HTML stays generic and reusable across
 * monetization profile changes (which only require regenerating the CDN
 * monetization JSON, not rebuilding the site).
 *
 * Only top-level paragraphs in the markdown body are indexed. Nested
 * paragraphs (e.g. inside blockquotes) are ignored to keep the numbering
 * consistent with the article's "real" prose paragraphs.
 */

import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

/**
 * Returns a rehype plugin that mutates the HAST tree by adding
 * `data-p-index="N"` to each top-level `<p>` element (1-based).
 */
export const paragraphIndexPlugin: Plugin<[], Root> = () => {
  return (tree: Root): void => {
    let index = 0;
    visit(tree, "element", (node: Element, _i, parent) => {
      if (node.tagName !== "p") return;
      // Only count paragraphs whose parent is the document root, not nested
      // inside other block elements (blockquote, li, figure, etc.).
      if (parent && parent.type === "element") return;
      index += 1;
      node.properties = node.properties ?? {};
      node.properties["data-p-index"] = String(index);
    });
  };
};
