import { AUTHOR_ID_RE } from "./record";
import type { AuthorFit, AuthorRecord, SiteAuthor } from "./types";

/**
 * Who fits a site (for the Add author list), exclusive conflicts, and how a site's topics are split among its
 * authors. Shared by the site save route and the Authors section. Deterministic (no AI ranker): Best-fit
 * verticals plus shared topic words decide the fit.
 */
export interface SiteFitContext {
  site: string;
  vertical?: string;
  topics: string[];
}

export interface RankedAuthor {
  author: AuthorRecord;
  fit: AuthorFit;
  /** Exclusive to other sites: may be assigned by hand only, after a confirm. */
  exclusiveElsewhere: boolean;
}

const FILLER = new Set(["and", "the", "for", "with", "news", "tips", "guide", "guides", "best", "your", "from", "about", "more", "all", "new"]);

function words(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    for (const raw of t.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || FILLER.has(raw)) continue;
      out.add(raw.length > 4 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
    }
  }
  return out;
}

export function fitOf(a: Pick<AuthorRecord, "beats" | "verticals" | "tagline">, ctx: SiteFitContext): AuthorFit {
  const vertical = ctx.vertical?.trim().toLowerCase();
  const verticalHit = !!vertical && (a.verticals ?? []).some((v) => v.toLowerCase() === vertical);
  const topicWords = words(ctx.topics);
  const shared = [...words([...a.beats, a.tagline])].some((w) => topicWords.has(w));
  if (verticalHit && shared) return "strong";
  return verticalHit || shared ? "close" : "none";
}

const FIT_ORDER: Record<AuthorFit, number> = { strong: 0, close: 1, none: 2 };

export function rankForSite(authors: AuthorRecord[], ctx: SiteFitContext, assigned: string[]): RankedAuthor[] {
  const taken = new Set(assigned);
  return authors
    .filter((a) => !taken.has(a.id))
    .map((author) => ({
      author,
      fit: fitOf(author, ctx),
      exclusiveElsewhere: author.exclusive_sites.length > 0 && !author.exclusive_sites.includes(ctx.site),
    }))
    .sort((x, y) => FIT_ORDER[x.fit] - FIT_ORDER[y.fit] || Number(x.exclusiveElsewhere) - Number(y.exclusiveElsewhere) || x.author.name.localeCompare(y.author.name));
}

function shuffled<T>(list: T[], rng: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * D3: topics an author already has stay with them (spelled as the site spells them; topics the site dropped are
 * removed). Authors with no topics are generalists who share every topic; only when there are none does each topic
 * nobody chose go to one author, round-robin over a shuffled order. Saved, so stable.
 */
export function distributeTopics(assignments: SiteAuthor[], siteTopics: string[], rng: () => number = Math.random): SiteAuthor[] {
  if (assignments.length === 0) return [];
  const known = new Map(siteTopics.map((t) => [t.toLowerCase(), t]));
  const out = assignments.map((a) => ({
    id: a.id,
    topics: siteTopics.length === 0
      ? [...a.topics]
      : [...new Set(a.topics.map((t) => known.get(t.toLowerCase())).filter((t): t is string => !!t))],
  }));
  // A generalist (an author with no topics) already covers every topic nobody chose: nothing to split.
  if (out.some((a) => a.topics.length === 0)) return out;
  const taken = new Set(out.flatMap((a) => a.topics.map((t) => t.toLowerCase())));
  const free = siteTopics.filter((t) => !taken.has(t.toLowerCase()));
  const order = shuffled(out.map((_, i) => i), rng);
  free.forEach((t, i) => out[order[i % order.length]!]!.topics.push(t));
  return out;
}

export function exclusiveConflicts(assignments: SiteAuthor[], authors: AuthorRecord[], site: string): AuthorRecord[] {
  const byId = new Map(authors.map((a) => [a.id, a]));
  return assignments
    .map((s) => byId.get(s.id))
    .filter((a): a is AuthorRecord => !!a && a.exclusive_sites.length > 0 && !a.exclusive_sites.includes(site));
}

export function normalizeSiteAuthors(raw: unknown): SiteAuthor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SiteAuthor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, topics } = entry as { id?: unknown; topics?: unknown };
    if (typeof id !== "string" || !AUTHOR_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const clean = Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
    const unique = new Map<string, string>();
    for (const t of clean) if (!unique.has(t.toLowerCase())) unique.set(t.toLowerCase(), t);
    out.push({ id, topics: [...unique.values()] });
  }
  return out;
}

export function siteTopicsOf(config: Record<string, unknown> | null | undefined): string[] {
  const brief = (config?.brief ?? {}) as { topics_v2?: unknown; topics?: unknown };
  if (Array.isArray(brief.topics_v2) && brief.topics_v2.length > 0) {
    return brief.topics_v2.map((t) => (t && typeof t === "object" ? (t as { name?: unknown }).name : null)).filter((n): n is string => typeof n === "string" && !!n.trim());
  }
  return Array.isArray(brief.topics) ? brief.topics.filter((t): t is string => typeof t === "string" && !!t.trim()) : [];
}

/** Who the site is written for (brief audiences, else the older single audience), as one line for the AI. */
export function siteAudienceOf(config: Record<string, unknown> | null | undefined): string | undefined {
  const brief = (config?.brief ?? {}) as { audiences?: unknown; audience?: unknown };
  const list = Array.isArray(brief.audiences) ? brief.audiences.filter((a): a is string => typeof a === "string").map((a) => a.trim()).filter(Boolean) : [];
  if (list.length > 0) return list.join(", ");
  return typeof brief.audience === "string" && brief.audience.trim() ? brief.audience.trim() : undefined;
}
