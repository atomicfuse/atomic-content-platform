"use client";

import { useCallback } from "react";

interface ScriptVariablesEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  requiredKeys?: string[];
}

export function ScriptVariablesEditor({
  value,
  onChange,
  requiredKeys,
}: ScriptVariablesEditorProps): React.ReactElement {
  const entries = Object.entries(value);

  const updateKey = useCallback(
    (oldKey: string, newKey: string): void => {
      const updated = { ...value };
      const val = updated[oldKey] ?? "";
      delete updated[oldKey];
      updated[newKey] = val;
      onChange(updated);
    },
    [value, onChange],
  );

  const updateValue = useCallback(
    (key: string, val: string): void => {
      onChange({ ...value, [key]: val });
    },
    [value, onChange],
  );

  const addEntry = useCallback((): void => {
    onChange({ ...value, "": "" });
  }, [value, onChange]);

  const removeEntry = useCallback(
    (key: string): void => {
      const updated = { ...value };
      delete updated[key];
      onChange(updated);
    },
    [value, onChange],
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)]">
        These variables are available as{" "}
        <code className="rounded bg-[var(--bg-elevated)] px-1">{"{{key}}"}</code>{" "}
        in all script templates across groups and sites.
      </p>

      {entries.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">No script variables defined.</p>
      )}

      <div className="space-y-2">
        {entries.map(([key, val], index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={key}
              placeholder="Variable name"
              onChange={(e): void => updateKey(key, e.target.value)}
              className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
            />
            <input
              type="text"
              value={val}
              placeholder="Value"
              onChange={(e): void => updateValue(key, e.target.value)}
              className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
            />
            {requiredKeys?.includes(key) && (
              <span className="text-red-500 text-xs">*</span>
            )}
            <button
              type="button"
              onClick={(): void => removeEntry(key)}
              className="rounded-lg px-2 py-2 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              aria-label="Remove variable"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addEntry}
        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
      >
        + Add Variable
      </button>
    </div>
  );
}
