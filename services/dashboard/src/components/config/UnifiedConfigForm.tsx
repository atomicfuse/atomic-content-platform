"use client";

import { useCallback } from "react";
import { TrackingForm } from "../settings/TrackingForm";
import { ScriptsEditor } from "../settings/ScriptsEditor";
import { ScriptVariablesEditor } from "../settings/ScriptVariablesEditor";
import { AdsConfigForm } from "../settings/AdsConfigForm";
import { AdsTxtEditor } from "../settings/AdsTxtEditor";
import { LegalForm } from "../settings/LegalForm";
import { ThemeForm } from "../groups/ThemeForm";
import { InfoTooltip } from "../ui/Tooltip";

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

/** Per-field merge modes for override configs. */
export interface OverrideMergeModes {
  tracking: "merge" | "replace";
  scripts: "merge_by_id" | "append" | "replace";
  scripts_vars: "merge" | "replace";
  ads_config: "replace" | "merge_placements";
  ads_txt: "add" | "replace";
  theme: "merge" | "replace";
  legal: "merge" | "replace";
}

export const DEFAULT_MERGE_MODES: OverrideMergeModes = {
  tracking: "merge",
  scripts: "merge_by_id",
  scripts_vars: "merge",
  ads_config: "replace",
  ads_txt: "add",
  theme: "merge",
  legal: "merge",
};

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
  /** Current merge modes per field (only used when mode='override'). */
  mergeModes?: OverrideMergeModes;
  /** Callback when a merge mode changes (only used when mode='override'). */
  onMergeModesChange?: (modes: OverrideMergeModes) => void;
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
// Mode option definitions
// ---------------------------------------------------------------------------

interface ModeOption {
  value: string;
  label: string;
  info: string;
}

const TRACKING_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Only change the fields you set. Other tracking IDs (GTM, Google Ads, Facebook Pixel) inherit from groups. Safe default \u2014 won\u2019t break existing tracking.",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe all inherited tracking and use ONLY what you define here. Any field not set will be null. Use only when you want to completely reset tracking for these sites.",
  },
];

const SCRIPTS_MODES: ModeOption[] = [
  {
    value: "merge_by_id",
    label: "Merge by ID (recommended)",
    info: "Add new scripts or replace specific ones by their id. Existing ad network scripts from groups are preserved. Safe default.",
  },
  {
    value: "append",
    label: "Append only",
    info: "Add new scripts to the group chain without replacing any existing ones. Use when you only need to add tracking pixels or test scripts.",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Remove all scripts from the group chain and use only these. Will kill ad network SDKs (GPT, Taboola, AdSense) unless you re-include them.",
  },
];

const SCRIPTS_VARS_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Your variables are added to the group chain\u2019s variables. Existing placeholders in group scripts continue to work.",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe all variables and use only yours. WARNING: if group scripts reference variables you don\u2019t redefine, the build will fail with \u2018unresolved placeholder\u2019 errors.",
  },
];

const ADS_CONFIG_MODES: ModeOption[] = [
  {
    value: "replace",
    label: "Replace (default)",
    info: "Wipe the group\u2019s ad layout and use this one entirely. Good when testing a completely different ad configuration. All placements in groups are removed.",
  },
  {
    value: "merge_placements",
    label: "Merge placements",
    info: "Keep the group\u2019s placements and add/update specific ones by id. Placements with the same id are replaced. New ids are added. Existing placements untouched.",
  },
];

const ADS_TXT_MODES: ModeOption[] = [
  {
    value: "add",
    label: "Add (recommended)",
    info: "Your entries are APPENDED to the group chain\u2019s entries. Real ad partner entries are preserved. Safe default \u2014 won\u2019t break revenue verification.",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Remove all entries from the group chain and use only yours. WARNING: this can break ad partner verification and stop revenue. Only use for testing isolated sites.",
  },
];

const THEME_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Change only the theme values you set. Fonts, logo, and other colors are inherited from groups. Safe \u2014 won\u2019t break site appearance.",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe the entire theme from groups and use only what you define. You must include all colors, fonts, logo, and favicon or the site will render broken.",
  },
];

const LEGAL_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Your legal keys are added to the group chain. Existing legal variables (company name, country, etc.) are preserved.",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe all legal keys and use only yours. May break shared legal pages that reference other keys.",
  },
];

// ---------------------------------------------------------------------------
// Replace warning banner
// ---------------------------------------------------------------------------

const FIELD_DISPLAY_NAMES: Record<string, string> = {
  tracking: "tracking",
  scripts: "scripts",
  scripts_vars: "script variables",
  ads_config: "ads config",
  ads_txt: "ads.txt entries",
  theme: "theme",
  legal: "legal variables",
};

function ReplaceWarningBanner({ fieldName }: { fieldName: string }): React.ReactElement {
  const displayName = FIELD_DISPLAY_NAMES[fieldName] ?? fieldName;
  return (
    <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 mb-4">
      <p className="text-sm text-amber-300">
        <span className="font-semibold">Replace mode:</span> the group chain&apos;s {displayName} will
        be wiped for targeted sites. Make sure you include all values you need.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode selector dropdown
// ---------------------------------------------------------------------------

function MergeModeSelector({
  fieldName,
  options,
  value,
  onChange,
}: {
  fieldName: string;
  options: ModeOption[];
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-3 mb-3">
      <label
        htmlFor={`mode-${fieldName}`}
        className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap"
      >
        Mode
      </label>
      <select
        id={`mode-${fieldName}`}
        value={value}
        onChange={(e): void => onChange(e.target.value)}
        className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {options.map((opt) =>
        opt.value === value ? (
          <InfoTooltip key={opt.value} content={opt.info} maxWidth={340} />
        ) : null,
      )}
    </div>
  );
}

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
  mergeModes: externalMergeModes,
  onMergeModesChange,
}: UnifiedConfigFormProps): React.ReactElement {
  const updateField = useCallback(
    <K extends keyof UnifiedConfigFields>(key: K, value: UnifiedConfigFields[K]): void => {
      onChange({ ...config, [key]: value });
    },
    [config, onChange],
  );

  const isOverride = mode === "override";
  const modes = externalMergeModes ?? DEFAULT_MERGE_MODES;

  const updateMode = useCallback(
    <K extends keyof OverrideMergeModes>(field: K, value: OverrideMergeModes[K]): void => {
      if (onMergeModesChange) {
        onMergeModesChange({ ...modes, [field]: value });
      }
    },
    [modes, onMergeModesChange],
  );

  const isReplaceMode = (field: keyof OverrideMergeModes): boolean => {
    return modes[field] === "replace";
  };

  return (
    <div className="space-y-8">
      {/* 1. Tracking */}
      <section>
        <SectionHeader title="Tracking" />
        {isOverride && (
          <>
            <MergeModeSelector
              fieldName="tracking"
              options={TRACKING_MODES}
              value={modes.tracking}
              onChange={(v): void => updateMode("tracking", v as "merge" | "replace")}
            />
            {isReplaceMode("tracking") && <ReplaceWarningBanner fieldName="tracking" />}
          </>
        )}
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
            !isOverride
              ? "Scripts merge by ID across layers. Same ID = replace, new ID = append."
              : undefined
          }
        />
        {isOverride && (
          <>
            <MergeModeSelector
              fieldName="scripts"
              options={SCRIPTS_MODES}
              value={modes.scripts}
              onChange={(v): void => updateMode("scripts", v as "merge_by_id" | "append" | "replace")}
            />
            {isReplaceMode("scripts") && <ReplaceWarningBanner fieldName="scripts" />}
          </>
        )}
        <ScriptsEditor
          value={config.scripts ?? DEFAULT_SCRIPTS}
          onChange={(v): void => updateField("scripts", v)}
        />
      </section>

      {/* 3. Script Variables */}
      <section>
        <SectionHeader title="Script Variables" />
        {isOverride && (
          <>
            <MergeModeSelector
              fieldName="scripts_vars"
              options={SCRIPTS_VARS_MODES}
              value={modes.scripts_vars}
              onChange={(v): void => updateMode("scripts_vars", v as "merge" | "replace")}
            />
            {isReplaceMode("scripts_vars") && <ReplaceWarningBanner fieldName="scripts_vars" />}
          </>
        )}
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
            !isOverride
              ? "Ad placements replace parent entirely; other fields merge."
              : undefined
          }
        />
        {isOverride && (
          <>
            <MergeModeSelector
              fieldName="ads_config"
              options={ADS_CONFIG_MODES}
              value={modes.ads_config}
              onChange={(v): void => updateMode("ads_config", v as "replace" | "merge_placements")}
            />
            {isReplaceMode("ads_config") && <ReplaceWarningBanner fieldName="ads_config" />}
          </>
        )}
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
            !isOverride
              ? "Entries accumulate additively across org + groups + site."
              : undefined
          }
        />
        {isOverride && (
          <>
            <MergeModeSelector
              fieldName="ads_txt"
              options={ADS_TXT_MODES}
              value={modes.ads_txt}
              onChange={(v): void => updateMode("ads_txt", v as "add" | "replace")}
            />
            {isReplaceMode("ads_txt") && <ReplaceWarningBanner fieldName="ads_txt" />}
          </>
        )}
        <AdsTxtEditor
          value={config.ads_txt ?? []}
          onChange={(v): void => updateField("ads_txt", v)}
          scopeLabel={mode}
        />
      </section>

      {/* 7. Theme */}
      <section>
        <SectionHeader title="Theme" />
        {isOverride && (
          <>
            <MergeModeSelector
              fieldName="theme"
              options={THEME_MODES}
              value={modes.theme}
              onChange={(v): void => updateMode("theme", v as "merge" | "replace")}
            />
            {isReplaceMode("theme") && <ReplaceWarningBanner fieldName="theme" />}
          </>
        )}
        <ThemeForm
          value={config.theme ?? {}}
          onChange={(v): void => updateField("theme", v)}
        />
      </section>

      {/* 8. Legal */}
      <section>
        <SectionHeader title="Legal" />
        {isOverride && (
          <>
            <MergeModeSelector
              fieldName="legal"
              options={LEGAL_MODES}
              value={modes.legal}
              onChange={(v): void => updateMode("legal", v as "merge" | "replace")}
            />
            {isReplaceMode("legal") && <ReplaceWarningBanner fieldName="legal" />}
          </>
        )}
        <LegalForm
          value={config.legal ?? {}}
          onChange={(v): void => updateField("legal", v)}
        />
      </section>
    </div>
  );
}
