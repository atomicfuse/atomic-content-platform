import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createGitHubClient, commitFile } from "./github.js";
import type { GitHubConfig } from "./github.js";

export interface WriterConfig {
  localNetworkPath: string | undefined;
  github: GitHubConfig;
}

/**
 * Write an article markdown file to local filesystem or GitHub.
 * LOCAL_NETWORK_PATH takes priority over GitHub if both are configured.
 */
export async function writeArticle(
  config: WriterConfig,
  siteDomain: string,
  slug: string,
  content: string,
): Promise<void> {
  const filePath = `sites/${siteDomain}/articles/${slug}.md`;

  if (config.localNetworkPath) {
    const fullPath = join(config.localNetworkPath, filePath);
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
  });
  console.log(`[writer] Committed article to GitHub: ${filePath}`);
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

  if (config.localNetworkPath) {
    const fullPath = join(config.localNetworkPath, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return;
  }

  const octokit = createGitHubClient(config.github);
  await commitFile(octokit, config.github.repo, {
    path: filePath,
    content: data.toString("base64"),
    message: `feat(assets): add generated image ${assetPath}`,
  });
}
