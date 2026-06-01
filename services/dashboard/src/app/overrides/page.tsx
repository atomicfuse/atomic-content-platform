"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

interface OverrideSummary {
  id: string;
  override_id?: string;
  name?: string;
  priority?: number;
  targets?: { groups?: string[]; sites?: string[] };
  [key: string]: unknown;
}

export default function OverridesPage(): React.ReactElement {
  const [overrides, setOverrides] = useState<OverrideSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverrides = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const res = await fetch("/api/overrides");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OverrideSummary[];
      setOverrides(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load overrides");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOverrides();
  }, [fetchOverrides]);

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading overrides...</div>;
  }

  function targetCount(o: OverrideSummary): number {
    return (o.targets?.groups?.length ?? 0) + (o.targets?.sites?.length ?? 0);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          Targeted config exceptions with REPLACE semantics. Fields defined in
          an override completely replace the group chain for targeted sites.
        </p>
        <Link href="/overrides/new">
          <Button>Create Override</Button>
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
                Override ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Priority
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Targets
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-secondary)]">
            {overrides.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No config overrides found. Create one to get started.
                </td>
              </tr>
            )}
            {overrides.map((o) => (
              <tr
                key={o.id}
                className="bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/overrides/${o.id}`}
                    className="font-medium text-cyan hover:underline"
                  >
                    {o.name ?? o.id}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">
                  {o.override_id ?? o.id}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {o.priority ?? 0}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {targetCount(o)} target{targetCount(o) !== 1 ? "s" : ""}
                  {o.targets?.groups?.length
                    ? ` (${o.targets.groups.length} group${o.targets.groups.length !== 1 ? "s" : ""})`
                    : ""}
                  {o.targets?.sites?.length
                    ? ` (${o.targets.sites.length} site${o.targets.sites.length !== 1 ? "s" : ""})`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
