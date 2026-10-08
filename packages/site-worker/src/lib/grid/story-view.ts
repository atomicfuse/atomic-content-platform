/**
 * One Grid story, ready to render — shared by the story pages (first story) and /api/next-story
 * (stories appended below it), so both produce the same article markup.
 */
import type { ExternalStoryRecord, GridSummaryRecord, NetworkDirectorySite, ResolvedGridConfig } from '@atomic-platform/shared-types';
import type { ArticleRecord } from '../kv-schema';
import { AGGREGATOR_SOURCE_ID } from '../kv-schema';
import { injectInlineAds } from '../inline-ads';
import { buildExternalOutboundUrl, buildOutboundUrl, escapeHtml } from './format';
import { GRID_CARD_DEFAULTS } from './normalize';
import { renderSourceLineHtml, selectPlacements, type AdPlacementLike } from './render';
import { externalStoryText, storyText } from './story';

export interface StoryView {
  /** "site/slug" (pool key). */
  key: string;
  /** Public path, e.g. /story/scoopella/big-news. */
  path: string;
  title: string;
  description: string;
  pills: string[];
  pillLabel?: string;
  sourceLineHtml: string;
  published: string;
  heroImage?: string;
  /** External publisher images may fail to load → placeholder. */
  heroFallback: boolean;
  /** Story text, before inline ads. */
  bodyHtml: string;
  outbound: string | null;
}

interface ViewContext {
  grid: ResolvedGridConfig;
  canonicalHost: string;
  sites: ReadonlyMap<string, NetworkDirectorySite>;
  now: Date;
}

function publishedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function sourceLine(item: Parameters<typeof renderSourceLineHtml>[0], c: ViewContext): string {
  return renderSourceLineHtml(item, {
    now: c.now, card: GRID_CARD_DEFAULTS, showIntro: false, sites: c.sites, placements: [], pageType: 'article', staging: false, reservedHeight: 0,
  });
}

function pillLabelOf(grid: ResolvedGridConfig, pills: readonly string[]): string | undefined {
  return grid.topics.find((t) => t.slug === pills[0])?.label;
}

/**
 * Network story. A story-level ("Use AI summary") summary shows in any mode, so the caller must
 * always pass the summary record when one exists — not only in ai_summary mode.
 */
export function buildNetworkStoryView(input: ViewContext & {
  sourceSiteId: string; hostname: string; record: ArticleRecord; summary: GridSummaryRecord | null; pills: string[];
}): StoryView {
  const fm = input.record.frontmatter;
  const text = storyText({ body: input.record.body, summary: input.summary, mode: input.grid.story_mode, paragraphs: input.grid.excerpt_paragraphs, hostname: input.hostname });
  return {
    key: `${input.sourceSiteId}/${fm.slug}`,
    path: `/story/${input.sourceSiteId}/${fm.slug}`,
    title: fm.title,
    description: fm.description ?? fm.title,
    pills: input.pills,
    pillLabel: pillLabelOf(input.grid, input.pills),
    sourceLineHtml: sourceLine({ site: input.sourceSiteId, slug: fm.slug, title: fm.title, publishDate: fm.publishDate, pills: input.pills, pinned: false }, input),
    published: publishedLabel(fm.publishDate),
    ...(fm.featuredImage ? { heroImage: fm.featuredImage } : {}),
    heroFallback: false,
    bodyHtml: text.html,
    outbound: buildOutboundUrl(input.hostname, fm.slug, input.canonicalHost, input.grid.outbound_utm),
  };
}

/** Aggregator story (canonical slug: <title-slug>-<itemId>). */
export function buildExternalStoryView(input: ViewContext & {
  record: ExternalStoryRecord; summary: GridSummaryRecord | null; pills: string[]; favicon?: string;
}): StoryView {
  const r = input.record;
  const slug = `${r.slug}-${r.id}`;
  const text = externalStoryText({ record: r, summary: input.summary, mode: input.grid.external_story_mode });
  return {
    key: `${AGGREGATOR_SOURCE_ID}/${slug}`,
    path: `/story/${AGGREGATOR_SOURCE_ID}/${slug}`,
    title: r.title,
    description: r.description || r.title,
    pills: input.pills,
    pillLabel: pillLabelOf(input.grid, input.pills),
    sourceLineHtml: sourceLine({
      site: AGGREGATOR_SOURCE_ID, slug, title: r.title, publishDate: r.publishedAt, pills: input.pills, pinned: false,
      kind: 'external', sourceName: r.sourceName, ...(input.favicon ? { favicon: input.favicon } : {}),
    }, input),
    published: publishedLabel(r.publishedAt),
    heroImage: r.imageUrl,
    heroFallback: true,
    bodyHtml: text.html,
    outbound: buildExternalOutboundUrl(r.url),
  };
}

/** The <article> block. The page's own story uses h1; appended stories use h2 (one h1 per page). */
export function renderStoryArticleHtml(v: StoryView, bodyHtml: string, heading: 'h1' | 'h2'): string {
  const title = escapeHtml(v.title);
  const hero = v.heroImage
    ? `<img class="g-story__hero" src="${escapeHtml(v.heroImage)}"${v.heroFallback ? ' data-fallback="/placeholder.svg"' : ''} alt="${title}" />`
    : '';
  return `<article class="g-story__article">`
    + (v.pillLabel ? `<p class="g-story__topic">${escapeHtml(v.pillLabel)}</p>` : '')
    + `<${heading} class="g-story__title">${title}</${heading}>`
    + `<div class="g-story__byline"><span class="g-story__by">Original story by</span> ${v.sourceLineHtml} <span class="g-story__date">${escapeHtml(v.published)}</span></div>`
    + hero
    + `<div class="g-story__prose">${bodyHtml}</div>`
    + (v.outbound ? `<a class="g-story__cta" href="${escapeHtml(v.outbound)}" target="_blank" rel="noopener">Read full story</a>` : '')
    + `</article>`;
}

/** Same attributes as components/AdSlot.astro, with an id unique to this appended story. */
function slotsHtml(placements: readonly AdPlacementLike[], position: string, suffix: string, staging: boolean): string {
  return selectPlacements(placements, position, 'article').map((p) => {
    const id = `${p.id ?? `${position}-article`}${suffix}`;
    const code = staging ? '' : (p.code ?? '');
    return `<div data-ad-id="${escapeHtml(id)}" data-ad-position="${escapeHtml(position)}" data-ad-page-type="article"`
      + ` data-ad-device="${escapeHtml(p.device ?? 'all')}" data-sizes-desktop="${escapeHtml(JSON.stringify(p.sizes?.desktop ?? []))}"`
      + ` data-sizes-mobile="${escapeHtml(JSON.stringify(p.sizes?.mobile ?? []))}" class="atl-ad-slot atl-ad-${escapeHtml(position)}">${code}</div>`;
  }).join('');
}

/**
 * A story appended below the current one: its own above-content, in-article and below-content ads
 * (sidebar and sticky stay single for the page). `index` (2, 3, …) keeps ad ids unique on the page.
 */
export function renderNextStoryHtml(v: StoryView, opts: { placements: readonly AdPlacementLike[]; staging: boolean; index: number }): string {
  const suffix = `-n${opts.index}`;
  const inline = opts.placements.map((p) => ({ ...p, ...(p.id ? { id: `${p.id}${suffix}` } : {}) }));
  const body = injectInlineAds(v.bodyHtml, inline as Parameters<typeof injectInlineAds>[1], { staging: opts.staging });
  return `<section class="g-next" data-story-key="${escapeHtml(v.key)}" data-story-path="${escapeHtml(v.path)}" data-story-title="${escapeHtml(v.title)}">`
    + slotsHtml(opts.placements, 'above-content', suffix, opts.staging)
    + renderStoryArticleHtml(v, body, 'h2')
    + slotsHtml(opts.placements, 'below-content', suffix, opts.staging)
    + `</section>`;
}
