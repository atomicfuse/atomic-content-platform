export interface AuthorPortrait {
  kind: "generated" | "uploaded";
  /** Site-relative R2 path: /authors/assets/<id>-<hash>.webp */
  path: string;
}

export interface AuthorLinks {
  website?: string;
  x?: string;
  instagram?: string;
  linkedin?: string;
}

/** Network repo authors/<id>.yaml — the source of truth (spec "Author record"). */
export interface AuthorRecord {
  id: string;
  name: string;
  tagline: string;
  bio: string;
  beats: string[];
  /** Best-fit site categories (dashboard-index verticals), 0–3. Dashboard-only. */
  verticals: string[];
  portrait: AuthorPortrait | null;
  links: AuthorLinks;
  exclusive_sites: string[];
  created_at: string;
  updated_at: string;
}

/** What the editor sends to save (id/timestamps are the server's). */
export type AuthorInput = Omit<AuthorRecord, "id" | "created_at" | "updated_at">;

export interface ConnectedSite {
  site: string;
  topics: string[];
}

/** One library card. */
export interface AuthorListItem extends AuthorRecord {
  sites: ConnectedSite[];
}

export type AuthorPart = "name" | "tagline" | "bio" | "beats" | "verticals" | "portrait";

/** How a generated portrait looks. Chosen when generating; not stored on the author. */
export type PortraitStyle = "realistic" | "illustrated";

/** One author on a site (`site.yaml` `authors:`), with the topics they write. */
export interface SiteAuthor {
  id: string;
  topics: string[];
}

/** How well a library author suits a site. */
export type AuthorFit = "strong" | "close" | "none";
