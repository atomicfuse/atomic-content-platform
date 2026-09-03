/**
 * Post-resolution config validator for seed-kv.
 *
 * Runs after resolveSiteConfig() produces the final merged config.
 * Returns an array of human-readable warning strings. These are
 * logged during seeding so operators notice dangerous patterns
 * (e.g. an override wiping all ad placements).
 *
 * This is a WARN layer, not a hard gate — seeding still proceeds.
 * A future strict mode can promote warnings to errors.
 */

interface AdsConfig {
  interstitial?: boolean;
  interstitial_config?: {
    script_url?: string;
    script_inline?: string;
    [k: string]: unknown;
  };
  ad_placements?: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

interface TrackingConfig {
  ga4?: string | null;
  gtm?: string | null;
  google_ads?: string | null;
  facebook_pixel?: string | null;
  custom?: unknown[];
  [k: string]: unknown;
}

interface ScriptsConfig {
  head?: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

export function validateResolvedConfig(
  config: Record<string, unknown>,
  siteId: string,
): string[] {
  const warnings: string[] = [];
  const ads = config.ads_config as AdsConfig | undefined;
  const tracking = config.tracking as TrackingConfig | undefined;
  const scripts = config.scripts as ScriptsConfig | undefined;

  // 1. Interstitial enabled but no delivery script
  if (ads?.interstitial === true) {
    const ic = ads.interstitial_config;
    const hasUrl = typeof ic?.script_url === 'string' && ic.script_url.length > 0;
    const hasInline = typeof ic?.script_inline === 'string' && ic.script_inline.trim().length > 0;
    if (!hasUrl && !hasInline) {
      warnings.push(
        `[${siteId}] ads_config.interstitial is true but interstitial_config has no script_url or script_inline — interstitial will not render`,
      );
    }
  }

  // 2. Ad placements wiped (empty array after merge)
  if (ads && Array.isArray(ads.ad_placements) && ads.ad_placements.length === 0) {
    warnings.push(
      `[${siteId}] ads_config.ad_placements is empty — no ad slots will render. Check if an override layer set ad_placements: []`,
    );
  }

  // 3. All tracking IDs null
  if (tracking) {
    const ids = [tracking.ga4, tracking.gtm, tracking.google_ads, tracking.facebook_pixel];
    const customs = Array.isArray(tracking.custom) ? tracking.custom : [];
    if (ids.every((v) => v === null || v === undefined) && customs.length === 0) {
      warnings.push(
        `[${siteId}] all tracking IDs are null — no analytics will fire`,
      );
    }
  }

  // 4. Head scripts empty (no ad SDK will load)
  if (scripts && Array.isArray(scripts.head) && scripts.head.length === 0) {
    warnings.push(
      `[${siteId}] scripts.head is empty — no SDK scripts will load. Ad widgets require header scripts.`,
    );
  }

  return warnings;
}
