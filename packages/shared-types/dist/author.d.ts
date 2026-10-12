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
//# sourceMappingURL=author.d.ts.map