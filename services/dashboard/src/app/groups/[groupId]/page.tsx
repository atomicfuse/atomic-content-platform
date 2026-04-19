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
import {
  normalizeAdsTxt,
  normalizeTracking,
  normalizeScripts,
  normalizeAdsConfig,
} from "@/lib/config-normalizers";

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
  const [allSites, setAllSites] = useState<
    Array<{ domain: string; status?: string }>
  >([]);
  const [siteSearch, setSiteSearch] = useState("");
  const [updatingSite, setUpdatingSite] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const [groupRes, sitesRes, allSitesRes] = await Promise.all([
        fetch(`/api/groups/${groupId}`),
        fetch(`/api/groups/${groupId}/sites`),
        fetch("/api/sites/list"),
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

      if (allSitesRes.ok) {
        const allData = (await allSitesRes.json()) as Array<{
          domain: string;
          status?: string;
        }>;
        setAllSites(allData);
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

  async function toggleSiteInGroup(
    domain: string,
    action: "add" | "remove",
  ): Promise<void> {
    setUpdatingSite(domain);
    try {
      const res = await fetch(`/api/groups/${groupId}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, action }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      if (action === "add") {
        setGroupSites((prev) => [...prev, { domain }]);
        toast(`Added ${domain} to group`, "success");
      } else {
        setGroupSites((prev) => prev.filter((s) => s.domain !== domain));
        toast(`Removed ${domain} from group`, "success");
      }
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to update site",
        "error",
      );
    } finally {
      setUpdatingSite(null);
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
      content: (() => {
        const assignedDomains = new Set(groupSites.map((s) => s.domain));
        const unassigned = allSites.filter(
          (s) => !assignedDomains.has(s.domain),
        );
        const filtered = siteSearch
          ? unassigned.filter((s) =>
              s.domain.toLowerCase().includes(siteSearch.toLowerCase()),
            )
          : unassigned;

        return (
          <div className="space-y-4">
            {/* Assigned sites */}
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                Assigned Sites
              </h3>
              {groupSites.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No sites assigned to this group.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border-secondary)]">
                  {groupSites.map((site) => (
                    <li
                      key={site.domain}
                      className="flex items-center justify-between py-2.5"
                    >
                      <Link
                        href={`/sites/${encodeURIComponent(site.domain)}`}
                        className="flex items-center gap-2 text-sm hover:text-cyan transition-colors"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan" />
                        <span className="font-medium">
                          {site.site_name ?? site.domain}
                        </span>
                        {site.site_name && (
                          <span className="text-[var(--text-muted)] text-xs">
                            {site.domain}
                          </span>
                        )}
                      </Link>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-error/30 text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                        disabled={updatingSite === site.domain}
                        onClick={(): void => {
                          void toggleSiteInGroup(site.domain, "remove");
                        }}
                      >
                        {updatingSite === site.domain ? "..." : "Remove"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Add sites */}
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">
                Add Sites
              </h3>
              <Input
                placeholder="Search sites..."
                value={siteSearch}
                onChange={(e): void => setSiteSearch(e.target.value)}
              />
              {filtered.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] mt-3">
                  {unassigned.length === 0
                    ? "All sites are already in this group."
                    : "No sites match your search."}
                </p>
              ) : (
                <ul className="divide-y divide-[var(--border-secondary)] mt-2 max-h-64 overflow-y-auto">
                  {filtered.map((site) => (
                    <li
                      key={site.domain}
                      className="flex items-center justify-between py-2.5"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]" />
                        <span>{site.domain}</span>
                        {site.status && (
                          <span className="text-[var(--text-muted)] text-xs">
                            {site.status}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded border border-cyan/30 text-cyan hover:bg-cyan/10 transition-colors disabled:opacity-50"
                        disabled={updatingSite === site.domain}
                        onClick={(): void => {
                          void toggleSiteInGroup(site.domain, "add");
                        }}
                      >
                        {updatingSite === site.domain ? "..." : "Add"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        );
      })(),
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
