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

describe('a broken author file never deletes the live profile', () => {
  it('keys of invalid files are kept (last good profile stays) while removed authors are pruned', () => {
    const { profile } = parseAuthorFile('ella-hughes.yaml', ELLA);
    expect(staleAuthorKeys(['author:ella-hughes', 'author:ben-foster', 'author:gone'], [profile!], ['ben-foster.yaml'])).toEqual(['author:gone']);
  });
});

