"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { DomainEntry } from "@/actions/domains";
import { fetchDomains, setDomainHiddenAction } from "@/actions/domains";

interface DomainsTableProps {
  initialDomains: DomainEntry[];
}

export function DomainsTable({ initialDomains }: DomainsTableProps): React.ReactElement {
  const [domains, setDomains] = useState(initialDomains);
  const [isRefreshing, startRefresh] = useTransition();
  const [savingDomain, setSavingDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hiddenCount = domains.filter((d) => d.hidden).length;

  function handleRefresh(): void {
    startRefresh(async () => {
      const fresh = await fetchDomains();
      setDomains(fresh);
    });
  }

  async function handleToggleHidden(domain: string, hidden: boolean): Promise<void> {
    setSavingDomain(domain);
    setError(null);
    const result = await setDomainHiddenAction(domain, hidden);
    setSavingDomain(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDomains((prev) => prev.map((d) => (d.domain === domain ? { ...d, hidden } : d)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {domains.length} domain{domains.length !== 1 ? "s" : ""} in Cloudflare
          {hiddenCount > 0 && ` · ${hiddenCount} hidden from the site platform`}
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="overflow-auto max-h-[80vh] rounded-lg border border-[var(--border-secondary)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-elevated)]">
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Domain</th>
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Connected Site</th>
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Zone ID</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr
                key={d.zoneId}
                className={`border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] transition-colors ${
                  d.hidden ? "opacity-50" : ""
                }`}
              >
                <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                  {d.domain}
                  {d.hidden && (
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-secondary)]">
                      Hidden
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    d.zoneStatus === "active"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-amber-700 dark:text-amber-400"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      d.zoneStatus === "active" ? "bg-emerald-400" : "bg-amber-400"
                    }`} />
                    {d.zoneStatus}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {d.connectedSite ? (
                    <Link
                      href={`/sites/${d.connectedSite}`}
                      className="text-cyan hover:underline"
                    >
                      {d.connectedSite}
                    </Link>
                  ) : (
                    <span className="text-[var(--text-muted)]">--</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-muted)] font-mono text-xs">
                  {d.zoneId.slice(0, 12)}...
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={(): void => void handleToggleHidden(d.domain, !d.hidden)}
                    disabled={savingDomain !== null}
                    title={d.hidden ? "Offer this domain in the site platform again" : "Don't offer this domain when attaching a domain to a site"}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                  >
                    {savingDomain === d.domain ? "Saving..." : d.hidden ? "Unhide" : "Hide"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
