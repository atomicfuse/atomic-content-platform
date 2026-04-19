"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { GeneralForm } from "@/components/settings/GeneralForm";
import { RebuildConfirmModal } from "@/components/shared/RebuildConfirmModal";
import { UnifiedConfigForm } from "@/components/config/UnifiedConfigForm";
import type { UnifiedConfigFields } from "@/components/config/UnifiedConfigForm";

interface OrgConfig {
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeTracking(raw: Record<string, unknown> | undefined): UnifiedConfigFields["tracking"] {
  return {
    ga4: (raw?.ga4 as string) ?? null,
    gtm: (raw?.gtm as string) ?? null,
    google_ads: (raw?.google_ads as string) ?? null,
    facebook_pixel: (raw?.facebook_pixel as string) ?? null,
    custom: (raw?.custom as UnifiedConfigFields["tracking"]["custom"]) ?? [],
  };
}

function normalizeScripts(raw: Record<string, unknown> | undefined): UnifiedConfigFields["scripts"] {
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

function normalizeAdsConfig(raw: Record<string, unknown> | undefined): UnifiedConfigFields["ads_config"] {
  const placements = Array.isArray(raw?.ad_placements) ? raw.ad_placements : [];
  return {
    interstitial: (raw?.interstitial as boolean) ?? false,
    layout: (raw?.layout as string) ?? "standard",
    ad_placements: placements.map((p: Record<string, unknown>) => {
      const rawSizes = p.sizes;
      let sizes: { desktop?: number[][]; mobile?: number[][] } = {};
      if (rawSizes && typeof rawSizes === "object" && !Array.isArray(rawSizes)) {
        sizes = rawSizes as { desktop?: number[][]; mobile?: number[][] };
      }
      return {
        id: (p.id as string) ?? "",
        position: (p.position as string) ?? "",
        device: (p.device ?? "all") as "all" | "desktop" | "mobile",
        sizes,
      };
    }),
  };
}

export default function OrgSettingsPage(): React.ReactElement {
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const [allSites, setAllSites] = useState<
    Array<{ domain: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchConfig = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [orgRes, sitesRes] = await Promise.all([
        fetch("/api/settings/org"),
        fetch("/api/sites/list"),
      ]);
      if (!orgRes.ok) throw new Error(`HTTP ${orgRes.status}`);
      const data = (await orgRes.json()) as OrgConfig;
      setConfig(data);
      if (sitesRes.ok) {
        const sites = (await sitesRes.json()) as Array<{ domain: string }>;
        setAllSites(sites);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load org config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  async function save(): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/org", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Org settings saved", "success");
      setShowRebuildModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading org settings...</div>;
  }

  if (error && !config) {
    return (
      <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  if (!config) return <div />;

  // Build config for UnifiedConfigForm
  const formConfig: Partial<UnifiedConfigFields> = {
    tracking: normalizeTracking(config.tracking as Record<string, unknown> | undefined),
    scripts: normalizeScripts(config.scripts as Record<string, unknown> | undefined),
    scripts_vars: ((config.scripts_vars ?? config.script_variables ?? {}) as Record<string, string>),
    ads_config: normalizeAdsConfig((config.ads_config ?? config.ads) as Record<string, unknown> | undefined),
    ad_placeholder_heights: config.ad_placeholder_heights as UnifiedConfigFields["ad_placeholder_heights"] | undefined,
    ads_txt: Array.isArray(config.ads_txt) ? (config.ads_txt as string[]) : [],
    theme: (config.theme ?? {}) as Record<string, unknown>,
    legal: (config.legal ?? {}) as Record<string, string>,
  };

  const tabs = [
    {
      id: "general",
      label: "General",
      content: (
        <GeneralForm
          value={
            {
              organization: (config.organization as string) ?? "",
              legal_entity: (config.legal_entity as string) ?? "",
              company_address: (config.company_address as string) ?? "",
              support_email_pattern: (config.support_email_pattern as string) ?? "",
              default_theme: config.default_theme as string | undefined,
              default_fonts: config.default_fonts as
                | { heading: string; body: string }
                | undefined,
            } satisfies Parameters<typeof GeneralForm>[0]["value"]
          }
          onChange={(v): void => {
            setConfig({ ...config, ...v });
          }}
        />
      ),
    },
    {
      id: "config",
      label: "Config",
      content: (
        <UnifiedConfigForm
          config={formConfig}
          onChange={(updated): void => {
            if (!config) return;
            setConfig({ ...config, ...updated } as OrgConfig);
          }}
          mode="org"
        />
      ),
    },
  ];

  return (
    <div className="max-w-6xl space-y-6">
      {error && (
        <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      <Tabs tabs={tabs} defaultTab="general" />

      <div className="flex gap-3">
        <Button onClick={save} loading={saving}>
          Save
        </Button>
      </div>

      <RebuildConfirmModal
        open={showRebuildModal}
        onClose={(): void => setShowRebuildModal(false)}
        affectedSites={allSites}
        changeLabel="org settings"
      />
    </div>
  );
}
