/**
 * GitHub API wrapper for reading/writing network repo data.
 *
 * All agent operations on network repos (reading site briefs, committing
 * articles, reading templates) go through this module.
 */

import { Octokit } from "@octokit/rest";

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

export function createGitHubClient(config: GitHubConfig): Octokit {
  return new Octokit({ auth: config.token });
}

export function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo".`);
  }
  return { owner, repo: name };
}

/**
 * Read a file from the network repo.
 */
export async function readFile(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string> {
  const { owner, repo: repoName } = parseRepo(repo);
  const response = await octokit.repos.getContent({
    owner,
    repo: repoName,
    path,
    ...(branch ? { ref: branch } : {}),
  });

  if ("content" in response.data) {
    return Buffer.from(response.data.content, "base64").toString("utf-8");
  }

  throw new Error(`Expected file at ${path}, got directory`);
}

/**
 * Commit a file to the network repo.
 */
export async function commitFile(
  octokit: Octokit,
  repo: string,
  commit: FileCommit,
): Promise<string> {
  const { owner, repo: repoName } = parseRepo(repo);

  // Check if file exists (to get SHA for update)
  let sha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({
      owner,
      repo: repoName,
      path: commit.path,
      ...(commit.branch ? { ref: commit.branch } : {}),
    });
    if ("sha" in existing.data) {
      sha = existing.data.sha;
    }
  } catch {
    // File doesn't exist — creating new
  }

  const response = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo: repoName,
    path: commit.path,
    message: commit.message,
    content: Buffer.from(commit.content).toString("base64"),
    ...(sha ? { sha } : {}),
    ...(commit.branch ? { branch: commit.branch } : {}),
  });

  return response.data.commit.sha ?? "";
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
  const baseSha = refData.object.sha;

  // 2. Get the tree SHA of that commit
  const { data: commitData } = await octokit.git.getCommit({ owner, repo: repoName, commit_sha: baseSha });
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

  // 6. Create commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner, repo: repoName,
    message,
    tree: newTree.sha,
    parents: [baseSha],
  });

  // 7. Update branch ref
  await octokit.git.updateRef({
    owner, repo: repoName,
    ref,
    sha: newCommit.sha,
  });

  console.log(`[github] Batch commit ${newCommit.sha.slice(0, 7)}: ${files.length} text + ${binaryFiles.length} binary files`);
  return newCommit.sha;
}

/**
 * List files in a directory of the network repo.
 */
export async function listFiles(
  octokit: Octokit,
  repo: string,
  path: string,
  branch?: string,
): Promise<string[]> {
  const { owner, repo: repoName } = parseRepo(repo);
  const response = await octokit.repos.getContent({
    owner,
    repo: repoName,
    path,
    ...(branch ? { ref: branch } : {}),
  });

  if (Array.isArray(response.data)) {
    return response.data.map((f) => f.name);
  }

  throw new Error(`Expected directory at ${path}, got file`);
}
