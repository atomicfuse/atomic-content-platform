import { listAuthors, readAuthor, updateAuthor } from "./store";
import { distributeTopics, exclusiveConflicts, normalizeSiteAuthors } from "./assignment";
import type { AuthorInput, AuthorRecord, SiteAuthor } from "./types";

export type ApplyResult =
  | { ok: true; authors: SiteAuthor[] }
  | { ok: false; status: 400 | 409; error: string; code?: "has-authors"; exclusive?: Array<{ id: string; name: string; sites: string[] }> };

interface Deps {
  listAuthors(): Promise<AuthorRecord[]>;
  readAuthor(id: string): Promise<AuthorRecord | null>;
  updateAuthor(id: string, input: AuthorInput): Promise<AuthorRecord>;
}

const inputOf = ({ id: _i, created_at: _c, updated_at: _u, ...rest }: AuthorRecord): AuthorInput => rest;

/**
 * Server side of saving a site's authors: every id must be in the library; an author exclusive to other sites is
 * only accepted when the user confirmed it (D2), and this site is then added to their exclusive list; unassigned
 * topics are split among the authors (D3). Nothing is written when it refuses.
 */
export async function applySiteAuthors(
  site: string,
  raw: unknown,
  siteTopics: string[],
  confirmedExclusive: string[],
  deps: Deps = { listAuthors, readAuthor, updateAuthor },
  rng: () => number = Math.random,
): Promise<ApplyResult> {
  const wanted = normalizeSiteAuthors(raw);
  if (wanted.length === 0) return { ok: true, authors: [] };
  const library = await deps.listAuthors();
  const known = new Set(library.map((a) => a.id));
  const unknown = wanted.filter((w) => !known.has(w.id)).map((w) => w.id);
  if (unknown.length > 0) return { ok: false, status: 400, error: `Unknown author: ${unknown.join(", ")}` };
  const conflicts = exclusiveConflicts(wanted, library, site);
  const unconfirmed = conflicts.filter((a) => !confirmedExclusive.includes(a.id));
  if (unconfirmed.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `${unconfirmed.map((a) => a.name).join(", ")} ${unconfirmed.length === 1 ? "is" : "are"} exclusive to other sites. Confirm to assign.`,
      exclusive: unconfirmed.map((a) => ({ id: a.id, name: a.name, sites: a.exclusive_sites })),
    };
  }
  for (const cached of conflicts) {
    // Re-read: the list may be up to a minute old, and another dashboard may have edited the profile since.
    const a = (await deps.readAuthor(cached.id)) ?? cached;
    if (!a.exclusive_sites.includes(site)) await deps.updateAuthor(a.id, { ...inputOf(a), exclusive_sites: [...a.exclusive_sites, site] });
  }
  return { ok: true, authors: distributeTopics(wanted, siteTopics, rng) };
}

/**
 * "Give every site an author" must never replace authors a site already has. Its check reads the site list (Mongo),
 * which can lag git, so the save repeats it against the site.yaml being written.
 */
export function refuseIfHasAuthors(existingAuthors: unknown, onlyIfEmpty: boolean): ApplyResult | null {
  if (!onlyIfEmpty || normalizeSiteAuthors(existingAuthors).length === 0) return null;
  return { ok: false, status: 409, code: "has-authors", error: "This site already has authors" };
}
