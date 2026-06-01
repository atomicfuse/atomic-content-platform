interface GitHubApiStats {
  getRef: number;
  getTree: number;
  getBlob: number;
  getCommit: number;
  createTree: number;
  createCommit: number;
  updateRef: number;
  treeCacheHits: number;
  blobCacheHits: number;
}

let stats: GitHubApiStats = newStats();

function newStats(): GitHubApiStats {
  return {
    getRef: 0, getTree: 0, getBlob: 0, getCommit: 0,
    createTree: 0, createCommit: 0, updateRef: 0,
    treeCacheHits: 0, blobCacheHits: 0,
  };
}

export function recordApiCall(endpoint: keyof Omit<GitHubApiStats, "treeCacheHits" | "blobCacheHits">): void {
  stats[endpoint]++;
}

export function recordCacheHit(kind: "tree" | "blob"): void {
  if (kind === "tree") stats.treeCacheHits++;
  else stats.blobCacheHits++;
}

export function getApiStats(): Readonly<GitHubApiStats> {
  return { ...stats };
}

export function resetApiStats(): GitHubApiStats {
  const snapshot = { ...stats };
  stats = newStats();
  return snapshot;
}

export function totalApiCalls(s: GitHubApiStats): number {
  return s.getRef + s.getTree + s.getBlob + s.getCommit +
    s.createTree + s.createCommit + s.updateRef;
}

export function formatApiStats(s: GitHubApiStats): string {
  const total = totalApiCalls(s);
  return `[github-stats] ${total} API calls` +
    ` (ref:${s.getRef} tree:${s.getTree} blob:${s.getBlob}` +
    ` commit:${s.getCommit} createTree:${s.createTree}` +
    ` createCommit:${s.createCommit} updateRef:${s.updateRef})` +
    ` | cache hits: tree=${s.treeCacheHits} blob=${s.blobCacheHits}`;
}
