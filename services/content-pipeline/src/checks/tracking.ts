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
    const tracking = (
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>).tracking
        : undefined
    ) as Record<string, unknown> | undefined;
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
