"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { UnifiedConfigForm, DEFAULT_MERGE_MODES } from "@/components/config/UnifiedConfigForm";
import type { UnifiedConfigFields, OverrideMergeModes } from "@/components/config/UnifiedConfigForm";
import {
  normalizeTracking,
  normalizeScripts,
  normalizeAdsConfig,
  normalizeAdsTxt,
} from "@/lib/config-normalizers";

interface SiteConfigTabProps {
  domain: string;
}

interface SiteConfigResponse {
  config: Record<string, unknown>;
  inheritance: {
    org: Record<string, unknown> | null;
    groups: Array<{ id: string; config: Record<string, unknown> | null }>;
  };
}

export function SiteConfigTab({ domain }: SiteConfigTabProps): React.ReactElement {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formConfig, setFormConfig] = useState<Partial<UnifiedConfigFields>>({});
  const [mergeModes, setMergeModes] = useState<OverrideMergeModes>({ ...DEFAULT_MERGE_MODES });

  const fetchConfig = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const res = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SiteConfigResponse;
      const raw = data.config;

      setFormConfig({
        tracking: normalizeTracking(raw.tracking as Record<string, unknown> | undefined),
        scripts: normalizeScripts(raw.scripts as Record<string, unknown> | undefined),
        scripts_vars: (raw.scripts_vars ?? raw.script_variables ?? {}) as Record<string, string>,
        ads_config: normalizeAdsConfig(
          (raw.ads_config ?? raw.ads) as Record<string, unknown> | undefined,
        ),
        ads_txt: normalizeAdsTxt(raw.ads_txt),
        theme: (raw.theme ?? {}) as Record<string, unknown>,
        legal: (raw.legal ?? {}) as Record<string, string>,
      });

      // Restore persisted merge modes from site.yaml (if any)
      const modes = raw.merge_modes as Partial<OverrideMergeModes> | undefined;
      if (modes && typeof modes === "object") {
        setMergeModes({ ...DEFAULT_MERGE_MODES, ...modes });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, [domain]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          faviconBase64: null,
          configUpdates: {
            tracking: formConfig.tracking,
            scripts: formConfig.scripts,
            scripts_vars: formConfig.scripts_vars,
            ads_config: formConfig.ads_config,
            merge_modes: mergeModes,
          },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") {
        toast("Config saved", "success");
      } else {
        toast(data.message ?? "Failed to save", "error");
      }
    } catch {
      toast("Failed to save config", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading config...</div>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-error bg-error/10 p-4 text-sm text-error">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UnifiedConfigForm
        config={formConfig}
        onChange={setFormConfig}
        mode="site"
        mergeModes={mergeModes}
        onMergeModesChange={setMergeModes}
      />
      <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
        <Button onClick={handleSave} loading={saving}>
          Save Config
        </Button>
      </div>
    </div>
  );
}
