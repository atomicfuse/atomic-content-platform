# Authors Stage 2 — Author Data, Sync and Site Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sites can show authors — a linked byline, an "About the author" box and an author page per assigned author — fed by a new `author:<id>` KV key family synced from the network repo, with zero visible change on any site until it has `authors` in `site.yaml` and the author has a KV profile.

**Architecture:** Shared types describe the public author profile and a site's author assignments. `scripts/seed-authors.ts` turns `authors/<id>.yaml` (network repo `main`) into `author:<id>` keys in both KV namespaces and prunes deleted ones; a new network workflow runs it on `authors/**` pushes. `seed-kv.ts` copies a site's `authors:` and each article's `author_id` into KV. In the worker, pure helpers in `src/lib/authors.ts` decide everything (byline match, assignment, article list, JSON-LD, noindex); the Astro pages and components only render what they return. The pipeline and dashboard reserve the `author` slug and the `authors` site id.

**Tech Stack:** Astro 6 SSR on Cloudflare Workers (KV + R2), TypeScript strict, vitest (`--project unit`), `yaml`, `wrangler kv`, GitHub Actions; Next.js 15 dashboard and Node pipeline for the reservations.

**Spec:** `docs/superpowers/specs/2026-10-08-authors-design.md` (approved 2026-10-08). Roadmap: `docs/superpowers/plans/2026-10-08-authors-roadmap.md` (Stage 2).

## Global Constraints

- Scope: regular (modern) sites only. Grid sites show no authors — unchanged (their `/author/*` already resolves to a missing `/grid/author/*` route → 404).
- KV schema evolution: runtime default `??=` in `src/lib/config.ts` + seed-time default in `seed-kv.ts`; `ResolvedConfig.authors` stays optional so existing KV entries keep working.
- `author:<id>` keys are written **only** by `scripts/seed-authors.ts` (prod + staging namespaces), run by the network-repo workflow `sync-authors.yml` on `authors/**` pushes.
- A missing `author:<id>` = "no profile": plain-text byline, no About box, `/author/<id>` 404 — never 404s an article.
- `/author/<id>` exists only for authors assigned to the site; `noindex` while the author has fewer than 3 published articles on the site.
- Author id format: `^[a-z0-9]+(-[a-z0-9]+)*$`, equal to the file name `authors/<id>.yaml`, immutable.
- Portraits are served by the existing asset route as `/authors/assets/<file>` (R2 key `authors/assets/<file>`); **`authors` is a reserved site id** and **`author` a reserved article slug**.
- Byline JSON-LD on articles gains `url`; author page emits `ProfilePage` with a `Person` `mainEntity`.
- Non-author sites render byte-identical HTML (no KV reads added when `config.authors` is empty).
- Conventions: TS strict, no `any`, explicit return types, `.yaml` never `.yml`, conventional commits ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; never commit to `main`; stage specific files.
- Local testing gate: no commit/push/deploy until Asaf has tested locally and approved (commit steps below run only after that approval).

## Review Focus

1. Article frontmatter author name differs in case/whitespace from the profile name (e.g. `ella hughes ` vs `Ella Hughes`) → byline still links (test in Task 2).
2. Author assigned to the site but no `author:<id>` in KV yet → plain byline, no About box, author page 404 (tests in Task 2).
3. Article `author_id` points at an author no longer assigned to this site → falls back to name matching, else plain text; never links to a page that would 404 (test in Task 2).
4. Hand-edited author YAML with a `javascript:` link, a portrait path outside `/authors/assets/`, an id that doesn't match the file name, or no name → that value/file is dropped and reported, other authors still sync (tests in Task 3).
5. Bio or name containing `</script>` / `<` in JSON-LD → escaped so it can't break out of the script tag (test in Task 2).
6. `authors/` folder missing or every file invalid → seed writes nothing and **prunes nothing** (never wipes all author keys) (test in Task 3).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/shared-types/src/author.ts` (new) | `AuthorLinks`, `AuthorProfile` (public KV shape), `SiteAuthorAssignment` |
| `packages/shared-types/src/index.ts` | export the new types |
| `packages/shared-types/src/config.ts` | `SiteConfig.authors?`, `ResolvedConfig.authors?` |
| `packages/shared-types/src/article.ts` | `ArticleFrontmatter.author_id?` |
| `packages/site-worker/src/lib/kv-schema.ts` | `authorKey(id)`, `ArticleIndexEntry.author_id?` |
| `packages/site-worker/src/lib/config.ts` | runtime default `config.authors ??= []` |
| `packages/site-worker/src/lib/authors.ts` (new) | pure helpers: normalize assignments, byline match, articles by author, beat links, initials, JSON-LD, profile loading |
| `packages/site-worker/scripts/seed-kv.ts` | seed `authors` from the site layer; `author_id` into the article index |
| `packages/site-worker/scripts/lib/authors-seed.ts` (new) | parse/validate `authors/*.yaml`, KV entries, stale-key selection |
| `packages/site-worker/scripts/seed-authors.ts` (new) | CLI: write `author:*` to both namespaces, prune deleted |
| `packages/site-worker/package.json` | `seed:authors` script |
| `packages/site-worker/src/components/SEOHead.astro` | `authorUrl?`, `jsonLd?` props |
| `packages/site-worker/src/themes/modern/components/ArticleHero.astro` | `authorHref?` → linked byline |
| `packages/site-worker/src/themes/modern/components/AboutAuthor.astro` (new) | About-the-author box |
| `packages/site-worker/src/pages/[slug]/index.astro` | resolve byline, pass link/url, render About box |
| `packages/site-worker/src/themes/modern/components/LoadMoreButton.astro` | `endpoint` + `targetId` props (defaults unchanged) |
| `packages/site-worker/src/pages/author/[id].astro` (new) | the author page |
| `packages/site-worker/src/pages/api/author-articles.ts` (new) | load-more endpoint for the author page |
| `services/content-pipeline/src/lib/reserved-slugs.ts` (new) | `isReservedArticleSlug` (`grid`, `author`) |
| `services/content-pipeline/src/agents/content-generation/agent.ts`, `dedicated-agent.ts` | skip reserved slugs in `resolveUniqueSlug` |
| `services/dashboard/src/lib/reserved-site-ids.ts` (new) | `isReservedSiteId` (`authors`, `aggregator`) |
| `services/dashboard/src/actions/wizard.ts`, `src/app/api/sites/rename/route.ts` | reject reserved site ids |
| network repo `.github/workflows/sync-authors.yml` (new) | run `seed-authors` on `authors/**` pushes (push needs Asaf's approval) |

---

### Task 1: Author types, KV key, runtime + seed defaults

**Files:**
- Create: `packages/shared-types/src/author.ts`
- Modify: `packages/shared-types/src/index.ts`, `packages/shared-types/src/config.ts` (SiteConfig ~line 662, ResolvedConfig ~line 830), `packages/shared-types/src/article.ts` (~line 42)
- Modify: `packages/site-worker/src/lib/kv-schema.ts`, `packages/site-worker/src/lib/config.ts`, `packages/site-worker/scripts/seed-kv.ts` (`loadArticles` ~line 363, `resolveSiteConfig` config object ~line 650)
- Create: `packages/site-worker/src/lib/authors.ts` (only `normalizeSiteAuthors` + constants in this task)
- Test: `packages/site-worker/src/lib/__tests__/authors-config.test.ts`

**Interfaces:**
- Produces: types `AuthorLinks`, `AuthorProfile`, `SiteAuthorAssignment` from `@atomic-platform/shared-types`; `authorKey(id: string): string` → `author:<id>`; `AUTHOR_ID_RE: RegExp`; `normalizeSiteAuthors(raw: unknown): SiteAuthorAssignment[]`; `ArticleIndexEntry.author_id?: string`; `getConfig()` guarantees `config.authors` is an array.

- [ ] **Step 1: Write the failing test**

```ts
// packages/site-worker/src/lib/__tests__/authors-config.test.ts
import { describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '@atomic-platform/shared-types';
import { AUTHOR_ID_RE, normalizeSiteAuthors } from '../authors';
import { authorKey } from '../kv-schema';
import { getConfig } from '../config';

describe('normalizeSiteAuthors', () => {
  it('keeps valid assignments, trims topics, drops bad ids and duplicates', () => {
    expect(normalizeSiteAuthors([
      { id: 'ella-hughes', topics: [' Celebrities ', '', 'Royals'] },
      { id: 'Ella Hughes', topics: [] },
      { id: 'ella-hughes', topics: ['TV'] },
      { id: 'ben-foster' },
      'nope',
      null,
    ])).toEqual([
      { id: 'ella-hughes', topics: ['Celebrities', 'Royals'] },
      { id: 'ben-foster', topics: [] },
    ]);
  });
  it('returns [] for anything that is not an array', () => {
    expect(normalizeSiteAuthors(undefined)).toEqual([]);
    expect(normalizeSiteAuthors({ id: 'x' })).toEqual([]);
  });
  it('id format', () => {
    expect(AUTHOR_ID_RE.test('ella-hughes')).toBe(true);
    expect(AUTHOR_ID_RE.test('ella--hughes')).toBe(false);
    expect(AUTHOR_ID_RE.test('-ella')).toBe(false);
  });
});

describe('author KV key', () => {
  it('is author:<id>', () => {
    expect(authorKey('ella-hughes')).toBe('author:ella-hughes');
  });
});

describe('getConfig runtime default', () => {
  it('a KV config seeded before authors existed gets authors: []', () => {
    const config = { layout: {}, scripts: {} } as unknown as ResolvedConfig;
    const out = getConfig({ locals: { site: { siteId: 's', hostname: 'h', config, isPreview: false, isStaging: false } } } as never);
    expect(out.authors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/site-worker && pnpm test -- src/lib/__tests__/authors-config.test.ts`
Expected: FAIL — `Failed to resolve import "../authors"`.

- [ ] **Step 3: Add the shared types**

```ts
// packages/shared-types/src/author.ts
/** Optional profile links (absolute http(s) URLs only — validated at seed time). */
export interface AuthorLinks {
  website?: string;
  x?: string;
  instagram?: string;
  linkedin?: string;
}

/**
 * Public author profile — the value of KV `author:<id>` (written only by scripts/seed-authors.ts from
 * network repo `authors/<id>.yaml`). Private fields (exclusive_sites, timestamps) are not included.
 */
export interface AuthorProfile {
  id: string;
  name: string;
  tagline: string;
  bio: string;
  beats: string[];
  /** Site-relative portrait path (`/authors/assets/<id>-<hash>.webp`), or null → initials. */
  portrait: string | null;
  links: AuthorLinks;
}

/** One author on a site (`site.yaml` `authors:`), with the topics they write. */
export interface SiteAuthorAssignment {
  id: string;
  topics: string[];
}
```

In `packages/shared-types/src/index.ts` add (next to the other `export type` blocks):

```ts
export type { AuthorLinks, AuthorProfile, SiteAuthorAssignment } from "./author.js";
```

In `packages/shared-types/src/config.ts` add `import type { SiteAuthorAssignment } from "./author.js";` at the top, then in `SiteConfig` right after the `author?: string;` field:

```ts
  /** Authors writing for this site, each with optional topics (supersedes `author` once set). */
  authors?: SiteAuthorAssignment[];
```

and in `ResolvedConfig` right after `grid?: ResolvedGridConfig;`:

```ts
  /** Site authors (runtime default `[]` in the worker — KV entries seeded before authors lack it). */
  authors?: SiteAuthorAssignment[];
```

In `packages/shared-types/src/article.ts`, after the `author: string;` field of `ArticleFrontmatter`:

```ts
  /** Library author id (`authors/<id>.yaml`) — set on new articles; older ones match by name. */
  author_id?: string;
```

- [ ] **Step 4: Worker key, runtime default, helper**

`packages/site-worker/src/lib/kv-schema.ts` — in `ArticleIndexEntry` after `author: string;`:

```ts
  /** Library author id when the article was written with one (else bylines match by name). */
  author_id?: string;
```

and with the other key builders:

```ts
/** Public author profile (written only by scripts/seed-authors.ts, prod + staging). */
export const authorKey = (id: string): string => `author:${id}`;
```

`packages/site-worker/src/lib/config.ts` — inside `getConfig`, just before `return config;`:

```ts
  // Authors were added after many sites were seeded; a missing field means "no authors".
  config.authors ??= [];
```

```ts
// packages/site-worker/src/lib/authors.ts
import type { SiteAuthorAssignment } from '@atomic-platform/shared-types';

/** Author ids are kebab-case slugs, equal to the network repo file name `authors/<id>.yaml`. */
export const AUTHOR_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** site.yaml `authors:` → clean assignments (valid ids, first occurrence wins, trimmed topics). */
export function normalizeSiteAuthors(raw: unknown): SiteAuthorAssignment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SiteAuthorAssignment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || !AUTHOR_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const topics = (entry as { topics?: unknown }).topics;
    out.push({
      id,
      topics: Array.isArray(topics) ? topics.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean) : [],
    });
  }
  return out;
}
```

- [ ] **Step 5: Seed-time defaults in `seed-kv.ts`**

Add `import { normalizeSiteAuthors } from '../src/lib/authors';` with the other imports. In `loadArticles`, in the `frontmatter` object after `author: String(front.author ?? 'Editorial Team'),`:

```ts
      author_id: typeof front.author_id === 'string' && front.author_id ? front.author_id : undefined,
```

In `resolveSiteConfig`, in the `config` object right after `pages_project: String(site.pages_project ?? siteId),`:

```ts
    // Authors are site-only (never inherited from org/groups/overrides).
    authors: normalizeSiteAuthors(site.authors),
```

- [ ] **Step 6: Build shared-types and run the test**

Run: `pnpm --filter @atomic-platform/shared-types build && cd packages/site-worker && pnpm test -- src/lib/__tests__/authors-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Full worker suite + typecheck**

Run: `cd packages/site-worker && pnpm test && npx tsc --noEmit -p .`
Expected: all tests pass; tsc exit 0.

- [ ] **Step 8: Commit (after Asaf's local approval of the stage)**

```bash
git add packages/shared-types/src/author.ts packages/shared-types/src/index.ts packages/shared-types/src/config.ts packages/shared-types/src/article.ts packages/site-worker/src/lib/kv-schema.ts packages/site-worker/src/lib/config.ts packages/site-worker/src/lib/authors.ts packages/site-worker/src/lib/__tests__/authors-config.test.ts packages/site-worker/scripts/seed-kv.ts
git commit -m "feat(site-worker): author types, author:<id> key and authors config defaults"
```

---

### Task 2: Pure author helpers (byline, articles, JSON-LD)

**Files:**
- Modify: `packages/site-worker/src/lib/authors.ts`
- Test: `packages/site-worker/src/lib/__tests__/authors.test.ts`

**Interfaces:**
- Consumes: `AuthorProfile`, `SiteAuthorAssignment` (Task 1), `ArticleIndexEntry`, `authorKey` (Task 1), `isVisibleArticle` (`src/utils/article-status.ts`).
- Produces:
  - `AUTHOR_PAGE_MIN_ARTICLES = 3`
  - `authorPath(id: string): string` → `/author/<id>`
  - `isAssignedAuthor(siteAuthors: SiteAuthorAssignment[], id: string): boolean`
  - `interface AuthorKv { get(key: string, type: 'json'): Promise<unknown> }`
  - `loadAuthorProfiles(kv: AuthorKv, siteAuthors: SiteAuthorAssignment[]): Promise<Map<string, AuthorProfile>>`
  - `interface Byline { name: string; id: string | null; profile: AuthorProfile | null }`
  - `resolveByline(articleAuthor: string, authorId: string | undefined, siteAuthors: SiteAuthorAssignment[], profiles: ReadonlyMap<string, AuthorProfile>): Byline`
  - `articlesByAuthor(index: ArticleIndexEntry[], profile: AuthorProfile, includeAll: boolean): ArticleIndexEntry[]`
  - `beatLinks(beats: string[], siteTopics: string[]): Array<{ label: string; href: string | null }>`
  - `initials(name: string): string`, `firstName(name: string): string`
  - `authorJsonLd(profile: AuthorProfile, pageUrl: string, portraitUrl: string | null): string`
  - `safeJsonLd(value: unknown): string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/site-worker/src/lib/__tests__/authors.test.ts
import { describe, expect, it, vi } from 'vitest';
import type { AuthorProfile } from '@atomic-platform/shared-types';
import type { ArticleIndexEntry } from '../kv-schema';
import {
  articlesByAuthor, authorJsonLd, authorPath, beatLinks, firstName, initials, isAssignedAuthor,
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
    expect(articlesByAuthor(index, ella, false).map((a) => a.slug)).toEqual(['b', 'a']);
    expect(articlesByAuthor(index, ella, true).map((a) => a.slug)).toContain('d');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/site-worker && pnpm test -- src/lib/__tests__/authors.test.ts`
Expected: FAIL — `resolveByline` (and the others) not exported.

- [ ] **Step 3: Implement the helpers** (append to `src/lib/authors.ts`; extend the import line)

```ts
import type { AuthorProfile, SiteAuthorAssignment } from '@atomic-platform/shared-types';
import { authorKey, type ArticleIndexEntry } from './kv-schema';
import { isVisibleArticle } from '../utils/article-status';

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

/** The author's articles on this site: `author_id` match, or no `author_id` and the same name. Newest first. */
export function articlesByAuthor(index: ArticleIndexEntry[], profile: AuthorProfile, includeAll: boolean): ArticleIndexEntry[] {
  const name = norm(profile.name);
  return index
    .filter((a) => includeAll || isVisibleArticle(a.status))
    .filter((a) => (a.author_id ? a.author_id === profile.id : norm(a.author ?? '') === name))
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
```

(Keep `AUTHOR_ID_RE` and `normalizeSiteAuthors` from Task 1 in the same file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/site-worker && pnpm test -- src/lib/__tests__/authors.test.ts src/lib/__tests__/authors-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (after approval)**

```bash
git add packages/site-worker/src/lib/authors.ts packages/site-worker/src/lib/__tests__/authors.test.ts
git commit -m "feat(site-worker): author byline, article list and JSON-LD helpers"
```

---

### Task 3: `seed-authors` — author files → KV, prune deleted, network workflow

**Files:**
- Create: `packages/site-worker/scripts/lib/authors-seed.ts`, `packages/site-worker/scripts/seed-authors.ts`
- Modify: `packages/site-worker/package.json` (scripts)
- Test: `packages/site-worker/scripts/__tests__/authors-seed.test.ts`
- Create (network repo, separate branch, push needs Asaf's approval): `.github/workflows/sync-authors.yml`

**Interfaces:**
- Consumes: `AuthorProfile` (Task 1), `authorKey`, `AUTHOR_ID_RE` (Task 1), `bulkPut` (`scripts/lib/kv-bulk.ts`).
- Produces: `parseAuthorFile(fileName: string, raw: string): { profile: AuthorProfile | null; problems: string[] }`; `readAuthors(root: string): Promise<{ exists: boolean; profiles: AuthorProfile[]; invalid: string[] }>`; `authorEntries(profiles: AuthorProfile[]): Array<{ key: string; value: string }>`; `staleAuthorKeys(existingKeys: string[], profiles: AuthorProfile[]): string[]`; CLI `pnpm seed:authors [--local]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/site-worker/scripts/__tests__/authors-seed.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorEntries, parseAuthorFile, readAuthors, staleAuthorKeys } from '../lib/authors-seed';

const ELLA = `id: ella-hughes
name: Ella Hughes
tagline: Celebrity & royals writer
bio: |
  Writes about royals.
beats: [Celebrities, Royals, " "]
portrait:
  kind: generated
  path: /authors/assets/ella-hughes-abc123.webp
links:
  x: https://x.com/ella
  website: javascript:alert(1)
exclusive_sites: [scoopella]
`;

describe('parseAuthorFile', () => {
  it('public profile only; bad link dropped; exclusive_sites never published', () => {
    const { profile, problems } = parseAuthorFile('ella-hughes.yaml', ELLA);
    expect(profile).toEqual({
      id: 'ella-hughes', name: 'Ella Hughes', tagline: 'Celebrity & royals writer', bio: 'Writes about royals.',
      beats: ['Celebrities', 'Royals'], portrait: '/authors/assets/ella-hughes-abc123.webp', links: { x: 'https://x.com/ella' },
    });
    expect(problems.join(' ')).toMatch(/website/);
    expect(JSON.stringify(profile)).not.toContain('scoopella');
  });
  it('rejects a portrait outside /authors/assets/ (keeps the author, drops the portrait)', () => {
    const { profile } = parseAuthorFile('ella-hughes.yaml', ELLA.replace('/authors/assets/ella-hughes-abc123.webp', '/scoopella/assets/../x.webp'));
    expect(profile?.portrait).toBeNull();
  });
  it('rejects the whole file when the id is not the file name, or there is no name', () => {
    expect(parseAuthorFile('someone-else.yaml', ELLA).profile).toBeNull();
    expect(parseAuthorFile('ella-hughes.yaml', ELLA.replace('name: Ella Hughes', 'name: ""')).profile).toBeNull();
    expect(parseAuthorFile('Bad Name.yaml', 'id: Bad Name\nname: X').profile).toBeNull();
    expect(parseAuthorFile('x.yaml', ': : not yaml [').profile).toBeNull();
  });
});

describe('readAuthors / entries / pruning', () => {
  it('reads every .yaml, reports invalid files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'net-'));
    mkdirSync(join(root, 'authors/assets'), { recursive: true });
    writeFileSync(join(root, 'authors/ella-hughes.yaml'), ELLA);
    writeFileSync(join(root, 'authors/broken.yaml'), 'id: nope\nname: X');
    writeFileSync(join(root, 'authors/notes.txt'), 'ignored');
    const out = await readAuthors(root);
    expect(out.exists).toBe(true);
    expect(out.profiles.map((p) => p.id)).toEqual(['ella-hughes']);
    expect(out.invalid).toEqual(['broken.yaml']);
    expect(authorEntries(out.profiles)).toEqual([{ key: 'author:ella-hughes', value: JSON.stringify(out.profiles[0]) }]);
  });
  it('no authors folder → exists: false', async () => {
    const out = await readAuthors(mkdtempSync(join(tmpdir(), 'net-')));
    expect(out).toEqual({ exists: false, profiles: [], invalid: [] });
  });
  it('stale keys = author:* keys without a valid file; other key families untouched', () => {
    const { profile } = parseAuthorFile('ella-hughes.yaml', ELLA);
    expect(staleAuthorKeys(['author:ella-hughes', 'author:gone', 'site-config:author'], [profile!])).toEqual(['author:gone']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/site-worker && pnpm test -- scripts/__tests__/authors-seed.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/authors-seed"`.

- [ ] **Step 3: Implement `scripts/lib/authors-seed.ts`**

```ts
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AuthorLinks, AuthorProfile } from '@atomic-platform/shared-types';
import { AUTHOR_ID_RE } from '../../src/lib/authors';
import { authorKey } from '../../src/lib/kv-schema';

const LINK_KEYS = ['website', 'x', 'instagram', 'linkedin'] as const;

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * One `authors/<id>.yaml` → the public profile written to KV, plus problems to report.
 * The file is rejected (profile null) when it isn't YAML, its id isn't a slug equal to the file name, or it
 * has no name. Bad optional values (links, portrait path) are dropped individually.
 */
export function parseAuthorFile(fileName: string, raw: string): { profile: AuthorProfile | null; problems: string[] } {
  const problems: string[] = [];
  const stem = fileName.replace(/\.yaml$/, '');
  let doc: Record<string, unknown>;
  try {
    const parsed = parseYaml(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return { profile: null, problems: [`${fileName}: not a YAML mapping`] };
    doc = parsed as Record<string, unknown>;
  } catch (err) {
    return { profile: null, problems: [`${fileName}: invalid YAML (${err instanceof Error ? err.message : String(err)})`] };
  }
  const id = doc.id;
  if (typeof id !== 'string' || !AUTHOR_ID_RE.test(id) || id !== stem) {
    return { profile: null, problems: [`${fileName}: id must be a kebab-case slug equal to the file name`] };
  }
  const name = typeof doc.name === 'string' ? doc.name.trim() : '';
  if (!name) return { profile: null, problems: [`${fileName}: name is required`] };

  const links: AuthorLinks = {};
  const rawLinks = doc.links && typeof doc.links === 'object' ? (doc.links as Record<string, unknown>) : {};
  for (const key of LINK_KEYS) {
    const value = rawLinks[key];
    if (value == null || value === '') continue;
    if (isHttpUrl(value)) links[key] = value;
    else problems.push(`${fileName}: links.${key} is not an http(s) URL — dropped`);
  }

  const portraitPath = doc.portrait && typeof doc.portrait === 'object' ? (doc.portrait as { path?: unknown }).path : undefined;
  let portrait: string | null = null;
  if (typeof portraitPath === 'string' && portraitPath.startsWith('/authors/assets/') && !portraitPath.includes('..')) {
    portrait = portraitPath;
  } else if (portraitPath != null) {
    problems.push(`${fileName}: portrait.path must start with /authors/assets/ — dropped`);
  }

  return {
    profile: {
      id,
      name,
      tagline: typeof doc.tagline === 'string' ? doc.tagline.trim() : '',
      bio: typeof doc.bio === 'string' ? doc.bio.trim() : '',
      beats: Array.isArray(doc.beats) ? doc.beats.filter((b): b is string => typeof b === 'string').map((b) => b.trim()).filter(Boolean) : [],
      portrait,
      links,
    },
    problems,
  };
}

/** All valid profiles under `<root>/authors/*.yaml`; `exists` is false when there is no authors folder. */
export async function readAuthors(root: string): Promise<{ exists: boolean; profiles: AuthorProfile[]; invalid: string[] }> {
  const dir = join(root, 'authors');
  if (!existsSync(dir)) return { exists: false, profiles: [], invalid: [] };
  const profiles: AuthorProfile[] = [];
  const invalid: string[] = [];
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.yaml')).sort()) {
    const { profile, problems } = parseAuthorFile(file, await readFile(join(dir, file), 'utf8'));
    for (const p of problems) console.warn(`[seed-authors] ${p}`);
    if (profile) profiles.push(profile);
    else invalid.push(file);
  }
  return { exists: true, profiles, invalid };
}

export function authorEntries(profiles: AuthorProfile[]): Array<{ key: string; value: string }> {
  return profiles.map((p) => ({ key: authorKey(p.id), value: JSON.stringify(p) }));
}

/** `author:*` keys in KV whose author no longer has a valid file. */
export function staleAuthorKeys(existingKeys: string[], profiles: AuthorProfile[]): string[] {
  const keep = new Set(profiles.map((p) => authorKey(p.id)));
  return existingKeys.filter((k) => k.startsWith('author:') && !keep.has(k));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/site-worker && pnpm test -- scripts/__tests__/authors-seed.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: The CLI `scripts/seed-authors.ts`**

```ts
/**
 * Writes the author library to KV — the ONLY writer of `author:<id>` keys.
 *   author:<id>  ← network repo `authors/<id>.yaml` (public fields only), prod + staging namespaces
 * Deleted authors' keys are pruned — but only when the authors folder exists and at least one file is valid,
 * so a bad checkout can never wipe every profile. Invalid files are reported and fail the run (exit 1)
 * after the valid ones are written.
 * Env (CI): NETWORK_DATA_PATH, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, KV_NAMESPACE_ID_PROD, KV_NAMESPACE_ID_STAGING
 * Env (--local): NETWORK_DATA_PATH, KV_NAMESPACE_ID (default: staging id — matches `pnpm dev:worker`)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorEntries, readAuthors, staleAuthorKeys } from './lib/authors-seed';
import { bulkPut } from './lib/kv-bulk';

const STAGING_DEFAULT = 'f6c35e1fa8c841b8b193509a3a237f7f';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[seed-authors] missing env ${name}`);
  return v;
}

function listAuthorKeys(namespaceId: string, remote: boolean): string[] {
  const out = execFileSync('wrangler', ['kv', 'key', 'list', `--namespace-id=${namespaceId}`, '--prefix=author:', remote ? '--remote' : '--local'], { encoding: 'utf8' });
  return (JSON.parse(out) as Array<{ name: string }>).map((k) => k.name);
}

function deleteKeys(keys: string[], namespaceId: string, remote: boolean): void {
  if (keys.length === 0) return;
  const dir = mkdtempSync(join(tmpdir(), 'seed-authors-'));
  try {
    const file = join(dir, 'delete.json');
    writeFileSync(file, JSON.stringify(keys));
    execFileSync('wrangler', ['kv', 'bulk', 'delete', file, `--namespace-id=${namespaceId}`, '--force', remote ? '--remote' : '--local'], { stdio: 'inherit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const local = process.argv.includes('--local');
  const { exists, profiles, invalid } = await readAuthors(requireEnv('NETWORK_DATA_PATH'));
  if (!exists) {
    console.log('[seed-authors] no authors/ folder — nothing written, nothing pruned');
    return;
  }
  const targets = local
    ? [process.env.KV_NAMESPACE_ID ?? STAGING_DEFAULT]
    : [requireEnv('KV_NAMESPACE_ID_PROD'), requireEnv('KV_NAMESPACE_ID_STAGING')];
  const entries = authorEntries(profiles);
  for (const ns of targets) {
    bulkPut(entries, ns, !local);
    if (profiles.length > 0) {
      const stale = staleAuthorKeys(listAuthorKeys(ns, !local), profiles);
      deleteKeys(stale, ns, !local);
      if (stale.length > 0) console.log(`[seed-authors] pruned ${stale.length} deleted author(s) from ${ns.slice(0, 8)}…`);
    }
  }
  console.log(`[seed-authors] authors: ${profiles.length} written, ${invalid.length} invalid; targets: ${targets.length}`);
  if (invalid.length > 0) {
    console.error(`[seed-authors] invalid author files: ${invalid.join(', ')}`);
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error('[seed-authors] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

In `packages/site-worker/package.json` scripts, after `"seed:kv": "tsx scripts/seed-kv.ts",` add:

```json
    "seed:authors": "tsx scripts/seed-authors.ts",
```

- [ ] **Step 6: Typecheck the scripts**

Run: `cd packages/site-worker && npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --types node scripts/seed-authors.ts scripts/lib/authors-seed.ts 2>&1 | grep -E "^scripts/(seed-authors|lib/authors-seed)" ; echo done`
Expected: only `done` (no errors in these two files; errors from other pre-existing files are ignored).

- [ ] **Step 7: Local dry run against local KV**

```bash
cd packages/site-worker
mkdir -p /tmp/authors-fixture/authors
printf 'id: test-writer\nname: Test Writer\ntagline: Pop culture writer\nbio: Covers film and TV.\nbeats: [Movies & TV, Celebrities]\n' > /tmp/authors-fixture/authors/test-writer.yaml
NETWORK_DATA_PATH=/tmp/authors-fixture pnpm seed:authors --local
npx wrangler kv key get "author:test-writer" --namespace-id=f6c35e1fa8c841b8b193509a3a237f7f --local
```
Expected: `authors: 1 written, 0 invalid; targets: 1`, then the profile JSON.

- [ ] **Step 8: Network workflow (network repo, own branch; push only with Asaf's approval)**

Create `.github/workflows/sync-authors.yml` in a worktree of the network repo branched from `origin/main`:

```yaml
name: Sync authors to KV

# Writes ONLY `author:<id>` keys (prod + staging) from authors/<id>.yaml via scripts/seed-authors.ts.
# Never touches site keys — editing a profile re-syncs one small key, never every site.
on:
  push:
    branches: [main]
    paths:
      - "authors/**"
  workflow_dispatch:

concurrency:
  group: sync-authors
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Checkout platform code
        uses: actions/checkout@v4
        with:
          repository: atomicfuse/atomic-content-platform
          path: platform
          token: ${{ secrets.PLATFORM_REPO_TOKEN }}

      - uses: actions/setup-node@v4
        with: { node-version: 20 }

      - uses: pnpm/action-setup@v4
        with: { version: 10 }

      - name: Install dependencies
        working-directory: platform
        run: |
          for attempt in 1 2 3; do
            if pnpm install --frozen-lockfile; then exit 0; fi
            echo "pnpm install failed (attempt $attempt/3) — retrying in 15s..."
            sleep 15
          done
          echo "::error::pnpm install failed after 3 attempts."
          exit 1

      - name: Build shared-types
        working-directory: platform
        run: pnpm --filter @atomic-platform/shared-types build

      - name: Sync authors
        working-directory: platform/packages/site-worker
        env:
          NETWORK_DATA_PATH: ${{ github.workspace }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          KV_NAMESPACE_ID_PROD: ${{ secrets.KV_NAMESPACE_ID_PROD }}
          KV_NAMESPACE_ID_STAGING: ${{ secrets.KV_NAMESPACE_ID_STAGING }}
        run: pnpm exec tsx scripts/seed-authors.ts
```

Validate: `node -e 'require("yaml").parse(require("fs").readFileSync(".github/workflows/sync-authors.yml","utf8")); console.log("ok")'` (run from `services/dashboard` with the file path). Expected: `ok`. Commit on the network branch; **ask Asaf before pushing to network `main`**.

- [ ] **Step 9: Commit platform files (after approval)**

```bash
git add packages/site-worker/scripts/lib/authors-seed.ts packages/site-worker/scripts/seed-authors.ts packages/site-worker/scripts/__tests__/authors-seed.test.ts packages/site-worker/package.json
git commit -m "feat(site-worker): seed-authors writes author:<id> to KV and prunes deleted authors"
```

---

### Task 4: Linked byline, About-the-author box, article JSON-LD url

**Files:**
- Modify: `packages/site-worker/src/components/SEOHead.astro`, `packages/site-worker/src/themes/modern/components/ArticleHero.astro`, `packages/site-worker/src/pages/[slug]/index.astro`
- Create: `packages/site-worker/src/themes/modern/components/AboutAuthor.astro`
- Verify: local `pnpm dev:worker` (Task 7 runs the full matrix; this task checks one article)

**Interfaces:**
- Consumes: `loadAuthorProfiles`, `resolveByline`, `authorPath`, `initials`, `firstName` (Task 2).
- Produces: `SEOHead` props `authorUrl?: string`, `jsonLd?: string`; `ArticleHero` prop `authorHref?: string`; `AboutAuthor` props `{ profile: AuthorProfile; href: string }`.

- [ ] **Step 1: SEOHead — author url + custom JSON-LD**

In `SEOHead.astro` `Props` add:

```ts
  /** Author page URL (absolute). Adds `url` to the article's author JSON-LD. */
  authorUrl?: string;
  /** Pre-built JSON-LD (already escaped, e.g. from authorJsonLd). Replaces the Article JSON-LD. */
  jsonLd?: string;
```

destructure `authorUrl` and `jsonLd: customJsonLd`, change the author line to

```ts
      ...(author
        ? { author: { '@type': 'Person', name: author, ...(authorUrl ? { url: authorUrl } : {}) } }
        : {}),
```

and the last line to:

```astro
{(customJsonLd ?? jsonLd) && <script is:inline type="application/ld+json" set:html={customJsonLd ?? jsonLd} />}
```

(Unchanged output when neither prop is passed.)

- [ ] **Step 2: ArticleHero — linked byline**

```astro
---
import type { ArticleIndexEntry } from '../../../lib/kv-schema';

interface Props { article: ArticleIndexEntry; authorHref?: string; }
const { article, authorHref } = Astro.props;
```

and replace the author span with:

```astro
        {article.author && (
          <>
            {authorHref
              ? <a class="article-hero-author article-hero-author-link" href={authorHref}>By {article.author}</a>
              : <span class="article-hero-author">By {article.author}</span>}
            <span class="article-hero-separator">&middot;</span>
          </>
        )}
```

Add to its `<style>`:

```css
  .article-hero-author-link {
    color: inherit;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .article-hero-author-link:hover { opacity: 0.85; }
```

- [ ] **Step 3: AboutAuthor component**

```astro
---
// packages/site-worker/src/themes/modern/components/AboutAuthor.astro
import type { AuthorProfile } from '@atomic-platform/shared-types';
import { firstName, initials } from '../../../lib/authors';

interface Props { profile: AuthorProfile; href: string; }
const { profile, href } = Astro.props;
---

<aside class="about-author" aria-labelledby="about-author-name">
  <a class="about-author-portrait" href={href} tabindex="-1" aria-hidden="true">
    {profile.portrait
      ? <img src={profile.portrait} alt="" width="72" height="72" loading="lazy" />
      : <span class="about-author-initials">{initials(profile.name)}</span>}
  </a>
  <div class="about-author-body">
    <p class="about-author-eyebrow">About the author</p>
    <h2 id="about-author-name" class="about-author-name"><a href={href}>{profile.name}</a></h2>
    {profile.tagline && <p class="about-author-tagline">{profile.tagline}</p>}
    {profile.bio && <p class="about-author-bio">{profile.bio}</p>}
    <a class="about-author-more" href={href}>More from {firstName(profile.name)} &rarr;</a>
  </div>
</aside>

<style>
  .about-author {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    margin-top: 2.5rem;
    padding: 1.25rem;
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: var(--radius-md, 8px);
    background: var(--color-surface, #f9fafb);
  }
  .about-author-portrait { flex-shrink: 0; }
  .about-author-portrait img,
  .about-author-initials {
    width: 72px;
    height: 72px;
    border-radius: 9999px;
    object-fit: cover;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .about-author-initials {
    background: var(--color-primary, #1a1a2e);
    color: var(--color-article_hero_title, #fff);
    font-weight: 700;
    font-size: 1.375rem;
  }
  .about-author-eyebrow {
    margin: 0 0 0.25rem;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted, #6b7280);
  }
  .about-author-name { margin: 0; font-size: 1.125rem; }
  .about-author-name a { color: inherit; text-decoration: none; }
  .about-author-name a:hover { text-decoration: underline; }
  .about-author-tagline { margin: 0.125rem 0 0.5rem; color: var(--color-muted, #6b7280); font-size: 0.9375rem; }
  .about-author-bio {
    margin: 0 0 0.5rem;
    font-size: 0.9375rem;
    line-height: 1.6;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .about-author-more { font-weight: 600; font-size: 0.9375rem; color: var(--color-link, var(--color-primary, #1a1a2e)); }
  @media (max-width: 480px) {
    .about-author { flex-direction: column; }
  }
</style>
```

- [ ] **Step 4: Wire the article page** (`src/pages/[slug]/index.astro`)

Add imports:

```ts
import AboutAuthor from '../../themes/modern/components/AboutAuthor.astro';
import { authorPath, loadAuthorProfiles, resolveByline } from '../../lib/authors';
```

After the `staging` constant computation and the article/404 checks (i.e. after `const { headScripts: ... }`), add:

```ts
// Bylines link to the author page only when the author is on this site and has a profile.
// Sites without `authors` make no extra KV reads and render exactly as before.
const siteAuthors = config.authors ?? [];
const authorProfiles = article && siteAuthors.length > 0 ? await loadAuthorProfiles(env.CONFIG_KV, siteAuthors) : new Map();
const byline = article ? resolveByline(article.frontmatter.author, article.frontmatter.author_id, siteAuthors, authorProfiles) : null;
const authorHref = byline?.id ? authorPath(byline.id) : undefined;
const authorUrl = authorHref ? `https://${getCanonicalDomain(Astro)}${authorHref}` : undefined;
```

Pass `authorUrl={authorUrl}` to `<SEOHead …>`, `authorHref={authorHref}` to `<ArticleHero …>`, and inside `<article class="article-prose prose">` after the tags paragraph:

```astro
          {byline?.profile && authorHref && <AboutAuthor profile={byline.profile} href={authorHref} />}
```

- [ ] **Step 5: Unit suite + typecheck + build**

Run: `cd packages/site-worker && pnpm test && npx tsc --noEmit -p . && IS_STAGING=true pnpm build`
Expected: tests pass, tsc exit 0, build `Complete!`.

- [ ] **Step 6: Commit (after approval)**

```bash
git add packages/site-worker/src/components/SEOHead.astro packages/site-worker/src/themes/modern/components/ArticleHero.astro packages/site-worker/src/themes/modern/components/AboutAuthor.astro "packages/site-worker/src/pages/[slug]/index.astro"
git commit -m "feat(site-worker): linked byline and About-the-author box"
```

---

### Task 5: Author page + load-more

**Files:**
- Modify: `packages/site-worker/src/themes/modern/components/LoadMoreButton.astro`
- Create: `packages/site-worker/src/pages/author/[id].astro`, `packages/site-worker/src/pages/api/author-articles.ts`
- Test: `packages/site-worker/src/lib/__tests__/authors.test.ts` (add `authorPageSlice`)

**Interfaces:**
- Consumes: `isAssignedAuthor`, `articlesByAuthor`, `beatLinks`, `initials`, `authorJsonLd`, `AUTHOR_PAGE_MIN_ARTICLES` (Task 2), `authorKey` (Task 1), `SEOHead` `jsonLd`/`noindex` (Task 4), `FeedCard.astro`, `renderFeedCardsHtml`.
- Produces: `authorPageSlice<T>(items: T[], page: number, perPage: number): { items: T[]; hasMore: boolean }`; `LoadMoreButton` props `endpoint?: string` (default `/api/articles`), `targetId?: string` (default `more-on-list`).

- [ ] **Step 1: Failing test for the pagination helper** (append to `authors.test.ts`; add `authorPageSlice` to its import)

```ts
describe('authorPageSlice', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  it('page 1 / page 3 / beyond / clamped', () => {
    expect(authorPageSlice(items, 1, 12)).toEqual({ items: items.slice(0, 12), hasMore: true });
    expect(authorPageSlice(items, 3, 12)).toEqual({ items: [24], hasMore: false });
    expect(authorPageSlice(items, 9, 12)).toEqual({ items: [], hasMore: false });
    expect(authorPageSlice(items, 0, 12).items).toHaveLength(12);
  });
});
```

Run: `cd packages/site-worker && pnpm test -- src/lib/__tests__/authors.test.ts` → Expected: FAIL (`authorPageSlice` not exported).

- [ ] **Step 2: Implement** (append to `src/lib/authors.ts`)

```ts
/** Page N of the author's articles (1-based, clamped) and whether more remain. */
export function authorPageSlice<T>(items: T[], page: number, perPage: number): { items: T[]; hasMore: boolean } {
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  const start = (p - 1) * perPage;
  return { items: items.slice(start, start + perPage), hasMore: start + perPage < items.length };
}
```

Run the test again → Expected: PASS.

- [ ] **Step 3: LoadMoreButton endpoint + target (defaults unchanged)**

```astro
---
interface Props { nextPage: number; hasMore: boolean; endpoint?: string; targetId?: string; }
const { nextPage, hasMore, endpoint = '/api/articles', targetId = 'more-on-list' } = Astro.props;
---

{hasMore && (
  <div class="load-more-wrap">
    <a href={`?page=${nextPage}`} data-load-more data-endpoint={endpoint} data-target={targetId} class="load-more-btn">Load More</a>
    <p class="load-more-status" data-load-more-status></p>
  </div>
)}
```

In the inline script replace `var feed = document.getElementById('more-on-list');` with

```js
    var feed = document.getElementById(btn.getAttribute('data-target') || 'more-on-list');
    var endpoint = btn.getAttribute('data-endpoint') || '/api/articles';
```

and `var res = await fetch('/api/articles?page=' + page);` with

```js
        var res = await fetch(endpoint + (endpoint.indexOf('?') === -1 ? '?' : '&') + 'page=' + page);
```

- [ ] **Step 4: Load-more endpoint** `src/pages/api/author-articles.ts`

```ts
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { AuthorProfile } from '@atomic-platform/shared-types';
import { getConfig, getSiteId, isPreviewMode } from '../../lib/config';
import { articleIndexKey, authorKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { articlesByAuthor, authorPageSlice, isAssignedAuthor } from '../../lib/authors';
import { renderFeedCardsHtml } from '../../themes/modern/components/_render-feed-cards';

export const prerender = false;

/** Next page of an author's articles as feed-card HTML (Load More on /author/<id>). */
export const GET: APIRoute = async (ctx) => {
  const url = new URL(ctx.request.url);
  const id = url.searchParams.get('id') ?? '';
  const page = parseInt(url.searchParams.get('page') ?? '2', 10);
  const config = getConfig(ctx);
  const notFound = new Response('', { status: 404 });
  if (!isAssignedAuthor(config.authors ?? [], id)) return notFound;
  const profile = await env.CONFIG_KV.get<AuthorProfile>(authorKey(id), 'json');
  if (!profile) return notFound;
  const index = (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(getSiteId(ctx)), 'json')) ?? [];
  const { items } = authorPageSlice(articlesByAuthor(index, profile, isPreviewMode(ctx)), page, config.categories.per_page);
  return new Response(renderFeedCardsHtml(items), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
};
```

- [ ] **Step 5: The author page** `src/pages/author/[id].astro`

```astro
---
export const prerender = false;

import { env } from 'cloudflare:workers';
import type { AuthorProfile } from '@atomic-platform/shared-types';
import BaseLayout from '../../layouts/BaseLayout.astro';
import SEOHead from '../../components/SEOHead.astro';
import Header from '../../themes/modern/components/Header.astro';
import Footer from '../../themes/modern/components/Footer.astro';
import FeedCard from '../../themes/modern/components/FeedCard.astro';
import LoadMoreButton from '../../themes/modern/components/LoadMoreButton.astro';
import AdSlot from '../../components/AdSlot.astro';
import { getConfig, getSiteId, isPreviewMode, getCanonicalDomain, isStagingEnv } from '../../lib/config';
import { articleIndexKey, authorKey, type ArticleIndexEntry } from '../../lib/kv-schema';
import { toAbsoluteImageUrl } from '../../lib/url';
import {
  AUTHOR_PAGE_MIN_ARTICLES, articlesByAuthor, authorJsonLd, authorPageSlice, beatLinks, initials, isAssignedAuthor,
} from '../../lib/authors';

const { id } = Astro.params;
if (!id) return new Response('Not found', { status: 404 });

const config = getConfig(Astro);
const siteId = getSiteId(Astro);
const preview = isPreviewMode(Astro);
const staging = isStagingEnv(Astro);

// Only authors assigned to this site, with a synced profile, have a page here.
if (!isAssignedAuthor(config.authors ?? [], id)) return new Response('Not found', { status: 404 });
const profile = await env.CONFIG_KV.get<AuthorProfile>(authorKey(id), 'json');
if (!profile) return new Response('Not found', { status: 404 });

const index = (await env.CONFIG_KV.get<ArticleIndexEntry[]>(articleIndexKey(siteId), 'json')) ?? [];
const articles = articlesByAuthor(index, profile, preview);
const perPage = config.categories.per_page;
const first = authorPageSlice(articles, 1, perPage);
const published = preview ? articlesByAuthor(index, profile, false).length : articles.length;

const domain = getCanonicalDomain(Astro);
const canonicalUrl = `https://${domain}/author/${id}`;
const portraitUrl = profile.portrait ? (toAbsoluteImageUrl(profile.portrait, `https://${domain}`) ?? null) : null;
const title = `${profile.name}${profile.tagline ? ` — ${profile.tagline}` : ''} | ${config.site_name}`;
const description = profile.bio ? profile.bio.slice(0, 160) : `Articles by ${profile.name} on ${config.site_name}`;
const beats = beatLinks(profile.beats, config.brief?.topics ?? []);
const links = Object.entries(profile.links).filter(([, v]) => typeof v === 'string' && v);
const LINK_LABELS: Record<string, string> = { website: 'Website', x: 'X', instagram: 'Instagram', linkedin: 'LinkedIn' };

Astro.response.headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
---

<BaseLayout title={title} description={description} pageType="category">
  <Fragment slot="head">
    <SEOHead
      title={title}
      description={description}
      canonicalUrl={canonicalUrl}
      image={profile.portrait ?? undefined}
      siteName={config.site_name}
      siteBaseUrl={`https://${domain}`}
      noindex={published < AUTHOR_PAGE_MIN_ARTICLES}
      jsonLd={authorJsonLd(profile, canonicalUrl, portraitUrl)}
    />
  </Fragment>

  <Header config={config} currentPath={`/author/${id}`} />

  <main class="author-page">
    <section class="author-profile">
      <div class="author-portrait">
        {profile.portrait
          ? <img src={profile.portrait} alt={`Portrait of ${profile.name}`} width="160" height="160" />
          : <span class="author-initials" aria-hidden="true">{initials(profile.name)}</span>}
      </div>
      <div class="author-text">
        <h1 class="author-name">{profile.name}</h1>
        {profile.tagline && <p class="author-tagline">{profile.tagline}</p>}
        {profile.bio && <p class="author-bio">{profile.bio}</p>}
        {beats.length > 0 && (
          <ul class="author-beats" aria-label="Writes about">
            {beats.map((b) => <li>{b.href ? <a href={b.href}>{b.label}</a> : <span>{b.label}</span>}</li>)}
          </ul>
        )}
        {links.length > 0 && (
          <p class="author-links">
            {links.map(([k, v]) => <a href={v} rel="me noopener" target="_blank">{LINK_LABELS[k] ?? k}</a>)}
          </p>
        )}
      </div>
    </section>

    <AdSlot position="category-top" pageType="category" server:defer />

    <section class="author-articles" aria-labelledby="author-articles-title">
      <h2 id="author-articles-title" class="author-articles-title">Latest from {profile.name}</h2>
      {first.items.length === 0
        ? <p class="author-empty">No articles yet. Check back soon.</p>
        : (
          <div class="author-grid" id="author-articles-list">
            {first.items.map((a) => <FeedCard article={a} />)}
          </div>
        )}
      <LoadMoreButton nextPage={2} hasMore={first.hasMore} endpoint={`/api/author-articles?id=${encodeURIComponent(id)}`} targetId="author-articles-list" />
    </section>
  </main>

  <Footer config={config} staging={staging} />
  <AdSlot position="sticky-bottom" pageType="category" server:defer />
</BaseLayout>

<style>
  .author-page { max-width: var(--container-max, 1200px); margin: 0 auto; padding: 2.5rem 1rem; }
  .author-profile { display: grid; grid-template-columns: 1fr; gap: 1.5rem; align-items: start; margin-bottom: 2.5rem; }
  @media (min-width: 720px) { .author-profile { grid-template-columns: 160px 1fr; gap: 2rem; } }
  .author-portrait img, .author-initials {
    width: 160px; height: 160px; border-radius: 9999px; object-fit: cover; display: flex; align-items: center; justify-content: center;
  }
  .author-initials { background: var(--color-primary, #1a1a2e); color: var(--color-article_hero_title, #fff); font-size: 3rem; font-weight: 700; }
  .author-name { margin: 0; font-size: clamp(1.75rem, 3vw, 2.5rem); line-height: 1.15; }
  .author-tagline { margin: 0.25rem 0 1rem; color: var(--color-muted, #6b7280); font-weight: 600; }
  .author-bio { margin: 0 0 1rem; line-height: 1.7; max-width: 65ch; }
  .author-beats { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; padding: 0; margin: 0 0 1rem; }
  .author-beats li > * {
    display: inline-block; padding: 0.25rem 0.75rem; border-radius: 9999px; border: 1px solid var(--color-border, #e5e7eb);
    font-size: 0.875rem; color: inherit; text-decoration: none;
  }
  .author-beats a:hover { border-color: var(--color-primary, #1a1a2e); }
  .author-links { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0; }
  .author-links a { font-weight: 600; color: var(--color-link, var(--color-primary, #1a1a2e)); }
  .author-articles-title { font-size: var(--text-2xl, 1.5rem); margin: 0 0 1.25rem; }
  .author-grid { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
  @media (min-width: 720px) { .author-grid { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1024px) { .author-grid { grid-template-columns: repeat(3, 1fr); } }
  .author-empty { color: var(--color-muted, #6b7280); }
</style>
```

`BaseLayout`'s `pageType` is `'homepage' | 'article' | 'category'`; the author page uses `'category'`, so ad placements follow category-page rules (same as the topic pages it resembles).

- [ ] **Step 6: Suite + typecheck + build**

Run: `cd packages/site-worker && pnpm test && npx tsc --noEmit -p . && IS_STAGING=true pnpm build`
Expected: pass / exit 0 / `Complete!`.

- [ ] **Step 7: Commit (after approval)**

```bash
git add packages/site-worker/src/themes/modern/components/LoadMoreButton.astro "packages/site-worker/src/pages/author/[id].astro" packages/site-worker/src/pages/api/author-articles.ts packages/site-worker/src/lib/authors.ts packages/site-worker/src/lib/__tests__/authors.test.ts
git commit -m "feat(site-worker): author pages with load-more"
```

---

### Task 6: Reserve the `author` slug and the `authors` site id

**Files:**
- Create: `services/content-pipeline/src/lib/reserved-slugs.ts`, `services/content-pipeline/src/__tests__/reserved-slugs.test.ts`
- Modify: `services/content-pipeline/src/agents/content-generation/agent.ts` (~line 443), `services/content-pipeline/src/agents/content-generation/dedicated-agent.ts` (~line 111)
- Create: `services/dashboard/src/lib/reserved-site-ids.ts`, `services/dashboard/src/lib/__tests__/reserved-site-ids.test.ts`
- Modify: `services/dashboard/src/actions/wizard.ts` (after `const projectName = data.pagesProjectName;` ~line 80), `services/dashboard/src/app/api/sites/rename/route.ts` (after the `SLUG_RE` check ~line 60)

**Interfaces:**
- Produces: `isReservedArticleSlug(slug: string): boolean` (pipeline); `isReservedSiteId(id: string): boolean` (dashboard).

- [ ] **Step 1: Failing tests**

```ts
// services/content-pipeline/src/__tests__/reserved-slugs.test.ts
import { describe, expect, it } from "vitest";
import { isReservedArticleSlug } from "../lib/reserved-slugs.js";

describe("isReservedArticleSlug", () => {
  it("grid and author are reserved path segments on every site", () => {
    expect(isReservedArticleSlug("grid")).toBe(true);
    expect(isReservedArticleSlug("author")).toBe(true);
    expect(isReservedArticleSlug("AUTHOR")).toBe(true);
    expect(isReservedArticleSlug("author-tips")).toBe(false);
    expect(isReservedArticleSlug("authors")).toBe(false);
  });
});
```

```ts
// services/dashboard/src/lib/__tests__/reserved-site-ids.test.ts
import { describe, expect, it } from "vitest";
import { isReservedSiteId } from "../reserved-site-ids";

describe("isReservedSiteId", () => {
  it("authors (portrait assets) and aggregator (Grid stories) can't be site ids", () => {
    expect(isReservedSiteId("authors")).toBe(true);
    expect(isReservedSiteId("aggregator")).toBe(true);
    expect(isReservedSiteId("Authors")).toBe(true);
    expect(isReservedSiteId("authorsdaily")).toBe(false);
  });
});
```

Run: `cd services/content-pipeline && npx vitest run src/__tests__/reserved-slugs.test.ts` and `cd services/dashboard && npx vitest run src/lib/__tests__/reserved-site-ids.test.ts`
Expected: both FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
// services/content-pipeline/src/lib/reserved-slugs.ts
/**
 * Path segments the site worker owns on every site — no article may use them as its slug:
 * `grid` (Grid template routes) and `author` (author pages, /author/<id>).
 */
const RESERVED_ARTICLE_SLUGS: ReadonlySet<string> = new Set(["grid", "author"]);

export function isReservedArticleSlug(slug: string): boolean {
  return RESERVED_ARTICLE_SLUGS.has(slug.toLowerCase());
}
```

```ts
// services/dashboard/src/lib/reserved-site-ids.ts
/**
 * Ids that look like site folders in R2/KV but belong to the platform: `authors` (author portraits at
 * /authors/assets/*) and `aggregator` (Grid's external stories). No site may be created or renamed to them.
 */
const RESERVED_SITE_IDS: ReadonlySet<string> = new Set(["authors", "aggregator"]);

export function isReservedSiteId(id: string): boolean {
  return RESERVED_SITE_IDS.has(id.toLowerCase());
}
```

In both `resolveUniqueSlug` functions (agent.ts and dedicated-agent.ts) change the loop condition to

```ts
  while (isReservedArticleSlug(candidate) || await slugExists(config, siteDomain, candidate, branch)) {
```

and add `import { isReservedArticleSlug } from "../../lib/reserved-slugs.js";` to each file.

In `wizard.ts` right after `const projectName = data.pagesProjectName;`:

```ts
  if (isReservedSiteId(projectName)) {
    throw new Error(`"${projectName}" is reserved by the platform — choose a different slug.`);
  }
```

with `import { isReservedSiteId } from "@/lib/reserved-site-ids";`.

In the rename route, after the `SLUG_RE` block:

```ts
  if (isReservedSiteId(newDomain)) {
    return NextResponse.json(
      { status: "error", message: `"${newDomain}" is reserved by the platform — choose a different slug` },
      { status: 400 },
    );
  }
```

with `import { isReservedSiteId } from "@/lib/reserved-site-ids";`.

- [ ] **Step 3: Tests + typechecks**

Run: `cd services/content-pipeline && npx vitest run src/__tests__/reserved-slugs.test.ts && pnpm typecheck` then `cd services/dashboard && npx vitest run src/lib/__tests__/reserved-site-ids.test.ts && pnpm typecheck`
Expected: PASS and typecheck exit 0 in both.

- [ ] **Step 4: Full suites**

Run: `cd services/content-pipeline && npx vitest run` and `cd services/dashboard && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit (after approval)**

```bash
git add services/content-pipeline/src/lib/reserved-slugs.ts services/content-pipeline/src/__tests__/reserved-slugs.test.ts services/content-pipeline/src/agents/content-generation/agent.ts services/content-pipeline/src/agents/content-generation/dedicated-agent.ts services/dashboard/src/lib/reserved-site-ids.ts services/dashboard/src/lib/__tests__/reserved-site-ids.test.ts services/dashboard/src/actions/wizard.ts services/dashboard/src/app/api/sites/rename/route.ts
git commit -m "feat: reserve the author slug and the authors site id"
```

---

### Task 7: Local end-to-end check (no shared state touched)

**Files:** none committed — results go to `docs/test-results/authors-stage2/README.md` (committed with the stage).

- [ ] **Step 1: Seed a modern site into local KV with two authors**

```bash
cd packages/site-worker
NET=$(mktemp -d)/net && git -C ../../../atomic-labs-network worktree add --detach "$NET" origin/staging/coffeeactually
# groups/overrides from main (see memory: staging checkouts have stale groups)
git -C ../../../atomic-labs-network show origin/main:org.yaml > "$NET/org.yaml"
python3 - "$NET/sites/coffeeactually/site.yaml" <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
s += "\nauthors:\n  - id: test-writer\n    topics: []\n  - id: no-profile\n    topics: []\n"
open(p,'w').write(s)
EOF
mkdir -p "$NET/authors"
AUTHOR=$(grep -m1 '^author:' "$NET/sites/coffeeactually/site.yaml" | sed 's/author: *//; s/"//g')
printf 'id: test-writer\nname: %s\ntagline: Coffee writer\nbio: Writes about coffee.\nbeats: [Coffee]\n' "$AUTHOR" > "$NET/authors/test-writer.yaml"
KV_REMOTE=false R2_REMOTE=false NETWORK_DATA_PATH="$NET" KV_NAMESPACE_ID=f6c35e1fa8c841b8b193509a3a237f7f pnpm seed:kv coffeeactually
NETWORK_DATA_PATH="$NET" pnpm seed:authors --local
pnpm dev:worker
```

(The test author uses the site's existing `author:` name so existing articles match by name.)

- [ ] **Step 2: Check the matrix** (in a second terminal; `S="http://localhost:8788"; Q="?_atl_site=coffeeactually"`)

| Check | Command | Expected |
|---|---|---|
| Author page | `curl -s -o /dev/null -w "%{http_code}" "$S/author/test-writer$Q"` | `200` |
| Assigned, no profile | `… "$S/author/no-profile$Q"` | `404` |
| Not assigned | `… "$S/author/ella-hughes$Q"` | `404` |
| JSON-LD | `curl -s "$S/author/test-writer$Q" \| grep -o '"@type":"ProfilePage"'` | match |
| noindex (≥3 articles → none) | `curl -s "$S/author/test-writer$Q" \| grep -c 'noindex'` | `0` if the author has ≥3 published articles, else `1` |
| Byline link | `curl -s "$S/<an article slug>$Q" \| grep -o 'href="/author/test-writer"'` | match |
| About box | `curl -s "$S/<an article slug>$Q" \| grep -c 'About the author'` | `1` |
| Article JSON-LD url | `curl -s "$S/<an article slug>$Q" \| grep -o '"url":"https://[^"]*/author/test-writer"'` | match |
| Load more | `curl -s "$S/api/author-articles?id=test-writer&page=2$Q" -o /dev/null -w "%{http_code}"` | `200` |
| Unchanged site | seed another site without `authors`, diff an article's HTML against the staging worker's | identical except build hashes |

Record each command's output in `docs/test-results/authors-stage2/README.md`, then remove the worktree (`git worktree remove "$NET"`). Ask Asaf to look at the author page and an article locally before any commit.

---

## Rollout (after Asaf's approval, in order)

1. Commit Tasks 1–7 on `asaf-dev`, push, PR → merge → `grid plug` (pipeline + dashboard reservations).
2. Deploy the worker: `pnpm deploy:staging`, check staging, then `pnpm deploy:production`. Safe before any author data exists: no site has `authors` yet.
3. Push `sync-authors.yml` to the network repo `main` (needs approval). It does nothing until `authors/` exists (Stage 3/4 create it).
