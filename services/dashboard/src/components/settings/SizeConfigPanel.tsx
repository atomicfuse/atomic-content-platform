"use client";

import type React from "react";
import type { AdSizeConfig } from "./ad-size-config";
import { formatConfigSizes, validateSizeConfig } from "./ad-size-config";

interface SizeConfigPanelProps {
  label: string;
  config: AdSizeConfig;
  onChange: (config: AdSizeConfig) => void;
  disabled?: boolean;
}

const INPUT_CLS =
  "w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

export function SizeConfigPanel({
  label,
  config,
  onChange,
  disabled = false,
}: SizeConfigPanelProps): React.ReactElement {
  const errors = disabled ? ({} as ReturnType<typeof validateSizeConfig>) : validateSizeConfig(config);
  const preview = formatConfigSizes(config);

  function updateRatio(field: "x" | "y", raw: string): void {
    const v = parseInt(raw, 10);
    onChange({
      ...config,
      ratio: { ...config.ratio, [field]: isNaN(v) || v < 1 ? 1 : v },
    });
  }

  function updateRange(
    field: keyof AdSizeConfig["range"],
    raw: string,
  ): void {
    const v = raw === "" ? null : parseInt(raw, 10);
    onChange({
      ...config,
      range: {
        ...config.range,
        [field]: v !== null && isNaN(v) ? null : v,
      },
    });
  }

  function addCustomSize(): void {
    onChange({
      ...config,
      customSizes: [...config.customSizes, { width: 0, height: 0 }],
    });
  }

  function updateCustomSize(
    index: number,
    field: "width" | "height",
    raw: string,
  ): void {
    const v = parseInt(raw, 10);
    const updated = config.customSizes.map((s, i) =>
      i === index ? { ...s, [field]: isNaN(v) ? 0 : Math.max(0, v) } : s,
    );
    onChange({ ...config, customSizes: updated });
  }

  function removeCustomSize(index: number): void {
    onChange({
      ...config,
      customSizes: config.customSizes.filter((_, i) => i !== index),
    });
  }

  return (
    <div
      className={`space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] p-3${
        disabled ? " opacity-50 pointer-events-none" : ""
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {label}
      </div>

      {/* ── Aspect Ratio ── */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Aspect Ratio
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            value={config.ratio.x}
            onChange={(e): void => updateRatio("x", e.target.value)}
            disabled={disabled}
            className={`${INPUT_CLS} w-16 text-center`}
          />
          <span className="text-sm font-semibold text-[var(--text-muted)]">
            :
          </span>
          <input
            type="number"
            min={1}
            value={config.ratio.y}
            onChange={(e): void => updateRatio("y", e.target.value)}
            disabled={disabled}
            className={`${INPUT_CLS} w-16 text-center`}
          />
        </div>
        {errors.ratio && (
          <p className="text-[10px] text-red-400 mt-1">{errors.ratio}</p>
        )}
      </div>

      {/* ── Size Range ── */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Size Range
        </label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Min Width
            </span>
            <input
              type="number"
              min={0}
              value={config.range.minWidth ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("minWidth", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Max Width
            </span>
            <input
              type="number"
              min={0}
              value={config.range.maxWidth ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("maxWidth", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Min Height
            </span>
            <input
              type="number"
              min={0}
              value={config.range.minHeight ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("minHeight", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
          <div className="space-y-0.5">
            <span className="text-[10px] text-[var(--text-muted)]">
              Max Height
            </span>
            <input
              type="number"
              min={0}
              value={config.range.maxHeight ?? ""}
              placeholder="—"
              onChange={(e): void => updateRange("maxHeight", e.target.value)}
              disabled={disabled}
              className={INPUT_CLS}
            />
          </div>
        </div>
        {errors.rangeWidth && (
          <p className="text-[10px] text-red-400 mt-1">{errors.rangeWidth}</p>
        )}
        {errors.rangeHeight && (
          <p className="text-[10px] text-red-400 mt-1">{errors.rangeHeight}</p>
        )}
      </div>

      {/* ── Custom Sizes ── */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          Custom Sizes
        </label>
        {config.customSizes.map((size, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={size.width || ""}
              placeholder="W"
              onChange={(e): void =>
                updateCustomSize(i, "width", e.target.value)
              }
              disabled={disabled}
              className={`${INPUT_CLS} w-20`}
            />
            <span className="text-xs text-[var(--text-muted)]">&times;</span>
            <input
              type="number"
              min={1}
              value={size.height || ""}
              placeholder="H"
              onChange={(e): void =>
                updateCustomSize(i, "height", e.target.value)
              }
              disabled={disabled}
              className={`${INPUT_CLS} w-20`}
            />
            <button
              type="button"
              onClick={(): void => removeCustomSize(i)}
              disabled={disabled}
              className="rounded px-1.5 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Remove size"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addCustomSize}
          disabled={disabled}
          className="text-xs font-semibold text-cyan hover:text-cyan/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          + Add Custom Size
        </button>
        {errors.customSizes && (
          <p className="text-[10px] text-red-400 mt-1">
            {errors.customSizes}
          </p>
        )}
      </div>

      {/* ── Rendered Sizes Preview ── */}
      {preview && (
        <div className="space-y-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Rendered Sizes
          </label>
          <div className="rounded bg-[var(--bg-elevated)] px-2 py-1.5 text-xs font-mono text-[var(--text-secondary)]">
            {preview}
          </div>
        </div>
      )}
    </div>
  );
}
