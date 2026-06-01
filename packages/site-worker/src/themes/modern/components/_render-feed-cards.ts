import type { ArticleIndexEntry } from '../../../lib/kv-schema';

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderFeedCardsHtml(articles: ArticleIndexEntry[]): string {
  return articles
    .map((a) => {
      const date = new Date(a.publishDate).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
      return `
<article class="feed-card">
  <a class="feed-card-thumb" href="/${escape(a.slug)}" aria-hidden="true" tabindex="-1">
    ${a.featuredImage ? `<img src="${escape(a.featuredImage)}" alt="" loading="lazy" />` : ''}
  </a>
  <div class="feed-card-body">
    <a class="feed-card-title-link" href="/${escape(a.slug)}">
      <h3 class="feed-card-title">${escape(a.title)}</h3>
    </a>
    <p class="feed-card-date">${escape(date)}</p>
    ${a.description ? `<p class="feed-card-snippet">${escape(a.description)}</p>` : ''}
  </div>
</article>`;
    })
    .join('\n');
}
