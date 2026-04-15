"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

/**
 * Single ad placement entry as stored in `monetization/<id>.yaml`. Sizes are
 * kept as `WxH` strings (e.g. "728x90") for a clean YAML representation;
 * runtime conversion to numeric tuples happens elsewhere.
 */
export interface AdPlacement {
  id: string;
  position: string;
  device: "all" | "desktop" | "mobile";
  sizes: string[];
}

interface AdPlacementsEditorProps {
  value: AdPlacement[];
  onChange: (value: AdPlacement[]) => void;
}

const POSITION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "above-content", label: "Above content" },
  { value: "after-paragraph-1", label: "After paragraph 1" },
  { value: "after-paragraph-2", label: "After paragraph 2" },
  { value: "after-paragraph-3", label: "After paragraph 3" },
  { value: "after-paragraph-4", label: "After paragraph 4" },
  { value: "after-paragraph-5", label: "After paragraph 5" },
  { value: "after-paragraph-6", label: "After paragraph 6" },
  { value: "after-paragraph-8", label: "After paragraph 8" },
  { value: "below-content", label: "Below content" },
  { value: "sidebar", label: "Sidebar" },
  { value: "sticky-bottom", label: "Sticky bottom" },
];

const DEVICE_OPTIONS: Array<{ value: AdPlacement["device"]; label: string }> = [
  { value: "all", label: "All devices" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

export function AdPlacementsEditor({
  value,
  onChange,
}: AdPlacementsEditorProps): React.ReactElement {
  const updatePlacement = useCallback(
    (index: number, patch: Partial<AdPlacement>): void => {
      onChange(value.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    },
    [value, onChange],
  );

  const addPlacement = useCallback((): void => {
    const next: AdPlacement = {
      id: `slot-${value.length + 1}`,
      position: "above-content",
      device: "all",
      sizes: ["728x90"],
    };
    onChange([...value, next]);
  }, [value, onChange]);

  const removePlacement = useCallback(
    (index: number): void => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  const movePlacement = useCallback(
    (index: number, direction: -1 | 1): void => {
      const target = index + direction;
      if (target < 0 || target >= value.length) return;
      const next = [...value];
      const [removed] = next.splice(index, 1);
      next.splice(target, 0, removed);
      onChange(next);
    },
    [value, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Ad Placements
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Each placement is rendered at runtime by{" "}
            <code className="rounded bg-[var(--bg-elevated)] px-1">ad-loader.js</code>{" "}
            using the position anchor in the static HTML.
          </p>
        </div>
        <button
          type="button"
          onClick={addPlacement}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-cyan text-white hover:bg-cyan/90 transition-colors"
        >
          + Add Placement
        </button>
      </div>

      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--border-primary)] py-8 text-center text-sm text-[var(--text-muted)]">
          No ad placements configured. Click &quot;Add Placement&quot; to create one.
        </p>
      )}

      {value.map((placement, index) => (
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
                aria-label="Move up"
                disabled={index === 0}
                onClick={(): void => movePlacement(index, -1)}
                className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={index === value.length - 1}
                onClick={(): void => movePlacement(index, 1)}
                className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
              >
                ↓
              </button>
              <button
                type="button"
                aria-label="Remove placement"
                onClick={(): void => removePlacement(index)}
                className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="ID"
              value={placement.id}
              placeholder="ad-slot-1"
              onChange={(e): void => updatePlacement(index, { id: e.target.value })}
            />
            <Select
              label="Position"
              value={placement.position}
              onChange={(e): void => updatePlacement(index, { position: e.target.value })}
              options={POSITION_OPTIONS}
            />
            <Select
              label="Device"
              value={placement.device}
              onChange={(e): void =>
                updatePlacement(index, {
                  device: e.target.value as AdPlacement["device"],
                })
              }
              options={DEVICE_OPTIONS}
            />
          </div>

          <Input
            label="Sizes (comma-separated)"
            value={placement.sizes.join(", ")}
            placeholder="728x90, 970x250"
            onChange={(e): void =>
              updatePlacement(index, {
                sizes: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      ))}
    </div>
  );
}
