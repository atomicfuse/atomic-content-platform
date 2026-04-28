"use client";

import { useCallback, useState } from "react";
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

/** Per-field merge modes for override configs. */
export interface OverrideMergeModes {
  tracking: "merge" | "replace";
  scripts: "merge_by_id" | "replace";
  scripts_vars: "merge" | "replace";
  ads_config: "add" | "replace" | "merge_placements";
  ads_txt: "add" | "replace";
  theme: "merge" | "replace";
  legal: "merge" | "replace";
}

export const DEFAULT_MERGE_MODES: OverrideMergeModes = {
  tracking: "merge",
  scripts: "merge_by_id",
  scripts_vars: "merge",
  ads_config: "add",
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
  /** Current merge modes per field (used when mode='override' or mode='site'). */
  mergeModes?: OverrideMergeModes;
  /** Callback when a merge mode changes (used when mode='override' or mode='site'). */
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
  /** Example: what the inherited chain looks like. */
  exampleInherited: string;
  /** Example: what the override defines. */
  exampleOverride: string;
  /** Example: the resulting output after applying this mode. */
  exampleResult: string;
}

const TRACKING_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Only change the fields you set. Other tracking IDs inherit from groups.",
    exampleInherited: "GA4: G-AAA, GTM: GTM-BBB",
    exampleOverride: "GA4: G-NEW",
    exampleResult: "GA4: G-NEW, GTM: GTM-BBB",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe all inherited tracking. Only what you define here will remain.",
    exampleInherited: "GA4: G-AAA, GTM: GTM-BBB",
    exampleOverride: "GA4: G-NEW",
    exampleResult: "GA4: G-NEW (GTM gone)",
  },
];

const SCRIPTS_MODES: ModeOption[] = [
  {
    value: "merge_by_id",
    label: "Merge by ID (recommended)",
    info: "Add new scripts or replace specific ones by their ID. Existing scripts are preserved.",
    exampleInherited: "analytics (id:1), chat (id:2)",
    exampleOverride: "analytics-v2 (id:1), pixel (id:3)",
    exampleResult: "analytics-v2 (id:1), chat (id:2), pixel (id:3)",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Remove all inherited scripts and use only these. Ad network SDKs will be removed unless re-included.",
    exampleInherited: "analytics (id:1), chat (id:2)",
    exampleOverride: "pixel (id:3)",
    exampleResult: "pixel (id:3) only",
  },
];

const SCRIPTS_VARS_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Your variables are added to the chain. Existing placeholders in group scripts keep working.",
    exampleInherited: "SITE_ID=abc, AD_KEY=xyz",
    exampleOverride: "SITE_ID=new",
    exampleResult: "SITE_ID=new, AD_KEY=xyz",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe all variables. Scripts referencing removed variables will break.",
    exampleInherited: "SITE_ID=abc, AD_KEY=xyz",
    exampleOverride: "SITE_ID=new",
    exampleResult: "SITE_ID=new (AD_KEY gone)",
  },
];

const ADS_CONFIG_MODES: ModeOption[] = [
  {
    value: "add",
    label: "Add (recommended)",
    info: "Append placements on top of inherited ones. Even if IDs match, nothing is replaced \u2014 you get both. Use this to stack multiple units in the same slot.",
    exampleInherited: "sidebar (id:1), sticky-bottom (id:2)",
    exampleOverride: "sidebar (id:3)",
    exampleResult: "sidebar (id:1), sticky-bottom (id:2), sidebar (id:3) \u2190 two sidebars",
  },
  {
    value: "merge_placements",
    label: "Merge placements",
    info: "Match by ID: same-ID placements are replaced, new IDs are added. No duplicates. Use this to swap out a specific placement.",
    exampleInherited: "sidebar (id:1), sticky-bottom (id:2)",
    exampleOverride: "sidebar-wide (id:1), banner (id:3)",
    exampleResult: "sidebar-wide (id:1), sticky-bottom (id:2), banner (id:3)",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe the entire ad layout and use only what you define here.",
    exampleInherited: "sidebar (id:1), sticky-bottom (id:2)",
    exampleOverride: "banner (id:3)",
    exampleResult: "banner (id:3) only",
  },
];

const ADS_TXT_MODES: ModeOption[] = [
  {
    value: "add",
    label: "Add (recommended)",
    info: "Your entries are appended. Existing ad partner entries are preserved.",
    exampleInherited: "google.com, DIRECT\ntaboola.com, DIRECT",
    exampleOverride: "newpartner.com, DIRECT",
    exampleResult: "google.com + taboola.com + newpartner.com",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Remove all inherited entries. Can break ad partner verification and stop revenue.",
    exampleInherited: "google.com, DIRECT\ntaboola.com, DIRECT",
    exampleOverride: "newpartner.com, DIRECT",
    exampleResult: "newpartner.com only",
  },
];

const THEME_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Change only the theme values you set. Fonts, logo, and colors inherit from groups.",
    exampleInherited: "primary: blue, font: Inter, logo: logo.svg",
    exampleOverride: "primary: red",
    exampleResult: "primary: red, font: Inter, logo: logo.svg",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe the entire theme. You must include all colors, fonts, logo, and favicon.",
    exampleInherited: "primary: blue, font: Inter, logo: logo.svg",
    exampleOverride: "primary: red",
    exampleResult: "primary: red (font, logo gone)",
  },
];

const LEGAL_MODES: ModeOption[] = [
  {
    value: "merge",
    label: "Merge (recommended)",
    info: "Your legal keys are added to the chain. Existing variables are preserved.",
    exampleInherited: "company: Acme, country: US",
    exampleOverride: "company: NewCo",
    exampleResult: "company: NewCo, country: US",
  },
  {
    value: "replace",
    label: "Replace",
    info: "Wipe all legal keys. May break shared pages that reference removed keys.",
    exampleInherited: "company: Acme, country: US",
    exampleOverride: "company: NewCo",
    exampleResult: "company: NewCo (country gone)",
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
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 mb-4">
      <p className="text-sm text-amber-700 dark:text-amber-300">
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
  const [showExplain, setShowExplain] = useState(false);

  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center gap-3">
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
        <button
          type="button"
          onClick={(): void => setShowExplain(!showExplain)}
          className="text-[11px] text-[var(--text-muted)] hover:text-cyan transition-colors underline decoration-dotted underline-offset-2"
        >
          {showExplain ? "hide" : "what do these modes do?"}
        </button>
      </div>

      {showExplain && (
        <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-elevated)]">
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">Mode</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">Inherited</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">Override</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">Result</th>
              </tr>
            </thead>
            <tbody>
              {options.map((opt, i) => (
                <tr
                  key={opt.value}
                  className={`${i < options.length - 1 ? "border-b border-[var(--border-secondary)]" : ""} ${opt.value === value ? "bg-cyan/5" : ""}`}
                >
                  <td className="px-3 py-2 align-top">
                    <span className={`font-semibold whitespace-nowrap ${opt.value === value ? "text-cyan" : "text-[var(--text-primary)]"}`}>
                      {opt.label.replace(" (recommended)", "").replace(" (default)", "")}
                    </span>
                    <p className="text-[var(--text-muted)] mt-0.5 leading-snug">{opt.info}</p>
                  </td>
                  <td className="px-3 py-2 align-top font-mono text-[var(--text-secondary)] whitespace-pre-line">{opt.exampleInherited}</td>
                  <td className="px-3 py-2 align-top font-mono text-cyan whitespace-pre-line">{opt.exampleOverride}</td>
                  <td className="px-3 py-2 align-top font-mono font-semibold text-[var(--text-primary)] whitespace-pre-line">{opt.exampleResult}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const isSite = mode === "site";
  const showMergeModes = isOverride || isSite;
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
        {showMergeModes && (
          <>
            <MergeModeSelector
              fieldName="tracking"
              options={TRACKING_MODES}
              value={modes.tracking}
              onChange={(v): void => updateMode("tracking", v as "merge" | "replace")}
            />
            {showMergeModes && isReplaceMode("tracking") && <ReplaceWarningBanner fieldName="tracking" />}
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
            !showMergeModes
              ? "Scripts merge by ID across layers. Same ID = replace, new ID = append."
              : undefined
          }
        />
        {showMergeModes && (
          <>
            <MergeModeSelector
              fieldName="scripts"
              options={SCRIPTS_MODES}
              value={modes.scripts}
              onChange={(v): void => updateMode("scripts", v as "merge_by_id" | "replace")}
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
        {showMergeModes && (
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
            !showMergeModes
              ? "Ad placements replace parent entirely; other fields merge."
              : undefined
          }
        />
        {showMergeModes && (
          <>
            <MergeModeSelector
              fieldName="ads_config"
              options={ADS_CONFIG_MODES}
              value={modes.ads_config}
              onChange={(v): void => updateMode("ads_config", v as "add" | "replace" | "merge_placements")}
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
            !showMergeModes
              ? "Entries accumulate additively across org + groups + site."
              : undefined
          }
        />
        {showMergeModes && (
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
        {showMergeModes && (
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
        {showMergeModes && (
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
