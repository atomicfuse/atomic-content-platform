import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createGitHubClient, commitFile, commitBatch } from "./github.js";
import { uploadToR2 } from "./r2-upload.js";
import type { GitHubConfig, BatchFileEntry } from "./github.js";

export type { BatchFileEntry };

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
 * Write a binary asset to local filesystem or R2.
 * Local mode writes to disk; GitHub mode uploads directly to R2.
 */
export async function writeAsset(
  config: WriterConfig,
  siteDomain: string,
  assetPath: string,
  data: Buffer,
): Promise<void> {
  if (shouldWriteLocal(config)) {
    const fullPath = join(config.localNetworkPath!, `sites/${siteDomain}/${assetPath}`);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return;
  }

  const r2Key = `${siteDomain}/${assetPath}`;
  await uploadToR2(r2Key, data);
}

// ---------------------------------------------------------------------------
// Batch write — articles to Git, images to R2
// ---------------------------------------------------------------------------

export interface PendingArticle {
  siteDomain: string;
  slug: string;
  content: string;
}

export interface PendingAsset {
  siteDomain: string;
  assetPath: string;
  data: Buffer;
}

/**
 * Write multiple articles in a single git commit, uploading any assets
 * directly to R2 (not Git). Falls back to individual file writes in
 * local mode.
 *
 * `extraFiles` allows including additional text files (e.g. dedup-index.json)
 * in the same atomic commit.
 */
export async function writeArticleBatch(
  config: WriterConfig,
  articles: PendingArticle[],
  assets: PendingAsset[],
  commitMessage: string,
  extraFiles?: BatchFileEntry[],
): Promise<void> {
  if (articles.length === 0 && assets.length === 0 && (!extraFiles || extraFiles.length === 0)) return;

  // Local mode: write each file individually (no git commit needed)
  if (shouldWriteLocal(config)) {
    for (const a of articles) {
      const filePath = join(config.localNetworkPath!, `sites/${a.siteDomain}/articles/${a.slug}.md`);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, a.content, "utf-8");
      console.log(`[writer] Wrote article locally: ${filePath}`);
    }
    for (const asset of assets) {
      const filePath = join(config.localNetworkPath!, `sites/${asset.siteDomain}/${asset.assetPath}`);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, asset.data);
    }
    for (const ef of extraFiles ?? []) {
      const filePath = join(config.localNetworkPath!, ef.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, ef.content, "utf-8");
    }
    return;
  }

  // GitHub mode: upload images to R2 directly, commit only text to Git
  // Upload assets to R2 first (best-effort — failure doesn't block article commit)
  for (const asset of assets) {
    const r2Key = `${asset.siteDomain}/${asset.assetPath}`;
    await uploadToR2(r2Key, asset.data);
  }

  const textFiles: BatchFileEntry[] = [
    ...articles.map((a) => ({
      path: `sites/${a.siteDomain}/articles/${a.slug}.md`,
      content: a.content,
    })),
    ...(extraFiles ?? []),
  ];

  // No binary files in Git commit — images are in R2
  const octokit = createGitHubClient(config.github);
  await commitBatch(
    octokit,
    config.github.repo,
    textFiles,
    [],
    commitMessage,
    config.branch,
  );

  const slugs = articles.map((a) => a.slug).join(", ");
  console.log(
    `[writer] Batch committed ${articles.length} article(s) to GitHub: ${slugs}` +
    `${config.branch ? ` (branch: ${config.branch})` : ""}`,
  );
}
