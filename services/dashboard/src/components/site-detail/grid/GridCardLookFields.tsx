"use client";

import { GRID_CARD_DEFAULTS, GRID_CARD_OPTIONS, type GridCardFields } from "@/types/grid";

interface GridCardLookFieldsProps {
  value: GridCardFields;
  onChange: (next: GridCardFields) => void;
}

const LABELS: Record<keyof GridCardFields, string> = {
  style: "Card style",
  corners: "Corners",
  image_ratio: "Image ratio",
  image_position: "Image position",
  density: "Density",
  source_position: "Source line",
};

/** Six card-look dropdowns plus a live mini preview that reflects every choice. */
export function GridCardLookFields({ value, onChange }: GridCardLookFieldsProps): React.ReactElement {
  const v = { ...GRID_CARD_DEFAULTS, ...value };
  const keys = Object.keys(GRID_CARD_OPTIONS) as Array<keyof GridCardFields>;
  const radius = v.corners === "square" ? 0 : v.corners === "small" ? 6 : 12;

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_220px]">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {keys.map((k) => (
          <label key={k} className="flex flex-col gap-1 text-sm text-[var(--text-primary)]">
            <span className="font-medium">{LABELS[k]}</span>
            <select
              aria-label={LABELS[k]}
              className="rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[var(--text-primary)]"
              value={v[k]}
              onChange={(e): void => onChange({ ...value, [k]: e.target.value })}
            >
              {GRID_CARD_OPTIONS[k].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {/* Live mini preview — a single representative card rendered with the current look. */}
      <div
        aria-hidden="true"
        className="self-start overflow-hidden bg-white p-2 text-black"
        style={{
          borderRadius: radius,
          border: v.style === "bordered" ? "1px solid #e3e6ee" : "none",
          boxShadow: v.style === "shadow" ? "0 8px 24px rgb(0 0 0 / .1)" : "none",
          display: v.image_position === "left" ? "flex" : "block",
          gap: 8,
        }}
      >
        <div
          style={{
            background: "#cfd6e4",
            borderRadius: Math.max(0, radius - 3),
            aspectRatio: v.image_position === "left" ? "1 / 1" : v.image_ratio.replace(":", " / "),
            width: v.image_position === "left" ? 64 : "100%",
            position: "relative",
          }}
        >
          {v.source_position === "badge" && (
            <span
              style={{
                position: "absolute",
                left: 6,
                bottom: 6,
                fontSize: 10,
                background: "rgb(0 0 0 / .6)",
                color: "#fff",
                borderRadius: 99,
                padding: "1px 6px",
              }}
            >
              site.com · 5d
            </span>
          )}
        </div>
        <div style={{ padding: v.density === "compact" ? 4 : 8 }}>
          {v.source_position === "below" && (
            <p style={{ fontSize: 10, opacity: 0.6, margin: 0 }}>site.com · 5d</p>
          )}
          <p style={{ fontWeight: 700, fontSize: v.density === "compact" ? 12 : 14, margin: "4px 0 0" }}>
            Headline preview for the card
          </p>
        </div>
      </div>
    </div>
  );
}
