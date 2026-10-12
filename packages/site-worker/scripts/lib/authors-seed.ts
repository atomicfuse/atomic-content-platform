import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AuthorLinks, AuthorProfile } from '@atomic-platform/shared-types';
import { AUTHOR_ID_RE } from '../../src/lib/author-ids';
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

/**
 * `author:*` keys in KV whose author file is gone. A file that exists but is invalid keeps its key — the last
 * good profile stays live until the file is fixed (a bad edit must never unlink an author everywhere).
 */
export function staleAuthorKeys(existingKeys: string[], profiles: AuthorProfile[], invalidFiles: string[] = []): string[] {
  const keep = new Set([
    ...profiles.map((p) => authorKey(p.id)),
    ...invalidFiles.map((f) => authorKey(f.replace(/\.yaml$/, ''))),
  ]);
  return existingKeys.filter((k) => k.startsWith('author:') && !keep.has(k));
}
