import type { UnifiedConfigFields } from "@/components/config/UnifiedConfigForm";
import type { AdsConfigFormValue } from "@/components/settings/AdsConfigForm";
import type { AdSizeConfig } from "@/components/settings/ad-size-config";
import { sizeTuplesToConfig } from "@/components/settings/ad-size-config";

/**
 * Shared normalizers for transforming raw YAML config data into typed form values.
 * Used by group page, site config tab, and any other consumer of UnifiedConfigForm.
 */

export function normalizeAdsTxt(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  return [];
}

export function normalizeTracking(raw: Record<string, unknown> | undefined): UnifiedConfigFields["tracking"] {
  return {
    ga4: (raw?.ga4 as string) ?? null,
    gtm: (raw?.gtm as string) ?? null,
    google_ads: (raw?.google_ads as string) ?? null,
    facebook_pixel: (raw?.facebook_pixel as string) ?? null,
    custom: (raw?.custom as UnifiedConfigFields["tracking"]["custom"]) ?? [],
  };
}

export function normalizeScripts(raw: Record<string, unknown> | undefined): UnifiedConfigFields["scripts"] {
  function normalizeEntries(entries: unknown): UnifiedConfigFields["scripts"]["head"] {
    if (!Array.isArray(entries)) return [];
    return entries.map((e: Record<string, unknown>) => ({
      id: (e.id as string) ?? "",
      src: (e.src as string) ?? undefined,
      inline: (e.inline as string) ?? (e.content as string) ?? undefined,
      async: (e.async as boolean) ?? undefined,
    }));
  }
  return {
    head: normalizeEntries(raw?.head),
    body_start: normalizeEntries(raw?.body_start),
    body_end: normalizeEntries(raw?.body_end),
  };
}

export function normalizeAdsConfig(raw: Record<string, unknown> | undefined): AdsConfigFormValue {
  const placements = Array.isArray(raw?.ad_placements) ? raw.ad_placements : [];
  return {
    interstitial: (raw?.interstitial as boolean) ?? false,
    layout: (raw?.layout as string) ?? "standard",
    ad_placements: placements.map((p: Record<string, unknown>) => {
      const rawSizes = p.sizes;
      let sizes: { desktop?: number[][]; mobile?: number[][] } = {};
      if (Array.isArray(rawSizes)) {
        const tuples = (rawSizes as unknown[])
          .map((s) => {
            if (typeof s === "string" && s.includes("x")) {
              const [w, h] = s.split("x").map(Number);
              return w && h ? [w, h] : null;
            }
            if (Array.isArray(s)) return s as number[];
            return null;
          })
          .filter(Boolean) as number[][];
        sizes = { desktop: tuples, mobile: tuples };
      } else if (rawSizes && typeof rawSizes === "object") {
        sizes = rawSizes as { desktop?: number[][]; mobile?: number[][] };
      }
      const dismissible = p.dismissible as boolean | undefined;
      // Hydrate size config: use persisted config or migrate from sizes
      const rawDesktopCfg = p.desktopSizeConfig as AdSizeConfig | undefined;
      const rawMobileCfg = p.mobileSizeConfig as AdSizeConfig | undefined;

      return {
        id: (p.id as string) ?? "",
        position: (p.position as string) ?? "",
        device: (p.devices ?? p.device ?? "all") as "all" | "desktop" | "mobile",
        sizes,
        ...(dismissible !== undefined && { dismissible }),
        desktopSizeConfig: rawDesktopCfg ?? sizeTuplesToConfig(sizes.desktop),
        mobileSizeConfig: rawMobileCfg ?? sizeTuplesToConfig(sizes.mobile),
      };
    }),
  };
}
