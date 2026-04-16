"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";

import { TrackingForm } from "@/components/settings/TrackingForm";
import { ScriptsEditor } from "@/components/settings/ScriptsEditor";
import { ScriptVariablesEditor } from "@/components/settings/ScriptVariablesEditor";
import { AdsConfigForm } from "@/components/settings/AdsConfigForm";
import { LegalForm } from "@/components/settings/LegalForm";

import { ThemeForm } from "@/components/groups/ThemeForm";
import { LegalPagesOverrideEditor } from "@/components/groups/LegalPagesOverrideEditor";

import { AdsTxtEditor } from "@/components/settings/AdsTxtEditor";

interface GroupConfig {
  name?: string;
  group_id?: string;
  ads_txt?: string | string[];
  tracking?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  scripts_vars?: Record<string, string>;
  script_variables?: Record<string, string>;
  ads_config?: Record<string, unknown>;
  ads?: Record<string, unknown>;
  theme?: Record<string, unknown>;
  legal?: Record<string, string>;
  legal_pages_override?: Record<string, string>;
  [key: string]: unknown;
}

interface OrgConfig {
  tracking?: Record<string, unknown>;
  [key: string]: unknown;
}

interface TrackingConfig {
  ga4: string | null;
  gtm: string | null;
  google_ads: string | null;
  facebook_pixel: string | null;
  custom: Array<{
    name: string;
    src: string;
    position: "head" | "body_start" | "body_end";
  }>;
}

interface ScriptsConfig {
  head: Array<{ id: string; src?: string; inline?: string; async?: boolean }>;
  body_start: Array<{
    id: string;
    src?: string;
    inline?: string;
    async?: boolean;
  }>;
  body_end: Array<{
    id: string;
    src?: string;
    inline?: string;
    async?: boolean;
  }>;
}

interface AdsConfigFormValue {
  interstitial: boolean;
  layout: string;
  in_content_slots?: number;
  sidebar?: boolean;
  ad_placements: Array<{
    id: string;
    position: string;
    sizes: { desktop?: number[][]; mobile?: number[][] };
    device: "all" | "desktop" | "mobile";
  }>;
}

function normalizeAdsTxt(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeTracking(
  raw: Record<string, unknown> | undefined,
): TrackingConfig {
  return {
    ga4: (raw?.ga4 as string) ?? null,
    gtm: (raw?.gtm as string) ?? null,
    google_ads: (raw?.google_ads as string) ?? null,
    facebook_pixel: (raw?.facebook_pixel as string) ?? null,
    custom: (raw?.custom as TrackingConfig["custom"]) ?? [],
  };
}

function normalizeScripts(
  raw: Record<string, unknown> | undefined,
): ScriptsConfig {
  function normalizeEntries(entries: unknown): ScriptsConfig["head"] {
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

function normalizeAdsConfig(
  raw: Record<string, unknown> | undefined,
): AdsConfigFormValue {
  const placements = Array.isArray(raw?.ad_placements) ? raw.ad_placements : [];
  return {
    interstitial: (raw?.interstitial as boolean) ?? false,
    layout: (raw?.layout as string) ?? "standard",
    in_content_slots: (raw?.in_content_slots as number) ?? 3,
    sidebar: (raw?.sidebar as boolean) ?? true,
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
      return {
        id: (p.id as string) ?? "",
        position: (p.position as string) ?? "",
        device: (p.devices ?? p.device ?? "all") as
          | "all"
          | "desktop"
          | "mobile",
        sizes,
      };
    }),
  };
}

/** Returns true if any of the given fields exists on the config object. */
function hasAny(config: GroupConfig, keys: readonly string[]): boolean {
  return keys.some((k) => k in config && config[k] != null);
}

export default function GroupDetailPage(): React.ReactElement {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { toast } = useToast();

  const [config, setConfig] = useState<GroupConfig | null>(null);
  const [orgConfig, setOrgConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [groupSites, setGroupSites] = useState<
    Array<{ domain: string; site_name?: string }>
  >([]);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [groupRes, orgRes, sitesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`),
        fetch("/api/settings/org"),
        fetch(`/api/groups/${groupId}/sites`),
      ]);
      if (!groupRes.ok) {
        throw new Error(`Failed to load group: HTTP ${groupRes.status}`);
      }
      const groupData = (await groupRes.json()) as GroupConfig;
      setConfig(groupData);

      if (orgRes.ok) {
        const orgData = (await orgRes.json()) as OrgConfig;
        setOrgConfig(orgData);
      }

      if (sitesRes.ok) {
        const sitesData = (await sitesRes.json()) as Array<{
          domain: string;
          site_name?: string;
        }>;
        setGroupSites(sitesData);
      }

      // Auto-expand advanced if any of those fields are set.
      if (
        hasAny(groupData, [
          "tracking",
          "scripts",
          "scripts_vars",
          "script_variables",
          "ads_config",
          "ads",
          "ads_txt",
        ])
      ) {
        setAdvancedOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load group config");
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function updateField(key: string, value: unknown): void {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  async function save(): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Group saved", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">Loading group...</div>
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

  const adsTxtEntries = normalizeAdsTxt(config.ads_txt);
  const trackingValue = normalizeTracking(config.tracking);
  const scriptsValue = normalizeScripts(config.scripts);
  const scriptVarsValue = (config.scripts_vars ??
    config.script_variables ??
    {}) as Record<string, string>;
  const adsConfigValue = normalizeAdsConfig(
    (config.ads_config ?? config.ads) as Record<string, unknown> | undefined,
  );

  const orgTracking = orgConfig?.tracking;
  const inheritedTracking = orgTracking
    ? normalizeTracking(orgTracking)
    : undefined;

  const tabs = [
    {
      id: "general",
      label: "General",
      content: (
        <div className="space-y-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
          <Input
            label="Group ID"
            value={groupId}
            readOnly
            className="opacity-60 cursor-not-allowed"
          />
          <Input
            label="Name"
            value={config.name ?? ""}
            onChange={(e): void => updateField("name", e.target.value)}
          />
        </div>
      ),
    },
    {
      id: "theme",
      label: "Theme",
      content: (
        <ThemeForm
          value={(config.theme ?? {}) as Record<string, unknown>}
          onChange={(v: Record<string, unknown>): void =>
            updateField("theme", v)
          }
        />
      ),
    },
    {
      id: "legal",
      label: "Legal",
      content: (
        <div className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Legal variables
            </h3>
            <LegalForm
              value={(config.legal ?? {}) as Record<string, string>}
              onChange={(v: Record<string, string>): void =>
                updateField("legal", v)
              }
            />
          </div>
          <div className="space-y-2 pt-4 border-t border-[var(--border-secondary)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Legal page overrides
            </h3>
            <LegalPagesOverrideEditor
              value={(config.legal_pages_override ?? {}) as Record<string, string>}
              onChange={(v: Record<string, string>): void =>
                updateField("legal_pages_override", v)
              }
            />
          </div>
        </div>
      ),
    },
    {
      id: "sites",
      label: `Sites (${groupSites.length})`,
      content: (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
          {groupSites.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No sites assigned to this group.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-secondary)]">
              {groupSites.map((site) => (
                <li key={site.domain} className="py-3">
                  <Link
                    href={`/sites/${encodeURIComponent(site.domain)}`}
                    className="flex items-center justify-between gap-2 text-sm hover:text-cyan transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan" />
                      <span className="font-medium">
                        {site.site_name ?? site.domain}
                      </span>
                    </span>
                    <span className="text-[var(--text-muted)] text-xs">
                      {site.domain}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    {
      id: "advanced",
      label: "Advanced",
      content: (
        <div className="space-y-4">
          <button
            type="button"
            onClick={(): void => setAdvancedOpen((o) => !o)}
            className="w-full text-left text-sm font-semibold text-[var(--text-primary)] flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 hover:bg-[var(--bg-surface)] transition-colors"
          >
            <span>{advancedOpen ? "Hide" : "Show"} group-level overrides</span>
            <span className="text-lg text-[var(--text-muted)]">
              {advancedOpen ? "−" : "+"}
            </span>
          </button>

          {advancedOpen && (
            <div className="space-y-6 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Tracking overrides
                </h3>
                <TrackingForm
                  value={trackingValue}
                  onChange={(v): void => updateField("tracking", v)}
                  inheritedValues={inheritedTracking}
                />
              </section>

              <section className="space-y-2 pt-4 border-t border-[var(--border-secondary)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Scripts
                </h3>
                <ScriptsEditor
                  value={scriptsValue}
                  onChange={(v): void => updateField("scripts", v)}
                />
              </section>

              <section className="space-y-2 pt-4 border-t border-[var(--border-secondary)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Script variables
                </h3>
                <ScriptVariablesEditor
                  value={scriptVarsValue}
                  onChange={(v: Record<string, string>): void =>
                    updateField("scripts_vars", v)
                  }
                />
              </section>

              <section className="space-y-2 pt-4 border-t border-[var(--border-secondary)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Ads config
                </h3>
                <AdsConfigForm
                  value={adsConfigValue}
                  onChange={(v): void => updateField("ads_config", v)}
                />
              </section>

              <section className="space-y-2 pt-4 border-t border-[var(--border-secondary)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  ads.txt
                </h3>
                <AdsTxtEditor
                  value={adsTxtEntries}
                  onChange={(v: string[]): void => updateField("ads_txt", v)}
                  scopeLabel="group"
                />
              </section>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{config.name ?? groupId}</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Group: <span className="font-mono">{groupId}</span>
          </p>
        </div>
      </div>

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
    </div>
  );
}
