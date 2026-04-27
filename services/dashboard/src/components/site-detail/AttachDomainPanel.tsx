"use client";

import { useState, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { attachCustomDomain, detachCustomDomain, getAvailableZones } from "@/actions/wizard";

interface AttachDomainPanelProps {
  domain: string;
  customDomain: string | null;
}

const REDEPLOY_CMD = "cd packages/site-worker && pnpm deploy:production";

export function AttachDomainPanel({
  domain,
  customDomain,
}: AttachDomainPanelProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [selectedZone, setSelectedZone] = useState("");
  const [zones, setZones] = useState<Array<{ domain: string; zoneId: string }>>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [redeployHint, setRedeployHint] = useState(false);

  useEffect(() => {
    if (customDomain) return;
    setLoadingZones(true);
    getAvailableZones()
      .then(setZones)
      .catch(() => setZones([]))
      .finally(() => setLoadingZones(false));
  }, [customDomain]);

  function handleAttach(): void {
    if (!selectedZone) return;
    startTransition(async () => {
      try {
        await attachCustomDomain(domain, selectedZone);
        setSelectedZone("");
        setRedeployHint(true);
        toast("Custom domain attached", "success");
      } catch {
        toast("Failed to attach domain", "error");
      }
    });
  }

  function handleDetach(): void {
    startTransition(async () => {
      try {
        await detachCustomDomain(domain);
        setRedeployHint(true);
        toast("Custom domain disconnected", "success");
      } catch {
        toast("Failed to disconnect domain", "error");
      }
    });
  }

  function copyCmd(): void {
    void navigator.clipboard.writeText(REDEPLOY_CMD);
    toast("Command copied", "success");
  }

  return (
    <div className="rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-primary)] p-6 space-y-3">
      <h3 className="text-sm font-bold text-[var(--text-primary)]">Custom Domain</h3>
      {customDomain ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-[var(--text-primary)]">
              Connected to <span className="font-mono text-cyan">{customDomain}</span>
            </span>
          </div>
          <Button size="sm" variant="danger" loading={isPending} onClick={handleDetach}>
            Disconnect
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <select
            value={selectedZone}
            onChange={(e): void => setSelectedZone(e.target.value)}
            disabled={loadingZones || zones.length === 0}
            className="flex-1 px-3 py-2 text-sm rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-primary)] outline-none focus:border-cyan"
          >
            <option value="">
              {loadingZones ? "Loading domains..." : zones.length === 0 ? "No available domains" : "Select a domain"}
            </option>
            {zones.map((z) => (
              <option key={z.zoneId} value={z.domain}>{z.domain}</option>
            ))}
          </select>
          <Button size="sm" loading={isPending} disabled={!selectedZone} onClick={handleAttach}>
            Attach Domain
          </Button>
        </div>
      )}

      {redeployHint && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 space-y-2">
          <p className="text-xs text-[var(--text-secondary)]">
            Domain change saved. The production worker only claims the route on its next deploy.
            Run this from the platform repo:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-primary)] truncate">
              {REDEPLOY_CMD}
            </code>
            <button
              onClick={copyCmd}
              className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] hover:bg-[var(--bg-surface)] transition-colors"
              type="button"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
