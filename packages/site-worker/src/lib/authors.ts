import type { AuthorProfile, SiteAuthorAssignment } from '@atomic-platform/shared-types';
import { authorKey, type ArticleIndexEntry } from './kv-schema';
import { isVisibleArticle } from '../utils/article-status';

export { AUTHOR_ID_RE, normalizeSiteAuthors } from './author-ids';

/** Below this many published articles on the site, the author page is `noindex` (thin page). */
export const AUTHOR_PAGE_MIN_ARTICLES = 3;

export function authorPath(id: string): string {
  return `/author/${id}`;
}

export function isAssignedAuthor(siteAuthors: SiteAuthorAssignment[], id: string): boolean {
  return siteAuthors.some((a) => a.id === id);
}

/** The slice of KVNamespace these helpers need (lets tests pass a fake). */
export interface AuthorKv {
  get(key: string, type: 'json'): Promise<unknown>;
}

/** `author:<id>` for each of the site's authors; missing keys are skipped. No reads when there are none. */
export async function loadAuthorProfiles(kv: AuthorKv, siteAuthors: SiteAuthorAssignment[]): Promise<Map<string, AuthorProfile>> {
  const out = new Map<string, AuthorProfile>();
  if (siteAuthors.length === 0) return out;
  const results = await Promise.all(siteAuthors.map(async (a) => [a.id, (await kv.get(authorKey(a.id), 'json')) as AuthorProfile | null] as const));
  for (const [id, profile] of results) if (profile) out.set(id, profile);
  return out;
}

export interface Byline {
  name: string;
  /** Set only when the author is assigned to this site AND has a profile (so the link never 404s). */
  id: string | null;
  profile: AuthorProfile | null;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Article author → linked byline when possible: by `author_id`, else by name; otherwise plain text. */
export function resolveByline(
  articleAuthor: string,
  authorId: string | undefined,
  siteAuthors: SiteAuthorAssignment[],
  profiles: ReadonlyMap<string, AuthorProfile>,
): Byline {
  if (authorId && isAssignedAuthor(siteAuthors, authorId)) {
    const profile = profiles.get(authorId);
    if (profile) return { name: articleAuthor, id: authorId, profile };
  }
  const wanted = norm(articleAuthor);
  for (const a of siteAuthors) {
    const profile = profiles.get(a.id);
    if (profile && norm(profile.name) === wanted) return { name: articleAuthor, id: a.id, profile };
  }
  return { name: articleAuthor, id: null, profile: null };
}

/**
 * The author's articles on this site: `author_id` match, or the same name when the article has no `author_id`
 * or one that isn't assigned to this site (e.g. a copied article) — the same rule `resolveByline` links by.
 * Newest first.
 */
export function articlesByAuthor(
  index: ArticleIndexEntry[],
  profile: AuthorProfile,
  includeAll: boolean,
  siteAuthors: SiteAuthorAssignment[] = [],
): ArticleIndexEntry[] {
  const name = norm(profile.name);
  const assigned = new Set(siteAuthors.map((a) => a.id));
  return index
    .filter((a) => includeAll || isVisibleArticle(a.status))
    .filter((a) => {
      if (a.author_id === profile.id) return true;
      if (a.author_id && assigned.has(a.author_id)) return false; // another author on this site
      return norm(a.author ?? '') === name;
    })
    .sort((a, b) => new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime());
}

/** Category-page slug — same rule as src/pages/category/[topic].astro. */
const topicSlug = (t: string): string => t.toLowerCase().replace(/\s+/g, '-');

/** Beats that are also site topics link to their category page; others are plain labels. */
export function beatLinks(beats: string[], siteTopics: string[]): Array<{ label: string; href: string | null }> {
  const topics = new Map(siteTopics.map((t) => [t.toLowerCase(), t]));
  return beats.map((label) => {
    const topic = topics.get(label.toLowerCase());
    return { label, href: topic ? `/category/${topicSlug(topic)}` : null };
  });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** JSON for a <script type="application/ld+json">: `<` escaped so content can never close the tag. */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function authorJsonLd(profile: AuthorProfile, pageUrl: string, portraitUrl: string | null): string {
  const sameAs = Object.values(profile.links).filter((v): v is string => typeof v === 'string' && v.length > 0);
  return safeJsonLd({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: pageUrl,
    mainEntity: {
      '@type': 'Person',
      name: profile.name,
      url: pageUrl,
      ...(profile.tagline ? { jobTitle: profile.tagline } : {}),
      ...(profile.bio ? { description: profile.bio } : {}),
      ...(portraitUrl ? { image: portraitUrl } : {}),
      ...(profile.beats.length > 0 ? { knowsAbout: profile.beats } : {}),
      ...(sameAs.length > 0 ? { sameAs } : {}),
    },
  });
}

/** Page N of the author's articles (1-based, clamped) and whether more remain. */
export function authorPageSlice<T>(items: T[], page: number, perPage: number): { items: T[]; hasMore: boolean } {
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const start = (p - 1) * perPage;
  return { items: items.slice(start, start + perPage), hasMore: start + perPage < items.length };
}
