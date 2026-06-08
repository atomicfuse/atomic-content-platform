"use client";

import { useState, useTransition } from "react";
import { refreshSiteCache } from "@/actions/sites";

interface RefreshCacheButtonProps {
  domain: string;
  branch?: string | null;
}

export function RefreshCacheButton({ domain, branch }: RefreshCacheButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  async function handleClick() {
    setSpinning(true);
    await refreshSiteCache(domain, branch ?? undefined);
    // Full page reload — router.refresh() goes through Next.js RSC
    // caching layers that can serve stale data.
    window.location.reload();
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending || spinning}
      title="Refresh data from Git & KV"
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
    >
      <svg
        className={`w-4 h-4 ${spinning || isPending ? "animate-spin" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
        />
      </svg>
      {isPending ? "Refreshing..." : "Refresh"}
    </button>
  );
}
