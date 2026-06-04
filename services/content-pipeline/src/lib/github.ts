/**
 * GitHub API wrapper for reading/writing network repo data.
 *
 * All agent operations on network repos (reading site briefs, committing
 * articles, reading templates) go through this module.
 */

import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { recordApiCall, recordCacheHit } from "./github-stats.js";

export interface GitHubConfig {
  token: string;
  repo: string; // "owner/repo" format
}

export interface FileCommit {
  path: string;
  content: string;
  message: string;
  branch?: string;
}

const ResilientOctokit = Octokit.plugin(retry, throttling);

/**
 * Unified Octokit factory with automatic retry on 5xx/network errors
 * and rate-limit throttling. All GitHub API calls should go through this.
 */
export function createOctokit(configOrToken: GitHubConfig | string): Octokit {
  const token = typeof configOrToken === "string" ? configOrToken : configOrToken.token;
  return new ResilientOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: Record<string, unknown>, _octo: unknown, retryCount: number): boolean => {
        console.warn(`[github] Rate limit hit for ${String(options.method)} ${String(options.url)} — retry #${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter: number, options: Record<string, unknown>, _octo: unknown, retryCount: number): boolean => {
        console.warn(`[github] Secondary rate limit for ${String(options.method)} ${String(options.url)} — retry #${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 1;
      },
    },
  });
}

/** @deprecated Use {@link createOctokit} instead. Will be removed once all callers are migrated. */
export const createGitHubClient = (config: GitHubConfig): Octokit => createOctokit(config);

/** @deprecated Use {@link createOctokit} instead. Will be removed once all callers are migrated. */
export const createResilientOctokit = (token: string): Octokit => createOctokit(token);

export function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo".`);
  }
  return { owner, repo: name };
}

export class TreeTruncatedError extends Error {
  constructor(ref: string) {
    super(`Tree truncated for ref: ${ref}`);
    this.name = "TreeTruncatedError";
  }
}

type TreeEntry = {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
};

/** Tree cache entry. Carries a timestamp so we can expire stale trees written
 *  by external processes (notably: the dashboard committing site.yaml edits
 *  while content-pipeline keeps running with its old tree in memory).
 *  Blob content is content-addressed by SHA so it can't go stale — only the
 *  branch→tree mapping can. */
interface TreeCacheEntry {
  tree: TreeEntry[];
  filledAt: number;
}

/** Max age before a cached branch tree is refetched. 30s is long enough to
 *  dedupe back-to-back reads inside a single generation run (which spans
 *  seconds), but short enough that a dashboard-side migration is picked up
 *  by the next manual Generate click within at most ~30s — no more restart-
 *  every-time. See landmine note in CLAUDE.md. */
const TREE_CACHE_TTL_MS = 30_000;

const treeCache = new Map<string, TreeCacheEntry>();
const blobCache = new Map<string, string>();
const BLOB_CACHE_MAX = 200;

export async function getTreeCached(
  octokit: Octokit,
  repo: string,
  branch?: string,
): Promise<TreeEntry[]> {
  const ref = branch ?? "main";
  const cacheKey = `${repo}:${ref}`;
  const cached = treeCache.get(cacheKey);
  if (cached && Date.now() - cached.filledAt < TREE_CACHE_TTL_MS) {
    recordCacheHit("tree");
    return cached.tree;
  }
  // Stale entry — drop it so a write between this check and the refetch
  // doesn't accidentally serve old data on a parallel read.
  if (cached) treeCache.delete(cacheKey);

  const { owner, repo: repoName } = parseRepo(repo);
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${ref}`,
  });
  recordApiCall("getRef");
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo: repoName,
    tree_sha: refData.object.sha,
    recursive: "true",
  });
  recordApiCall("getTree");

  if (tree.truncated) {
    console.warn(`[github] Tree for ${ref} is truncated — falling back to per-directory fetches`);
    throw new TreeTruncatedError(ref);
  }

  treeCache.set(cacheKey, { tree: tree.tree, filledAt: Date.now() });
  return tree.tree;
}

export function clearTreeCache(branch?: string): void {
  if (branch) {
    for (const key of treeCache.keys()) {
      if (key.endsWith(`:${branch}`)) {
        treeCache.delete(key);
      }
    }
  } else {
    treeCache.clear();
  }
}

export function clearBlobCache(): void {
  blobCache.clear();
}

async function listFilesNonRecursive(
  octokit: Octokit,
  repo: string,
  dirPath: string,
  branch?: string,
): Promise<TreeEntry[]> {
  const { owner, repo: repoName } = parseRepo(repo);
  const ref = branch ?? "main";
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${ref}`,
  });
  let treeSha = (
    await octokit.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: refData.object.sha,
    })
  ).data.tree.sha;

  for (const segment of dirPath.split("/").filter(Boolean)) {
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo: repoName,
      tree_sha: treeSha,
    });
    const entry = tree.tree.find(
      (e) => e.path === segment && e.type === "tree",
    );
    if (!entry?.sha) throw new Error(`Directory not found: ${dirPath}`);
    treeSha = entry.sha;
  }

  const { data: dirTree } = await octokit.git.getTree({
    owner,
    repo: repoName,
    tree_sha: treeSha,
  });
  return dirTree.tree;
}

/** Resolve the blob SHA for a repo path on a branch, with a fallback for
 *  truncated trees. */
async function resolveBlobSha(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string> {
  let entry: TreeEntry | undefined;
  try {
    const tree = await getTreeCached(octokit, repo, branch);
    entry = tree.find((f) => f.path === path && f.type === "blob");
  } catch (err) {
    if (err instanceof TreeTruncatedError) {
      const dirPath = path.split("/").slice(0, -1).join("/");
      const fileName = path.split("/").pop()!;
      const entries = await listFilesNonRecursive(octokit, repo, dirPath, branch);
      entry = entries.find((e) => e.path === fileName && e.type === "blob");
    } else {
      throw err;
    }
  }

  if (!entry?.sha) throw new Error(`Expected file at ${path}, got nothing`);
  return entry.sha;
}

/** Fetch a blob's content as normalized base64 (no line breaks), cached by
 *  SHA. This is the binary-safe primitive: text callers decode it as UTF-8;
 *  callers committing binary assets pass it straight through as base64. */
async function fetchBlobBase64(
  octokit: Octokit,
  owner: string,
  repoName: string,
  sha: string,
): Promise<string> {
  const cached = blobCache.get(sha);
  if (cached !== undefined) {
    recordCacheHit("blob");
    return cached;
  }

  const { data } = await octokit.git.getBlob({ owner, repo: repoName, file_sha: sha });
  recordApiCall("getBlob");
  const base64 = data.content.replace(/\n/g, "");

  if (blobCache.size >= BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value!;
    blobCache.delete(oldest);
  }
  blobCache.set(sha, base64);

  return base64;
}

/**
 * Read a text file from the network repo (decoded as UTF-8).
 * Do NOT use for binary assets (images, fonts) — UTF-8 decoding corrupts
 * the bytes. Use readFileBase64 for those.
 */
export async function readFile(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string> {
  const { owner, repo: repoName } = parseRepo(repo);
  const sha = await resolveBlobSha(octokit, repo, path, branch);
  const base64 = await fetchBlobBase64(octokit, owner, repoName, sha);
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Read a binary file from the network repo as base64 — preserves exact bytes.
 * Required when copying binary assets (logos, favicons, images) between
 * branches: reading them via readFile (UTF-8) mangles the bytes, which is what
 * corrupted every site logo during scheduler auto-publish.
 */
export async function readFileBase64(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string> {
  const { owner, repo: repoName } = parseRepo(repo);
  const sha = await resolveBlobSha(octokit, repo, path, branch);
  return fetchBlobBase64(octokit, owner, repoName, sha);
}

/**
 * Commit a file to the network repo.
 */
export async function commitFile(
  octokit: Octokit,
  repo: string,
  commit: FileCommit,
): Promise<string> {
  return commitBatch(
    octokit,
    repo,
    [{ path: commit.path, content: commit.content }],
    [],
    commit.message,
    commit.branch,
  );
}

// ---------------------------------------------------------------------------
// Batch commit — creates ONE commit with multiple file changes via the Git
// Trees API so that Cloudflare Pages (or any CI) only triggers one build.
// ---------------------------------------------------------------------------

export interface BatchFileEntry {
  /** Repo-relative path, e.g. "sites/example.com/articles/my-slug.md" */
  path: string;
  /** UTF-8 content (text files) */
  content: string;
}

export interface BatchBinaryEntry {
  path: string;
  /** base64-encoded binary content */
  base64: string;
}

/**
 * Commit multiple files in a single Git commit using the low-level
 * Git Data API (trees + commits + ref update).
 */
export async function commitBatch(
  octokit: Octokit,
  repo: string,
  files: BatchFileEntry[],
  binaryFiles: BatchBinaryEntry[],
  message: string,
  branch?: string,
): Promise<string> {
  if (files.length === 0 && binaryFiles.length === 0) {
    throw new Error("commitBatch: nothing to commit");
  }

  const { owner, repo: repoName } = parseRepo(repo);
  const ref = `heads/${branch ?? "main"}`;

  // 1. Get the current commit SHA for the branch
  const { data: refData } = await octokit.git.getRef({ owner, repo: repoName, ref });
  recordApiCall("getRef");
  const baseSha = refData.object.sha;

  // 2. Get the tree SHA of that commit
  const { data: commitData } = await octokit.git.getCommit({ owner, repo: repoName, commit_sha: baseSha });
  recordApiCall("getCommit");
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for binary files (text files can be inlined)
  const blobShas: Map<string, string> = new Map();
  for (const bf of binaryFiles) {
    const { data: blob } = await octokit.git.createBlob({
      owner, repo: repoName,
      content: bf.base64,
      encoding: "base64",
    });
    blobShas.set(bf.path, blob.sha);
  }

  // 4. Build the tree entries
  const treeEntries: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    content?: string;
    sha?: string;
  }> = [];

  for (const f of files) {
    treeEntries.push({ path: f.path, mode: "100644", type: "blob", content: f.content });
  }
  for (const bf of binaryFiles) {
    treeEntries.push({ path: bf.path, mode: "100644", type: "blob", sha: blobShas.get(bf.path) });
  }

  // 5. Create new tree
  const { data: newTree } = await octokit.git.createTree({
    owner, repo: repoName,
    base_tree: baseTreeSha,
    tree: treeEntries,
  });
  recordApiCall("createTree");

  // 6. Create commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner, repo: repoName,
    message,
    tree: newTree.sha,
    parents: [baseSha],
  });
  recordApiCall("createCommit");

  // 7. Update branch ref
  await octokit.git.updateRef({
    owner, repo: repoName,
    ref,
    sha: newCommit.sha,
  });
  recordApiCall("updateRef");

  clearTreeCache(branch ?? "main");

  console.log(`[github] Batch commit ${newCommit.sha.slice(0, 7)}: ${files.length} text + ${binaryFiles.length} binary files`);
  return newCommit.sha;
}

/**
 * List files in a directory of the network repo.
 */
export async function listFiles(
  octokit: Octokit,
  repo: string,
  dirPath: string,
  branch?: string,
): Promise<string[]> {
  try {
    const tree = await getTreeCached(octokit, repo, branch);
    const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
    return tree
      .filter(
        (f) =>
          f.path?.startsWith(prefix) &&
          f.type === "blob" &&
          !f.path.slice(prefix.length).includes("/"),
      )
      .map((f) => f.path!.split("/").pop()!);
  } catch (err) {
    if (err instanceof TreeTruncatedError) {
      const entries = await listFilesNonRecursive(octokit, repo, dirPath, branch);
      return entries
        .filter((e) => e.type === "blob")
        .map((e) => e.path!)
        .filter(Boolean);
    }
    throw err;
  }
}

/**
 * List all files under a directory path recursively (using the tree cache).
 * Returns full paths relative to repo root.
 */
export async function listFilesRecursive(
  octokit: Octokit,
  repo: string,
  dirPath: string,
  branch?: string,
): Promise<string[]> {
  const tree = await getTreeCached(octokit, repo, branch);
  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  return tree
    .filter((f) => f.path?.startsWith(prefix) && f.type === "blob")
    .map((f) => f.path!);
}
