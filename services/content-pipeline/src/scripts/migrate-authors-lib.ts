import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SiteAuthor } from "../authors/bylines.js";

/** Pure planning for scripts/migrate-authors.ts (Stage 4, option A). */
export interface SiteState {
  site: string;
  /** The site's current site.yaml `authors:`. */
  authors: SiteAuthor[];
  /** Articles whose `author:` is a bad byline, on the staging branch or on main. */
  badArticles: Array<{ path: string; author: string; ref: "staging" | "main" }>;
}

export interface LibraryAuthor {
  id: string;
  name: string;
  exclusive_sites: string[];
}

export interface MigrationPlan {
  createAuthors: LibraryAuthor[];
  addExclusive: Array<{ id: string; sites: string[] }>;
  /** Authors made exclusive by the first bulk run (before "not exclusive unless chosen"): their reservation is cleared. */
  clearExclusive: string[];
  siteAuthors: Array<{ site: string; authors: SiteAuthor[] }>;
  recredit: Array<{ site: string; ref: "staging" | "main"; path: string; from: string; to: string; authorId: string }>;
  /** Sites with bad bylines but no authors yet: run "Give every site an author" first. */
  waiting: Array<{ site: string; articles: number }>;
}

/** Existing personas that become library authors, exclusive to their site (spec D7). */
export const PERSONAS: Array<{ name: string; site: string }> = [{ name: "Ella Hughes", site: "scoopella" }];

const BAD = /^(admin|administrator|editor|editorial team|staff|team|guest|anonymous)$/i;

export function isBadByline(name: string): boolean {
  const n = name.trim();
  return BAD.test(n) || /\bAI\b/.test(n);
}

export function slugFor(name: string, taken: Set<string>): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "author";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function planMigration(sites: SiteState[], library: LibraryAuthor[]): MigrationPlan {
  const plan: MigrationPlan = { createAuthors: [], addExclusive: [], clearExclusive: [], siteAuthors: [], recredit: [], waiting: [] };
  const personaNames = new Set(PERSONAS.map((p) => p.name.toLowerCase()));
  for (const a of library) {
    if (!personaNames.has(a.name.toLowerCase()) && a.exclusive_sites.length > 0) plan.clearExclusive.push(a.id);
  }
  const all = [...library];
  const taken = new Set(library.map((a) => a.id));
  const effective = new Map(sites.map((s) => [s.site, s.authors]));

  for (const p of PERSONAS) {
    let a = all.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (!a) {
      a = { id: slugFor(p.name, taken), name: p.name, exclusive_sites: [p.site] };
      taken.add(a.id);
      all.push(a);
      plan.createAuthors.push(a);
    } else if (!a.exclusive_sites.includes(p.site)) {
      plan.addExclusive.push({ id: a.id, sites: [p.site] });
    }
    const current = effective.get(p.site);
    if (current && !current.some((x) => x.id === a!.id)) {
      const next = [{ id: a.id, topics: [] }, ...current];
      effective.set(p.site, next);
      plan.siteAuthors.push({ site: p.site, authors: next });
    }
  }

  const nameOf = new Map(all.map((a) => [a.id, a.name]));
  for (const s of sites) {
    if (s.badArticles.length === 0) continue;
    const first = (effective.get(s.site) ?? []).find((x) => nameOf.has(x.id));
    if (!first) { plan.waiting.push({ site: s.site, articles: s.badArticles.length }); continue; }
    for (const art of s.badArticles) {
      plan.recredit.push({ site: s.site, ref: art.ref, path: art.path, from: art.author, to: nameOf.get(first.id)!, authorId: first.id });
    }
  }
  return plan;
}

const HEADER_RE = /^---\n([\s\S]*?)\n---\n/;

/** The `author:` of the article header (never a line in the body); null without a header. */
export function headerAuthor(raw: string): string | null {
  const m = HEADER_RE.exec(raw.replace(/\r\n/g, "\n"));
  const line = m?.[1]!.split("\n").find((l) => /^author:/.test(l));
  return line ? line.replace(/^author:\s*/, "").replace(/^["']|["']$/g, "").trim() : null;
}

/** Only the header's `author:` line changes (and `author_id:` is set right after it); the body is never touched. */
export function recreditFrontmatter(raw: string, name: string, id: string): string {
  const text = raw.replace(/\r\n/g, "\n");
  const m = HEADER_RE.exec(text);
  if (!m) return text;
  const lines = m[1]!.split("\n").filter((l) => !/^author_id:/.test(l));
  const i = lines.findIndex((l) => /^author:/.test(l));
  if (i < 0) return text;
  lines.splice(i, 1, `author: ${name}`, `author_id: ${id}`);
  return `---\n${lines.join("\n")}\n---\n${text.slice(m[0].length)}`;
}

/** A new library author file: name and exclusivity; "Generate missing profiles" fills the rest. */
export function authorFileYaml(a: LibraryAuthor, now: string): string {
  return stringifyYaml({
    id: a.id, name: a.name, tagline: "", bio: "", beats: [], verticals: [], links: {}, exclusive_sites: a.exclusive_sites,
    created_at: now, updated_at: now,
  }, { lineWidth: 0 });
}

/** Site ids deleted in dashboard-index.yaml (its `deleted:` list, or status Deleted); their staging branches remain. */
export function deletedSiteIds(indexYaml: string): Set<string> {
  let doc: { sites?: Array<{ domain?: unknown; status?: unknown }>; deleted?: Array<{ domain?: unknown }> };
  try { doc = (parseYaml(indexYaml) ?? {}) as typeof doc; } catch { return new Set(); }
  const ids = new Set<string>();
  for (const s of doc.deleted ?? []) if (typeof s?.domain === "string") ids.add(s.domain);
  for (const s of doc.sites ?? []) if (typeof s?.domain === "string" && String(s.status ?? "").toLowerCase() === "deleted") ids.add(s.domain);
  return ids;
}
