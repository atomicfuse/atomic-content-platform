"use client";

import { useCallback } from "react";
/** Ad placement — mirrors @atomic-platform/shared-types */
interface AdPlacementSizes {
  desktop?: number[][];
  mobile?: number[][];
}

export interface AdPlacement {
  id: string;
  position: string;
  sizes: AdPlacementSizes;
  device: "all" | "desktop" | "mobile";
}

export interface AdsConfigFormValue {
  interstitial: boolean;
  layout: string;
  ad_placements: AdPlacement[];
}

interface AdsConfigFormProps {
  value: AdsConfigFormValue;
  onChange: (value: AdsConfigFormValue) => void;
}

const LAYOUT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "standard", label: "Standard" },
  { value: "high-density", label: "High Density" },
];

const DEVICE_OPTIONS: Array<{ value: AdPlacement["device"]; label: string }> = [
  { value: "all", label: "All Devices" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

const POSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "above-content", label: "Above Content" },
  { value: "after-paragraph-1", label: "After Paragraph 1" },
  { value: "after-paragraph-2", label: "After Paragraph 2" },
  { value: "after-paragraph-3", label: "After Paragraph 3" },
  { value: "after-paragraph-4", label: "After Paragraph 4" },
  { value: "after-paragraph-5", label: "After Paragraph 5" },
  { value: "after-paragraph-6", label: "After Paragraph 6" },
  { value: "after-paragraph-7", label: "After Paragraph 7" },
  { value: "after-paragraph-8", label: "After Paragraph 8" },
  { value: "below-content", label: "Below Content" },
  { value: "sidebar", label: "Sidebar" },
  { value: "sticky-bottom", label: "Sticky Bottom" },
  { value: "homepage-top", label: "Homepage Top" },
  { value: "homepage-mid", label: "Homepage Mid" },
  { value: "category-top", label: "Category Top" },
];

export function AdsConfigForm({ value, onChange }: AdsConfigFormProps): React.ReactElement {
  const updateField = useCallback(
    <K extends keyof AdsConfigFormValue>(key: K, fieldValue: AdsConfigFormValue[K]): void => {
      onChange({ ...value, [key]: fieldValue });
    },
    [value, onChange],
  );

  const updatePlacement = useCallback(
    (index: number, patch: Partial<AdPlacement>): void => {
      const updated = value.ad_placements.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      );
      onChange({ ...value, ad_placements: updated });
    },
    [value, onChange],
  );

  const addPlacement = useCallback((): void => {
    const newPlacement: AdPlacement = {
      id: "",
      position: "above-content",
      device: "all",
      sizes: {},
    };
    onChange({ ...value, ad_placements: [...value.ad_placements, newPlacement] });
  }, [value, onChange]);

  const removePlacement = useCallback(
    (index: number): void => {
      onChange({
        ...value,
        ad_placements: value.ad_placements.filter((_, i) => i !== index),
      });
    },
    [value, onChange],
  );

  const movePlacement = useCallback(
    (index: number, direction: -1 | 1): void => {
      const target = index + direction;
      if (target < 0 || target >= value.ad_placements.length) return;
      const updated = [...value.ad_placements];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      onChange({ ...value, ad_placements: updated });
    },
    [value, onChange],
  );

  const updateSizes = useCallback(
    (placementIndex: number, device: keyof AdPlacementSizes, sizesStr: string): void => {
      const placement = value.ad_placements[placementIndex];
      const parsed = parseSizes(sizesStr);
      const newSizes = { ...placement.sizes, [device]: parsed.length > 0 ? parsed : undefined };
      updatePlacement(placementIndex, { sizes: newSizes });
    },
    [value, updatePlacement],
  );

  return (
    <div className="space-y-6">
      {/* Toggle fields */}
      <div className="grid grid-cols-2 gap-4">
        <ToggleField
          label="Interstitial Ads"
          checked={value.interstitial}
          onChange={(checked): void => {
            updateField("interstitial", checked);
          }}
        />
      </div>

      {/* Layout dropdown */}
      <div className="space-y-1.5">
        <label
          htmlFor="ads-layout"
          className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
        >
          Ad Layout
        </label>
        <select
          id="ads-layout"
          value={value.layout}
          onChange={(e): void => {
            updateField("layout", e.target.value as AdsConfigFormValue["layout"]);
          }}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
        >
          {LAYOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Ad Placements */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Ad Placements
          </h4>
          <button
            type="button"
            onClick={addPlacement}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            + Add Placement
          </button>
        </div>

        {value.ad_placements.length === 0 && (
          <p className="text-xs text-[var(--text-muted)]">No ad placements configured.</p>
        )}

        {value.ad_placements.map((placement, index) => (
          <div
            key={index}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                Placement #{index + 1}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(): void => movePlacement(index, -1)}
                  disabled={index === 0}
                  className="rounded-lg px-1.5 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move up"
                >
                  &#x25B2;
                </button>
                <button
                  type="button"
                  onClick={(): void => movePlacement(index, 1)}
                  disabled={index === value.ad_placements.length - 1}
                  className="rounded-lg px-1.5 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="Move down"
                >
                  &#x25BC;
                </button>
                <button
                  type="button"
                  onClick={(): void => {
                    removePlacement(index);
                  }}
                  className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  aria-label="Remove placement"
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  ID
                </label>
                <input
                  type="text"
                  value={placement.id}
                  placeholder="ad-slot-id"
                  onChange={(e): void => {
                    updatePlacement(index, { id: e.target.value });
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Position
                </label>
                <select
                  value={placement.position}
                  onChange={(e): void => {
                    updatePlacement(index, { position: e.target.value });
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
                >
                  {POSITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Device
                </label>
                <select
                  value={placement.device}
                  onChange={(e): void => {
                    updatePlacement(index, {
                      device: e.target.value as AdPlacement["device"],
                    });
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors appearance-none"
                >
                  {DEVICE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sizes */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Desktop Sizes
                </label>
                <input
                  type="text"
                  value={formatSizes(placement.sizes.desktop)}
                  placeholder="728x90, 970x250"
                  onChange={(e): void => {
                    updateSizes(index, "desktop", e.target.value);
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Mobile Sizes
                </label>
                <input
                  type="text"
                  value={formatSizes(placement.sizes.mobile)}
                  placeholder="320x50, 300x250"
                  onChange={(e): void => {
                    updateSizes(index, "mobile", e.target.value);
                  }}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function ToggleField({
  label,
  checked,
  onChange: onToggle,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-4 py-3 cursor-pointer">
      <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(): void => {
          onToggle(!checked);
        }}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-cyan" : "bg-[var(--border-primary)]"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

function formatSizes(sizes?: number[][]): string {
  if (!sizes || sizes.length === 0) return "";
  return sizes.map((s) => `${s[0]}x${s[1]}`).join(", ");
}

function parseSizes(str: string): number[][] {
  if (!str.trim()) return [];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.includes("x"))
    .map((s) => {
      const [w, h] = s.split("x").map(Number);
      return [w, h];
    })
    .filter(([w, h]) => !isNaN(w) && !isNaN(h));
}
