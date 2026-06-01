import type { ArticleScript } from "@atomic-platform/shared-types";

export interface ScriptInjectionResult {
  headScripts: string;
  bodyHtml: string;
}

/**
 * Inject article-level scripts into the rendered HTML body.
 *
 * - `head` scripts are returned separately for <head> injection.
 * - `before-content` scripts are prepended to the body.
 * - `after-content` scripts are appended to the body.
 * - `after-paragraph-N` scripts are inserted after the Nth </p> tag (1-indexed).
 *   If N exceeds the paragraph count, the script is appended to the end.
 *
 * Uses the same </p>-counting pattern as injectInlineAds().
 */
export function injectArticleScripts(
  body: string,
  scripts: ArticleScript[] | undefined,
): ScriptInjectionResult {
  if (!scripts || scripts.length === 0) {
    return { headScripts: "", bodyHtml: body };
  }

  const head: string[] = [];
  const before: string[] = [];
  const after: string[] = [];
  const paragraph: Array<{ afterIndex: number; content: string }> = [];

  for (const s of scripts) {
    if (s.position === "head") {
      head.push(s.content);
    } else if (s.position === "before-content") {
      before.push(s.content);
    } else if (s.position === "after-content") {
      after.push(s.content);
    } else {
      const match = /^after-paragraph-(\d+)$/.exec(s.position);
      if (match) {
        const n = Number.parseInt(match[1]!, 10);
        if (Number.isFinite(n) && n > 0) {
          paragraph.push({ afterIndex: n, content: s.content });
        }
      }
    }
  }

  let result = body;

  // Inject paragraph-relative scripts (same algorithm as injectInlineAds)
  if (paragraph.length > 0) {
    const parts = result.split(/(<\/p>)/i);
    let pSeen = 0;
    const out: string[] = [];
    for (const part of parts) {
      out.push(part);
      if (part.toLowerCase() === "</p>") {
        pSeen += 1;
        const matches = paragraph.filter((p) => p.afterIndex === pSeen);
        for (const m of matches) {
          out.push(m.content);
        }
      }
    }
    // Append any paragraph scripts whose index exceeded the count
    const unplaced = paragraph.filter((p) => p.afterIndex > pSeen);
    for (const u of unplaced) {
      out.push(u.content);
    }
    result = out.join("");
  }

  // Prepend before-content, append after-content
  if (before.length > 0) {
    result = before.join("") + result;
  }
  if (after.length > 0) {
    result = result + after.join("");
  }

  return {
    headScripts: head.join("\n"),
    bodyHtml: result,
  };
}
