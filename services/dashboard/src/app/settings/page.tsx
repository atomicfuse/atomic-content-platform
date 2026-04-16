"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { TrackingForm } from "@/components/settings/TrackingForm";
import { ScriptsEditor } from "@/components/settings/ScriptsEditor";
import { ScriptVariablesEditor } from "@/components/settings/ScriptVariablesEditor";
import { AdsConfigForm } from "@/components/settings/AdsConfigForm";
import { LegalForm } from "@/components/settings/LegalForm";
import { GeneralForm } from "@/components/settings/GeneralForm";
import { AdsTxtEditor } from "@/components/settings/AdsTxtEditor";
import { PlacementPreview } from "@/components/shared/PlacementPreview";
import { RebuildConfirmModal } from "@/components/shared/RebuildConfirmModal";

interface OrgConfig {
  [key: string]: unknown;
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
      const orgRes = await fetch("/api/settings/org");
      if (!orgRes.ok) throw new Error(`HTTP ${orgRes.status}`);
      const data = (await orgRes.json()) as OrgConfig;
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load org config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  function updateField(key: string, value: unknown): void {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

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

      // Fetch all sites for rebuild prompt
      try {
        const sitesRes = await fetch("/api/sites/list");
        if (sitesRes.ok) {
          const sites = (await sitesRes.json()) as Array<{ domain: string }>;
          setAllSites(sites);
        }
      } catch {
        // non-blocking
      }
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
      id: "tracking",
      label: "Tracking",
      content: (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            These are org-wide defaults. Groups, overrides, and sites can override.
          </p>
          <TrackingForm
            value={
              (config.tracking ?? {
                ga4: null,
                gtm: null,
                google_ads: null,
                facebook_pixel: null,
                custom: [],
              }) as unknown as Parameters<typeof TrackingForm>[0]["value"]
            }
            onChange={(v): void => updateField("tracking", v)}
          />
        </div>
      ),
    },
    {
      id: "scripts",
      label: "Scripts",
      content: (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            These scripts load on EVERY site unless overridden by a group,
            override, or site.
          </p>
          <ScriptsEditor
            value={
              (config.scripts ?? {
                head: [],
                body_start: [],
                body_end: [],
              }) as unknown as Parameters<typeof ScriptsEditor>[0]["value"]
            }
            onChange={(v): void => updateField("scripts", v)}
          />
        </div>
      ),
    },
    {
      id: "script-variables",
      label: "Script Variables",
      content: (
        <ScriptVariablesEditor
          value={
            (config.scripts_vars ?? config.script_variables ?? {}) as Record<
              string,
              string
            >
          }
          onChange={(v: Record<string, string>): void =>
            updateField("scripts_vars", v)
          }
        />
      ),
    },
    {
      id: "ads",
      label: "Ads Config",
      content: (() => {
        const adsVal = (config.ads_config ?? config.ads ?? {
          interstitial: false,
          layout: "standard",
          ad_placements: [],
        }) as unknown as Parameters<typeof AdsConfigForm>[0]["value"];
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AdsConfigForm
              value={adsVal}
              onChange={(v): void => updateField("ads_config", v)}
            />
            <PlacementPreview placements={adsVal.ad_placements ?? []} />
          </div>
        );
      })(),
    },
    {
      id: "ads-txt",
      label: "ads.txt",
      content: (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            These entries appear in EVERY site&apos;s ads.txt. Group, override,
            and site entries are added on top.
          </p>
          <AdsTxtEditor
            value={(config.ads_txt ?? []) as string[]}
            onChange={(v): void => updateField("ads_txt", v)}
            scopeLabel="organization"
          />
        </div>
      ),
    },
    {
      id: "legal",
      label: "Legal",
      content: (
        <LegalForm
          value={(config.legal ?? {}) as Record<string, string>}
          onChange={(v: Record<string, string>): void => updateField("legal", v)}
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
