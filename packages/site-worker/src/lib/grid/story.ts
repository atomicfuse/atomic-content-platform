import type {
  ExternalStoryRecord, GridExternalStoryMode, GridPoolItem, GridStoryMode, GridSummaryRecord,
} from '@atomic-platform/shared-types';
import { absolutizeLinks, buildExcerpt } from './excerpt';
import { escapeHtml } from './format';

/** A summary is shown when the site's mode asks for it or the story is pinned (spec D3). */
function showSummary(summary: GridSummaryRecord | null, modeWantsSummary: boolean): summary is GridSummaryRecord {
  return !!summary?.html && (modeWantsSummary || summary.pinned === true);
}

/** Story body for the Grid story page: AI summary when configured (or pinned) and available, else excerpt. */
export function storyText(input: { body: string; summary: GridSummaryRecord | null; mode: GridStoryMode; paragraphs: number; hostname: string }): { html: string; source: 'summary' | 'excerpt' } {
  if (showSummary(input.summary, input.mode === 'ai_summary')) return { html: input.summary.html, source: 'summary' };
  return { html: buildExcerpt(absolutizeLinks(input.body, input.hostname), input.paragraphs), source: 'excerpt' };
}

/** Plain text (blank-line separated) → escaped <p> paragraphs. */
function textParagraphs(text: string): string {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
}

/** External story body (spec D2/D3): summary (mode or pinned) → What It Covers → description. */
export function externalStoryText(input: { record: ExternalStoryRecord; summary: GridSummaryRecord | null; mode: GridExternalStoryMode }): { html: string; source: 'summary' | 'what_it_covers' | 'description' } {
  if (showSummary(input.summary, input.mode === 'ai_summary')) return { html: input.summary.html, source: 'summary' };
  if (input.record.whatItCovers) return { html: textParagraphs(input.record.whatItCovers), source: 'what_it_covers' };
  return { html: textParagraphs(input.record.description), source: 'description' };
}

/** "Related stories": newest pool items sharing a pill (or from All when the source has none). */
export function relatedItems(items: readonly GridPoolItem[], current: { site: string; slug: string }, pills: readonly string[], n: number): GridPoolItem[] {
  return items
    .filter((i) => !(i.site === current.site && i.slug === current.slug))
    .filter((i) => pills.length === 0 || i.pills.some((p) => pills.includes(p)))
    .slice(0, n);
}
