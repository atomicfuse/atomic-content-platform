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
