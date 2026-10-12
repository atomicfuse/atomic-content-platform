/**
 * "Give every site an author", two sites per author (Asaf, 2026-10-12): who writes for which sites. Pure; the run
 * (useAssignAllRun) carries the steps out and re-checks each site before saving.
 */

export interface PlanSite {
  domain: string;
  vertical?: string;
}

export interface PlanAuthor {
  id: string;
  name: string;
  /** Sites the author already writes for. */
  sites: string[];
  /** Sites the author is reserved for: an author created but never assigned still names the site it was made for. */
  exclusive_sites: string[];
}

export type PlanStep =
  | { kind: "join"; site: string; authorId: string; authorName: string }
  | { kind: "new"; sites: string[] };

/** Sites kept out of the bulk run because they already have a persona (added by the authors migration). */
export const RESERVED_SITES: Record<string, string> = { scoopella: "Ella Hughes" };

const key = (v: string | undefined): string => (v ?? "").trim().toLowerCase();

/**
 * 1. Authors with room (fewer than `perAuthor` sites) first take the site they were made for if it still has no
 *    author, then sites from their own category, so no existing author is wasted.
 * 2. The remaining sites are paired within their category, in the order given; an odd one out gets its own author.
 */
export function planSiteAuthors(
  candidates: PlanSite[],
  authors: PlanAuthor[],
  verticalOf: Record<string, string | undefined>,
  perAuthor = 2,
): PlanStep[] {
  const open = candidates.map((s) => s.domain);
  const take = (domain: string): boolean => {
    const i = open.indexOf(domain);
    if (i < 0) return false;
    open.splice(i, 1);
    return true;
  };
  const steps: PlanStep[] = [];
  const candidateVertical = new Map(candidates.map((s) => [s.domain, key(s.vertical ?? verticalOf[s.domain])]));

  for (const a of authors) {
    let room = perAuthor - a.sites.length;
    if (room <= 0) continue;
    for (const own of a.exclusive_sites) {
      if (room > 0 && !a.sites.includes(own) && take(own)) {
        steps.push({ kind: "join", site: own, authorId: a.id, authorName: a.name });
        room--;
      }
    }
    const home = a.sites[0] ?? a.exclusive_sites[0];
    const vertical = home ? key(verticalOf[home]) : "";
    if (!vertical) continue;
    for (const domain of [...open]) {
      if (room <= 0) break;
      if (candidateVertical.get(domain) === vertical && take(domain)) {
        steps.push({ kind: "join", site: domain, authorId: a.id, authorName: a.name });
        room--;
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const domain of open) {
    const v = candidateVertical.get(domain) ?? "";
    groups.set(v, [...(groups.get(v) ?? []), domain]);
  }
  for (const domains of groups.values()) {
    for (let i = 0; i < domains.length; i += perAuthor) steps.push({ kind: "new", sites: domains.slice(i, i + perAuthor) });
  }
  return steps;
}
