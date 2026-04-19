"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

interface EmailConfig {
  address: string;
  destination: string;
  active: boolean;
  ruleId?: string;
}

interface EmailRoutingPanelProps {
  domain: string;
}

export function EmailRoutingPanel({ domain }: EmailRoutingPanelProps): React.ReactElement {
  const { toast } = useToast();
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    fetch(`/api/email-routing/${domain}`)
      .then((r) => r.json())
      .then((data: EmailConfig) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [domain]);

  const activate = async (): Promise<void> => {
    setActivating(true);
    try {
      const res = await fetch(`/api/email-routing/${domain}`, { method: "POST" });
      if (!res.ok) {
        const err = (await res.json()) as { error: string };
        toast(err.error, "error");
        setActivating(false);
        return;
      }
      const data = (await res.json()) as EmailConfig;
      setConfig(data);
      toast("Email routing activated", "success");
    } catch {
      toast("Failed to activate", "error");
    }
    setActivating(false);
  };

  const deactivate = async (): Promise<void> => {
    try {
      await fetch(`/api/email-routing/${domain}`, { method: "DELETE" });
      setConfig((prev) => prev ? { ...prev, active: false, ruleId: undefined } : null);
      toast("Email routing deactivated", "success");
    } catch {
      toast("Failed to deactivate", "error");
    }
  };

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading email config...</div>;
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email Routing</h3>
        {config?.active ? (
          <Badge label="Active" variant="success" />
        ) : (
          <Badge label="Pending" variant="warning" />
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">Contact email</span>
          <span className="text-sm font-mono text-[var(--text-primary)]">
            {config?.address ?? `contact@${domain}`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">Forwards to</span>
          <span className="text-sm font-mono text-[var(--text-primary)]">
            {config?.destination ?? "michal@atomiclabs.io"}
          </span>
        </div>
      </div>

      <div className="pt-2">
        {config?.active ? (
          <Button variant="ghost" size="sm" onClick={deactivate}>
            Deactivate Routing
          </Button>
        ) : (
          <Button size="sm" loading={activating} onClick={activate}>
            Activate Email Routing
          </Button>
        )}
      </div>
    </div>
  );
}
