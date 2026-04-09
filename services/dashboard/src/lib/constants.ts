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
