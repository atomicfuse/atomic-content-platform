"use client";

import { useState, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { attachCustomDomain, detachCustomDomain, getAvailableZones } from "@/actions/wizard";

interface AttachDomainPanelProps {
  domain: string;
  customDomain: string | null;
}

export function AttachDomainPanel({
  domain,
  customDomain,
}: AttachDomainPanelProps): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const [selectedZone, setSelectedZone] = useState<{ domain: string; zoneId: string } | null>(null);
  const [zones, setZones] = useState<Array<{ domain: string; zoneId: string }>>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customDomain) return;
    setLoadingZones(true);
    setError(null);
    getAvailableZones()
      .then(setZones)
      .catch((err) => {
        setZones([]);
        setError(err instanceof Error ? err.message : "Failed to load domains");
      })
      .finally(() => setLoadingZones(false));
  }, [customDomain]);

  function handleAttach(): void {
    if (!selectedZone) return;
    startTransition(async () => {
      try {
        await attachCustomDomain(domain, selectedZone.domain, selectedZone.zoneId);
        setSelectedZone(null);
        await fetch("/api/cache-flush", { method: "POST" });
        window.location.reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to attach domain", "error");
      }
    });
  }

  function handleDetach(): void {
    startTransition(async () => {
      try {
        await detachCustomDomain(domain);
        await fetch("/api/cache-flush", { method: "POST" });
        window.location.reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Failed to disconnect domain", "error");
      }
    });
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
        <>
          <div className="flex items-center gap-3">
            <select
              value={selectedZone?.domain ?? ""}
              onChange={(e): void => {
                const zone = zones.find((z) => z.domain === e.target.value) ?? null;
                setSelectedZone(zone);
              }}
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
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
