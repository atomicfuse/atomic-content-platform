import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { AuthorInput, AuthorRecord } from "./types";

export const AUTHOR_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LINK_KEYS = ["website", "x", "instagram", "linkedin"] as const;

const isHttp = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
};
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);
const validPortraitPath = (p: unknown): p is string => typeof p === "string" && p.startsWith("/authors/assets/") && !p.includes("..");

export function parseAuthorYaml(id: string, raw: string): AuthorRecord | null {
  let doc: unknown;
  try { doc = parseYaml(raw); } catch { return null; }
  if (!doc || typeof doc !== "object") return null;
  const d = doc as Record<string, unknown>;
  if (d.id !== id || !AUTHOR_ID_RE.test(id) || typeof d.name !== "string" || !d.name.trim()) return null;
  const p = d.portrait as Record<string, unknown> | undefined;
  const links: AuthorRecord["links"] = {};
  const rawLinks = (d.links && typeof d.links === "object" ? d.links : {}) as Record<string, unknown>;
  for (const k of LINK_KEYS) if (isHttp(rawLinks[k])) links[k] = rawLinks[k] as string;
  return {
    id,
    name: d.name.trim(),
    tagline: typeof d.tagline === "string" ? d.tagline.trim() : "",
    bio: typeof d.bio === "string" ? d.bio.trim() : "",
    beats: strList(d.beats),
    verticals: strList(d.verticals),
    portrait: p && validPortraitPath(p.path) ? { kind: p.kind === "uploaded" ? "uploaded" : "generated", path: p.path } : null,
    links,
    exclusive_sites: strList(d.exclusive_sites),
    created_at: typeof d.created_at === "string" ? d.created_at : "",
    updated_at: typeof d.updated_at === "string" ? d.updated_at : "",
  };
}

export function serializeAuthor(a: AuthorRecord): string {
  const doc: Record<string, unknown> = {
    id: a.id, name: a.name, tagline: a.tagline, bio: a.bio, beats: a.beats, verticals: a.verticals,
    ...(a.portrait ? { portrait: a.portrait } : {}),
    links: a.links, exclusive_sites: a.exclusive_sites,
    created_at: a.created_at, updated_at: a.updated_at,
  };
  return stringifyYaml(doc, { lineWidth: 0 });
}

export function authorIdFromName(name: string, taken: Iterable<string>): string {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "author";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function isIncomplete(a: Pick<AuthorRecord, "bio" | "portrait">): boolean {
  return !a.bio.trim() || !a.portrait;
}

export function validateAuthorInput(input: unknown): { ok: true; value: AuthorInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "author is required" };
  const i = input as Record<string, unknown>;
  const name = typeof i.name === "string" ? i.name.trim() : "";
  if (name.length < 2 || name.length > 60) return { ok: false, error: "Name must be 2–60 characters" };
  const tagline = typeof i.tagline === "string" ? i.tagline.trim() : "";
  if (tagline.length > 80) return { ok: false, error: "Tagline must be 80 characters or fewer" };
  const bio = typeof i.bio === "string" ? i.bio.trim() : "";
  if (bio.length > 1500) return { ok: false, error: "Bio is too long" };
  const beats = strList(i.beats);
  if (beats.length > 8) return { ok: false, error: "At most 8 beats" };
  const verticals = strList(i.verticals);
  if (verticals.length > 3) return { ok: false, error: "At most 3 best-fit categories" };
  const links: AuthorInput["links"] = {};
  const rawLinks = (i.links && typeof i.links === "object" ? i.links : {}) as Record<string, unknown>;
  for (const k of LINK_KEYS) {
    const v = rawLinks[k];
    if (v === undefined || v === null || v === "") continue;
    if (!isHttp(v)) return { ok: false, error: `${k} must be an http(s) link` };
    links[k] = v;
  }
  const p = i.portrait as Record<string, unknown> | null | undefined;
  if (p && !validPortraitPath(p.path)) return { ok: false, error: "Portrait must be an /authors/assets/ image" };
  return {
    ok: true,
    value: {
      name, tagline, bio, beats, verticals, links,
      portrait: p ? { kind: p.kind === "uploaded" ? "uploaded" : "generated", path: p.path as string } : null,
      exclusive_sites: strList(i.exclusive_sites),
    },
  };
}
