import type { JobsOptions } from "bullmq";

export interface GenerateJobData {
  siteDomain: string;
  count: number;
  branch: string;
  runId?: string;
  triggeredBy: "manual" | "scheduled" | "scheduled-forced";
  briefJson?: string;
}

export interface SchedulerRunData {
  runId: string;
  timezone: string;
  forced: boolean;
  /** Domains that were enqueued as child generate jobs. */
  enqueuedDomains: string[];
  skipped: Array<{ domain: string; reason: string }>;
}

export const GENERATE_QUEUE = "content-generation";
export const SCHEDULER_RUN_QUEUE = "scheduler-run";

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

// --- Import site queue ---

export const IMPORT_SITE_QUEUE = "import-site";
export const IMPORT_FINALIZE_QUEUE = "import-finalize";

/** Max sites per CSV upload. */
export const MAX_IMPORT_BATCH_SIZE = 200;

/** Data for each per-site import child job. */
export interface ImportSiteJobData {
  batchId: string;
  siteId: string;
  row: Record<string, string>;
}

/** Result returned by each completed import-site job. */
export interface ImportSiteResult {
  siteId: string;
  domain: string;
  status: "created" | "error";
  previewUrl?: string;
  warnings?: string[];
  postsApiUrl?: string;
  error?: string;
  company?: string;
  vertical?: string;
}

/** Data for the parent finalize job. */
export interface ImportFinalizeData {
  batchId: string;
  siteIds: string[];
}

/** Per-site status stored in the Redis batch hash. */
export interface ImportBatchSiteStatus {
  status: "pending" | "running" | "complete" | "error";
  phase?: string;
  error?: string;
  warnings?: string[];
  previewUrl?: string;
  postsApiUrl?: string;
}

/** Batch metadata stored in the Redis batch hash (the "meta" field). */
export interface ImportBatchMeta {
  total: number;
  status: "pending" | "running" | "complete" | "failed";
  createdAt: string;
}

export const DEFAULT_IMPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: {
    type: "exponential",
    delay: 15_000,
  },
  removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

// --- Import articles queue ---

export const IMPORT_ARTICLES_QUEUE = "import-articles";

/** Data for each article import job. */
export interface ImportArticlesJobData {
  /** Unique job ID for status polling. */
  jobId: string;
  siteDomain: string;
  wpApiUrl: string;
  branch: string;
  /** If set, also commit to this branch (e.g. staging + main). */
  alsoCommitTo?: string;
  /** WP menu items / topics for tag mapping. */
  menuItems?: string[];
  /** Site category for image prompt context. */
  websiteCategory?: string;
}

/** Result returned by a completed article import job. */
export interface ImportArticlesResult {
  jobId: string;
  site: string;
  totalArticles: number;
  successful: number;
  failed: number;
  durationMs: number;
  n8nImagesTriggered: number;
}

/** Per-article-import progress stored in Redis. */
export interface ArticleImportProgress {
  jobId: string;
  site: string;
  status: "pending" | "running" | "complete" | "failed";
  phase?: string;
  totalArticles: number;
  processedArticles: number;
  successfulArticles: number;
  failedArticles: number;
  currentArticleSlug?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** No retries — article imports are long-running, and re-running could create duplicate articles. */
export const DEFAULT_ARTICLE_IMPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 7 * 24 * 3600, count: 200 },
  removeOnFail: { age: 30 * 24 * 3600 },
};
