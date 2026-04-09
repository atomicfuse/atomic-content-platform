/**
 * A custom tracking script entry injected into the page.
 */
export interface CustomTrackingScript {
    /** Identifier for this custom script. */
    name: string;
    /** URL of the external script to load. */
    src: string;
    /** Where in the document the script tag is placed. */
    position: "head" | "body_start" | "body_end";
}
/**
 * Analytics and tracking pixel configuration.
 * All vendor IDs are nullable — `null` means the tracker is disabled.
 */
export interface TrackingConfig {
    /** Google Analytics 4 measurement ID (e.g. "G-XXXXXXXXXX"). */
    ga4: string | null;
    /** Google Tag Manager container ID (e.g. "GTM-XXXXXXX"). */
    gtm: string | null;
    /** Google Ads conversion ID. */
    google_ads: string | null;
    /** Meta / Facebook pixel ID. */
    facebook_pixel: string | null;
    /** Additional custom tracking scripts. */
    custom: CustomTrackingScript[];
}
//# sourceMappingURL=tracking.d.ts.map