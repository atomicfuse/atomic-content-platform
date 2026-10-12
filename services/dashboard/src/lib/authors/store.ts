import { NETWORK_REPO_NAME, NETWORK_REPO_OWNER } from "@/lib/constants";
import { commitNetworkFiles, deleteNetworkFile, listNetworkDirectory, readFileContent } from "@/lib/github";
import { authorIdFromName, parseAuthorYaml, serializeAuthor } from "./record";
import type { AuthorInput, AuthorRecord } from "./types";

/**
 * Author library in the network repo (main, authors/<id>.yaml) — read and written straight from git so local and
 * production dashboards always agree (no Mongo mirror; see the plan's storage ruling). Files are read with the
 * Contents API (never the 5-minute tree cache) so another dashboard's fresh write is seen. A 60 s in-memory list
 * cache keeps loads fast; writes update it in place, and a list that started before a write never replaces it.
 */
export const AUTHORS_DIR = "authors";
const CACHE_MS = 60_000;
const NETWORK = { owner: NETWORK_REPO_OWNER, name: NETWORK_REPO_NAME };
let cache: { at: number; authors: AuthorRecord[]; fileIds: string[] } | null = null;
let generation = 0;

export function _resetAuthorCache(): void {
  cache = null;
  generation++;
}

function pathOf(id: string): string {
  return `${AUTHORS_DIR}/${id}.yaml`;
}

function readFresh(path: string): Promise<string | null> {
  return readFileContent(path, "main", NETWORK);
}

const byName = (a: AuthorRecord, b: AuthorRecord): number => a.name.localeCompare(b.name);

async function load(): Promise<{ authors: AuthorRecord[]; fileIds: string[] }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  const startedAt = generation;
  const entries = (await listNetworkDirectory(AUTHORS_DIR, "main")).filter((e) => e.type === "file" && e.name.endsWith(".yaml"));
  const fileIds = entries.map((e) => e.name.replace(/\.yaml$/, ""));
  const authors = (await Promise.all(entries.map(async (e, i) => {
    const raw = await readFresh(e.path);
    const parsed = raw ? parseAuthorYaml(fileIds[i]!, raw) : null;
    if (!parsed) console.warn(`[authors] skipping unreadable ${e.path}`);
    return parsed;
  }))).filter((a): a is AuthorRecord => a !== null);
  authors.sort(byName);
  const fresh = { at: Date.now(), authors, fileIds };
  if (startedAt === generation) cache = fresh;
  return fresh;
}

export async function listAuthors(): Promise<AuthorRecord[]> {
  return (await load()).authors;
}

export async function readAuthor(id: string): Promise<AuthorRecord | null> {
  const raw = await readFresh(pathOf(id));
  return raw ? parseAuthorYaml(id, raw) : null;
}

/** Keep the cached list current after a write (no re-list), and make lists already in flight stale. */
function patchCache(id: string, record: AuthorRecord | null): void {
  generation++;
  if (!cache) return;
  const authors = cache.authors.filter((a) => a.id !== id);
  if (record) authors.push(record);
  authors.sort(byName);
  const fileIds = record ? [...new Set([...cache.fileIds, id])] : cache.fileIds.filter((f) => f !== id);
  cache = { ...cache, authors, fileIds };
}

async function write(a: AuthorRecord, verb: "add" | "update"): Promise<AuthorRecord> {
  await commitNetworkFiles([{ path: pathOf(a.id), content: serializeAuthor(a) }], `dashboard: ${verb} author ${a.id}`, "main");
  patchCache(a.id, a);
  return a;
}

export async function createAuthor(input: AuthorInput): Promise<AuthorRecord> {
  // Every file counts as taken, even one that doesn't parse; then confirm the chosen path is free on main right
  // now, since the listing can lag a write made by another dashboard.
  const taken = [...(await load()).fileIds];
  let id = authorIdFromName(input.name, taken);
  while ((await readFresh(pathOf(id))) !== null) {
    taken.push(id);
    id = authorIdFromName(input.name, taken);
  }
  const now = new Date().toISOString();
  return write({ ...input, id, created_at: now, updated_at: now }, "add");
}

export async function updateAuthor(id: string, input: AuthorInput): Promise<AuthorRecord> {
  const current = await readAuthor(id);
  if (!current) throw new Error(`author ${id} not found`);
  return write({ ...input, id, created_at: current.created_at, updated_at: new Date().toISOString() }, "update");
}

export async function deleteAuthor(id: string): Promise<void> {
  await deleteNetworkFile(pathOf(id), `dashboard: delete author ${id}`, "main");
  patchCache(id, null);
}
