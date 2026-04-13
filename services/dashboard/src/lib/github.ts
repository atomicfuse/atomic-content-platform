import { Octokit } from "@octokit/rest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  DashboardIndex,
  DashboardSiteEntry,
  DeletedSiteEntry,
  ArticleEntry,
  ActivityEvent,
} from "@/types/dashboard";
import {
  NETWORK_REPO_OWNER,
  NETWORK_REPO_NAME,
  DASHBOARD_INDEX_PATH,
} from "@/lib/constants";

function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  return new Octokit({ auth: token });
}

/** Read and parse dashboard-index.yaml from the network repo. */
export async function readDashboardIndex(): Promise<DashboardIndex> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getContent({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      path: DASHBOARD_INDEX_PATH,
    });
    if ("content" in data && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      const parsed = parseYaml(content) as DashboardIndex | null;
      if (!parsed) return { sites: [], deleted: [] };
      // Backfill new fields for entries written before pages_project/zone_id existed
      parsed.sites = parsed.sites.map((s) => ({
        ...s,
        pages_project: (s as Partial<DashboardSiteEntry>).pages_project ?? null,
        zone_id: (s as Partial<DashboardSiteEntry>).zone_id ?? null,
        staging_branch: (s as Partial<DashboardSiteEntry>).staging_branch ?? null,
        preview_url: (s as Partial<DashboardSiteEntry>).preview_url ?? null,
        saved_previews: (s as Partial<DashboardSiteEntry>).saved_previews ?? null,
        custom_domain: (s as Partial<DashboardSiteEntry>).custom_domain ?? null,
      }));
      parsed.deleted = parsed.deleted ?? [];
      return parsed;
    }
    return { sites: [], deleted: [] };
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return { sites: [], deleted: [] };
    }
    throw error;
  }
}

/** Write dashboard-index.yaml to the network repo. */
export async function writeDashboardIndex(
  index: DashboardIndex,
  message: string
): Promise<void> {
  const octokit = getOctokit();
  const yamlContent = stringifyYaml(index, { lineWidth: 0 });

  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      path: DASHBOARD_INDEX_PATH,
    });
    if ("sha" in data) {
      sha = data.sha;
    }
  } catch (error: unknown) {
    if (!isNotFoundError(error)) throw error;
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path: DASHBOARD_INDEX_PATH,
    message,
    content: Buffer.from(yamlContent).toString("base64"),
    sha,
  });
}

/** Update a single site entry in the dashboard index. */
export async function updateSiteInIndex(
  domain: string,
  updates: Partial<DashboardSiteEntry>
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  const siteIndex = index.sites.findIndex((s) => s.domain === domain);
  if (siteIndex === -1) {
    throw new Error(`Site ${domain} not found in dashboard index`);
  }
  index.sites[siteIndex] = {
    ...index.sites[siteIndex]!,
    ...updates,
    last_updated: new Date().toISOString(),
  };
  await writeDashboardIndex(index, `dashboard: update ${domain}`);
  return index;
}

/** Move a site from the active list to the deleted (trash) list. */
export async function removeSiteFromIndex(
  domain: string
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  const siteIndex = index.sites.findIndex((s) => s.domain === domain);
  if (siteIndex === -1) {
    throw new Error(`Site ${domain} not found in dashboard index`);
  }
  const [removed] = index.sites.splice(siteIndex, 1);
  const deletedEntry: DeletedSiteEntry = {
    ...removed!,
    deleted_at: new Date().toISOString(),
  };
  index.deleted = index.deleted ?? [];
  index.deleted.push(deletedEntry);
  await writeDashboardIndex(index, `dashboard: move ${domain} to trash`);
  return index;
}

/** Restore a site from trash back to the active list. Re-detects status based on Git state. */
export async function restoreSiteInIndex(
  domain: string
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  index.deleted = index.deleted ?? [];
  const trashIndex = index.deleted.findIndex((s) => s.domain === domain);
  if (trashIndex === -1) {
    throw new Error(`Site ${domain} not found in trash`);
  }
  const [restored] = index.deleted.splice(trashIndex, 1);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deleted_at, ...siteEntry } = restored!;

  // Re-detect status: check if site.yaml still exists in Git
  const siteConfig = await readSiteConfig(domain);
  let newStatus = siteEntry.status;
  if (!siteConfig) {
    // No site.yaml → site files were deleted, reset to New
    newStatus = "New";
  }

  index.sites.push({
    ...siteEntry,
    status: newStatus,
    last_updated: new Date().toISOString(),
  });
  await writeDashboardIndex(index, `dashboard: restore ${domain} from trash`);
  return index;
}

/** Permanently remove a site from trash (does NOT delete Git files). */
export async function permanentlyRemoveFromTrash(
  domain: string
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  index.deleted = index.deleted ?? [];
  const before = index.deleted.length;
  index.deleted = index.deleted.filter((s) => s.domain !== domain);
  if (index.deleted.length === before) {
    throw new Error(`Site ${domain} not found in trash`);
  }
  await writeDashboardIndex(index, `dashboard: permanently remove ${domain}`);
  return index;
}

/** Delete site files (site.yaml, skill.md, articles, assets) from the Git repo. */
export async function deleteSiteFilesFromRepo(domain: string): Promise<void> {
  const octokit = getOctokit();
  const basePath = `sites/${domain}`;

  // List all files under sites/{domain}/
  let files: Array<{ path: string; sha: string }> = [];
  try {
    const { data } = await octokit.repos.getContent({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      path: basePath,
    });
    if (Array.isArray(data)) {
      // Collect top-level files
      for (const item of data) {
        if (item.type === "file") {
          files.push({ path: item.path, sha: item.sha });
        } else if (item.type === "dir") {
          // Recurse one level into subdirs (articles/, assets/)
          try {
            const { data: subData } = await octokit.repos.getContent({
              owner: NETWORK_REPO_OWNER,
              repo: NETWORK_REPO_NAME,
              path: item.path,
            });
            if (Array.isArray(subData)) {
              for (const subItem of subData) {
                if (subItem.type === "file") {
                  files.push({ path: subItem.path, sha: subItem.sha });
                }
              }
            }
          } catch {
            // Skip subdirs that fail
          }
        }
      }
    }
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return; // No files to delete
    }
    throw error;
  }

  if (files.length === 0) return;

  // Use Git Data API to delete all files in a single commit
  const branch = "main";
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;

  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: latestCommitSha,
  });

  // Create tree entries that delete each file (sha: null)
  const treeItems = files.map((f) => ({
    path: f.path,
    mode: "100644" as const,
    type: "blob" as const,
    sha: null as unknown as string, // null sha = delete file
  }));

  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: commit.tree.sha,
    tree: treeItems,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message: `site(${domain}): delete all site files`,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

/** Delete a single file from a specific branch using the Git Data API. */
export async function deleteFileFromBranch(
  filePath: string,
  branch: string
): Promise<void> {
  const octokit = getOctokit();

  // Get the latest commit on the branch
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;

  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: latestCommitSha,
  });

  // Create a tree that deletes the file (sha: null)
  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: commit.tree.sha,
    tree: [
      {
        path: filePath,
        mode: "100644" as const,
        type: "blob" as const,
        sha: null as unknown as string,
      },
    ],
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message: `delete ${filePath}`,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

/** Delete multiple files from a branch in a single atomic commit. */
export async function deleteFilesFromBranch(
  filePaths: string[],
  branch: string
): Promise<void> {
  const octokit = getOctokit();

  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;

  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: latestCommitSha,
  });

  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: commit.tree.sha,
    tree: filePaths.map((path) => ({
      path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: null as unknown as string,
    })),
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message: `delete ${filePaths.length} files`,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

/** Add multiple new sites to the dashboard index. */
export async function addSitesToIndex(
  entries: DashboardSiteEntry[]
): Promise<DashboardIndex> {
  const index = await readDashboardIndex();
  const existingDomains = new Set(index.sites.map((s) => s.domain));
  const newEntries = entries.filter((e) => !existingDomains.has(e.domain));
  index.sites.push(...newEntries);
  if (newEntries.length > 0) {
    await writeDashboardIndex(
      index,
      `dashboard: sync ${newEntries.length} domains from Cloudflare`
    );
  }
  return index;
}

/** Read raw file content from the network repo (or a specified repo). */
export async function readFileContent(
  path: string,
  branch?: string,
  repo?: { owner: string; name: string },
): Promise<string | null> {
  const octokit = getOctokit();
  const repoOwner = repo?.owner ?? NETWORK_REPO_OWNER;
  const repoName = repo?.name ?? NETWORK_REPO_NAME;
  try {
    const { data } = await octokit.repos.getContent({
      owner: repoOwner,
      repo: repoName,
      path,
      ...(branch ? { ref: branch } : {}),
    });
    if ("content" in data && data.content) {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Read a site's config YAML from the network repo. */
export async function readSiteConfig(
  domain: string,
  branch?: string
): Promise<Record<string, unknown> | null> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getContent({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      path: `sites/${domain}/site.yaml`,
      ...(branch ? { ref: branch } : {}),
    });
    if ("content" in data && data.content) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return parseYaml(content) as Record<string, unknown>;
    }
    return null;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** List articles for a site from the network repo. */
export async function readArticles(domain: string, branch?: string): Promise<ArticleEntry[]> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.repos.getContent({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      path: `sites/${domain}/articles`,
      ...(branch ? { ref: branch } : {}),
    });
    if (!Array.isArray(data)) return [];

    const articles: ArticleEntry[] = [];
    for (const file of data) {
      if (!file.name.endsWith(".md") || file.name === ".gitkeep") continue;
      try {
        const { data: fileData } = await octokit.repos.getContent({
          owner: NETWORK_REPO_OWNER,
          repo: NETWORK_REPO_NAME,
          path: file.path,
          ...(branch ? { ref: branch } : {}),
        });
        if ("content" in fileData && fileData.content) {
          const content = Buffer.from(fileData.content, "base64").toString("utf-8");
          const frontmatter = extractFrontmatter(content);
          articles.push({
            slug: file.name.replace(".md", ""),
            title: (frontmatter.title as string) ?? file.name,
            type: (frontmatter.type as string) ?? "standard",
            status: (frontmatter.status as string) ?? "draft",
            publishDate: (frontmatter.publishDate as string) ?? "",
            score: (frontmatter.quality_score as number) ?? (frontmatter.score as number | undefined),
            scoreBreakdown: frontmatter.score_breakdown as ArticleEntry["scoreBreakdown"],
            qualityNote: frontmatter.quality_note as string | undefined,
            reviewerNotes: frontmatter.reviewer_notes as string | undefined,
          });
        }
      } catch {
        // Skip files that fail to read
      }
    }
    return articles;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

/** Commit multiple files atomically using the Git Data API. */
export async function commitSiteFiles(
  domain: string,
  files: Array<{ path: string; content: string | Buffer }>,
  message: string,
  branch: string = "main"
): Promise<void> {
  const octokit = getOctokit();

  // Get the latest commit SHA
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;

  // Get the tree SHA of the latest commit
  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: latestCommitSha,
  });
  const baseTreeSha = commit.tree.sha;

  // Create blobs for each file
  const treeItems = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner: NETWORK_REPO_OWNER,
        repo: NETWORK_REPO_NAME,
        content: Buffer.isBuffer(file.content)
          ? file.content.toString("base64")
          : Buffer.from(file.content).toString("base64"),
        encoding: "base64",
      });
      return {
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    })
  );

  // Create a new tree
  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // Create a new commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message: `site(${domain}): ${message}`,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  // Update the branch reference
  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

/**
 * Trigger a workflow run by pushing a build-trigger file via the Contents API.
 *
 * Git Data API commits (createTree → createCommit → updateRef) do NOT trigger
 * GitHub Actions. The Contents API (createOrUpdateFileContents) DOES. So after
 * committing site files, we push a small trigger file to fire the workflow.
 */
export async function triggerWorkflowViaPush(
  branch: string,
  siteFolder: string
): Promise<void> {
  const octokit = getOctokit();
  const triggerPath = `sites/${siteFolder}/.build-trigger`;

  // Check if the trigger file already exists (to get its SHA for update)
  let existingSha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      path: triggerPath,
      ref: branch,
    });
    if ("sha" in data) {
      existingSha = data.sha;
    }
  } catch {
    // File doesn't exist yet — that's fine
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path: triggerPath,
    message: `ci: trigger staging build for ${siteFolder}`,
    content: Buffer.from(new Date().toISOString()).toString("base64"),
    sha: existingSha,
    branch,
  });
}

/** Create a new branch from an existing branch. */
export async function createBranch(
  branchName: string,
  fromBranch: string = "main"
): Promise<void> {
  const octokit = getOctokit();
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${fromBranch}`,
  });
  await octokit.git.createRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `refs/heads/${branchName}`,
    sha: ref.object.sha,
  });
}

/** Merge a branch into main. */
export async function mergeBranchToMain(
  branchName: string,
  commitMessage: string
): Promise<string> {
  const octokit = getOctokit();
  const { data } = await octokit.repos.merge({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base: "main",
    head: branchName,
    commit_message: commitMessage,
  });
  return data.sha;
}

/** Delete a branch from the network repo. */
export async function deleteBranch(branchName: string): Promise<void> {
  const octokit = getOctokit();
  await octokit.git.deleteRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branchName}`,
  });
}

/**
 * List all sites that currently have a `staging/{site}` branch.
 *
 * The staging branches are the source of truth for "which sites exist in the
 * dashboard" — `sites/{site}/` on main only appears after publish-to-prod, so
 * we can't rely on the main tree for site enumeration.
 */
export async function listStagingSites(): Promise<string[]> {
  const octokit = getOctokit();
  const { data } = await octokit.git.listMatchingRefs({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: "heads/staging/",
  });
  return data
    .map((r) => r.ref.replace(/^refs\/heads\/staging\//, ""))
    .filter((s) => s.length > 0);
}

/** Check if a branch exists in the network repo. */
export async function branchExists(branchName: string): Promise<boolean> {
  const octokit = getOctokit();
  try {
    await octokit.git.getRef({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      ref: `heads/${branchName}`,
    });
    return true;
  } catch {
    return false;
  }
}

/** Fetch recent activity from git commit history. */
export async function fetchRecentActivity(
  limit: number = 10
): Promise<ActivityEvent[]> {
  const octokit = getOctokit();
  const { data: commits } = await octokit.repos.listCommits({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    per_page: limit,
  });

  return commits.map((commit) => {
    const msg = commit.commit.message;
    const timestamp = commit.commit.committer?.date ?? commit.commit.author?.date ?? "";
    const type = inferActivityType(msg);
    const domain = extractDomainFromCommit(msg);

    return {
      id: commit.sha.slice(0, 8),
      type,
      description: msg.split("\n")[0] ?? msg,
      timestamp,
      domain: domain ?? undefined,
    };
  });
}

/** Count articles published this week across all sites. */
export async function countArticlesThisWeek(): Promise<number> {
  const octokit = getOctokit();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since = weekAgo.toISOString();

  const { data: commits } = await octokit.repos.listCommits({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    since,
    per_page: 100,
  });

  // Count commits that look like article publishes
  return commits.filter(
    (c) =>
      c.commit.message.includes("article") ||
      c.commit.message.includes("publish")
  ).length;
}

/** Count failed builds from GitHub Actions. */
export async function countFailedBuilds(): Promise<number> {
  const octokit = getOctokit();
  try {
    const { data } = await octokit.actions.listWorkflowRunsForRepo({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      status: "failure",
      per_page: 10,
      created: `>=${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}`,
    });
    return data.total_count;
  } catch {
    return 0;
  }
}

// --- Generic network repo operations ---

/** Commit multiple files to the network repo atomically (generic, no domain prefix). */
export async function commitNetworkFiles(
  files: Array<{ path: string; content: string | Buffer }>,
  message: string,
  branch: string = "main"
): Promise<void> {
  const octokit = getOctokit();
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;
  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: latestCommitSha,
  });
  const treeItems = await Promise.all(
    files.map(async (file) => {
      const { data: blob } = await octokit.git.createBlob({
        owner: NETWORK_REPO_OWNER,
        repo: NETWORK_REPO_NAME,
        content: Buffer.isBuffer(file.content)
          ? file.content.toString("base64")
          : Buffer.from(file.content).toString("base64"),
        encoding: "base64",
      });
      return {
        path: file.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha: blob.sha,
      };
    })
  );
  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: commit.tree.sha,
    tree: treeItems,
  });
  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });
  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

/** List contents of a directory in the network repo (or a specified repo). */
export async function listNetworkDirectory(
  path: string,
  branch?: string,
  repo?: { owner: string; name: string },
): Promise<Array<{ name: string; type: string; path: string }>> {
  const octokit = getOctokit();
  const repoOwner = repo?.owner ?? NETWORK_REPO_OWNER;
  const repoName = repo?.name ?? NETWORK_REPO_NAME;
  try {
    const { data } = await octokit.repos.getContent({
      owner: repoOwner,
      repo: repoName,
      path,
      ...(branch ? { ref: branch } : {}),
    });
    if (!Array.isArray(data)) return [];
    return data.map((item) => ({
      name: item.name,
      type: item.type,
      path: item.path,
    }));
  } catch (error: unknown) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

/** Delete a single file from the network repo with a commit message. */
export async function deleteNetworkFile(
  filePath: string,
  message: string,
  branch: string = "main"
): Promise<void> {
  const octokit = getOctokit();
  const { data: ref } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = ref.object.sha;
  const { data: commit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: latestCommitSha,
  });
  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: commit.tree.sha,
    tree: [{
      path: filePath,
      mode: "100644" as const,
      type: "blob" as const,
      sha: null as unknown as string,
    }],
  });
  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });
  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });
}

// --- Helpers ---

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 404
  );
}

function extractFrontmatter(
  markdown: string
): Record<string, unknown> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return {};
  try {
    return parseYaml(match[1]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function inferActivityType(
  message: string
): ActivityEvent["type"] {
  const lower = message.toLowerCase();
  if (lower.includes("publish") || lower.includes("article")) return "article_published";
  if (lower.includes("flag") || lower.includes("review")) return "article_flagged";
  if (lower.includes("create site") || lower.includes("site(")) return "site_created";
  if (lower.includes("monetiz") || lower.includes("ads")) return "monetization_activated";
  if (lower.includes("fail") || lower.includes("error")) return "build_failed";
  return "article_published";
}

function extractDomainFromCommit(message: string): string | null {
  // Match patterns like "site(coolnews.dev):" or "domain.com"
  const siteMatch = message.match(/site\(([^)]+)\)/);
  if (siteMatch?.[1]) return siteMatch[1];
  const domainMatch = message.match(/([a-z0-9-]+\.[a-z]{2,})/i);
  return domainMatch?.[1] ?? null;
}
