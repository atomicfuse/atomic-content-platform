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
  const base = getWorkerStagingUrl(siteId);
  return `${base}${cleanPath}?_atl_site=${encodeURIComponent(siteId)}`;
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

// --- Dev1 legacy account (temporary — remove after zone transfer to Assets) ---

/** Site identifiers whose zones still live on the Dev1 Cloudflare account.
 *  These are dashboard-index `domain` values (site folder names).
 *  Remove a domain from this set after its zone is transferred to Assets. */
export const DEV1_SITE_IDS = new Set(["financenewsbase", "muvizzcom"]);

/** Custom domains (hostnames) that belong to Dev1 sites.
 *  Used by functions that receive a custom domain instead of a siteId
 *  (e.g. email routing's `createEmailRoutingRule`). */
export const DEV1_CUSTOM_DOMAINS = new Set(["financenewsbase.com", "coolnews.dev"]);

/** Check if a domain identifier (siteId OR custom domain) belongs to the Dev1 account. */
export function isDev1Domain(domain: string): boolean {
  return DEV1_SITE_IDS.has(domain) || DEV1_CUSTOM_DOMAINS.has(domain);
}

/** Dev1 account ID. */
export const DEV1_ACCOUNT_ID = "953511f6356ff606d84ac89bba3eff50";

/** Dev1 production CONFIG_KV namespace ID. */
export const DEV1_KV_NAMESPACE_PROD = "a69cb2c59507482ca5e6d114babdd098";

/** Dev1 staging CONFIG_KV namespace ID. */
export const DEV1_KV_NAMESPACE_STAGING = "4673c82cdd7f41d49e93d938fb1c6848";

/** Dev1 staging Worker preview URL. */
export const DEV1_WORKER_STAGING_URL =
  "https://atomic-site-worker-staging.dev1-953.workers.dev";

/** Get the KV namespace IDs for a domain (Dev1 or Assets). */
export function getKvNamespaces(domain: string): {
  prod: string;
  staging: string;
} {
  if (isDev1Domain(domain)) {
    return { prod: DEV1_KV_NAMESPACE_PROD, staging: DEV1_KV_NAMESPACE_STAGING };
  }
  return { prod: KV_NAMESPACE_PROD, staging: KV_NAMESPACE_STAGING };
}

/** Get the Worker staging preview URL for a domain (Dev1 or Assets). */
export function getWorkerStagingUrl(domain: string): string {
  if (isDev1Domain(domain)) return DEV1_WORKER_STAGING_URL;
  return WORKER_STAGING_URL;
}
