"use client";

import { useCallback } from "react";
/** Script entry — mirrors @atomic-platform/shared-types */
interface ScriptEntry {
  id: string;
  src?: string;
  inline?: string;
  async?: boolean;
}

interface ScriptsConfig {
  head: ScriptEntry[];
  body_start: ScriptEntry[];
  body_end: ScriptEntry[];
}

interface ScriptsEditorProps {
  value: ScriptsConfig;
  onChange: (value: ScriptsConfig) => void;
}

type ScriptPosition = keyof ScriptsConfig;

const SECTIONS: Array<{ key: ScriptPosition; label: string }> = [
  { key: "head", label: "Head" },
  { key: "body_start", label: "Body Start" },
  { key: "body_end", label: "Body End" },
];

export function ScriptsEditor({ value, onChange }: ScriptsEditorProps): React.ReactElement {
  const updateEntry = useCallback(
    (position: ScriptPosition, index: number, patch: Partial<ScriptEntry>): void => {
      const updated = value[position].map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      );
      onChange({ ...value, [position]: updated });
    },
    [value, onChange],
  );

  const addEntry = useCallback(
    (position: ScriptPosition): void => {
      const newEntry: ScriptEntry = { id: "", src: "" };
      onChange({ ...value, [position]: [...value[position], newEntry] });
    },
    [value, onChange],
  );

  const removeEntry = useCallback(
    (position: ScriptPosition, index: number): void => {
      onChange({
        ...value,
        [position]: value[position].filter((_, i) => i !== index),
      });
    },
    [value, onChange],
  );

  const toggleMode = useCallback(
    (position: ScriptPosition, index: number, mode: "src" | "inline"): void => {
      const entry = value[position][index];
      if (mode === "src") {
        updateEntry(position, index, { src: entry.src ?? "", inline: undefined });
      } else {
        updateEntry(position, index, { inline: entry.inline ?? "", src: undefined, async: undefined });
      }
    },
    [value, updateEntry],
  );

  return (
    <div className="space-y-8">
      {SECTIONS.map((section) => (
        <div key={section.key} className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              {section.label}
            </h4>
            <button
              type="button"
              onClick={(): void => {
                addEntry(section.key);
              }}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              + Add Script
            </button>
          </div>

          {value[section.key].length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">No scripts in this section.</p>
          )}

          {value[section.key].map((entry, index) => {
            const isInline = entry.inline !== undefined && entry.src === undefined;
            return (
              <div
                key={index}
                className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 space-y-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Script ID
                    </label>
                    <input
                      type="text"
                      value={entry.id}
                      placeholder="unique-script-id"
                      onChange={(e): void => {
                        updateEntry(section.key, index, { id: e.target.value });
                      }}
                      className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={(): void => {
                      removeEntry(section.key, index);
                    }}
                    className="ml-3 rounded-lg px-2 py-2 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    aria-label="Remove script"
                  >
                    &times;
                  </button>
                </div>

                {/* Mode toggle */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(): void => {
                      toggleMode(section.key, index, "src");
                    }}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      !isInline
                        ? "bg-cyan/20 text-cyan"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    External URL
                  </button>
                  <button
                    type="button"
                    onClick={(): void => {
                      toggleMode(section.key, index, "inline");
                    }}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      isInline
                        ? "bg-cyan/20 text-cyan"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Inline Code
                  </button>
                </div>

                {isInline ? (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Inline JavaScript
                    </label>
                    <textarea
                      value={entry.inline ?? ""}
                      placeholder="// Your JavaScript code here..."
                      rows={4}
                      onChange={(e): void => {
                        updateEntry(section.key, index, { inline: e.target.value });
                      }}
                      className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors resize-y"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                        Script URL
                      </label>
                      <input
                        type="text"
                        value={entry.src ?? ""}
                        placeholder="https://example.com/script.js"
                        onChange={(e): void => {
                          updateEntry(section.key, index, { src: e.target.value });
                        }}
                        className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entry.async ?? false}
                        onChange={(e): void => {
                          updateEntry(section.key, index, { async: e.target.checked });
                        }}
                        className="rounded border-[var(--border-primary)] bg-[var(--bg-surface)] text-cyan focus:ring-cyan/50"
                      />
                      <span className="text-xs text-[var(--text-secondary)]">Load asynchronously</span>
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
