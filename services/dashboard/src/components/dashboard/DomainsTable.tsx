"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { DomainEntry } from "@/actions/domains";
import { fetchDomains } from "@/actions/domains";

interface DomainsTableProps {
  initialDomains: DomainEntry[];
}

export function DomainsTable({ initialDomains }: DomainsTableProps): React.ReactElement {
  const [domains, setDomains] = useState(initialDomains);
  const [isRefreshing, startRefresh] = useTransition();

  function handleRefresh(): void {
    startRefresh(async () => {
      const fresh = await fetchDomains();
      setDomains(fresh);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {domains.length} domain{domains.length !== 1 ? "s" : ""} in Cloudflare
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

      <div className="overflow-x-auto rounded-lg border border-[var(--border-secondary)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-elevated)]">
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Domain</th>
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Status</th>
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Connected Site</th>
              <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Zone ID</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr
                key={d.zoneId}
                className="border-b border-[var(--border-secondary)] last:border-b-0 hover:bg-[var(--bg-elevated)] transition-colors"
              >
                <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">
                  {d.domain}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    d.zoneStatus === "active"
                      ? "text-emerald-400"
                      : "text-amber-400"
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
