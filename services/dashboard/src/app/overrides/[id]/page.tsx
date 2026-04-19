"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { SearchableToggleList } from "@/components/shared/SearchableToggleList";
import { RebuildConfirmModal } from "@/components/shared/RebuildConfirmModal";
import { UnifiedConfigForm } from "@/components/config/UnifiedConfigForm";
import type { UnifiedConfigFields, OverrideMergeModes } from "@/components/config/UnifiedConfigForm";
import { DEFAULT_MERGE_MODES } from "@/components/config/UnifiedConfigForm";

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
  theme?: Record<string, unknown>;
  legal?: Record<string, string>;
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

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

function normalizeAdsTxt(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return [];
}

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

export default function OverrideDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const overrideId = params.id;
  const router = useRouter();
  const { toast } = useToast();

  const [config, setConfig] = useState<OverrideConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const [rebuildSites, setRebuildSites] = useState<
    Array<{ domain: string; site_name?: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);

  const [allGroups, setAllGroups] = useState<GroupSummary[]>([]);
  const [allSites, setAllSites] = useState<SiteSummary[]>([]);
  // Track the saved-in-git targets so we can union old + new for rebuild
  const [savedTargets, setSavedTargets] = useState<{ groups: string[]; sites: string[] }>({ groups: [], sites: [] });
  const [mergeModes, setMergeModes] = useState<OverrideMergeModes>({ ...DEFAULT_MERGE_MODES });

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [overrideRes, groupsRes, sitesRes] = await Promise.all([
        fetch(`/api/overrides/${overrideId}`),
        fetch("/api/groups"),
        fetch("/api/sites/list"),
      ]);
      if (!overrideRes.ok) throw new Error(`HTTP ${overrideRes.status}`);
      const overrideData = (await overrideRes.json()) as OverrideConfig;
      setConfig(overrideData);
      // Snapshot the targets as they exist in git
      setSavedTargets({
        groups: overrideData.targets?.groups ?? [],
        sites: overrideData.targets?.sites ?? [],
      });
      // Extract _mode from each field for the merge mode selector
      setMergeModes({
        tracking: (overrideData.tracking as Record<string, unknown>)?._mode as OverrideMergeModes["tracking"] ?? DEFAULT_MERGE_MODES.tracking,
        scripts: (overrideData.scripts as Record<string, unknown>)?._mode as OverrideMergeModes["scripts"] ?? DEFAULT_MERGE_MODES.scripts,
        scripts_vars: (overrideData.scripts_vars as Record<string, unknown>)?._mode as OverrideMergeModes["scripts_vars"] ?? DEFAULT_MERGE_MODES.scripts_vars,
        ads_config: (overrideData.ads_config as Record<string, unknown>)?._mode as OverrideMergeModes["ads_config"] ?? DEFAULT_MERGE_MODES.ads_config,
        ads_txt: Array.isArray(overrideData.ads_txt) || typeof overrideData.ads_txt === "string"
          ? DEFAULT_MERGE_MODES.ads_txt
          : ((overrideData.ads_txt as unknown as Record<string, unknown>)?._mode as OverrideMergeModes["ads_txt"] ?? DEFAULT_MERGE_MODES.ads_txt),
        theme: (overrideData.theme as Record<string, unknown>)?._mode as OverrideMergeModes["theme"] ?? DEFAULT_MERGE_MODES.theme,
        legal: (overrideData.legal as Record<string, unknown>)?._mode as OverrideMergeModes["legal"] ?? DEFAULT_MERGE_MODES.legal,
      });
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
      // Embed _mode into each field before saving
      const configToSave = { ...config };
      if (configToSave.tracking && mergeModes.tracking !== DEFAULT_MERGE_MODES.tracking) {
        configToSave.tracking = { ...configToSave.tracking, _mode: mergeModes.tracking };
      }
      if (configToSave.scripts && mergeModes.scripts !== DEFAULT_MERGE_MODES.scripts) {
        configToSave.scripts = { ...configToSave.scripts, _mode: mergeModes.scripts };
      }
      if (configToSave.scripts_vars && mergeModes.scripts_vars !== DEFAULT_MERGE_MODES.scripts_vars) {
        configToSave.scripts_vars = { ...configToSave.scripts_vars, _mode: mergeModes.scripts_vars };
      }
      if (configToSave.ads_config && mergeModes.ads_config !== DEFAULT_MERGE_MODES.ads_config) {
        configToSave.ads_config = { ...configToSave.ads_config, _mode: mergeModes.ads_config };
      }
      if (mergeModes.ads_txt !== DEFAULT_MERGE_MODES.ads_txt) {
        configToSave.ads_txt = { _mode: mergeModes.ads_txt, _values: normalizeAdsTxt(config.ads_txt) } as unknown as string[];
      }
      if (configToSave.theme && mergeModes.theme !== DEFAULT_MERGE_MODES.theme) {
        configToSave.theme = { ...configToSave.theme, _mode: mergeModes.theme };
      }
      if (configToSave.legal && mergeModes.legal !== DEFAULT_MERGE_MODES.legal) {
        configToSave.legal = { ...configToSave.legal, _mode: mergeModes.legal };
      }
      const res = await fetch(`/api/overrides/${overrideId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configToSave),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Override saved", "success");

      // Affected sites = UNION of old targets + new targets.
      const newGroups = config.targets?.groups ?? [];
      const newSites = config.targets?.sites ?? [];
      const allGroupIds = [...new Set([...savedTargets.groups, ...newGroups])];
      const allDirectSites = [...new Set([...savedTargets.sites, ...newSites])];

      const affected = new Map<string, { domain: string; site_name?: string }>();

      for (const domain of allDirectSites) {
        affected.set(domain, { domain });
      }

      await Promise.all(
        allGroupIds.map(async (gid) => {
          try {
            const gRes = await fetch(`/api/groups/${gid}/sites`);
            if (!gRes.ok) return;
            const sites = (await gRes.json()) as Array<{
              domain: string;
              site_name?: string;
            }>;
            for (const s of sites) {
              if (!affected.has(s.domain)) affected.set(s.domain, s);
            }
          } catch {
            // skip
          }
        }),
      );

      setSavedTargets({ groups: newGroups, sites: newSites });
      setRebuildSites(Array.from(affected.values()));
      setShowRebuildModal(true);
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

  // Build config for UnifiedConfigForm
  const formConfig: Partial<UnifiedConfigFields> = {
    tracking: normalizeTracking(config.tracking),
    scripts: normalizeScripts(config.scripts),
    scripts_vars: (config.scripts_vars ?? {}) as Record<string, string>,
    ads_config: normalizeAdsConfig(config.ads_config as Record<string, unknown> | undefined),
    ads_txt: normalizeAdsTxt(config.ads_txt),
    theme: (config.theme ?? {}) as Record<string, unknown>,
    legal: (config.legal ?? {}) as Record<string, string>,
  };

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
            <SearchableToggleList
              items={allGroups.map((g) => ({
                id: g.group_id ?? g.id,
                label: g.name ?? (g.group_id ?? g.id),
                sublabel: g.group_id ?? g.id,
              }))}
              selected={targetGroups}
              onToggle={toggleTargetGroup}
              searchPlaceholder="Search groups..."
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Target Sites</h3>
            <SearchableToggleList
              items={allSites.map((s) => ({
                id: s.domain,
                label: s.domain,
              }))}
              selected={targetSites}
              onToggle={toggleTargetSite}
              searchPlaceholder="Search sites..."
            />
          </div>
        </div>
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
            setConfig({ ...config, ...updated } as OverrideConfig);
          }}
          mode="override"
          mergeModes={mergeModes}
          onMergeModesChange={setMergeModes}
        />
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

      <RebuildConfirmModal
        open={showRebuildModal}
        onClose={(): void => setShowRebuildModal(false)}
        affectedSites={rebuildSites}
        changeLabel={`override '${config?.name ?? overrideId}'`}
      />
    </div>
  );
}
