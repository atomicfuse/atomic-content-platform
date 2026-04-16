"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";

import { TrackingForm } from "@/components/settings/TrackingForm";
import { ScriptsEditor } from "@/components/settings/ScriptsEditor";
import { ScriptVariablesEditor } from "@/components/settings/ScriptVariablesEditor";
import { AdsConfigForm } from "@/components/settings/AdsConfigForm";
import { AdsTxtEditor } from "@/components/settings/AdsTxtEditor";

interface OverrideConfig {
  override_id?: string;
  name?: string;
  priority?: number;
  targets?: { groups?: string[]; sites?: string[] };
  tracking?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  scripts_vars?: Record<string, string>;
  ads_config?: Record<string, unknown>;
  ads_txt?: string | string[];
  [key: string]: unknown;
}

interface GroupSummary {
  id: string;
  group_id?: string;
  name?: string;
}

interface SiteSummary {
  domain: string;
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
  body_start: Array<{ id: string; src?: string; inline?: string; async?: boolean }>;
  body_end: Array<{ id: string; src?: string; inline?: string; async?: boolean }>;
}

interface AdsConfigFormValue {
  interstitial: boolean;
  layout: string;
  ad_placements: Array<{
    id: string;
    position: string;
    sizes: { desktop?: number[][]; mobile?: number[][] };
    device: "all" | "desktop" | "mobile";
  }>;
}

function normalizeAdsTxt(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return [];
}

function normalizeTracking(raw: Record<string, unknown> | undefined): TrackingConfig {
  return {
    ga4: (raw?.ga4 as string) ?? null,
    gtm: (raw?.gtm as string) ?? null,
    google_ads: (raw?.google_ads as string) ?? null,
    facebook_pixel: (raw?.facebook_pixel as string) ?? null,
    custom: (raw?.custom as TrackingConfig["custom"]) ?? [],
  };
}

function normalizeScripts(raw: Record<string, unknown> | undefined): ScriptsConfig {
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

function normalizeAdsConfig(raw: Record<string, unknown> | undefined): AdsConfigFormValue {
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

export default function OverrideDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const overrideId = params.id;
  const router = useRouter();
  const { toast } = useToast();

  const [config, setConfig] = useState<OverrideConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [allGroups, setAllGroups] = useState<GroupSummary[]>([]);
  const [allSites, setAllSites] = useState<SiteSummary[]>([]);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [overrideRes, groupsRes, sitesRes] = await Promise.all([
        fetch(`/api/overrides/${overrideId}`),
        fetch("/api/groups"),
        fetch("/api/sites/list"),
      ]);
      if (!overrideRes.ok) throw new Error(`HTTP ${overrideRes.status}`);
      setConfig((await overrideRes.json()) as OverrideConfig);
      if (groupsRes.ok) setAllGroups((await groupsRes.json()) as GroupSummary[]);
      if (sitesRes.ok) setAllSites((await sitesRes.json()) as SiteSummary[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load override");
    } finally {
      setLoading(false);
    }
  }, [overrideId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function updateField(key: string, value: unknown): void {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  }

  function toggleTargetGroup(groupId: string): void {
    if (!config) return;
    const targets = config.targets ?? { groups: [], sites: [] };
    const groups = targets.groups ?? [];
    const newGroups = groups.includes(groupId)
      ? groups.filter((g) => g !== groupId)
      : [...groups, groupId];
    setConfig({ ...config, targets: { ...targets, groups: newGroups } });
  }

  function toggleTargetSite(domain: string): void {
    if (!config) return;
    const targets = config.targets ?? { groups: [], sites: [] };
    const sites = targets.sites ?? [];
    const newSites = sites.includes(domain)
      ? sites.filter((s) => s !== domain)
      : [...sites, domain];
    setConfig({ ...config, targets: { ...targets, sites: newSites } });
  }

  async function save(): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/overrides/${overrideId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Override saved", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!confirm(`Delete override "${overrideId}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/overrides/${overrideId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Override deleted", "success");
      router.push("/overrides");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading override...</div>;
  }

  if (error && !config) {
    return (
      <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  if (!config) return <div />;

  const targetGroups = config.targets?.groups ?? [];
  const targetSites = config.targets?.sites ?? [];
  const trackingValue = normalizeTracking(config.tracking);
  const scriptsValue = normalizeScripts(config.scripts);
  const scriptVarsValue = (config.scripts_vars ?? {}) as Record<string, string>;
  const adsConfigValue = normalizeAdsConfig(config.ads_config as Record<string, unknown> | undefined);
  const adsTxtEntries = normalizeAdsTxt(config.ads_txt);

  const tabs = [
    {
      id: "general",
      label: "General",
      content: (
        <div className="space-y-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
          <Input label="Override ID" value={overrideId} readOnly className="opacity-60 cursor-not-allowed" />
          <Input
            label="Name"
            value={config.name ?? ""}
            onChange={(e): void => updateField("name", e.target.value)}
          />
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Priority
            </label>
            <input
              type="number"
              value={config.priority ?? 0}
              onChange={(e): void => updateField("priority", Number(e.target.value))}
              min={0}
              max={1000}
              className="w-24 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <p className="text-xs text-[var(--text-muted)]">
              Higher = applied later = wins conflicts.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: "targeting",
      label: `Targeting (${targetGroups.length + targetSites.length})`,
      content: (
        <div className="space-y-6">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-[var(--text-secondary)]">
            This override applies to the <strong>union</strong> of targeted
            groups and individual sites. A site is affected if it belongs to any
            targeted group OR is listed directly.
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Target Groups</h3>
            <div className="space-y-1">
              {allGroups.map((g) => {
                const gId = g.group_id ?? g.id;
                const selected = targetGroups.includes(gId);
                return (
                  <button
                    key={gId}
                    type="button"
                    onClick={(): void => toggleTargetGroup(gId)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-[var(--border-primary)] hover:border-[var(--border-secondary)]"
                    }`}
                  >
                    <span className="font-medium">{g.name ?? gId}</span>
                    <span className="ml-2 text-xs text-[var(--text-muted)]">{gId}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Target Sites</h3>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {allSites.map((s) => {
                const selected = targetSites.includes(s.domain);
                return (
                  <button
                    key={s.domain}
                    type="button"
                    onClick={(): void => toggleTargetSite(s.domain)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-[var(--border-primary)] hover:border-[var(--border-secondary)]"
                    }`}
                  >
                    {s.domain}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "tracking",
      label: "Tracking",
      content: (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--text-secondary)]">
            Fields defined here <strong>REPLACE</strong> the group chain&apos;s
            tracking for targeted sites. Leave fields empty to pass through.
          </div>
          <TrackingForm value={trackingValue} onChange={(v): void => updateField("tracking", v)} />
        </div>
      ),
    },
    {
      id: "scripts",
      label: "Scripts",
      content: (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--text-secondary)]">
            Scripts arrays here <strong>REPLACE</strong> the group chain&apos;s
            scripts for targeted sites.
          </div>
          <ScriptsEditor value={scriptsValue} onChange={(v): void => updateField("scripts", v)} />
        </div>
      ),
    },
    {
      id: "script-vars",
      label: "Script Variables",
      content: (
        <ScriptVariablesEditor
          value={scriptVarsValue}
          onChange={(v: Record<string, string>): void => updateField("scripts_vars", v)}
        />
      ),
    },
    {
      id: "ads",
      label: "Ads Config",
      content: (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--text-secondary)]">
            ads_config here <strong>completely REPLACES</strong> the group
            chain&apos;s ads_config for targeted sites.
          </div>
          <AdsConfigForm value={adsConfigValue} onChange={(v): void => updateField("ads_config", v)} />
        </div>
      ),
    },
    {
      id: "ads-txt",
      label: "ads.txt",
      content: (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-[var(--text-secondary)]">
            ads_txt entries here <strong>REPLACE</strong> all group chain
            ads_txt entries for targeted sites.
          </div>
          <AdsTxtEditor value={adsTxtEntries} onChange={(v: string[]): void => updateField("ads_txt", v)} scopeLabel="override" />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{config.name ?? overrideId}</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Override: <span className="font-mono">{overrideId}</span>
            {" \u00B7 "}Priority: {config.priority ?? 0}
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
        <Button onClick={save} loading={saving}>Save</Button>
        <Button variant="danger" onClick={handleDelete} loading={deleting}>
          Delete
        </Button>
      </div>
    </div>
  );
}
