"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

interface NetworkConfig {
  platform_version: string;
  network_id: string;
  network_name: string;
  created: string;
  [key: string]: unknown;
}

export default function NetworkSettingsPage(): React.ReactElement {
  const { toast } = useToast();
  const [config, setConfig] = useState<NetworkConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const res = await fetch("/api/settings/network");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NetworkConfig;
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load network config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  async function save(): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/network", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Network settings saved", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading network settings...</div>;
  }

  if (error && !config) {
    return (
      <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  if (!config) return <div />;

  return (
    <div className="max-w-3xl space-y-6">
      {error && (
        <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
        <Input
          label="Platform Version"
          value={config.platform_version}
          onChange={(e): void =>
            setConfig({ ...config, platform_version: e.target.value })
          }
        />

        <Input
          label="Network ID"
          value={config.network_id}
          readOnly
          className="opacity-60 cursor-not-allowed"
        />

        <Input
          label="Network Name"
          value={config.network_name}
          onChange={(e): void =>
            setConfig({ ...config, network_name: e.target.value })
          }
        />

        <Input
          label="Created"
          value={config.created}
          readOnly
          className="opacity-60 cursor-not-allowed"
        />
      </div>

      <div className="flex gap-3">
        <Button onClick={save} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
