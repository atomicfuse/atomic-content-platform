import { parse as parseYaml } from "yaml";
import { getMongoDb } from "../lib/mongo.js";
import { COLLECTIONS } from "../stats/types.js";

/**
 * Which library author a new article is credited to. The author whose topics include the article's topic, else
 * the next in the site's rotation (Mongo site_stats.authorRotation); authors whose profile can't be read are
 * skipped. A site without `authors` keeps its legacy `author:` name.
 */
export interface SiteAuthor {
  id: string;
  topics: string[];
}

export interface Byline {
  name: string;
  /** Set only when the name comes from a library author assigned to the site. */
  authorId?: string;
}

export type BylineResolver = (topic?: string) => Promise<Byline>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSiteAuthors(raw: unknown): SiteAuthor[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SiteAuthor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { id, topics } = entry as { id?: unknown; topics?: unknown };
    if (typeof id !== "string" || !ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, topics: Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim()) : [] });
  }
  return out;
}

/**
 * Every author once, in the order to try. The pool for a topic is the authors who chose it plus the generalists
 * (authors with no topics, who share every topic), rotated by `turn`; the other specialists follow as a fallback.
 * No topic, or nobody to cover it: everyone takes turns.
 */
export function pickArticleAuthor(siteAuthors: SiteAuthor[], topic: string | undefined, turn: number): SiteAuthor[] {
  if (siteAuthors.length === 0) return [];
  const t = topic?.trim().toLowerCase();
  const owners = t ? siteAuthors.filter((a) => a.topics.length === 0 || a.topics.some((x) => x.toLowerCase() === t)) : [];
  const rest = siteAuthors.filter((a) => !owners.includes(a));
  const rotate = (list: SiteAuthor[]): SiteAuthor[] => {
    if (list.length === 0) return list;
    const start = ((turn % list.length) + list.length) % list.length;
    return [...list.slice(start), ...list.slice(0, start)];
  };
  return [...rotate(owners), ...rotate(rest)];
}

export function authorNameFromYaml(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const doc = parseYaml(raw) as { name?: unknown } | null;
    return doc && typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : null;
  } catch {
    return null;
  }
}

/** Atomic per-site counter; each call returns the turn to use and advances it. */
export async function nextAuthorTurn(siteDomain: string): Promise<number> {
  const db = await getMongoDb();
  const before = await db.collection<{ _id: string; authorRotation?: { nextIndex?: number } }>(COLLECTIONS.siteStats).findOneAndUpdate(
    { _id: siteDomain },
    { $inc: { "authorRotation.nextIndex": 1 }, $set: { "authorRotation.updatedAt": new Date() } },
    { upsert: true, returnDocument: "before" },
  );
  return before?.authorRotation?.nextIndex ?? 0;
}

export function createBylineResolver(deps: {
  siteDomain: string;
  siteAuthors: SiteAuthor[];
  legacyAuthor?: string;
  readAuthorFile(id: string): Promise<string | null>;
  nextTurn?(siteDomain: string): Promise<number>;
}): BylineResolver {
  const names = new Map<string, Promise<string | null>>();
  const fallback: Byline = { name: deps.legacyAuthor?.trim() || "Editorial Team" };
  // A missing or broken file is remembered for the run; a read error (GitHub blip) is not, so the next article retries.
  const nameOf = (id: string): Promise<string | null> => {
    if (!names.has(id)) {
      names.set(id, deps.readAuthorFile(id).then(authorNameFromYaml, () => { names.delete(id); return null; }));
    }
    return names.get(id)!;
  };
  return async (topic?: string): Promise<Byline> => {
    if (deps.siteAuthors.length === 0) return fallback;
    // One author: no rotation needed (saves a Mongo round trip per article).
    const turn = deps.siteAuthors.length === 1
      ? 0
      : await (deps.nextTurn ?? nextAuthorTurn)(deps.siteDomain).catch(() => Math.floor(Math.random() * 1000));
    for (const candidate of pickArticleAuthor(deps.siteAuthors, topic, turn)) {
      const name = await nameOf(candidate.id);
      if (name) return { name, authorId: candidate.id };
      console.warn(`[bylines] ${deps.siteDomain}: author ${candidate.id} has no readable profile; skipping`);
    }
    return fallback;
  };
}
