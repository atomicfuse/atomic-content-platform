"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { syncDomainsFromCloudflare } from "@/actions/sync";
import { useToast } from "@/components/ui/Toast";

export function SyncDomainsButton(): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [syncCount, setSyncCount] = useState<number | null>(null);

  function handleSync(): void {
    startTransition(async () => {
      try {
        const result = await syncDomainsFromCloudflare();
        setSyncCount(result.newCount);
        if (result.newCount > 0) {
          toast(`Synced ${result.newCount} new domains from Cloudflare`, "success");
        } else {
          toast("All domains are already synced", "info");
        }
      } catch {
        toast("Failed to sync domains from Cloudflare", "error");
      }
    });
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handleSync}
      loading={isPending}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
      </svg>
      Sync Domains
      {syncCount !== null && syncCount > 0 && (
        <span className="text-xs text-cyan">+{syncCount}</span>
      )}
    </Button>
  );
}
