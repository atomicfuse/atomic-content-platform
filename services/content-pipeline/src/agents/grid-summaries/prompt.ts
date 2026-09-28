import { parse } from "node-html-parser";

/** System prompt for Grid story summaries (spec "Summary file"). */
export const SUMMARY_SYSTEM_PROMPT = [
  "You write short story summaries for a news feed.",
  "Rewrite in your own words; never copy sentences from the article. Use only facts stated in the article; add nothing.",
  "Output GitHub-flavoured markdown only, with exactly this structure:",
  "one line starting with '## ' (a fresh headline, not the original title), then one intro paragraph,",
  "then 3 or 4 sections, each a '### ' heading followed by one paragraph.",
  "About 200 words in total. No links, no URLs, no HTML, no images, no lists, no quotes longer than 10 words.",
].join(" ");

const MAX_ARTICLE_CHARS = 12_000;

/** Article HTML (KV body) → plain text for the prompt. */
export function articleText(html: string): string {
  return parse(html).structuredText.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_ARTICLE_CHARS);
}

/** User turn for one article. */
export function buildUserPrompt(title: string, text: string): string {
  return `Article title: ${title}\n\nArticle text:\n${text}`;
}

/** Strips anything the story page must never render (fences, HTML, links, images, URLs). */
export function sanitizeSummaryMarkdown(md: string): string {
  const unfenced = md.trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, "$1");
  return unfenced
    .replace(/<[^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One H2, 2–5 H3s, 80–450 words. Invalid output is treated as a failure and retried next run. */
export function isValidSummary(md: string): boolean {
  const h2 = (md.match(/^## /gm) ?? []).length;
  const h3 = (md.match(/^### /gm) ?? []).length;
  const words = md.replace(/[#*_>`]/g, " ").split(/\s+/).filter(Boolean).length;
  return h2 === 1 && h3 >= 2 && h3 <= 5 && words >= 80 && words <= 450;
}
