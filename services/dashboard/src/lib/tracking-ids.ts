/** Tracking IDs edited from the Sites table: format checks and where an inherited value comes from. */

export type TrackingKey = "ga4" | "gtm" | "facebook_pixel";

export const TRACKING_FIELDS: Record<TrackingKey, { label: string; placeholder: string; hint: string; re: RegExp; upper: boolean }> = {
  ga4: { label: "Google Analytics", placeholder: "G-XXXXXXXXXX", hint: "Starts with G-, e.g. G-4KD9X2L7QP", re: /^G-[A-Z0-9]{4,20}$/, upper: true },
  // GT- is a Google tag ID; many sites keep theirs here and gtm.js serves it like a GTM container.
  gtm: { label: "Google Tag Manager", placeholder: "GTM-XXXXXXX", hint: "Starts with GTM- or GT-, e.g. GTM-K9X2L4 or GT-PB63Z593", re: /^GTM?-[A-Z0-9]{4,12}$/, upper: true },
  facebook_pixel: { label: "Facebook Pixel", placeholder: "1234567890123456", hint: "The pixel ID: 6 to 20 digits", re: /^\d{6,20}$/, upper: false },
};

export function normalizeTrackingId(key: TrackingKey, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const f = TRACKING_FIELDS[key];
  const value = f.upper ? raw.trim().toUpperCase() : raw.trim();
  if (!value) return { ok: false, error: `Enter the ${f.label} ID, or use the inherited value` };
  return f.re.test(value) ? { ok: true, value } : { ok: false, error: `That doesn't look like a ${f.label} ID. ${f.hint}.` };
}

interface Inheritance {
  org: Record<string, unknown> | null;
  groups: Array<{ id: string; config: Record<string, unknown> | null }>;
}

const trackingValue = (config: Record<string, unknown> | null | undefined, key: TrackingKey): string | null => {
  const v = (config?.tracking as Record<string, unknown> | undefined)?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/**
 * What the site gets when it has no value of its own: the organization's value, overridden by each of its groups
 * in order (later wins), the way seed-kv merges them. Config overrides aren't included here.
 */
export function inheritedTracking(inheritance: Inheritance | null | undefined, key: TrackingKey): { value: string; from: string } | null {
  if (!inheritance) return null;
  let found: { value: string; from: string } | null = null;
  const org = trackingValue(inheritance.org, key);
  if (org) found = { value: org, from: "organization" };
  for (const g of inheritance.groups ?? []) {
    const v = trackingValue(g.config, key);
    if (v) found = { value: v, from: `group ${g.id}` };
  }
  return found;
}
