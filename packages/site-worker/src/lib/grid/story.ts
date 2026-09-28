import type { GridPoolItem, GridStoryMode, GridSummaryRecord } from '@atomic-platform/shared-types';
import { absolutizeLinks, buildExcerpt } from './excerpt';

/** Story body for the Grid story page: AI summary when configured and available, else excerpt. */
export function storyText(input: { body: string; summary: GridSummaryRecord | null; mode: GridStoryMode; paragraphs: number; hostname: string }): { html: string; source: 'summary' | 'excerpt' } {
  if (input.mode === 'ai_summary' && input.summary?.html) return { html: input.summary.html, source: 'summary' };
  return { html: buildExcerpt(absolutizeLinks(input.body, input.hostname), input.paragraphs), source: 'excerpt' };
}

/** "Related stories": newest pool items sharing a pill (or from All when the source has none). */
export function relatedItems(items: readonly GridPoolItem[], current: { site: string; slug: string }, pills: readonly string[], n: number): GridPoolItem[] {
  return items
    .filter((i) => !(i.site === current.site && i.slug === current.slug))
    .filter((i) => pills.length === 0 || i.pills.some((p) => pills.includes(p)))
    .slice(0, n);
}
