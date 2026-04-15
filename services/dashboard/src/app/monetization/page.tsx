"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

interface MonetizationSummary {
  monetization_id: string;
  name?: string;
  provider?: string;
  ads_config?: { layout?: string; ad_placements?: unknown[] };
  [key: string]: unknown;
}

interface SiteCountMap {
  [profileId: string]: number;
}

export default function MonetizationListPage(): React.ReactElement {
  const [profiles, setProfiles] = useState<MonetizationSummary[]>([]);
  const [siteCounts, setSiteCounts] = useState<SiteCountMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const res = await fetch("/api/monetization");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MonetizationSummary[];
      setProfiles(data);

      // Fetch site counts in parallel — best effort, failures hide the column.
      const counts: SiteCountMap = {};
      await Promise.all(
        data.map(async (p) => {
          try {
            const r = await fetch(`/api/monetization/${p.monetization_id}/sites`);
            if (r.ok) {
              const sites = (await r.json()) as unknown[];
              counts[p.monetization_id] = sites.length;
            }
          } catch {
            // ignore — column shows "—"
          }
        }),
      );
      setSiteCounts(counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monetization profiles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-secondary)]">
        Loading monetization profiles...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Monetization</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Reusable ad/tracking profiles. Sites reference one via{" "}
            <code className="rounded bg-[var(--bg-elevated)] px-1">monetization: &lt;id&gt;</code>.
          </p>
        </div>
        <Link href="/monetization/new">
          <Button>Create New Profile</Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--border-primary)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Provider
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Layout
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Placements
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Sites
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-secondary)]">
            {profiles.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No monetization profiles. Create one to get started.
                </td>
              </tr>
            )}
            {profiles.map((p) => {
              const placementCount = Array.isArray(p.ads_config?.ad_placements)
                ? p.ads_config!.ad_placements!.length
                : 0;
              const layout = p.ads_config?.layout ?? "—";
              const count = siteCounts[p.monetization_id];
              return (
                <tr
                  key={p.monetization_id}
                  className="bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/monetization/${p.monetization_id}`}
                      className="font-medium text-cyan hover:underline"
                    >
                      {p.name ?? p.monetization_id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">
                    {p.monetization_id}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {p.provider ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {layout}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {placementCount}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">
                    {typeof count === "number" ? count : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
