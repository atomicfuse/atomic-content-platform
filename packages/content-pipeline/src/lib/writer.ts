import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createGitHubClient, commitFile, parseRepo } from "./github.js";
import type { GitHubConfig } from "./github.js";

export interface WriterConfig {
  localNetworkPath: string | undefined;
  github: GitHubConfig;
  branch?: string;
}

/**
 * When a branch is specified, ALWAYS use GitHub — the staging build
 * reads from the git branch, not from the local filesystem.
 * Local write mode is only used when no branch is given.
 */
function shouldWriteLocal(config: WriterConfig): boolean {
  return !!config.localNetworkPath && !config.branch;
}

/**
 * Write an article markdown file to local filesystem or GitHub.
 */
export async function writeArticle(
  config: WriterConfig,
  siteDomain: string,
  slug: string,
  content: string,
): Promise<void> {
  const filePath = `sites/${siteDomain}/articles/${slug}.md`;

  if (shouldWriteLocal(config)) {
    const fullPath = join(config.localNetworkPath!, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    console.log(`[writer] Wrote article locally: ${fullPath}`);
    return;
  }

  const octokit = createGitHubClient(config.github);
  await commitFile(octokit, config.github.repo, {
    path: filePath,
    content,
    message: `feat(content): add article ${slug} for ${siteDomain}`,
    branch: config.branch,
  });
  console.log(`[writer] Committed article to GitHub: ${filePath}${config.branch ? ` (branch: ${config.branch})` : ""}`);
}

/**
 * Write a binary asset (e.g. Gemini-generated image) to local filesystem or GitHub.
 */
export async function writeAsset(
  config: WriterConfig,
  siteDomain: string,
  assetPath: string,
  data: Buffer,
): Promise<void> {
  const filePath = `sites/${siteDomain}/${assetPath}`;

  if (shouldWriteLocal(config)) {
    const fullPath = join(config.localNetworkPath!, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return;
  }

  // Bypass commitFile: it re-encodes content via Buffer.from().toString("base64"),
  // which would double-encode an already-base64 buffer. Call Octokit directly.
  const octokit = createGitHubClient(config.github);
  const { owner, repo: repoName } = parseRepo(config.github.repo);

  let sha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({
      owner, repo: repoName, path: filePath,
      ...(config.branch ? { ref: config.branch } : {}),
    });
    if ("sha" in existing.data) sha = existing.data.sha;
  } catch { /* new file */ }

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo: repoName,
    path: filePath,
    message: `feat(assets): add generated image ${assetPath}`,
    content: data.toString("base64"),
    ...(sha ? { sha } : {}),
    ...(config.branch ? { branch: config.branch } : {}),
  });
}
