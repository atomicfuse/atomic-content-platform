import type { SiteStatus } from "@/types/dashboard";

/**
 * Compute the correct dashboard status for a site during a Cloudflare sync.
 *
 * Ordering matters:
 * 1. Staging stays sticky — an operator who unpublished a site keeps it in
 *    Staging even if a custom domain is still attached.
 * 2. A custom domain means the site is serving production traffic → Live.
 *    This must be checked BEFORE the keep-Ready/Live branch, otherwise a site
 *    wrongly demoted to Ready (e.g. by a past goLive on an already-live site)
 *    can never self-heal.
 * 3. Otherwise keep Ready/Live as-is, then fall back to Cloudflare zone
 *    presence (Ready) or config presence (Staging).
 *
 * Returns `null` when the site matches nothing — an orphaned index entry the
 * caller should remove.
 */
export function computeCorrectStatus(
  site: Pick<
    { staging_branch: string | null; status: SiteStatus; custom_domain: string | null },
    "staging_branch" | "status" | "custom_domain"
  >,
  hasCfZone: boolean,
  hasSiteConfig: boolean,
): SiteStatus | null {
  if (site.staging_branch && site.status === "Staging") return "Staging";
  if (site.custom_domain) return "Live";
  if (site.staging_branch && (site.status === "Ready" || site.status === "Live")) {
    return site.status;
  }
  if (hasCfZone) return "Ready";
  if (hasSiteConfig) return "Staging";
  return null;
}
