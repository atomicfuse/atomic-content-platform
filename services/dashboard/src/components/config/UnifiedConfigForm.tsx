"use client";

import { useCallback } from "react";
import { TrackingForm } from "../settings/TrackingForm";
import { ScriptsEditor } from "../settings/ScriptsEditor";
import { ScriptVariablesEditor } from "../settings/ScriptVariablesEditor";
import { AdsConfigForm } from "../settings/AdsConfigForm";
import { AdsTxtEditor } from "../settings/AdsTxtEditor";
import { LegalForm } from "../settings/LegalForm";
import { ThemeForm } from "../groups/ThemeForm";

import type { AdsConfigFormValue } from "../settings/AdsConfigForm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackingConfig {
  ga4: string | null;
  gtm: string | null;
  google_ads: string | null;
  facebook_pixel: string | null;
  custom: Array<{ name: string; src: string; position: "head" | "body_start" | "body_end" }>;
}

interface ScriptEntry {
  id: string;
  src?: string;
  inline?: string;
  async?: boolean;
}

interface ScriptsConfig {
  head: ScriptEntry[];
  body_start: ScriptEntry[];
  body_end: ScriptEntry[];
}

export interface AdPlaceholderHeights {
  "above-content": number;
  "after-paragraph": number;
  sidebar: number;
  "sticky-bottom": number;
}

export interface UnifiedConfigFields {
  tracking: TrackingConfig;
  scripts: ScriptsConfig;
  scripts_vars: Record<string, string>;
  ads_config: AdsConfigFormValue;
  ad_placeholder_heights: AdPlaceholderHeights;
  ads_txt: string[];
  theme: Record<string, unknown>;
  legal: Record<string, string>;
}

export interface UnifiedConfigFormProps {
  config: Partial<UnifiedConfigFields>;
  onChange: (config: Partial<UnifiedConfigFields>) => void;
  mode: "org" | "group" | "override" | "site";
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TRACKING: TrackingConfig = {
  ga4: null,
  gtm: null,
  google_ads: null,
  facebook_pixel: null,
  custom: [],
};

const DEFAULT_SCRIPTS: ScriptsConfig = {
  head: [],
  body_start: [],
  body_end: [],
};

const DEFAULT_ADS_CONFIG: AdsConfigFormValue = {
  interstitial: false,
  layout: "standard",
  ad_placements: [],
};

const DEFAULT_HEIGHTS: AdPlaceholderHeights = {
  "above-content": 90,
  "after-paragraph": 280,
  sidebar: 600,
  "sticky-bottom": 50,
};

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title, description }: { title: string; description?: string }): React.ReactElement {
  return (
    <div className="border-b border-[var(--border-primary)] pb-3 mb-4">
      <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
      {description && (
        <p className="text-xs text-[var(--text-muted)] mt-1">{description}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CLS Heights editor (small inline component)
// ---------------------------------------------------------------------------

function ClsHeightsEditor({
  value,
  onChange,
}: {
  value: AdPlaceholderHeights;
  onChange: (value: AdPlaceholderHeights) => void;
}): React.ReactElement {
  const keys: Array<{ key: keyof AdPlaceholderHeights; label: string }> = [
    { key: "above-content", label: "Above Content" },
    { key: "after-paragraph", label: "After Paragraph" },
    { key: "sidebar", label: "Sidebar" },
    { key: "sticky-bottom", label: "Sticky Bottom" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {keys.map(({ key, label }) => (
        <div key={key} className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {label}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={2000}
              value={value[key]}
              onChange={(e): void => {
                const num = parseInt(e.target.value, 10);
                if (!isNaN(num)) onChange({ ...value, [key]: num });
              }}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
            />
            <span className="text-xs text-[var(--text-muted)]">px</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function UnifiedConfigForm({
  config,
  onChange,
  mode,
}: UnifiedConfigFormProps): React.ReactElement {
  const updateField = useCallback(
    <K extends keyof UnifiedConfigFields>(key: K, value: UnifiedConfigFields[K]): void => {
      onChange({ ...config, [key]: value });
    },
    [config, onChange],
  );

  const modeLabel = mode === "override" ? "Override" : mode === "org" ? "Org" : mode === "group" ? "Group" : "Site";
  const isOverride = mode === "override";

  return (
    <div className="space-y-8">
      {/* 1. Tracking */}
      <section>
        <SectionHeader
          title="Tracking"
          description={isOverride ? "REPLACE semantics — defines tracking for targeted sites." : undefined}
        />
        <TrackingForm
          value={config.tracking ?? DEFAULT_TRACKING}
          onChange={(v): void => updateField("tracking", v)}
        />
      </section>

      {/* 2. Scripts */}
      <section>
        <SectionHeader
          title="Scripts"
          description={
            isOverride
              ? "REPLACE semantics — these scripts replace the group chain entirely."
              : "Scripts merge by ID across layers. Same ID = replace, new ID = append."
          }
        />
        <ScriptsEditor
          value={config.scripts ?? DEFAULT_SCRIPTS}
          onChange={(v): void => updateField("scripts", v)}
        />
      </section>

      {/* 3. Script Variables */}
      <section>
        <SectionHeader
          title="Script Variables"
          description={`Key-value pairs resolved as {{key}} in scripts. ${modeLabel}-level values ${isOverride ? "replace" : "override"} parent values.`}
        />
        <ScriptVariablesEditor
          value={config.scripts_vars ?? {}}
          onChange={(v): void => updateField("scripts_vars", v)}
        />
      </section>

      {/* 4. Ads Config */}
      <section>
        <SectionHeader
          title="Ads Config"
          description={
            isOverride
              ? "REPLACE semantics — entire ads_config replaced for targeted sites."
              : "Ad placements replace parent entirely; other fields merge."
          }
        />
        <AdsConfigForm
          value={config.ads_config ?? DEFAULT_ADS_CONFIG}
          onChange={(v): void => updateField("ads_config", v)}
        />
      </section>

      {/* 5. CLS Placeholder Heights (org/group only — no per-site override) */}
      {(mode === "org" || mode === "group") && (
        <section>
          <SectionHeader
            title="CLS Placeholder Heights"
            description="Reserved vertical space (px) for ad containers before JS loads. Prevents layout shift."
          />
          <ClsHeightsEditor
            value={config.ad_placeholder_heights ?? DEFAULT_HEIGHTS}
            onChange={(v): void => updateField("ad_placeholder_heights", v)}
          />
        </section>
      )}

      {/* 6. ads.txt */}
      <section>
        <SectionHeader
          title="ads.txt"
          description={
            isOverride
              ? "REPLACE semantics — these entries replace the accumulated ads.txt."
              : "Entries accumulate additively across org + groups + site."
          }
        />
        <AdsTxtEditor
          value={config.ads_txt ?? []}
          onChange={(v): void => updateField("ads_txt", v)}
          scopeLabel={mode}
        />
      </section>

      {/* 7. Theme */}
      <section>
        <SectionHeader
          title="Theme"
          description={
            isOverride
              ? "REPLACE semantics — entire theme replaced for targeted sites."
              : "Colors deep merge; other fields last-defined wins."
          }
        />
        <ThemeForm
          value={config.theme ?? {}}
          onChange={(v): void => updateField("theme", v)}
        />
      </section>

      {/* 8. Legal */}
      <section>
        <SectionHeader
          title="Legal"
          description="Template variables available as {{key}} in legal page templates."
        />
        <LegalForm
          value={config.legal ?? {}}
          onChange={(v): void => updateField("legal", v)}
        />
      </section>
    </div>
  );
}
