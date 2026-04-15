"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DashboardSiteEntry } from "@/types/dashboard";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { SourceBadge, type SourceLayer } from "@/components/shared/SourceBadge";
import {
  PlacementPreview,
} from "@/components/monetization/PlacementPreview";
import type { AdPlacement } from "@/components/monetization/AdPlacementsEditor";

interface MonetizationTabProps {
  site: DashboardSiteEntry;
}

interface ProfileSummary {
  monetization_id: string;
  name?: string;
  provider?: string;
  tracking?: Record<string, unknown>;
  ads_config?: Record<string, unknown>;
  scripts_vars?: Record<string, string>;
}

interface SiteConfigSnapshot {
  monetization?: string;
  tracking?: Record<string, unknown>;
}

interface OrgSnapshot {
  default_monetization?: string;
  tracking?: Record<string, unknown>;
}

type TrackingKey = "ga4" | "gtm" | "google_ads" | "facebook_pixel";

interface ResolvedTrackingRow {
  key: TrackingKey;
  label: string;
  value: string | null;
  source: SourceLayer;
}

const TRACKING_LABELS: Record<TrackingKey, string> = {
  ga4: "GA4",
  gtm: "GTM",
  google_ads: "Google Ads",
  facebook_pixel: "Facebook Pixel",
};

/**
 * Resolves a single tracking ID through org → monetization → site, treating an
 * explicit `null` as "disabled" (no inheritance).
 */
function resolveTrackingValue(
  key: TrackingKey,
  org: Record<string, unknown> | undefined,
  mon: Record<string, unknown> | undefined,
  site: Record<string, unknown> | undefined,
): { value: string | null; source: SourceLayer } {
  if (site && key in site) {
    return { value: (site[key] as string | null) ?? null, source: "site" };
  }
  if (mon && key in mon) {
    return { value: (mon[key] as string | null) ?? null, source: "monetization" };
  }
  if (org && key in org) {
    return { value: (org[key] as string | null) ?? null, source: "org" };
  }
  return { value: null, source: "org" };
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
      device: (placement["device"] ?? "all") as AdPlacement["device"],
      sizes,
    };
  });
}

export function MonetizationTab({
  site,
}: MonetizationTabProps): React.ReactElement {
  const { toast } = useToast();

  const [siteConfig, setSiteConfig] = useState<SiteConfigSnapshot | null>(null);
  const [orgConfig, setOrgConfig] = useState<OrgSnapshot | null>(null);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<ProfileSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftMonetization, setDraftMonetization] = useState<string>("");

  // Load site, org, and profile list in parallel.
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [siteRes, orgRes, profilesRes] = await Promise.all([
          fetch(`/api/sites/site-config?domain=${encodeURIComponent(site.domain)}`),
          fetch("/api/settings/org"),
          fetch("/api/monetization"),
        ]);

        let siteCfg: SiteConfigSnapshot | null = null;
        if (siteRes.ok) {
          siteCfg = (await siteRes.json()) as SiteConfigSnapshot;
        }
        let org: OrgSnapshot | null = null;
        if (orgRes.ok) {
          org = (await orgRes.json()) as OrgSnapshot;
        }
        let profileList: ProfileSummary[] = [];
        if (profilesRes.ok) {
          profileList = (await profilesRes.json()) as ProfileSummary[];
        }

        if (cancelled) return;
        setSiteConfig(siteCfg);
        setOrgConfig(org);
        setProfiles(profileList);
        setDraftMonetization(siteCfg?.monetization ?? "");

        // Determine and fetch active profile.
        const activeId = siteCfg?.monetization ?? org?.default_monetization;
        if (activeId) {
          const detailRes = await fetch(`/api/monetization/${activeId}`);
          if (!cancelled && detailRes.ok) {
            setActiveProfile((await detailRes.json()) as ProfileSummary);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [site.domain]);

  const monetizationSource: SourceLayer = siteConfig?.monetization
    ? "site"
    : "org";

  const trackingRows: ResolvedTrackingRow[] = useMemo(() => {
    const keys: TrackingKey[] = ["ga4", "gtm", "google_ads", "facebook_pixel"];
    return keys.map((k) => {
      const { value, source } = resolveTrackingValue(
        k,
        orgConfig?.tracking,
        activeProfile?.tracking,
        siteConfig?.tracking,
      );
      return { key: k, label: TRACKING_LABELS[k], value, source };
    });
  }, [orgConfig, activeProfile, siteConfig]);

  const placements = useMemo(
    () => normalizePlacements(activeProfile?.ads_config?.["ad_placements"]),
    [activeProfile],
  );

  async function saveAssignment(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: site.domain,
          configUpdates: { monetization: draftMonetization },
          logoBase64: null,
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status !== "ok") {
        throw new Error(data.message ?? "Save failed");
      }
      toast("Monetization profile updated", "success");
      // Refresh active profile in-place.
      const activeId = draftMonetization || orgConfig?.default_monetization;
      setSiteConfig((prev) => ({
        ...(prev ?? {}),
        monetization: draftMonetization || undefined,
      }));
      if (activeId) {
        const detail = await fetch(`/api/monetization/${activeId}`);
        if (detail.ok) {
          setActiveProfile((await detail.json()) as ProfileSummary);
        }
      } else {
        setActiveProfile(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        Loading monetization details...
      </p>
    );
  }

  if (!site.staging_branch) {
    return (
      <div className="p-4 rounded-lg bg-cyan/5 border border-cyan/20">
        <p className="text-sm text-cyan">
          Monetization can be configured once the site has a staging branch.
          Complete the site creation flow first.
        </p>
      </div>
    );
  }

  const orgDefault = orgConfig?.default_monetization;
  const isDirty = (siteConfig?.monetization ?? "") !== draftMonetization;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-error bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Active monetization profile
          </h3>
          <SourceBadge
            source={monetizationSource}
            label={
              monetizationSource === "site"
                ? "Site override"
                : orgDefault
                  ? `Org default: ${orgDefault}`
                  : "From org"
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={draftMonetization}
            onChange={(e): void => setDraftMonetization(e.target.value)}
            className="flex-1 min-w-[200px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          >
            <option value="">
              {orgDefault
                ? `— Inherit org default (${orgDefault}) —`
                : "— No monetization —"}
            </option>
            {profiles.map((p) => (
              <option key={p.monetization_id} value={p.monetization_id}>
                {p.name ?? p.monetization_id}
                {p.provider ? ` · ${p.provider}` : ""}
              </option>
            ))}
          </select>

          <Button
            size="sm"
            onClick={saveAssignment}
            loading={saving}
            disabled={!isDirty}
          >
            Update assignment
          </Button>

          {activeProfile && (
            <Link
              href={`/monetization/${activeProfile.monetization_id}`}
              className="text-xs text-cyan hover:underline"
            >
              Edit profile →
            </Link>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Resolved tracking
        </h3>
        <div className="divide-y divide-[var(--border-secondary)]">
          {trackingRows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="text-[var(--text-secondary)] w-24">
                {row.label}
              </span>
              <span className="flex-1 font-mono text-xs text-[var(--text-primary)] truncate">
                {row.value === null ? (
                  <span className="text-[var(--text-muted)] italic">
                    disabled / not set
                  </span>
                ) : (
                  row.value
                )}
              </span>
              <SourceBadge
                source={row.source}
                label={
                  row.source === "monetization" && activeProfile
                    ? `From monetization: ${activeProfile.monetization_id}`
                    : row.source === "site"
                      ? "Site override"
                      : "From org"
                }
              />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Resolved ad placements
          </h3>
          {activeProfile ? (
            <Link
              href={`/monetization/${activeProfile.monetization_id}`}
              className="text-xs text-cyan hover:underline"
            >
              Edit placements in profile →
            </Link>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">
              No active profile
            </span>
          )}
        </div>
        {placements.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            No ad placements defined on the active profile.
          </p>
        ) : (
          <PlacementPreview placements={placements} />
        )}
      </section>
    </div>
  );
}
