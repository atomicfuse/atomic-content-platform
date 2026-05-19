export interface CustomDomainRoute {
  pattern: string;
  custom_domain: true;
}

/** Custom domains are now registered on the `atl-sites-workers-manager`
 *  worker, which routes traffic to atomic-site-worker via a Service Binding
 *  (ATL_SITES_MAIN). atomic-site-worker no longer claims any Custom Domains
 *  directly — it receives traffic only from the manager and via its
 *  workers.dev URL (staging).
 *
 *  This function is kept for API compatibility with emit-env-configs.ts
 *  but always returns an empty array. */
export async function loadCustomDomains(_networkPath: string): Promise<CustomDomainRoute[]> {
  return [];
}
