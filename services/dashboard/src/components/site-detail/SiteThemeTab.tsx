"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ColorPickerField } from "@/components/wizard/ColorPickerField";
import { FontPickerField } from "@/components/wizard/FontPickerField";

interface LayoutState {
  hero: { enabled: boolean; count: 3 | 4 };
  must_reads: { enabled: boolean; count: number };
  sidebar_topics: { auto: boolean; explicit: string[] };
  load_more: { page_size: number };
}

interface ThemeState {
  primaryColor: string;
  accentColor: string;
  fontHeading: string;
  fontBody: string;
  layout: LayoutState;
}

const DEFAULT_LAYOUT: LayoutState = {
  hero: { enabled: true, count: 4 },
  must_reads: { enabled: true, count: 5 },
  sidebar_topics: { auto: true, explicit: [] },
  load_more: { page_size: 10 },
};

interface SiteThemeTabProps {
  domain: string;
}

function parseLayout(raw: Record<string, unknown> | undefined): LayoutState {
  if (!raw) return { ...DEFAULT_LAYOUT };
  const hero = raw.hero as Record<string, unknown> | undefined;
  const mr = raw.must_reads as Record<string, unknown> | undefined;
  const st = raw.sidebar_topics as Record<string, unknown> | undefined;
  const lm = raw.load_more as Record<string, unknown> | undefined;
  return {
    hero: {
      enabled: (hero?.enabled as boolean) ?? DEFAULT_LAYOUT.hero.enabled,
      count: ((hero?.count as number) === 3 ? 3 : 4),
    },
    must_reads: {
      enabled: (mr?.enabled as boolean) ?? DEFAULT_LAYOUT.must_reads.enabled,
      count: (mr?.count as number) ?? DEFAULT_LAYOUT.must_reads.count,
    },
    sidebar_topics: {
      auto: (st?.auto as boolean) ?? DEFAULT_LAYOUT.sidebar_topics.auto,
      explicit: (st?.explicit as string[]) ?? [],
    },
    load_more: {
      page_size: (lm?.page_size as number) ?? DEFAULT_LAYOUT.load_more.page_size,
    },
  };
}

export function SiteThemeTab({ domain }: SiteThemeTabProps): React.ReactElement {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<ThemeState>({
    primaryColor: "#1a1a2e",
    accentColor: "#f4c542",
    fontHeading: "Inter",
    fontBody: "Inter",
    layout: { ...DEFAULT_LAYOUT },
  });
  const [topicInput, setTopicInput] = useState("");

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const res = await fetch(`/api/sites/site-config?domain=${encodeURIComponent(domain)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { config: Record<string, unknown> };
        const theme = (data.config.theme ?? {}) as Record<string, unknown>;
        const colors = (theme.colors ?? {}) as Record<string, string>;
        const fonts = (theme.fonts ?? {}) as Record<string, string>;
        const layout = data.config.layout as Record<string, unknown> | undefined;
        setState({
          primaryColor: colors.primary ?? "#1a1a2e",
          accentColor: colors.accent ?? "#f4c542",
          fontHeading: fonts.heading ?? "Inter",
          fontBody: fonts.body ?? "Inter",
          layout: parseLayout(layout),
        });
      } catch {
        // keep defaults
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [domain]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          faviconBase64: null,
          configUpdates: {
            theme_colors: { primary: state.primaryColor, accent: state.accentColor },
            theme_fonts: { heading: state.fontHeading, body: state.fontBody },
            layout: state.layout,
          },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") toast("Theme saved", "success");
      else toast(data.message ?? "Failed to save", "error");
    } catch {
      toast("Failed to save theme", "error");
    } finally {
      setSaving(false);
    }
  }

  function addExplicitTopic(raw: string): void {
    const tag = raw.trim();
    if (tag && !state.layout.sidebar_topics.explicit.includes(tag)) {
      setState((s) => ({
        ...s,
        layout: {
          ...s.layout,
          sidebar_topics: {
            ...s.layout.sidebar_topics,
            explicit: [...s.layout.sidebar_topics.explicit, tag],
          },
        },
      }));
    }
    setTopicInput("");
  }

  function removeExplicitTopic(tag: string): void {
    setState((s) => ({
      ...s,
      layout: {
        ...s.layout,
        sidebar_topics: {
          ...s.layout.sidebar_topics,
          explicit: s.layout.sidebar_topics.explicit.filter((t) => t !== tag),
        },
      },
    }));
  }

  if (loading) {
    return <div className="text-sm text-[var(--text-secondary)]">Loading theme...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Brand Colors */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Brand Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorPickerField
            label="Main color (header / nav)"
            value={state.primaryColor}
            onChange={(v): void => setState((s) => ({ ...s, primaryColor: v }))}
            helperText="Used for the header band and accents"
          />
          <ColorPickerField
            label="Accent color (CTA / newsletter)"
            value={state.accentColor}
            onChange={(v): void => setState((s) => ({ ...s, accentColor: v }))}
            helperText="Used for the subscribe band and call-to-action buttons"
          />
        </div>
      </div>

      {/* Typography */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Typography</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FontPickerField
            label="Heading font"
            value={state.fontHeading}
            onChange={(v): void => setState((s) => ({ ...s, fontHeading: v }))}
          />
          <FontPickerField
            label="Body font"
            value={state.fontBody}
            onChange={(v): void => setState((s) => ({ ...s, fontBody: v }))}
          />
        </div>
      </div>

      {/* Layout Knobs */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Layout</h3>
        <div className="space-y-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4">
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={state.layout.hero.enabled}
              onChange={(e): void =>
                setState((s) => ({
                  ...s,
                  layout: { ...s.layout, hero: { ...s.layout.hero, enabled: e.target.checked } },
                }))
              }
              className="accent-cyan"
            />
            Show hero grid
          </label>
          {state.layout.hero.enabled && (
            <div className="flex items-center gap-2 ml-6 text-sm text-[var(--text-secondary)]">
              <span>Hero count:</span>
              <select
                value={state.layout.hero.count}
                onChange={(e): void =>
                  setState((s) => ({
                    ...s,
                    layout: {
                      ...s.layout,
                      hero: { ...s.layout.hero, count: parseInt(e.target.value, 10) as 3 | 4 },
                    },
                  }))
                }
                className="px-2 py-1 border rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              >
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={state.layout.must_reads.enabled}
              onChange={(e): void =>
                setState((s) => ({
                  ...s,
                  layout: {
                    ...s.layout,
                    must_reads: { ...s.layout.must_reads, enabled: e.target.checked },
                  },
                }))
              }
              className="accent-cyan"
            />
            Show Must Reads section
          </label>

          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span>Load more page size:</span>
            <input
              type="number"
              min={1}
              max={50}
              value={state.layout.load_more.page_size}
              onChange={(e): void =>
                setState((s) => ({
                  ...s,
                  layout: {
                    ...s.layout,
                    load_more: { page_size: parseInt(e.target.value, 10) || 10 },
                  },
                }))
              }
              className="w-20 px-2 py-1 border rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={state.layout.sidebar_topics.auto}
                onChange={(e): void =>
                  setState((s) => ({
                    ...s,
                    layout: {
                      ...s.layout,
                      sidebar_topics: { ...s.layout.sidebar_topics, auto: e.target.checked },
                    },
                  }))
                }
                className="accent-cyan"
              />
              Auto-select sidebar topics
            </label>
            {!state.layout.sidebar_topics.auto && (
              <div className="ml-6 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {state.layout.sidebar_topics.explicit.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={(): void => removeExplicitTopic(tag)}
                        className="hover:text-red-400 transition-colors"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={topicInput}
                  onChange={(e): void => setTopicInput(e.target.value)}
                  onKeyDown={(e): void => {
                    if ((e.key === "Enter" || e.key === ",") && topicInput.trim()) {
                      e.preventDefault();
                      addExplicitTopic(topicInput);
                    }
                  }}
                  onBlur={(): void => { if (topicInput.trim()) addExplicitTopic(topicInput); }}
                  placeholder="Type a topic and press Enter..."
                  className="w-full px-2 py-1.5 border rounded text-sm bg-[var(--bg-elevated)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-[var(--border-secondary)]">
        <Button onClick={save} loading={saving}>Save Theme</Button>
      </div>
    </div>
  );
}
