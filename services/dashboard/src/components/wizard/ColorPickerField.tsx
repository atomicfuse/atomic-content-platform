"use client";

import { useState } from "react";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(raw: string): string | null {
  const trimmed = raw.trim();
  if (HEX_RE.test(trimmed)) return trimmed;
  if (/^[a-z]+$/i.test(trimmed)) {
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillStyle = trimmed;
    return ctx.fillStyle;
  }
  return null;
}

export function ColorPickerField({ label, value, onChange, helperText }: Props): React.ReactElement {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);

  function commit(raw: string): void {
    const normalized = normalizeColor(raw);
    if (!normalized) {
      setError("Invalid color");
      return;
    }
    setError(null);
    setText(normalized);
    onChange(normalized);
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => { setText(e.target.value); onChange(e.target.value); }}
          className="h-10 w-12 cursor-pointer border rounded"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          className="flex-1 px-2 py-1.5 border rounded text-sm font-mono"
          placeholder="#1a1a2e or red"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {helperText && !error && <p className="text-xs text-gray-500">{helperText}</p>}
    </div>
  );
}
