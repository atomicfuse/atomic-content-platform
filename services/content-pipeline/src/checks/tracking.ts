import { getKVEntry, credentialsFor } from "../lib/kv.js";
import { getKvNamespaces } from "../lib/cloudflare-accounts.js";

export interface TrackingCheck {
  state: "ok" | "unknown";
  ga4: boolean;
  gtm: boolean;
  pixel: boolean;
}

const present = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

export async function readTracking(domain: string): Promise<TrackingCheck> {
  try {
    const creds = credentialsFor(domain);
    const namespaceId = getKvNamespaces(domain).prod;
    const raw = await getKVEntry(namespaceId, `site-config:${domain}`, creds);

    // No KV entry (staging-only site, or never seeded to prod) — treat as
    // unknown so computeTrackingOff returns false (no false-positive alerts).
    if (!raw || typeof raw !== "object") {
      return { state: "unknown", ga4: false, gtm: false, pixel: false };
    }

    const tracking = (raw as Record<string, unknown>).tracking as
      | Record<string, unknown>
      | undefined;
    return {
      state: "ok",
      ga4: present(tracking?.ga4),
      gtm: present(tracking?.gtm),
      pixel: present(tracking?.facebook_pixel),
    };
  } catch {
    return { state: "unknown", ga4: false, gtm: false, pixel: false };
  }
}
