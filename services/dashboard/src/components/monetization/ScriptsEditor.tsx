"use client";

import { useCallback, useState } from "react";

export interface ScriptEntry {
  id: string;
  src?: string;
  inline?: string;
  async?: boolean;
}

export interface ScriptsConfig {
  head: ScriptEntry[];
  body_start: ScriptEntry[];
  body_end: ScriptEntry[];
}

interface ScriptsEditorProps {
  value: ScriptsConfig;
  onChange: (value: ScriptsConfig) => void;
}

type ScriptPosition = keyof ScriptsConfig;

const SECTIONS: Array<{ key: ScriptPosition; label: string; description: string }> = [
  {
    key: "head",
    label: "Head",
    description: "Loaded inside <head>. Use for tag managers and ad library bootstraps.",
  },
  {
    key: "body_start",
    label: "Body Start",
    description: "Injected immediately after <body>. Useful for noscript pixels.",
  },
  {
    key: "body_end",
    label: "Body End",
    description: "Loaded just before </body>. Best for non-blocking trackers.",
  },
];

const PLACEHOLDER_REGEX = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/** Returns placeholder names referenced anywhere in the scripts config. */
export function extractPlaceholders(value: ScriptsConfig): string[] {
  const set = new Set<string>();
  for (const position of Object.keys(value) as ScriptPosition[]) {
    for (const entry of value[position]) {
      const sources = [entry.src, entry.inline].filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      );
      for (const source of sources) {
        for (const match of source.matchAll(PLACEHOLDER_REGEX)) {
          if (match[1]) set.add(match[1]);
        }
      }
    }
  }
  return [...set].sort();
}

/**
 * Renders text with `{{placeholder}}` sequences highlighted as yellow chips.
 * Used for inline script previews so editors can see which variables are
 * referenced.
 */
function renderHighlighted(text: string): React.ReactElement[] {
  const parts: React.ReactElement[] = [];
  let lastIndex = 0;
  let i = 0;
  PLACEHOLDER_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${i}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    parts.push(
      <span
        key={`p-${i}`}
        className="rounded bg-amber-500/20 px-1 text-amber-500 font-semibold"
      >
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
    i += 1;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`t-end`}>{text.slice(lastIndex)}</span>);
  }
  return parts;
}

export function ScriptsEditor({
  value,
  onChange,
}: ScriptsEditorProps): React.ReactElement {
  const [openSections, setOpenSections] = useState<Record<ScriptPosition, boolean>>({
    head: true,
    body_start: false,
    body_end: false,
  });

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
      onChange({
        ...value,
        [position]: [...value[position], { id: "", src: "" }],
      });
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

  const placeholders = extractPlaceholders(value);

  return (
    <div className="space-y-4">
      {placeholders.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="text-xs font-semibold text-amber-500 mb-1">
            Detected placeholders
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-2">
            These will be resolved from each site&apos;s{" "}
            <code className="rounded bg-[var(--bg-elevated)] px-1">scripts_vars</code>{" "}
            at build time.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {placeholders.map((p) => (
              <span
                key={p}
                className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-mono text-amber-500"
              >
                {`{{${p}}}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {SECTIONS.map((section) => {
        const isOpen = openSections[section.key];
        const entries = value[section.key];

        return (
          <div
            key={section.key}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] overflow-hidden"
          >
            <button
              type="button"
              onClick={(): void =>
                setOpenSections((s) => ({ ...s, [section.key]: !isOpen }))
              }
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-surface)] transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {section.label}{" "}
                  <span className="text-xs text-[var(--text-muted)]">
                    ({entries.length})
                  </span>
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  {section.description}
                </div>
              </div>
              <span className="text-[var(--text-muted)] text-lg">
                {isOpen ? "−" : "+"}
              </span>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-secondary)]">
                {entries.length === 0 && (
                  <p className="pt-4 text-xs text-[var(--text-muted)]">
                    No entries in {section.label.toLowerCase()}.
                  </p>
                )}

                {entries.map((entry, index) => {
                  const isInline = !!entry.inline;
                  return (
                    <div
                      key={index}
                      className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-3 space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={entry.id}
                          placeholder="script-id"
                          onChange={(e): void =>
                            updateEntry(section.key, index, { id: e.target.value })
                          }
                          className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                        />

                        <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={entry.async ?? false}
                            onChange={(e): void =>
                              updateEntry(section.key, index, {
                                async: e.target.checked || undefined,
                              })
                            }
                          />
                          async
                        </label>

                        <div className="flex rounded-lg overflow-hidden border border-[var(--border-primary)] text-xs">
                          <button
                            type="button"
                            onClick={(): void =>
                              updateEntry(section.key, index, {
                                src: entry.src ?? "",
                                inline: undefined,
                              })
                            }
                            className={`px-3 py-1.5 ${
                              !isInline
                                ? "bg-cyan/20 text-cyan font-semibold"
                                : "bg-transparent text-[var(--text-muted)]"
                            }`}
                          >
                            URL
                          </button>
                          <button
                            type="button"
                            onClick={(): void =>
                              updateEntry(section.key, index, {
                                inline: entry.inline ?? "",
                                src: undefined,
                              })
                            }
                            className={`px-3 py-1.5 ${
                              isInline
                                ? "bg-cyan/20 text-cyan font-semibold"
                                : "bg-transparent text-[var(--text-muted)]"
                            }`}
                          >
                            Inline
                          </button>
                        </div>

                        <button
                          type="button"
                          aria-label="Remove script"
                          onClick={(): void => removeEntry(section.key, index)}
                          className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          &times;
                        </button>
                      </div>

                      {!isInline && (
                        <input
                          type="text"
                          value={entry.src ?? ""}
                          placeholder="https://example.com/tag.js?id={{network_id}}"
                          onChange={(e): void =>
                            updateEntry(section.key, index, { src: e.target.value })
                          }
                          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                        />
                      )}

                      {isInline && (
                        <div className="space-y-2">
                          <textarea
                            value={entry.inline ?? ""}
                            placeholder={"window.example = '{{site_id}}';"}
                            rows={6}
                            onChange={(e): void =>
                              updateEntry(section.key, index, {
                                inline: e.target.value,
                              })
                            }
                            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                          />
                          {entry.inline && entry.inline.includes("{{") && (
                            <div className="rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap">
                              {renderHighlighted(entry.inline)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={(): void => addEntry(section.key)}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  + Add Script
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
