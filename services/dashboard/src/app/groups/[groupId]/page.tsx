"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { RebuildConfirmModal } from "@/components/shared/RebuildConfirmModal";
import { UnifiedConfigForm } from "@/components/config/UnifiedConfigForm";
import type { UnifiedConfigFields } from "@/components/config/UnifiedConfigForm";

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
  ad_placeholder_heights?: Record<string, number>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Normalizers — transform raw API data into typed form values
// ---------------------------------------------------------------------------

function normalizeAdsTxt(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    return raw.split("\n").map((l) => l.trim()).filter(Boolean);
  }
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
        device: (p.devices ?? p.device ?? "all") as "all" | "desktop" | "mobile",
        sizes,
      };
    }),
  };
}

export default function GroupDetailPage(): React.ReactElement {
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;
  const router = useRouter();
  const { toast } = useToast();

  const [config, setConfig] = useState<GroupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groupSites, setGroupSites] = useState<
    Array<{ domain: string; site_name?: string }>
  >([]);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [groupRes, sitesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`),
        fetch(`/api/groups/${groupId}/sites`),
      ]);
      if (!groupRes.ok) {
        throw new Error(`Failed to load group: HTTP ${groupRes.status}`);
      }
      const groupData = (await groupRes.json()) as GroupConfig;
      setConfig(groupData);

      if (sitesRes.ok) {
        const sitesData = (await sitesRes.json()) as Array<{
          domain: string;
          site_name?: string;
        }>;
        setGroupSites(sitesData);
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
      setShowRebuildModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(`Group '${config?.name ?? groupId}' deleted`, "success");
      router.push("/groups");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
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

  // Build the config object for UnifiedConfigForm
  const formConfig: Partial<UnifiedConfigFields> = {
    tracking: normalizeTracking(config.tracking),
    scripts: normalizeScripts(config.scripts),
    scripts_vars: (config.scripts_vars ?? config.script_variables ?? {}) as Record<string, string>,
    ads_config: normalizeAdsConfig(
      (config.ads_config ?? config.ads) as Record<string, unknown> | undefined,
    ),
    ad_placeholder_heights: config.ad_placeholder_heights as UnifiedConfigFields["ad_placeholder_heights"] | undefined,
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
      id: "config",
      label: "Config",
      content: (
        <UnifiedConfigForm
          config={formConfig}
          onChange={(updated): void => {
            if (!config) return;
            setConfig({ ...config, ...updated } as GroupConfig);
          }}
          mode="group"
        />
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

      <div className="flex items-center justify-between">
        <Button onClick={save} loading={saving}>
          Save
        </Button>
        <Button
          variant="danger"
          onClick={(): void => setShowDeleteModal(true)}
        >
          Delete Group
        </Button>
      </div>

      {/* Rebuild confirmation modal */}
      <RebuildConfirmModal
        open={showRebuildModal}
        onClose={(): void => setShowRebuildModal(false)}
        affectedSites={groupSites}
        changeLabel={`group '${config?.name ?? groupId}'`}
      />

      {/* Delete confirmation modal */}
      <Modal
        open={showDeleteModal}
        onClose={(): void => setShowDeleteModal(false)}
        title="Delete group?"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            This will permanently delete the group{" "}
            <span className="font-semibold text-[var(--text-primary)]">
              &lsquo;{config?.name ?? groupId}&rsquo;
            </span>.{" "}
            {groupSites.length > 0
              ? `${groupSites.length} site(s) currently reference this group.`
              : "No sites currently reference this group."}
          </p>

          {groupSites.length > 0 && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
              <p className="text-xs font-medium text-yellow-400">
                These sites will lose this group from their configuration. You should reassign them first.
              </p>
              <ul className="text-xs text-[var(--text-secondary)] space-y-1">
                {groupSites.slice(0, 10).map((site) => (
                  <li key={site.domain} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-yellow-400" />
                    {site.site_name ?? site.domain}
                    <span className="text-[var(--text-muted)]">({site.domain})</span>
                  </li>
                ))}
                {groupSites.length > 10 && (
                  <li className="text-[var(--text-muted)]">
                    + {groupSites.length - 10} more
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={(): void => setShowDeleteModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
