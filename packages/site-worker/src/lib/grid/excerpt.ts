const STRIP_PAIRED = ['script', 'style', 'iframe', 'video', 'audio', 'figure', 'noscript', 'object', 'svg', 'picture'];
const STRIP_VOID = /<(img|embed|source|input)\b[^>]*>/gi;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ALLOWED_BLOCKS = new Set(['p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'table', 'pre']);

// Quoted attribute values may contain ">" — match them whole so a handler after one isn't missed.
const OPEN_TAG = /<[a-zA-Z](?:[^>"']|"[^"]*"|'[^']*')*>/g;
const EVENT_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL_ATTR = /(\s(?:href|src)\s*=\s*)(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi;

/** Within one opening tag: drops on* handlers; a javascript: href/src becomes "#" (original quoting kept). */
function neutraliseAttributes(tag: string): string {
  return tag
    .replace(EVENT_ATTR, '')
    .replace(JS_URL_ATTR, (match, prefix: string) => {
      const value = match.slice(prefix.length);
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
      return `${prefix}${quote}#${quote}`;
    });
}

/** Removes comments, embeds, media, scripts, event-handler attributes and javascript: URLs from article HTML. */
export function stripUnsafe(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of STRIP_PAIRED) out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  // Attributes are only rewritten inside tags, so article text like "one = two" is never touched.
  return out.replace(STRIP_VOID, '').replace(OPEN_TAG, neutraliseAttributes);
}

/** Splits well-formed HTML (marked output) into its top-level elements. */
export function splitTopLevelBlocks(html: string): Array<{ tag: string; html: string }> {
  const blocks: Array<{ tag: string; html: string }> = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  let start = -1;
  let tag = '';
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === '/';
    const name = (m[2] ?? '').toLowerCase();
    if (!closing && (m[3] === '/' || VOID.has(name))) continue;
    if (!closing) {
      if (depth === 0) { start = m.index; tag = name; }
      depth += 1;
    } else {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && start >= 0) {
        blocks.push({ tag, html: html.slice(start, m.index + m[0].length) });
        start = -1;
      }
    }
  }
  return blocks;
}

const textOf = (html: string): string => html.replace(/<[^>]+>/g, '').trim();

/**
 * Opening of an article for a Grid story page: whole top-level blocks until `paragraphs`
 * <p> blocks are included, capped at half the article's paragraphs (min 1).
 */
export function buildExcerpt(html: string, paragraphs: number): string {
  const blocks = splitTopLevelBlocks(stripUnsafe(html))
    .filter((b) => ALLOWED_BLOCKS.has(b.tag) && !(b.tag === 'p' && textOf(b.html) === ''));
  const total = blocks.filter((b) => b.tag === 'p').length;
  if (total === 0) return '';
  const limit = Math.min(paragraphs, Math.max(1, Math.floor(total / 2)));
  const out: string[] = [];
  let count = 0;
  for (const b of blocks) {
    out.push(b.html);
    if (b.tag === 'p' && ++count >= limit) break;
  }
  return out.join('\n');
}

/** Root-relative links in a source article point at the source site, not the Grid site. */
export function absolutizeLinks(html: string, hostname: string): string {
  return html.replace(/href="\/(?!\/)/g, `href="https://${hostname}/`);
}
