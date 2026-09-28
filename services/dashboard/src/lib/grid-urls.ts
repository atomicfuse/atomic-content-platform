const DEFAULT_STAGING_WORKER = "https://atomic-site-worker-staging.accounts-4a8.workers.dev";

/** Where a Grid site's /api/pool lives: prod host when Live, staging preview otherwise, or a local override. */
export function gridPoolUrl(
  entry: { domain: string; status?: string | null; custom_domain?: string | null; preview_url?: string | null },
  override?: string,
): string {
  if (override) return `${override.replace(/\/$/, "")}/api/pool?_atl_site=${encodeURIComponent(entry.domain)}&summaries=1`;
  if ((entry.status ?? "").toLowerCase() === "live" && entry.custom_domain) return `https://${entry.custom_domain}/api/pool?summaries=1`;
  const url = new URL(entry.preview_url || `${DEFAULT_STAGING_WORKER}/?_atl_site=${encodeURIComponent(entry.domain)}`);
  url.pathname = "/api/pool";
  url.searchParams.set("summaries", "1");
  return url.toString();
}
