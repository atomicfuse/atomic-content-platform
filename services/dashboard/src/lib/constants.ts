import type { SiteStatus, Company, Vertical } from "@/types/dashboard";

export const STATUS_CONFIG: Record<
  SiteStatus,
  { label: string; color: string; bgColor: string }
> = {
  New: {
    label: "New",
    color: "text-gray-600 dark:text-gray-300",
    bgColor: "bg-gray-200 dark:bg-gray-500/20",
  },
  Staging: {
    label: "Staging",
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-100 dark:bg-amber-500/20",
  },
  Preview: {
    label: "Preview",
    color: "text-purple-700 dark:text-purple-300",
    bgColor: "bg-purple-100 dark:bg-purple-500/20",
  },
  Ready: {
    label: "Ready",
    color: "text-blue-700 dark:text-blue-300",
    bgColor: "bg-blue-100 dark:bg-blue-500/20",
  },
  Live: {
    label: "Live",
    color: "text-green-700 dark:text-green-300",
    bgColor: "bg-green-100 dark:bg-green-500/20",
  },
  WordPress: {
    label: "WordPress",
    color: "text-orange-700 dark:text-orange-300",
    bgColor: "bg-orange-100 dark:bg-orange-500/20",
  },
};

export const COMPANIES: Company[] = ["ATL", "NGC"];

export const VERTICALS: Vertical[] = [
  "Lifestyle",
  "Travel",
  "Entertainment",
  "Animals",
  "Science",
  "Food & Drink",
  "News",
  "Conspiracy",
  "Other",
];

export const STATUSES: SiteStatus[] = [
  "New",
  "Staging",
  "Preview",
  "Ready",
  "Live",
  "WordPress",
];

export const NETWORK_REPO_OWNER = "atomicfuse";
export const NETWORK_REPO_NAME = "atomic-labs-network";
export const DASHBOARD_INDEX_PATH = "dashboard-index.yaml";

/**
 * Base URL for the multi-tenant site Worker (staging deployment).
 * Used for the per-site "Worker Preview" links during the Pages → Workers
 * migration. Override via `NEXT_PUBLIC_WORKER_STAGING_URL` for the
 * production dashboard. The Worker honours `?_atl_site=<site_id>` on
 * `*.workers.dev` hostnames so any seeded site can be previewed without
 * a custom domain.
 */
export const WORKER_STAGING_URL =
  process.env.NEXT_PUBLIC_WORKER_STAGING_URL ??
  "https://atomic-site-worker-staging.accounts-4a8.workers.dev";

/** Build a Worker preview URL that forces a specific siteId via the
 *  preview-override query param. The Worker only honours this on
 *  workers.dev / localhost — production custom domains use KV.
 *
 *  `path` is the in-site path (e.g. `/about`, `/<article-slug>`,
 *  defaults to `/`). The siteId is appended as `?_atl_site=` so the
 *  Worker resolves config + content from staging KV (which is what
 *  CI writes for any push to `staging/<domain>` branches). */
export function workerPreviewUrl(siteId: string, path = "/"): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${WORKER_STAGING_URL}${cleanPath}?_atl_site=${encodeURIComponent(siteId)}`;
}

// --- Cloudflare Worker + KV identifiers (production) ---

/** Production worker name — used for Workers Custom Domains API. */
export const WORKER_NAME_PROD = "atomic-site-worker";

/** Production CONFIG_KV namespace ID — Assets @ AtomicLabs. */
export const KV_NAMESPACE_PROD = "b258e47065274b8b8af1a0b6d6529c1d";

/** Staging CONFIG_KV namespace ID — Assets @ AtomicLabs. */
export const KV_NAMESPACE_STAGING = "f6c35e1fa8c841b8b193509a3a237f7f";

// --- R2 bucket identifier ---

/** R2 bucket for all per-site assets. The site-worker's ASSET_BUCKET
 *  binding points here in both staging and production environments. */
export const R2_BUCKET_PROD = "atl-assets-prod";
