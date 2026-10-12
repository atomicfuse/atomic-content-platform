import { describe, expect, it, vi } from 'vitest';
import type { AuthorProfile } from '@atomic-platform/shared-types';
import type { ArticleIndexEntry } from '../kv-schema';
import {
  articlesByAuthor, authorJsonLd, authorPageSlice, authorPath, beatLinks, firstName, initials, isAssignedAuthor,
  loadAuthorProfiles, resolveByline, safeJsonLd,
} from '../authors';

const ella: AuthorProfile = {
  id: 'ella-hughes', name: 'Ella Hughes', tagline: 'Celebrity & royals writer', bio: 'Writes about royals.',
  beats: ['Celebrities', 'Royals'], portrait: '/authors/assets/ella-hughes-abc.webp', links: { x: 'https://x.com/ella' },
};
const site = [{ id: 'ella-hughes', topics: ['Celebrities'] }, { id: 'ben-foster', topics: [] }];
const profiles = new Map([['ella-hughes', ella]]);

const art = (slug: string, author: string, extra: Partial<ArticleIndexEntry> = {}): ArticleIndexEntry => ({
  slug, title: slug, author, publishDate: `2026-10-0${slug.length % 9 + 1}T00:00:00Z`, tags: [], type: 'standard', status: 'published', ...extra,
});

describe('resolveByline', () => {
  it('links by author_id when that author is assigned and has a profile', () => {
    expect(resolveByline('Someone Else', 'ella-hughes', site, profiles)).toEqual({ name: 'Someone Else', id: 'ella-hughes', profile: ella });
  });
  it('matches the name case- and whitespace-insensitively when there is no author_id', () => {
    expect(resolveByline('  ella hughes ', undefined, site, profiles).id).toBe('ella-hughes');
  });
  it('assigned but no KV profile → plain text', () => {
    expect(resolveByline('Ben Foster', 'ben-foster', site, profiles)).toEqual({ name: 'Ben Foster', id: null, profile: null });
  });
  it('author_id of an author no longer on this site → falls back to the name, else plain', () => {
    const otherSite = [{ id: 'ben-foster', topics: [] }];
    expect(resolveByline('Ella Hughes', 'ella-hughes', otherSite, profiles)).toEqual({ name: 'Ella Hughes', id: null, profile: null });
  });
  it('site without authors → plain text', () => {
    expect(resolveByline('Ella Hughes', undefined, [], profiles).id).toBeNull();
  });
});

describe('assignment and paths', () => {
  it('isAssignedAuthor / authorPath', () => {
    expect(isAssignedAuthor(site, 'ben-foster')).toBe(true);
    expect(isAssignedAuthor(site, 'nobody')).toBe(false);
    expect(authorPath('ella-hughes')).toBe('/author/ella-hughes');
  });
});

describe('loadAuthorProfiles', () => {
  it('reads author:<id> for each site author and skips missing ones', async () => {
    const kv = { get: vi.fn(async (key: string) => (key === 'author:ella-hughes' ? ella : null)) };
    const out = await loadAuthorProfiles(kv, site);
    expect([...out.keys()]).toEqual(['ella-hughes']);
    expect(kv.get).toHaveBeenCalledWith('author:ben-foster', 'json');
  });
  it('makes no KV reads when the site has no authors', async () => {
    const kv = { get: vi.fn() };
    expect((await loadAuthorProfiles(kv, [])).size).toBe(0);
    expect(kv.get).not.toHaveBeenCalled();
  });
});

describe('articlesByAuthor', () => {
  it('author_id match or (no author_id) name match, visible only, newest first', () => {
    const index = [
      art('a', 'Whoever', { author_id: 'ella-hughes', publishDate: '2026-10-01T00:00:00Z' }),
      art('b', 'ELLA HUGHES', { publishDate: '2026-10-05T00:00:00Z' }),
      art('c', 'Ella Hughes', { author_id: 'ben-foster' }),
      art('d', 'Ella Hughes', { status: 'draft' }),
      art('e', 'Ben Foster'),
    ];
    expect(articlesByAuthor(index, ella, false, site).map((a) => a.slug)).toEqual(['b', 'a']);
    expect(articlesByAuthor(index, ella, true, site).map((a) => a.slug)).toContain('d');
  });
});

describe('display helpers', () => {
  it('initials / firstName', () => {
    expect(initials('Ella Hughes')).toBe('EH');
    expect(initials('Madonna')).toBe('M');
    expect(initials('Mary Jane Watson')).toBe('MW');
    expect(firstName('Ella Hughes')).toBe('Ella');
  });
  it('beatLinks links only beats that are site topics', () => {
    expect(beatLinks(['Celebrities', 'Royals'], ['Celebrities', 'Movies & TV'])).toEqual([
      { label: 'Celebrities', href: '/category/celebrities' },
      { label: 'Royals', href: null },
    ]);
  });
});

describe('JSON-LD', () => {
  it('ProfilePage with a Person mainEntity, absolute image, sameAs links', () => {
    const ld = JSON.parse(authorJsonLd(ella, 'https://s.com/author/ella-hughes', 'https://s.com/authors/assets/ella-hughes-abc.webp'));
    expect(ld['@type']).toBe('ProfilePage');
    expect(ld.mainEntity).toMatchObject({ '@type': 'Person', name: 'Ella Hughes', url: 'https://s.com/author/ella-hughes', sameAs: ['https://x.com/ella'] });
    expect(ld.mainEntity.image).toBe('https://s.com/authors/assets/ella-hughes-abc.webp');
  });
  it('escapes < so a bio can never close the script tag', () => {
    const out = safeJsonLd({ bio: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out).bio).toBe('</script><script>alert(1)</script>');
  });
});

describe('authorPageSlice', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  it('page 1 / page 3 / beyond / clamped', () => {
    expect(authorPageSlice(items, 1, 12)).toEqual({ items: items.slice(0, 12), hasMore: true });
    expect(authorPageSlice(items, 3, 12)).toEqual({ items: [24], hasMore: false });
    expect(authorPageSlice(items, 9, 12)).toEqual({ items: [], hasMore: false });
    expect(authorPageSlice(items, 0, 12).items).toHaveLength(12);
  });
});

describe('articlesByAuthor agrees with the byline', () => {
  it("an article whose author_id isn't on this site is listed by name, like its byline links", () => {
    const index = [art('copied', 'Ella Hughes', { author_id: 'someone-elsewhere' }), art('other', 'Ella Hughes', { author_id: 'ben-foster' })];
    expect(articlesByAuthor(index, ella, false, site).map((a) => a.slug)).toEqual(['copied']);
  });
});

