import { marked } from 'marked';
import type { GridSummaryRecord } from '@atomic-platform/shared-types';
import { splitFrontmatter } from './resolve';

const PATH_RE = /^grid-summaries\/([a-z0-9][a-z0-9-]*)\/([^/]+)\.md$/i;

/** Summary markdown → HTML with no raw HTML, links or images (defence in depth; pipeline also sanitises). */
export function renderSummaryHtml(markdown: string): string {
  const clean = markdown
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '');
  const html = marked.parse(clean, { async: false, gfm: true }) as string;
  return html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1').replace(/<img\b[^>]*>/gi, '');
}

/** grid-summaries/<site>/<slug>.md → KV record, or null when the file isn't a valid summary. */
export function parseSummaryFile(path: string, raw: string): { site: string; slug: string; record: GridSummaryRecord } | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const { front, body } = splitFrontmatter(raw);
  if (!body.trim()) return null;
  const f = (front ?? {}) as Record<string, unknown>;
  return {
    site: m[1] as string,
    slug: m[2] as string,
    record: {
      html: renderSummaryHtml(body),
      bodyHash: String(f.body_hash ?? ''),
      generatedAt: String(f.generated_at ?? ''),
      model: String(f.model ?? ''),
      edited: f.edited === true,
      sourceChanged: f.source_changed === true,
    },
  };
}
