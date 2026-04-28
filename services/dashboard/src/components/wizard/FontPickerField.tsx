"use client";

import { useEffect, useRef } from "react";
import { FONT_REGISTRY, type FontEntry } from "@/lib/font-registry";

interface Props {
  label: string;
  value: string;
  onChange: (family: string) => void;
}

export function FontPickerField({ label, value, onChange }: Props): React.ReactElement {
  const loadedRef = useRef(new Set<string>());

  function ensureLoaded(family: string): void {
    if (loadedRef.current.has(family)) return;
    loadedRef.current.add(family);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }

  useEffect(() => { ensureLoaded(value); }, [value]);

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium">{label}</label>
      <select
        value={value}
        onChange={(e) => { ensureLoaded(e.target.value); onChange(e.target.value); }}
        className="w-full px-2 py-1.5 border rounded"
      >
        {FONT_REGISTRY.map((f: FontEntry) => (
          <option key={f.id} value={f.family} style={{ fontFamily: `'${f.family}', sans-serif` }}>
            {f.family} — {f.category}
          </option>
        ))}
      </select>
      <p
        className="text-base text-gray-700 mt-1"
        style={{ fontFamily: `'${value}', sans-serif` }}
      >
        The quick brown fox jumps over the lazy dog
      </p>
    </div>
  );
}
