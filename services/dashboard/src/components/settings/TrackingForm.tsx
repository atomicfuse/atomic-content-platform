"use client";

import { useCallback } from "react";
import { InheritanceIndicator } from "@/components/ui/InheritanceIndicator";

/** Mirrors @atomic-platform/shared-types CustomTrackingScript */
interface CustomTrackingScript {
  name: string;
  src: string;
  position: "head" | "body_start" | "body_end";
}

/** Mirrors @atomic-platform/shared-types TrackingConfig */
interface TrackingConfig {
  ga4: string | null;
  gtm: string | null;
  google_ads: string | null;
  facebook_pixel: string | null;
  custom: CustomTrackingScript[];
}

interface TrackingFormProps {
  value: TrackingConfig;
  onChange: (value: TrackingConfig) => void;
  inheritedValues?: Partial<TrackingConfig>;
}

const VENDOR_FIELDS: Array<{
  key: keyof Pick<TrackingConfig, "ga4" | "gtm" | "google_ads" | "facebook_pixel">;
  label: string;
  placeholder: string;
}> = [
  { key: "ga4", label: "GA4 Measurement ID", placeholder: "G-XXXXXXXXXX" },
  { key: "gtm", label: "GTM Container ID", placeholder: "GTM-XXXXXXX" },
  { key: "google_ads", label: "Google Ads Conversion ID", placeholder: "AW-XXXXXXXXXX" },
  { key: "facebook_pixel", label: "Facebook Pixel ID", placeholder: "1234567890" },
];

const POSITION_OPTIONS: Array<{ value: CustomTrackingScript["position"]; label: string }> = [
  { value: "head", label: "Head" },
  { value: "body_start", label: "Body Start" },
  { value: "body_end", label: "Body End" },
];

export function TrackingForm({
  value,
  onChange,
  inheritedValues,
}: TrackingFormProps): React.ReactElement {
  const updateField = useCallback(
    (key: keyof TrackingConfig, fieldValue: string | null): void => {
      onChange({ ...value, [key]: fieldValue });
    },
    [value, onChange],
  );

  const updateCustomScript = useCallback(
    (index: number, patch: Partial<CustomTrackingScript>): void => {
      const updated = value.custom.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      );
      onChange({ ...value, custom: updated });
    },
    [value, onChange],
  );

  const addCustomScript = useCallback((): void => {
    onChange({
      ...value,
      custom: [...value.custom, { name: "", src: "", position: "body_end" }],
    });
  }, [value, onChange]);

  const removeCustomScript = useCallback(
    (index: number): void => {
      onChange({ ...value, custom: value.custom.filter((_, i) => i !== index) });
    },
    [value, onChange],
  );

  function getInheritanceSource(
    key: keyof Pick<TrackingConfig, "ga4" | "gtm" | "google_ads" | "facebook_pixel">,
  ): "org" | "custom" | null {
    if (!inheritedValues) return null;
    const inherited = inheritedValues[key];
    const current = value[key];
    if (current && current !== inherited) return "custom";
    if (inherited) return "org";
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {VENDOR_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label
                htmlFor={`tracking-${field.key}`}
                className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
              >
                {field.label}
              </label>
              {inheritedValues && (
                <InheritanceIndicator source={getInheritanceSource(field.key)} />
              )}
            </div>
            <input
              id={`tracking-${field.key}`}
              type="text"
              value={value[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(e): void => {
                updateField(field.key, e.target.value || null);
              }}
              className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
            />
            {!value[field.key] && (
              <p className="text-xs text-[var(--text-muted)]">Not configured</p>
            )}
          </div>
        ))}
      </div>

      {/* Custom tracking scripts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Custom Tracking Scripts
          </h4>
          <button
            type="button"
            onClick={addCustomScript}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            + Add Script
          </button>
        </div>

        {value.custom.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">No custom tracking scripts configured.</p>
        )}

        {value.custom.map((script, index) => (
          <div
            key={index}
            className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-end rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-3"
          >
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Name
              </label>
              <input
                type="text"
                value={script.name}
                placeholder="Script name"
                onChange={(e): void => {
                  updateCustomScript(index, { name: e.target.value });
                }}
                className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Source URL
              </label>
              <input
                type="text"
                value={script.src}
                placeholder="https://..."
                onChange={(e): void => {
                  updateCustomScript(index, { src: e.target.value });
                }}
                className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Position
              </label>
              <select
                value={script.position}
                onChange={(e): void => {
                  updateCustomScript(index, {
                    position: e.target.value as CustomTrackingScript["position"],
                  });
                }}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
              >
                {POSITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={(): void => {
                removeCustomScript(index);
              }}
              className="rounded-lg px-2 py-2 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              aria-label="Remove script"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
