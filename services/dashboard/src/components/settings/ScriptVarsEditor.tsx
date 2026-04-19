"use client";

import { useCallback, useMemo } from "react";

interface ScriptVarsEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  requiredKeys?: string[];
}

export function ScriptVarsEditor({
  value,
  onChange,
  requiredKeys = [],
}: ScriptVarsEditorProps): React.ReactElement {
  const entries = useMemo((): Array<[string, string]> => Object.entries(value), [value]);

  const requiredSet = useMemo((): Set<string> => new Set(requiredKeys), [requiredKeys]);

  const updateKey = useCallback(
    (oldKey: string, newKey: string): void => {
      const updated: Record<string, string> = {};
      for (const [k, v] of Object.entries(value)) {
        updated[k === oldKey ? newKey : k] = v;
      }
      onChange(updated);
    },
    [value, onChange],
  );

  const updateValue = useCallback(
    (key: string, newValue: string): void => {
      onChange({ ...value, [key]: newValue });
    },
    [value, onChange],
  );

  const addRow = useCallback((): void => {
    let newKey = "new_variable";
    let counter = 1;
    while (value[newKey] !== undefined) {
      newKey = `new_variable_${counter}`;
      counter++;
    }
    onChange({ ...value, [newKey]: "" });
  }, [value, onChange]);

  const removeRow = useCallback(
    (key: string): void => {
      const { [key]: _, ...rest } = value;
      onChange(rest);
    },
    [value, onChange],
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Script Variables
        </h4>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
        >
          + Add Variable
        </button>
      </div>

      {entries.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">No script variables defined.</p>
      )}

      {entries.length > 0 && (
        <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3 px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-primary)]">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Key
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Value
            </span>
            <span className="w-8" />
          </div>

          {/* Rows */}
          {entries.map(([key, val]) => (
            <div
              key={key}
              className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center px-4 py-2 border-b border-[var(--border-primary)] last:border-b-0 bg-[var(--bg-elevated)]"
            >
              <div className="flex items-center gap-1">
                {requiredSet.has(key) && (
                  <span className="text-red-400 text-sm" title="Required by group scripts">
                    *
                  </span>
                )}
                <input
                  type="text"
                  value={key}
                  onChange={(e): void => {
                    updateKey(key, e.target.value);
                  }}
                  className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors font-mono"
                />
              </div>
              <input
                type="text"
                value={val}
                onChange={(e): void => {
                  updateValue(key, e.target.value);
                }}
                placeholder="Value"
                className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
              />
              <button
                type="button"
                onClick={(): void => {
                  removeRow(key);
                }}
                className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                aria-label={`Remove ${key}`}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {requiredKeys.length > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          <span className="text-red-400">*</span> Required by group scripts
        </p>
      )}
    </div>
  );
}
