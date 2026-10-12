import type { ArticleIndexEntry } from '../../../lib/kv-schema';

/**
 * Article cards for /author/<id>: a vertical card (image on top, then date, title, a two-line excerpt) that reads
 * well in a 2–3 column grid. Plain HTML so the page and its Load More endpoint render the same markup; the styles
 * are global in the author page.
 */
function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderAuthorCardsHtml(articles: ArticleIndexEntry[]): string {
  return articles
    .map((a) => {
      const href = `/${escape(a.slug)}`;
      const date = new Date(a.publishDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      return `
<article class="author-card">
  <a class="author-card-thumb" href="${href}" aria-hidden="true" tabindex="-1">${a.featuredImage ? `<img src="${escape(a.featuredImage)}" alt="" loading="lazy" />` : ''}</a>
  <div class="author-card-body">
    <p class="author-card-date">${escape(date)}</p>
    <a class="author-card-title-link" href="${href}"><h3 class="author-card-title">${escape(a.title)}</h3></a>
    ${a.description ? `<p class="author-card-excerpt">${escape(a.description)}</p>` : ''}
  </div>
</article>`;
    })
    .join('\n');
}
