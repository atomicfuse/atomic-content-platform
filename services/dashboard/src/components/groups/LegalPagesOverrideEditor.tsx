"use client";

import { useCallback, useState } from "react";

interface LegalPagesOverrideEditorProps {
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}

const SUGGESTED_SLUGS = ["privacy-policy", "terms", "cookie-policy", "disclaimer"];

/**
 * Editor for `legal_pages_override` — a map of legal page slug → full
 * markdown content that replaces the default template for that page.
 * Use sparingly; most groups should rely on legal vars to fill the org
 * templates instead.
 */
export function LegalPagesOverrideEditor({
  value,
  onChange,
}: LegalPagesOverrideEditorProps): React.ReactElement {
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const entries = Object.entries(value);

  const updateSlug = useCallback(
    (oldSlug: string, newSlug: string): void => {
      if (oldSlug === newSlug) return;
      const updated: Record<string, string> = {};
      for (const [k, v] of Object.entries(value)) {
        updated[k === oldSlug ? newSlug : k] = v;
      }
      onChange(updated);
    },
    [value, onChange],
  );

  const updateContent = useCallback(
    (slug: string, content: string): void => {
      onChange({ ...value, [slug]: content });
    },
    [value, onChange],
  );

  const addEntry = useCallback(
    (slug: string): void => {
      if (slug in value) return;
      onChange({ ...value, [slug]: "" });
      setOpenSlug(slug);
    },
    [value, onChange],
  );

  const removeEntry = useCallback(
    (slug: string): void => {
      const updated = { ...value };
      delete updated[slug];
      onChange(updated);
      if (openSlug === slug) setOpenSlug(null);
    },
    [value, onChange, openSlug],
  );

  const remaining = SUGGESTED_SLUGS.filter((s) => !(s in value));

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-muted)]">
        Replace the entire content of a legal page with custom markdown. Only
        use when the org-level template plus legal variables aren&apos;t enough.
      </p>

      {entries.length === 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          No legal page overrides.
        </p>
      )}

      <div className="space-y-2">
        {entries.map(([slug, content]) => {
          const isOpen = openSlug === slug;
          return (
            <div
              key={slug}
              className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  type="text"
                  value={slug}
                  onChange={(e): void => updateSlug(slug, e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-2 py-1 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                />
                <button
                  type="button"
                  onClick={(): void => setOpenSlug(isOpen ? null : slug)}
                  className="text-xs text-[var(--text-secondary)] hover:text-cyan transition-colors"
                >
                  {isOpen ? "Collapse" : "Edit"}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${slug} override`}
                  onClick={(): void => removeEntry(slug)}
                  className="rounded-lg px-2 py-1 text-sm text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  &times;
                </button>
              </div>
              {isOpen && (
                <textarea
                  value={content}
                  onChange={(e): void => updateContent(slug, e.target.value)}
                  rows={14}
                  placeholder={`# ${slug}\n\nFull markdown content for this page...`}
                  className="w-full border-t border-[var(--border-secondary)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {remaining.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={(): void => addEntry(slug)}
            className="rounded-lg px-3 py-1.5 text-xs font-mono bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            + {slug}
          </button>
        ))}
        <button
          type="button"
          onClick={(): void => {
            const slug = window.prompt("Slug for the new legal page override (kebab-case):");
            if (slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
              addEntry(slug);
            }
          }}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-primary)] hover:bg-[var(--bg-surface)] transition-colors"
        >
          + Custom slug
        </button>
      </div>
    </div>
  );
}
