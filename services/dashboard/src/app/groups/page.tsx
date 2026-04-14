"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

interface GroupSummary {
  id: string;
  name?: string;
  layout?: string;
  interstitial?: boolean;
  [key: string]: unknown;
}

export default function GroupsPage(): React.ReactElement {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const res = await fetch("/api/groups");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GroupSummary[];
      setGroups(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading groups...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Groups</h1>
        <Link href="/groups/new">
          <Button>Create New Group</Button>
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
                Group ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Layout
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Interstitial
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-secondary)]">
            {groups.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-[var(--text-muted)]"
                >
                  No groups found. Create one to get started.
                </td>
              </tr>
            )}
            {groups.map((group) => (
              <tr
                key={group.id}
                className="bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/groups/${group.id}`}
                    className="font-medium text-cyan hover:underline"
                  >
                    {group.name ?? group.id}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">
                  {group.id}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {String(group.layout ?? "-")}
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {group.interstitial ? "Yes" : "No"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
