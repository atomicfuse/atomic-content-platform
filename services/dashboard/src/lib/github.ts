import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type {
  DashboardIndex,
  DashboardSiteEntry,
  DeletedSiteEntry,
  HistoryEntry,
  ArticleEntry,
  ActivityEvent,
} from "@/types/dashboard";
import {
  NETWORK_REPO_OWNER,
  NETWORK_REPO_NAME,
  DASHBOARD_INDEX_PATH,
} from "@/lib/constants";

const RetryOctokit = Octokit.plugin(retry, throttling);

// ---------------------------------------------------------------------------
// Concurrency limiter — caps parallel async work (replaces unbounded
// Promise.allSettled on getBlob calls that trigger GitHub abuse detection).
// ---------------------------------------------------------------------------
function createLimiter(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            if (queue.length > 0) queue.shift()!();
          });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

/** Shared limiter for GitHub blob fetches — prevents secondary rate limits. */
const blobLimit = createLimiter(5);

// ---------------------------------------------------------------------------
// Octokit singleton
// ---------------------------------------------------------------------------
let _octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (_octokit) return _octokit;
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  _octokit = new RetryOctokit({
    auth: token,
    request: { timeout: 30_000 },
    retry: { retries: 3 },
    throttle: {
      onRateLimit: (retryAfter: number, options: Record<string, unknown>, _octo: unknown, retryCount: number): boolean => {
        console.warn(`[octokit] Rate limit hit for ${String(options.url)} — retry ${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter: number, options: Record<string, unknown>, _octo: unknown, retryCount: number): boolean => {
        console.warn(`[octokit] Secondary rate limit for ${String(options.url)} — retry ${retryCount + 1} after ${retryAfter}s`);
        return retryCount < 1;
      },
    },
  });
  return _octokit;
}

// ---------------------------------------------------------------------------
// Tree cache — single recursive tree fetch, shared across read helpers
// ---------------------------------------------------------------------------
interface TreeEntry {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
}

const TREE_CACHE_TTL = Infinity;
const treeCacheStore = new Map<string, { tree: TreeEntry[]; expiresAt: number }>();

async function getTreeCached(branch?: string): Promise<TreeEntry[]> {
  const ref = branch ?? "main";
  const cached = treeCacheStore.get(ref);
  if (cached && Date.now() < cached.expiresAt) return cached.tree;

  const octokit = getOctokit();
  const { data: refData } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${ref}`,
  });
  const { data: tree } = await octokit.git.getTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    tree_sha: refData.object.sha,
    recursive: "true",
  });

  if (tree.truncated) {
    console.warn(`[github] Tree for ${ref} is truncated`);
    throw new Error(`Tree truncated for ${ref}`);
  }

  treeCacheStore.set(ref, { tree: tree.tree, expiresAt: Date.now() + TREE_CACHE_TTL });
  return tree.tree;
}

export function invalidateTreeCache(branch?: string): void {
  if (branch) {
    treeCacheStore.delete(branch);
  } else {
    treeCacheStore.clear();
  }
}

/** Read and parse dashboard-index.yaml from the network repo.
 *  Pass `fresh: true` to bypass the tree cache and fetch directly via the
 *  Contents API. Use before uniqueness checks or after mutations where the
 *  tree cache may still hold a stale SHA.
 *
 *  NOTE: This function is the Git-read fallback for the DB helper
 *  (`db/dashboard-index.ts`). In normal operation, reads go through MongoDB.
 */
export async function readDashboardIndex(
  opts?: { fresh?: boolean },
): Promise<DashboardIndex> {
  const octokit = getOctokit();
  try {
    let content: string;

    if (opts?.fresh) {
      // Direct Content API fetch — bypasses tree cache entirely.
      const { data } = await octokit.repos.getContent({
        owner: NETWORK_REPO_OWNER,
        repo: NETWORK_REPO_NAME,
        path: DASHBOARD_INDEX_PATH,
        ref: "main",
      });
      if (Array.isArray(data) || !("content" in data)) {
        return { sites: [], deleted: [] };
      }
      content = Buffer.from(data.content, "base64").toString("utf-8");
    } else {
      // Standard path: tree + blob
      const tree = await getTreeCached();
      const entry = tree.find((f) => f.path === DASHBOARD_INDEX_PATH && f.type === "blob");
      if (!entry?.sha) {
        return { sites: [], deleted: [] };
      }
      const { data: blobData } = await octokit.git.getBlob({
        owner: NETWORK_REPO_OWNER,
        repo: NETWORK_REPO_NAME,
        file_sha: entry.sha,
      });
      content = Buffer.from(blobData.content, "base64").toString("utf-8");
    }
    const parsed = parseYaml(content) as DashboardIndex | null;
    if (!parsed) return { sites: [], deleted: [] };
    // Backfill new fields for entries written before pages_project/zone_id existed
    parsed.sites = parsed.sites.map((s) => {
      const partial = s as Partial<DashboardSiteEntry>;
      let pagesSubdomain = partial.pages_subdomain ?? null;
      if (!pagesSubdomain && partial.preview_url) {
        const m = partial.preview_url.match(/\.([^.]+)\.pages\.dev/);
        if (m) pagesSubdomain = m[1]!;
      }
      return {
        ...s,
        pages_project: partial.pages_project ?? null,
        pages_subdomain: pagesSubdomain,
        zone_id: partial.zone_id ?? null,
        staging_branch: partial.staging_branch ?? null,
        preview_url: partial.preview_url ?? null,
        saved_previews: partial.saved_previews ?? null,
        custom_domain: partial.custom_domain ?? null,
      };
    });
    parsed.deleted = parsed.deleted ?? [];
    return parsed;
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
    const tree = await getTreeCached();
    const entry = tree.find((f) => f.path === DASHBOARD_INDEX_PATH && f.type === "blob");
    sha = entry?.sha;
  } catch {
    // File doesn't exist yet
  }

  await octokit.repos.createOrUpdateFileContents({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path: DASHBOARD_INDEX_PATH,
    message,
    content: Buffer.from(yamlContent).toString("base64"),
    sha,
  });

  // Invalidate tree cache AFTER the write succeeds so subsequent reads
  // pick up the new SHA.
  invalidateTreeCache();
}

/** Update a single site entry in the dashboard index.
 *  Retries automatically on SHA conflicts (409/422) caused by concurrent
 *  writes to dashboard-index.yaml — e.g. rapid inline company edits. */
export async function updateSiteInIndex(
  domain: string,
  updates: Partial<DashboardSiteEntry>
): Promise<DashboardIndex> {
  const MAX_RETRIES = 4;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const index = await readDashboardIndex({ fresh: true });
    const siteIndex = index.sites.findIndex((s) => s.domain === domain);
    if (siteIndex === -1) {
      throw new Error(`Site ${domain} not found in dashboard index`);
    }
    index.sites[siteIndex] = {
      ...index.sites[siteIndex]!,
      ...updates,
      last_updated: new Date().toISOString(),
    };
    try {
      await writeDashboardIndex(index, `dashboard: update ${domain}`);
      return index;
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if ((status === 409 || status === 422) && attempt < MAX_RETRIES) {
        // SHA conflict — another write landed first. Retry with fresh data.
        const delay = 200 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  // Unreachable, but satisfies TS return type.
  throw new Error(`Failed to update ${domain} after ${MAX_RETRIES} retries`);
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

  // Re-detect status: check if site.yaml exists on staging branch first
  // (soft delete preserves staging but removes main), then fall back to main.
  const stagingBranch = siteEntry.staging_branch ?? `staging/${domain}`;
  const stagingConfig = await readSiteConfig(domain, stagingBranch);
  let newStatus = siteEntry.status;
  if (stagingConfig) {
    // Staging branch has config — site is restorable
    newStatus = "Staging";
  } else {
    // Check main as fallback
    const mainConfig = await readSiteConfig(domain);
    if (!mainConfig) {
      newStatus = "New";
    }
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
  const trashIndex = index.deleted.findIndex((s) => s.domain === domain);
  if (trashIndex === -1) {
    throw new Error(`Site ${domain} not found in trash`);
  }
  const [removed] = index.deleted.splice(trashIndex, 1);

  // Record in history for audit trail
  index.history = index.history ?? [];
  const historyEntry: HistoryEntry = {
    domain: removed!.domain,
    custom_domain: removed!.custom_domain,
    company: removed!.company,
    vertical: removed!.vertical,
    permanently_deleted_at: new Date().toISOString(),
  };
  index.history.push(historyEntry);

  await writeDashboardIndex(index, `dashboard: permanently delete ${domain}`);
  return index;
}

/** Delete site files (site.yaml, articles, assets) AND shared-page override
 *  files (overrides/<domain>/) from the Git repo in a single atomic commit.
 *  No-op if neither directory exists. */
export async function deleteSiteFilesFromRepo(domain: string): Promise<void> {
  const octokit = getOctokit();
  const tree = await getTreeCached();

  const files: Array<{ path: string; sha: string }> = [];
  for (const prefix of [`sites/${domain}/`, `overrides/${domain}/`]) {
    for (const entry of tree) {
      if (entry.path?.startsWith(prefix) && entry.type === "blob" && entry.sha) {
        files.push({ path: entry.path, sha: entry.sha });
      }
    }
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
    message: `site(${domain}): delete all site files and overrides`,
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
  if (repo) {
    // Custom repo — can't use tree cache
    const octokit = getOctokit();
    try {
      const { data } = await octokit.repos.getContent({
        owner: repo.owner,
        repo: repo.name,
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

  try {
    const tree = await getTreeCached(branch);
    const entry = tree.find((f) => f.path === path && f.type === "blob");
    if (!entry?.sha) return null;

    const octokit = getOctokit();
    const { data } = await octokit.git.getBlob({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      file_sha: entry.sha,
    });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Read raw base64 content of a file (for binary assets like images). */
export async function readFileBase64(
  path: string,
  branch?: string,
): Promise<string | null> {
  try {
    const tree = await getTreeCached(branch);
    const entry = tree.find((f) => f.path === path && f.type === "blob");
    if (!entry?.sha) return null;

    const octokit = getOctokit();
    const { data } = await octokit.git.getBlob({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      file_sha: entry.sha,
    });
    return data.content.replace(/\n/g, "");
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Read a site's config YAML from the network repo.
 *  NOTE: This is the Git-read fallback for the DB helper
 *  (`db/site-configs.ts`). In normal operation, reads go through MongoDB. */
export async function readSiteConfig(
  domain: string,
  branch?: string
): Promise<Record<string, unknown> | null> {
  try {
    const tree = await getTreeCached(branch);
    const path = `sites/${domain}/site.yaml`;
    const entry = tree.find((f) => f.path === path && f.type === "blob");
    if (!entry?.sha) return null;

    const octokit = getOctokit();
    const { data } = await octokit.git.getBlob({
      owner: NETWORK_REPO_OWNER,
      repo: NETWORK_REPO_NAME,
      file_sha: entry.sha,
    });
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return parseYaml(content) as Record<string, unknown>;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/** Count articles for a site — lightweight: uses the tree cache.
 *  NOTE: Git-read fallback for `db/articles.ts`. */
export async function countArticles(domain: string, branch?: string): Promise<number> {
  try {
    const tree = await getTreeCached(branch);
    const prefix = `sites/${domain}/articles/`;
    return tree.filter(
      (f) =>
        f.path?.startsWith(prefix) &&
        f.type === "blob" &&
        f.path.endsWith(".md") &&
        !f.path.endsWith(".gitkeep") &&
        !f.path.slice(prefix.length).includes("/"),
    ).length;
  } catch (error: unknown) {
    if (isNotFoundError(error)) return 0;
    throw error;
  }
}

/** Count articles for multiple sites in parallel. */
export async function countArticlesForSites(
  sites: Array<{ domain: string; staging_branch: string | null }>,
): Promise<Record<string, number>> {
  const results = await Promise.allSettled(
    sites.map(async (s) => {
      const count = await countArticles(s.domain, s.staging_branch ?? undefined);
      return { domain: s.domain, count };
    }),
  );
  const counts: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      counts[r.value.domain] = r.value.count;
    }
  }
  return counts;
}

/** List articles for a site from the network repo.
 *  NOTE: Git-read fallback for `db/articles.ts`. In normal operation,
 *  reads go through MongoDB. */
export async function readArticles(domain: string, branch?: string): Promise<ArticleEntry[]> {
  const octokit = getOctokit();
  try {
    const tree = await getTreeCached(branch);
    const prefix = `sites/${domain}/articles/`;
    const mdEntries = tree.filter(
      (f) =>
        f.path?.startsWith(prefix) &&
        f.type === "blob" &&
        f.path.endsWith(".md") &&
        !f.path.endsWith(".gitkeep") &&
        !f.path.slice(prefix.length).includes("/"),
    );

    const results = await Promise.allSettled(
      mdEntries.map((entry) =>
        blobLimit(async () => {
          const { data } = await octokit.git.getBlob({
            owner: NETWORK_REPO_OWNER,
            repo: NETWORK_REPO_NAME,
            file_sha: entry.sha!,
          });
          const content = Buffer.from(data.content, "base64").toString("utf-8");
          const frontmatter = extractFrontmatter(content);
          const fileName = entry.path!.split("/").pop()!;
          return {
            slug: fileName.replace(".md", ""),
            title: (frontmatter.title as string) ?? fileName,
            type: (frontmatter.type as string) ?? "standard",
            status: (frontmatter.status as string) ?? "draft",
            publishDate: (frontmatter.publishDate as string) ?? "",
            featuredImage: (frontmatter.featuredImage as string) ?? undefined,
            score: (frontmatter.quality_score as number) ?? (frontmatter.score as number | undefined),
            scoreBreakdown: frontmatter.score_breakdown as ArticleEntry["scoreBreakdown"],
            qualityNote: frontmatter.quality_note as string | undefined,
            reviewerNotes: frontmatter.reviewer_notes as string | undefined,
          } as ArticleEntry;
        }),
      ),
    );

    const articles: ArticleEntry[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) articles.push(r.value);
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
 * Trigger the sync-kv workflow by pushing a .build-trigger file via the
 * Contents API. The push event on `sites/**` fires `sync-kv.yml`, which
 * seeds CONFIG_KV + R2 for the site.
 *
 * Git Data API commits (createTree → createCommit → updateRef) do NOT trigger
 * GitHub Actions. The Contents API (createOrUpdateFileContents) DOES. So after
 * committing site files, we push a small trigger file to fire the workflow.
 *
 * NOTE: workflow_dispatch would be cleaner but requires `actions:write` scope
 * which the current GITHUB_TOKEN does not have.
 */
export async function triggerWorkflowViaPush(
  branch: string,
  siteFolder: string
): Promise<void> {
  const octokit = getOctokit();
  const triggerPath = `sites/${siteFolder}/.build-trigger`;

  let existingSha: string | undefined;
  try {
    const tree = await getTreeCached(branch);
    const entry = tree.find((f) => f.path === triggerPath && f.type === "blob");
    existingSha = entry?.sha;
  } catch {
    // File doesn't exist yet
  }
  invalidateTreeCache(branch);

  // KEEP createOrUpdateFileContents — triggers GitHub Actions
  await octokit.repos.createOrUpdateFileContents({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path: triggerPath,
    message: `ci: trigger KV sync for ${siteFolder}`,
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
let _stagingSitesCache: { data: string[]; expiresAt: number } | null = null;

export async function listStagingSites(): Promise<string[]> {
  if (_stagingSitesCache && Date.now() < _stagingSitesCache.expiresAt) return _stagingSitesCache.data;

  const octokit = getOctokit();
  const { data } = await octokit.git.listMatchingRefs({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: "heads/staging/",
  });
  const result = data
    .map((r) => r.ref.replace(/^refs\/heads\/staging\//, ""))
    .filter((s) => s.length > 0);
  _stagingSitesCache = { data: result, expiresAt: Date.now() + 5 * 60_000 };
  return result;
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

/**
 * Copy a site's entire directory from one branch to another using the Git
 * Tree API. This is O(1) API calls for the read phase (a single recursive
 * tree fetch) instead of O(N) per-file reads, making it safe for sites
 * with 100+ articles that would otherwise timeout on CloudGrid.
 *
 * The blob SHAs from the source branch are referenced directly in the new
 * commit tree on the target branch — no content is re-read or re-uploaded.
 */
export async function copySiteTreeToMain(
  domain: string,
  sourceBranch: string,
  commitMessage: string,
): Promise<void> {
  const octokit = getOctokit();
  const prefix = `sites/${domain}/`;

  // 1. Get the source branch's full recursive tree (single API call)
  const { data: srcRef } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: `heads/${sourceBranch}`,
  });
  const { data: srcTree } = await octokit.git.getTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    tree_sha: srcRef.object.sha,
    recursive: "true",
  });

  // 2. Filter to only this site's files
  const siteEntries = srcTree.tree.filter(
    (e) => e.path?.startsWith(prefix) && e.type === "blob" && e.sha && e.mode,
  );

  if (siteEntries.length === 0) {
    throw new Error(`No site files found on ${sourceBranch} for ${domain}`);
  }

  console.log(
    `[github] copySiteTreeToMain: ${siteEntries.length} files from ${sourceBranch} → main for ${domain}`,
  );

  // 3. Get main's current HEAD
  const { data: mainRef } = await octokit.git.getRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: "heads/main",
  });
  const mainHeadSha = mainRef.object.sha;
  const { data: mainCommit } = await octokit.git.getCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    commit_sha: mainHeadSha,
  });

  // 4. Create new tree on main with the source blob SHAs (no re-upload)
  const treeItems = siteEntries.map((e) => ({
    path: e.path!,
    mode: e.mode as "100644" | "100755" | "040000" | "160000" | "120000",
    type: "blob" as const,
    sha: e.sha!,
  }));

  const { data: newTree } = await octokit.git.createTree({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    base_tree: mainCommit.tree.sha,
    tree: treeItems,
  });

  // 5. Commit and update ref
  const { data: newCommit } = await octokit.git.createCommit({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    message: commitMessage,
    tree: newTree.sha,
    parents: [mainHeadSha],
  });
  await octokit.git.updateRef({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    ref: "heads/main",
    sha: newCommit.sha,
  });
}

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
  if (lower.includes("override") || lower.includes("ads")) return "override_activated";
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
