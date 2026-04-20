/**
 * Rehype plugin that removes the first <h1> element from the rendered
 * article HTML tree.
 *
 * The article layout already renders the title from frontmatter in a
 * dedicated <h1> in the page header. Some generated articles also
 * include an H1 in the markdown body, causing a duplicate title.
 * This plugin strips that redundant H1 at build time so only the
 * layout-rendered title remains.
 */

import type { Plugin } from "unified";
import type { Root } from "hast";
import { visit, SKIP } from "unist-util-visit";

export const stripLeadingH1Plugin: Plugin<[], Root> = () => {
  return (tree: Root): void => {
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName === "h1" && parent && index !== undefined) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
    });
  };
};
