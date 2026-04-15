"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";

import { MonetizationForm } from "@/components/monetization/MonetizationForm";
import {
  AdPlacementsEditor,
  type AdPlacement,
} from "@/components/monetization/AdPlacementsEditor";
import { PlacementPreview } from "@/components/monetization/PlacementPreview";
import { AdsTxtEditor } from "@/components/monetization/AdsTxtEditor";
import {
  ScriptsEditor,
  extractPlaceholders,
  type ScriptsConfig,
} from "@/components/monetization/ScriptsEditor";

import { TrackingForm } from "@/components/settings/TrackingForm";
import { ScriptVariablesEditor } from "@/components/settings/ScriptVariablesEditor";

interface MonetizationConfig {
  monetization_id?: string;
  name?: string;
  provider?: string;
  tracking?: Record<string, unknown>;
  scripts?: Partial<ScriptsConfig>;
  scripts_vars?: Record<string, string>;
  ads_config?: Record<string, unknown>;
  ads_txt?: string[];
  [key: string]: unknown;
}

interface SiteRow {
  domain: string;
  site_name?: string;
  group?: string;
  active?: boolean;
  explicit: boolean;
}

interface TrackingValue {
  ga4: string | null;
  gtm: string | null;
  google_ads: string | null;
  facebook_pixel: string | null;
  custom: Array<{ name: string; src: string; position: "head" | "body_start" | "body_end" }>;
}

function normalizeTracking(raw: Record<string, unknown> | undefined): TrackingValue {
  return {
    ga4: (raw?.["ga4"] as string) ?? null,
    gtm: (raw?.["gtm"] as string) ?? null,
    google_ads: (raw?.["google_ads"] as string) ?? null,
    facebook_pixel: (raw?.["facebook_pixel"] as string) ?? null,
    custom: (raw?.["custom"] as TrackingValue["custom"]) ?? [],
  };
}

function normalizeScripts(raw: Partial<ScriptsConfig> | undefined): ScriptsConfig {
  return {
    head: raw?.head ?? [],
    body_start: raw?.body_start ?? [],
    body_end: raw?.body_end ?? [],
  };
}

function normalizePlacements(raw: unknown): AdPlacement[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const placement = p as Record<string, unknown>;
    const sizesRaw = placement["sizes"];
    let sizes: string[] = [];
    if (Array.isArray(sizesRaw)) {
      sizes = (sizesRaw as unknown[])
        .map((s) => {
          if (typeof s === "string") return s;
          if (Array.isArray(s) && s.length === 2) return `${s[0]}x${s[1]}`;
          return "";
        })
        .filter(Boolean);
    }
    return {
      id: (placement["id"] as string) ?? "",
      position: (placement["position"] as string) ?? "above-content",
      device: ((placement["device"] ?? "all") as AdPlacement["device"]),
      sizes,
    };
  });
}

export default function MonetizationDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const { toast } = useToast();

  const [config, setConfig] = useState<MonetizationConfig | null>(null);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [profileRes, sitesRes] = await Promise.all([
        fetch(`/api/monetization/${id}`),
        fetch(`/api/monetization/${id}/sites`),
      ]);
      if (!profileRes.ok) {
        throw new Error(`Failed to load profile: HTTP ${profileRes.status}`);
      }
      const profileData = (await profileRes.json()) as MonetizationConfig;
      setConfig(profileData);
      if (sitesRes.ok) {
        setSites((await sitesRes.json()) as SiteRow[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function updateField(key: keyof MonetizationConfig, value: unknown): void {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  async function save(): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/monetization/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Saved. Ad changes go live within 5 minutes.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (sites.length > 0) {
      toast(
        `Cannot delete: ${sites.length} site${sites.length === 1 ? "" : "s"} still reference this profile.`,
        "error",
      );
      return;
    }
    if (!confirm(`Delete monetization profile "${id}"? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/monetization/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Profile deleted", "success");
      router.push("/monetization");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  const placements = useMemo(
    () => normalizePlacements(config?.ads_config?.["ad_placements"]),
    [config],
  );

  const scripts = useMemo(() => normalizeScripts(config?.scripts), [config]);
  const tracking = useMemo(() => normalizeTracking(config?.tracking), [config]);
  const scriptVars = useMemo(
    () => (config?.scripts_vars ?? {}) as Record<string, string>,
    [config],
  );
  const requiredPlaceholders = useMemo(
    () => extractPlaceholders(scripts),
    [scripts],
  );

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">Loading profile...</div>
    );
  }

  if (error && !config) {
    return (
      <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  if (!config) return <div />;

  // Hidden helpers used inside the placements tab to keep the JSX terse.
  function setAdsConfigField(key: string, value: unknown): void {
    if (!config) return;
    const adsConfig = (config.ads_config ?? {}) as Record<string, unknown>;
    updateField("ads_config", { ...adsConfig, [key]: value });
  }

  function setPlacements(next: AdPlacement[]): void {
    if (!config) return;
    const adsConfig = (config.ads_config ?? {}) as Record<string, unknown>;
    updateField("ads_config", { ...adsConfig, ad_placements: next });
  }

  function setScripts(next: ScriptsConfig): void {
    updateField("scripts", next);
  }

  const adsConfig = (config.ads_config ?? {}) as {
    interstitial?: boolean;
    layout?: string;
  };

  const tabs = [
    {
      id: "general",
      label: "General",
      content: (
        <MonetizationForm
          value={{
            monetization_id: id,
            name: config.name ?? "",
            provider: config.provider ?? "",
          }}
          onChange={(v): void => {
            setConfig({ ...config, name: v.name, provider: v.provider });
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
            These tracking IDs apply to all sites using this monetization
            profile, unless overridden by group or site.
          </p>
          <TrackingForm
            value={tracking}
            onChange={(v): void => updateField("tracking", v)}
          />
        </div>
      ),
    },
    {
      id: "placements",
      label: "Ad Placements",
      content: (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-3">
                Layout
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <label className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-4 py-3 cursor-pointer">
                  <span className="text-sm font-medium">Interstitial</span>
                  <input
                    type="checkbox"
                    checked={adsConfig.interstitial ?? false}
                    onChange={(e): void =>
                      setAdsConfigField("interstitial", e.target.checked)
                    }
                  />
                </label>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                    Layout type
                  </label>
                  <select
                    value={adsConfig.layout ?? "standard"}
                    onChange={(e): void =>
                      setAdsConfigField("layout", e.target.value)
                    }
                    className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
                  >
                    <option value="standard">Standard</option>
                    <option value="high-density">High Density</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <AdPlacementsEditor value={placements} onChange={setPlacements} />
            <PlacementPreview placements={placements} />
          </div>
        </div>
      ),
    },
    {
      id: "scripts",
      label: "Scripts",
      content: <ScriptsEditor value={scripts} onChange={setScripts} />,
    },
    {
      id: "script-variables",
      label: "Script Variables",
      content: (
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Default values for placeholders referenced in this profile&apos;s
            scripts. Sites can override these values in their{" "}
            <code className="rounded bg-[var(--bg-elevated)] px-1">site.yaml</code>.
          </p>
          {requiredPlaceholders.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <span className="font-semibold text-amber-500">
                Required by scripts:
              </span>{" "}
              <span className="font-mono text-[var(--text-secondary)]">
                {requiredPlaceholders.join(", ")}
              </span>
            </div>
          )}
          <ScriptVariablesEditor
            value={scriptVars}
            onChange={(v): void => updateField("scripts_vars", v)}
            requiredKeys={requiredPlaceholders}
          />
        </div>
      ),
    },
    {
      id: "ads-txt",
      label: "ads.txt",
      content: (
        <AdsTxtEditor
          value={config.ads_txt ?? []}
          onChange={(v): void => updateField("ads_txt", v)}
        />
      ),
    },
    {
      id: "sites",
      label: `Sites (${sites.length})`,
      content: (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
          {sites.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No sites are using this monetization profile yet.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-secondary)]">
              {sites.map((site) => (
                <li key={site.domain} className="py-3">
                  <Link
                    href={`/sites/${encodeURIComponent(site.domain)}`}
                    className="flex items-center justify-between gap-2 text-sm hover:text-cyan transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          site.active === false ? "bg-[var(--text-muted)]" : "bg-cyan"
                        }`}
                      />
                      <span className="font-medium">
                        {site.site_name ?? site.domain}
                      </span>
                      {!site.explicit && (
                        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] rounded bg-[var(--bg-surface)] px-1.5 py-0.5">
                          inherited
                        </span>
                      )}
                    </span>
                    <span className="text-[var(--text-muted)] text-xs">
                      {site.domain}
                      {site.group ? ` · ${site.group}` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{config.name ?? id}</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Monetization · <span className="font-mono">{id}</span>
            {config.provider ? ` · ${config.provider}` : ""}
          </p>
        </div>
        <Link
          href="/monetization"
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          ← Back to profiles
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      <Tabs tabs={tabs} defaultTab="general" />

      <div className="flex items-center justify-between">
        <Button onClick={save} loading={saving}>
          Save
        </Button>
        <Button
          variant="danger"
          onClick={handleDelete}
          loading={deleting}
          disabled={sites.length > 0}
        >
          Delete profile
        </Button>
      </div>
    </div>
  );
}
