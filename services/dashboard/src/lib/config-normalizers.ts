import type { UnifiedConfigFields } from "@/components/config/UnifiedConfigForm";
import type { AdsConfigFormValue, InterstitialConfigFormValue, InterstitialPageType, InterstitialExcludePage } from "@/components/settings/AdsConfigForm";
import { DEFAULT_INTERSTITIAL_CONFIG } from "@/components/settings/AdsConfigForm";
import type { AdSizeConfig } from "@/components/settings/ad-size-config";
import { sizeTuplesToConfig } from "@/components/settings/ad-size-config";

/**
 * Shared normalizers for transforming raw YAML config data into typed form values.
 * Used by group page, site config tab, and any other consumer of UnifiedConfigForm.
 */

function isValidSizeConfig(raw: unknown): raw is AdSizeConfig {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.ratio != null && typeof obj.ratio === "object" &&
    obj.range != null && typeof obj.range === "object" &&
    Array.isArray(obj.customSizes)
  );
}

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
    facebook_domain_verification: (raw?.facebook_domain_verification as string) ?? null,
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
    before_footer: normalizeEntries(raw?.before_footer),
  };
}

function normalizeInterstitialConfig(raw: Record<string, unknown> | undefined): InterstitialConfigFormValue {
  if (!raw) return { ...DEFAULT_INTERSTITIAL_CONFIG };
  const trigger = raw.trigger as Record<string, unknown> | undefined;
  const frequency = raw.frequency as Record<string, unknown> | undefined;
  return {
    script_url: (raw.script_url as string) ?? "",
    script_inline: (raw.script_inline as string) ?? "",
    trigger: {
      type: (trigger?.type as InterstitialConfigFormValue["trigger"]["type"]) ?? "delay",
      delay_seconds: (trigger?.delay_seconds as number) ?? 5,
      scroll_percent: (trigger?.scroll_percent as number) ?? 50,
    },
    frequency: {
      type: (frequency?.type as InterstitialConfigFormValue["frequency"]["type"]) ?? "once_per_session",
      max_per_session: (frequency?.max_per_session as number) ?? 1,
    },
    page_types: Array.isArray(raw.page_types) ? raw.page_types : ["all"],
    close_delay_seconds: (raw.close_delay_seconds as number) ?? 3,
    device: (raw.device as InterstitialConfigFormValue["device"]) ?? "both",
    exclude_pages: Array.isArray(raw.exclude_pages) ? raw.exclude_pages : [],
  };
}

export function normalizeAdsConfig(raw: Record<string, unknown> | undefined): AdsConfigFormValue {
  const placements = Array.isArray(raw?.ad_placements) ? raw.ad_placements : [];
  return {
    interstitial: (raw?.interstitial as boolean) ?? false,
    interstitial_config: normalizeInterstitialConfig(raw?.interstitial_config as Record<string, unknown> | undefined),
    layout: (raw?.layout as string) ?? "standard",
    ad_placements: placements.map((p: Record<string, unknown>) => {
      const rawSizes = p.sizes;
      let sizes: { desktop?: number[][]; mobile?: number[][] } = {};
      if (Array.isArray(rawSizes)) {
        const tuples = (rawSizes as unknown[])
          .map((s) => {
            if (typeof s === "string" && s.includes("x")) {
              const [w, h] = s.split("x").map(Number);
              return (!isNaN(w) && !isNaN(h) && (w > 0 || h > 0)) ? [w, h] : null;
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
      const rawDesktopCfg = isValidSizeConfig(p.desktopSizeConfig)
        ? (p.desktopSizeConfig as AdSizeConfig)
        : undefined;
      const rawMobileCfg = isValidSizeConfig(p.mobileSizeConfig)
        ? (p.mobileSizeConfig as AdSizeConfig)
        : undefined;

      return {
        id: (p.id as string) ?? "",
        position: (p.position as string) ?? "",
        device: (p.devices ?? p.device ?? "all") as "all" | "desktop" | "mobile",
        sizes,
        ...(dismissible !== undefined && { dismissible }),
        desktopSizeConfig: rawDesktopCfg ?? sizeTuplesToConfig(sizes.desktop),
        mobileSizeConfig: rawMobileCfg ?? sizeTuplesToConfig(sizes.mobile),
        ...(typeof p.code === "string" && p.code.trim() && { code: p.code as string }),
        page_types: (Array.isArray(p.page_types) ? p.page_types : ["all"]) as InterstitialPageType[],
        exclude_pages: (Array.isArray(p.exclude_pages) ? p.exclude_pages : []) as InterstitialExcludePage[],
      };
    }),
  };
}
