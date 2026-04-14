"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

interface AdPlacement {
  id: string;
  position: string;
  device: string;
  sizes: string[];
}

interface AdPlacementsEditorProps {
  value: AdPlacement[];
  onChange: (value: AdPlacement[]) => void;
}

const POSITION_OPTIONS = [
  { value: "above-content", label: "Above Content" },
  { value: "after-paragraph-1", label: "After Paragraph 1" },
  { value: "after-paragraph-2", label: "After Paragraph 2" },
  { value: "after-paragraph-3", label: "After Paragraph 3" },
  { value: "after-paragraph-4", label: "After Paragraph 4" },
  { value: "after-paragraph-5", label: "After Paragraph 5" },
  { value: "sidebar", label: "Sidebar" },
  { value: "sticky-bottom", label: "Sticky Bottom" },
  { value: "below-content", label: "Below Content" },
];

const DEVICE_OPTIONS = [
  { value: "all", label: "All Devices" },
  { value: "desktop", label: "Desktop" },
  { value: "mobile", label: "Mobile" },
];

export function AdPlacementsEditor({
  value,
  onChange,
}: AdPlacementsEditorProps): React.ReactElement {
  const updatePlacement = useCallback(
    (index: number, updates: Partial<AdPlacement>): void => {
      const next = value.map((p, i) => (i === index ? { ...p, ...updates } : p));
      onChange(next);
    },
    [value, onChange],
  );

  const addPlacement = useCallback((): void => {
    const newPlacement: AdPlacement = {
      id: `placement-${Date.now()}`,
      position: "above-content",
      device: "all",
      sizes: [],
    };
    onChange([...value, newPlacement]);
  }, [value, onChange]);

  const removePlacement = useCallback(
    (index: number): void => {
      onChange(value.filter((_, i) => i !== index));
    },
    [value, onChange],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Ad Placements
        </label>
        <Button size="sm" onClick={addPlacement}>
          + Add Placement
        </Button>
      </div>

      {value.length === 0 && (
        <p className="text-sm text-[var(--text-muted)] py-4 text-center">
          No placements configured. Click &quot;Add Placement&quot; to create one.
        </p>
      )}

      {value.map((placement, index) => (
        <div
          key={placement.id}
          className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              Placement #{index + 1}
            </span>
            <Button
              size="sm"
              variant="danger"
              onClick={(): void => removePlacement(index)}
            >
              Remove
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="ID"
              value={placement.id}
              onChange={(e): void => updatePlacement(index, { id: e.target.value })}
              placeholder="ad-slot-1"
            />

            <Select
              label="Position"
              value={placement.position}
              onChange={(e): void =>
                updatePlacement(index, { position: e.target.value })
              }
              options={POSITION_OPTIONS}
            />

            <Select
              label="Device"
              value={placement.device}
              onChange={(e): void =>
                updatePlacement(index, { device: e.target.value })
              }
              options={DEVICE_OPTIONS}
            />

            <Input
              label="Sizes"
              value={placement.sizes.join(", ")}
              onChange={(e): void =>
                updatePlacement(index, {
                  sizes: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="300x250, 728x90"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
