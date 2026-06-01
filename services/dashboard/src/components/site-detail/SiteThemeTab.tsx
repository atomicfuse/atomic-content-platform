"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { ColorPickerField } from "@/components/wizard/ColorPickerField";
import { FontPickerField } from "@/components/wizard/FontPickerField";

interface LayoutState {
  hero: { enabled: boolean; count: 3 | 4 };
  must_reads: { enabled: boolean; count: number };
  whats_new: { enabled: boolean; count: number };
  more_on: { enabled: boolean; page_size: number };
  sidebar_topics: { auto: boolean; explicit: string[] };
  load_more: { page_size: number };
}

interface ColorState {
  primary: string;
  accent: string;
  background: string;
  secondary: string;
  text: string;
  muted: string;
  surface: string;
  border: string;
  // New globals (Tier 4 — decouple from text/primary/accent)
  heading: string;
  link: string;
  link_hover: string;
  nav_link: string;
  nav_link_hover: string;
  footer_bg: string;
  must_reads_bg: string;
  hero_title: string;
  must_reads_title: string;
  article_hero_title: string;
  // New article-hero byline override (Tier 1 fix)
  article_hero_meta: string;
  feed_title: string;
  feed_desc: string;
  feed_date: string;
  prose_heading: string;
  prose_body: string;
  category_header_text: string;
  // Newsletter subscribe-form heading (sidebar NewsletterBox + article NewsletterBand).
  // Defaults to primary.
  subscribe_heading: string;
  // New footer text fields (Tier 2)
  footer_text: string;
  footer_heading: string;
  footer_link: string;
  footer_link_hover: string;
}

interface ThemeState {
  colors: ColorState;
  preset: string;
  fontHeading: string;
  fontBody: string;
  layout: LayoutState;
  /** Header logo height in pixels. Defaults to 52. */
  logoHeight: number;
  /** Footer logo height in pixels. null = auto (92% of header). */
  logoHeightFooter: number | null;
}

const DEFAULT_LAYOUT: LayoutState = {
  hero: { enabled: true, count: 4 },
  must_reads: { enabled: true, count: 5 },
  whats_new: { enabled: true, count: 4 },
  more_on: { enabled: true, page_size: 8 },
  sidebar_topics: { auto: true, explicit: [] },
  load_more: { page_size: 4 },
};

const PRESETS: Record<string, { name: string; colors: ColorState }> = {
  classic: {
    name: "Classic News",
    colors: {
      primary: "#1a1a2e", accent: "#f4c542", background: "#ffffff", secondary: "#1a1a2e",
      text: "#1a1a2e", muted: "#6b7280", surface: "#f8f9fa", border: "#e5e7eb",
      heading: "#1a1a2e", link: "#1a1a2e", link_hover: "#f4c542",
      nav_link: "#ffffff", nav_link_hover: "#f4c542",
      footer_bg: "#1a1a2e", must_reads_bg: "#1a1a2e",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#6b7280",
      feed_title: "#1a1a2e", feed_desc: "#1a1a2e", feed_date: "#6b7280",
      prose_heading: "#1a1a2e", prose_body: "#1a1a2e", category_header_text: "#1a1a2e",
      subscribe_heading: "#1a1a2e",
      footer_text: "#9ca3af", footer_heading: "#ffffff", footer_link: "#9ca3af", footer_link_hover: "#ffffff",
    },
  },
  bold: {
    name: "Bold Dark",
    colors: {
      primary: "#E50914", accent: "#B81D24", background: "#141414", secondary: "#1a1a2e",
      text: "#ffffff", muted: "#8C8C8C", surface: "#2a2a2a", border: "#333333",
      heading: "#ffffff", link: "#E50914", link_hover: "#B81D24",
      nav_link: "#ffffff", nav_link_hover: "#B81D24",
      footer_bg: "#1a1a2e", must_reads_bg: "#1a1a2e",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#8C8C8C",
      feed_title: "#ffffff", feed_desc: "#e0e0e0", feed_date: "#8C8C8C",
      prose_heading: "#ffffff", prose_body: "#e0e0e0", category_header_text: "#ffffff",
      subscribe_heading: "#E50914",
      footer_text: "#9ca3af", footer_heading: "#ffffff", footer_link: "#9ca3af", footer_link_hover: "#ffffff",
    },
  },
  ocean: {
    name: "Ocean Editorial",
    colors: {
      primary: "#0f4c81", accent: "#10b981", background: "#f8fafc", secondary: "#0f172a",
      text: "#0f172a", muted: "#64748b", surface: "#e2e8f0", border: "#cbd5e1",
      heading: "#0f172a", link: "#0f4c81", link_hover: "#10b981",
      nav_link: "#ffffff", nav_link_hover: "#10b981",
      footer_bg: "#0f172a", must_reads_bg: "#0f172a",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#64748b",
      feed_title: "#0f172a", feed_desc: "#0f172a", feed_date: "#64748b",
      prose_heading: "#0f172a", prose_body: "#1e293b", category_header_text: "#ffffff",
      subscribe_heading: "#0f4c81",
      footer_text: "#94a3b8", footer_heading: "#ffffff", footer_link: "#94a3b8", footer_link_hover: "#ffffff",
    },
  },
  warm: {
    name: "Warm Magazine",
    colors: {
      primary: "#7c2d12", accent: "#ea580c", background: "#fffbeb", secondary: "#1c1917",
      text: "#1c1917", muted: "#78716c", surface: "#fef3c7", border: "#d6d3d1",
      heading: "#1c1917", link: "#7c2d12", link_hover: "#ea580c",
      nav_link: "#ffffff", nav_link_hover: "#ea580c",
      footer_bg: "#1c1917", must_reads_bg: "#1c1917",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#78716c",
      feed_title: "#1c1917", feed_desc: "#1c1917", feed_date: "#78716c",
      prose_heading: "#1c1917", prose_body: "#292524", category_header_text: "#ffffff",
      subscribe_heading: "#7c2d12",
      footer_text: "#a8a29e", footer_heading: "#ffffff", footer_link: "#a8a29e", footer_link_hover: "#ffffff",
    },
  },
  slate: {
    name: "Elegant Slate",
    colors: {
      primary: "#334155", accent: "#6366f1", background: "#ffffff", secondary: "#1e293b",
      text: "#1e293b", muted: "#94a3b8", surface: "#f1f5f9", border: "#e2e8f0",
      heading: "#1e293b", link: "#334155", link_hover: "#6366f1",
      nav_link: "#ffffff", nav_link_hover: "#6366f1",
      footer_bg: "#1e293b", must_reads_bg: "#1e293b",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#94a3b8",
      feed_title: "#1e293b", feed_desc: "#334155", feed_date: "#94a3b8",
      prose_heading: "#1e293b", prose_body: "#334155", category_header_text: "#ffffff",
      subscribe_heading: "#334155",
      footer_text: "#94a3b8", footer_heading: "#ffffff", footer_link: "#94a3b8", footer_link_hover: "#ffffff",
    },
  },
  midnight: {
    name: "Midnight Purple",
    colors: {
      primary: "#581c87", accent: "#a855f7", background: "#0f0720", secondary: "#1e1038",
      text: "#f0e6ff", muted: "#a78bfa", surface: "#1e1038", border: "#2e1a50",
      heading: "#f0e6ff", link: "#a855f7", link_hover: "#c084fc",
      nav_link: "#f0e6ff", nav_link_hover: "#c084fc",
      footer_bg: "#1e1038", must_reads_bg: "#1e1038",
      hero_title: "#ffffff", must_reads_title: "#f0e6ff", article_hero_title: "#ffffff",
      article_hero_meta: "#a78bfa",
      feed_title: "#f0e6ff", feed_desc: "#d8c8f0", feed_date: "#a78bfa",
      prose_heading: "#f0e6ff", prose_body: "#d8c8f0", category_header_text: "#ffffff",
      subscribe_heading: "#581c87",
      footer_text: "#a78bfa", footer_heading: "#ffffff", footer_link: "#a78bfa", footer_link_hover: "#ffffff",
    },
  },
};

const ALL_COLOR_KEYS: (keyof ColorState)[] = [
  "primary", "accent", "background", "secondary", "text", "muted", "surface", "border",
  "heading", "link", "link_hover", "nav_link", "nav_link_hover",
  "footer_bg", "must_reads_bg",
  "hero_title", "must_reads_title", "article_hero_title", "article_hero_meta",
  "feed_title", "feed_desc", "feed_date",
  "prose_heading", "prose_body", "category_header_text",
  "subscribe_heading",
  "footer_text", "footer_heading", "footer_link", "footer_link_hover",
];

function detectPreset(colors: ColorState): string {
  for (const [id, preset] of Object.entries(PRESETS)) {
    const match = ALL_COLOR_KEYS.every(
      (k) => colors[k].toLowerCase() === preset.colors[k].toLowerCase(),
    );
    if (match) return id;
  }
  return "custom";
}

function defaultColors(): ColorState {
  return { ...PRESETS.classic.colors };
}

interface SiteThemeTabProps {
  domain: string;
}

function parseLayout(raw: Record<string, unknown> | undefined): LayoutState {
  if (!raw) return { ...DEFAULT_LAYOUT };
  const hero = raw.hero as Record<string, unknown> | undefined;
  const mr = raw.must_reads as Record<string, unknown> | undefined;
  const wn = raw.whats_new as Record<string, unknown> | undefined;
  const mo = raw.more_on as Record<string, unknown> | undefined;
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
    whats_new: {
      enabled: (wn?.enabled as boolean) ?? DEFAULT_LAYOUT.whats_new.enabled,
      count: (wn?.count as number) ?? DEFAULT_LAYOUT.whats_new.count,
    },
    more_on: {
      enabled: (mo?.enabled as boolean) ?? DEFAULT_LAYOUT.more_on.enabled,
      page_size: (mo?.page_size as number) ?? DEFAULT_LAYOUT.more_on.page_size,
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [state, setState] = useState<ThemeState>({
    colors: defaultColors(),
    preset: "classic",
    fontHeading: "Inter",
    fontBody: "Inter",
    layout: { ...DEFAULT_LAYOUT },
    logoHeight: 52,
    logoHeightFooter: null,
  });
  const [topicInput, setTopicInput] = useState("");
  // Footer logo upload state — tracked separately from ThemeState because
  // it's a transient file upload, not a value that round-trips with the YAML.
  const [existingFooterLogo, setExistingFooterLogo] = useState<string | null>(null);
  // null = no pending change, string = newly uploaded (base64), "" = pending removal
  const [footerLogoPending, setFooterLogoPending] = useState<string | null>(null);
  const footerLogoInputRef = useRef<HTMLInputElement>(null);
  const initialState = useRef<ThemeState | null>(null);

  // Compute on every render — avoids stale memoization issues.
  const dirty = initialState.current !== null
    && (
      JSON.stringify(state) !== JSON.stringify(initialState.current)
      || footerLogoPending !== null
    );

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

        const base = defaultColors();
        const resolved: ColorState = { ...base };
        for (const key of ALL_COLOR_KEYS) {
          if (colors[key]) resolved[key] = colors[key];
        }

        const loaded: ThemeState = {
          colors: resolved,
          preset: detectPreset(resolved),
          fontHeading: fonts.heading ?? "Inter",
          fontBody: fonts.body ?? "Inter",
          layout: parseLayout(layout),
          logoHeight: typeof theme.logo_height === "number" ? theme.logo_height : 52,
          logoHeightFooter:
            typeof theme.logo_height_footer === "number" ? theme.logo_height_footer : null,
        };
        setState(loaded);
        initialState.current = JSON.parse(JSON.stringify(loaded)) as ThemeState;
        setExistingFooterLogo(typeof theme.footer_logo === "string" ? theme.footer_logo : null);
      } catch {
        // keep defaults — snapshot the defaults as initial state
        initialState.current = {
          colors: defaultColors(),
          preset: "classic",
          fontHeading: "Inter",
          fontBody: "Inter",
          layout: { ...DEFAULT_LAYOUT },
          logoHeight: 52,
          logoHeightFooter: null,
        };
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [domain]);

  function applyPreset(id: string): void {
    const preset = PRESETS[id];
    if (!preset) return;
    setState((s) => ({ ...s, colors: { ...preset.colors }, preset: id }));
  }

  function setColor(key: keyof ColorState, value: string): void {
    setState((s) => {
      const next = { ...s, colors: { ...s.colors, [key]: value } };
      next.preset = detectPreset(next.colors);
      return next;
    });
  }

  function handleFooterLogoUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      if (base64Data) setFooterLogoPending(base64Data);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  // Empty string in footerLogoPending means "user clicked Remove"
  // null means "no pending change"
  // any other string is a base64 of the new upload
  const footerLogoPreviewSrc = footerLogoPending
    ? footerLogoPending === ""
      ? null
      : `data:image/png;base64,${footerLogoPending}`
    : existingFooterLogo;

  async function save(): Promise<void> {
    setSaving(true);
    try {
      // Translate pending footer-logo state into the API contract:
      //   undefined → no change      (omitted from payload)
      //   null      → remove existing
      //   string    → new upload
      let footerLogoBase64: string | null | undefined = undefined;
      if (footerLogoPending !== null) {
        footerLogoBase64 = footerLogoPending === "" ? null : footerLogoPending;
      }

      const res = await fetch("/api/sites/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          logoBase64: null,
          ...(footerLogoBase64 !== undefined ? { footerLogoBase64 } : {}),
          faviconBase64: null,
          configUpdates: {
            theme_colors: state.colors,
            theme_fonts: { heading: state.fontHeading, body: state.fontBody },
            theme_logo_height: state.logoHeight,
            theme_logo_height_footer: state.logoHeightFooter,
            layout: state.layout,
          },
        }),
      });
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "ok") {
        toast("Theme saved — changes will appear on the staging site in a few minutes", "success");
        initialState.current = JSON.parse(JSON.stringify(state)) as ThemeState;
        // Settle pending footer-logo state into the new "existing" baseline
        if (footerLogoPending !== null) {
          setExistingFooterLogo(
            footerLogoPending === "" ? null : "/assets/logo-footer.png",
          );
          setFooterLogoPending(null);
        }
      } else {
        toast(data.message ?? "Failed to save", "error");
      }
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
      {/* Theme Presets */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Theme Preset</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([id, preset]) => (
            <button
              key={id}
              type="button"
              onClick={(): void => applyPreset(id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                state.preset === id
                  ? "border-cyan bg-cyan/10 text-cyan"
                  : "border-[var(--border-secondary)] text-[var(--text-primary)] hover:border-[var(--border-primary)]"
              }`}
            >
              <span className="flex gap-0.5">
                <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: preset.colors.primary }} />
                <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: preset.colors.accent }} />
                <span className="inline-block h-3.5 w-3.5 rounded-full border border-[var(--border-secondary)]" style={{ background: preset.colors.background }} />
              </span>
              {preset.name}
            </button>
          ))}
          <span
            className={`flex items-center rounded-lg border px-3 py-2 text-xs font-medium ${
              state.preset === "custom"
                ? "border-amber-500 bg-amber-500/10 text-amber-600"
                : "border-[var(--border-secondary)] text-[var(--text-muted)]"
            }`}
          >
            Custom
          </span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Selecting a preset fills all colors below. Tweak individual colors to customize.
        </p>
      </div>

      {/* Brand Colors */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Brand Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorPickerField
            label="Main color (header / nav)"
            value={state.colors.primary}
            onChange={(v): void => setColor("primary", v)}
            helperText="Used for the header band and accents"
          />
          <ColorPickerField
            label="Accent color (CTA / newsletter)"
            value={state.colors.accent}
            onChange={(v): void => setColor("accent", v)}
            helperText="Used for the subscribe band and call-to-action buttons"
          />
        </div>
      </div>

      {/* Section Backgrounds */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Section Backgrounds</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColorPickerField
            label="Page background"
            value={state.colors.background}
            onChange={(v): void => setColor("background", v)}
            helperText="Main content area"
          />
          <ColorPickerField
            label="Footer background"
            value={state.colors.footer_bg}
            onChange={(v): void => setColor("footer_bg", v)}
            helperText="Footer section"
          />
          <ColorPickerField
            label="Must Reads background"
            value={state.colors.must_reads_bg}
            onChange={(v): void => setColor("must_reads_bg", v)}
            helperText="Must Reads section"
          />
        </div>
      </div>

      {/* Text Colors */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Text Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColorPickerField label="Body text" value={state.colors.text} onChange={(v): void => setColor("text", v)} helperText="Default body color (paragraphs, etc.)" />
          <ColorPickerField label="Headings" value={state.colors.heading} onChange={(v): void => setColor("heading", v)} helperText="Page headings (h1–h6). Defaults to body text." />
          <ColorPickerField label="Muted (dates, meta)" value={state.colors.muted} onChange={(v): void => setColor("muted", v)} helperText="Secondary text" />
          <ColorPickerField label="Link" value={state.colors.link} onChange={(v): void => setColor("link", v)} helperText="Inline links. Defaults to main color." />
          <ColorPickerField label="Link hover" value={state.colors.link_hover} onChange={(v): void => setColor("link_hover", v)} helperText="Link color on hover. Defaults to accent." />
          <ColorPickerField
            label="Menu item"
            value={state.colors.nav_link}
            onChange={(v): void => setColor("nav_link", v)}
            helperText="Color of nav-bar menu items. Defaults to white."
          />
          <ColorPickerField
            label="Menu item hover"
            value={state.colors.nav_link_hover}
            onChange={(v): void => setColor("nav_link_hover", v)}
            helperText="Color of nav-bar menu items on hover. Defaults to accent."
          />
          <ColorPickerField label="Borders" value={state.colors.border} onChange={(v): void => setColor("border", v)} helperText="Dividers and outlines" />
          <ColorPickerField label="Surface (card bg)" value={state.colors.surface} onChange={(v): void => setColor("surface", v)} helperText="Card backgrounds" />
          <ColorPickerField label="Secondary (dark sections)" value={state.colors.secondary} onChange={(v): void => setColor("secondary", v)} helperText="Dark section fallback" />
        </div>
      </div>

      {/* Advanced Text Colors */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={(): void => setShowAdvanced((v) => !v)}
          className="text-sm font-semibold text-cyan hover:underline"
        >
          {showAdvanced ? "▼" : "▶"} Advanced text colors (per-element overrides)
        </button>
        {showAdvanced && (
          <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">On dark overlays</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ColorPickerField label="Hero card title" value={state.colors.hero_title} onChange={(v): void => setColor("hero_title", v)} helperText="Default: white" />
                <ColorPickerField label="Must Reads card title" value={state.colors.must_reads_title} onChange={(v): void => setColor("must_reads_title", v)} helperText="Default: white" />
                <ColorPickerField label="Article hero title" value={state.colors.article_hero_title} onChange={(v): void => setColor("article_hero_title", v)} helperText="Default: white" />
                <ColorPickerField label="Article hero byline (date/author)" value={state.colors.article_hero_meta} onChange={(v): void => setColor("article_hero_meta", v)} helperText="Default: muted" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Feed cards</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ColorPickerField label="Feed card title" value={state.colors.feed_title} onChange={(v): void => setColor("feed_title", v)} helperText="Default: text color" />
                <ColorPickerField label="Feed card description" value={state.colors.feed_desc} onChange={(v): void => setColor("feed_desc", v)} helperText="Default: text color" />
                <ColorPickerField label="Feed card date" value={state.colors.feed_date} onChange={(v): void => setColor("feed_date", v)} helperText="Default: muted color" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Article page</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ColorPickerField label="Prose headings (h2, h3)" value={state.colors.prose_heading} onChange={(v): void => setColor("prose_heading", v)} helperText="Default: text color" />
                <ColorPickerField label="Prose body text" value={state.colors.prose_body} onChange={(v): void => setColor("prose_body", v)} helperText="Default: text color" />
                <ColorPickerField label="Category header text" value={state.colors.category_header_text} onChange={(v): void => setColor("category_header_text", v)} helperText="Default: white" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Newsletter forms</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ColorPickerField label="Subscribe form heading" value={state.colors.subscribe_heading} onChange={(v): void => setColor("subscribe_heading", v)} helperText='"Subscribe to our newsletter" text in sidebar and article forms. Defaults to primary.' />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Footer</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ColorPickerField label="Footer text" value={state.colors.footer_text} onChange={(v): void => setColor("footer_text", v)} helperText="Tagline, description, copyright. Default: muted." />
                <ColorPickerField label="Footer column headings" value={state.colors.footer_heading} onChange={(v): void => setColor("footer_heading", v)} helperText="Default: white" />
                <ColorPickerField label="Footer link" value={state.colors.footer_link} onChange={(v): void => setColor("footer_link", v)} helperText="Quick Links and similar. Default: muted." />
                <ColorPickerField label="Footer link hover" value={state.colors.footer_link_hover} onChange={(v): void => setColor("footer_link_hover", v)} helperText="Default: white" />
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] border-t border-[var(--border-secondary)] pt-2">
              These default to the global text color above, or white for elements on dark backgrounds. Only change if you need per-element control.
            </p>
          </div>
        )}
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

      {/* Logo */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Logo</h3>
        <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
              Header logo height
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={32}
                max={96}
                step={2}
                value={state.logoHeight}
                onChange={(e): void =>
                  setState((s) => ({ ...s, logoHeight: parseInt(e.target.value, 10) }))
                }
                className="flex-1 accent-cyan"
              />
              <span className="text-xs font-mono text-[var(--text-muted)] w-12 text-right">
                {state.logoHeight}px
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
              Footer logo height
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={24}
                max={96}
                step={2}
                value={state.logoHeightFooter ?? Math.round(state.logoHeight * 0.92)}
                onChange={(e): void =>
                  setState((s) => ({ ...s, logoHeightFooter: parseInt(e.target.value, 10) }))
                }
                className="flex-1 accent-cyan"
              />
              <span className="text-xs font-mono text-[var(--text-muted)] w-12 text-right">
                {state.logoHeightFooter ?? Math.round(state.logoHeight * 0.92)}px
              </span>
              {state.logoHeightFooter != null && (
                <button
                  type="button"
                  onClick={(): void => setState((s) => ({ ...s, logoHeightFooter: null }))}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400"
                  title="Reset to auto (92% of header)"
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Defaults to 92% of header height. Click Reset to return to auto.
            </p>
          </div>

          {/* Footer logo variant */}
          <div className="pt-3 border-t border-[var(--border-secondary)] space-y-2">
            <div>
              <h4 className="text-xs font-semibold text-[var(--text-primary)]">Footer logo (optional)</h4>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Different logo for the footer (e.g. light variant on dark bg). Defaults to the main logo.
              </p>
            </div>
            {footerLogoPreviewSrc && (
              <div className="flex items-center gap-3">
                <img
                  src={footerLogoPreviewSrc}
                  alt="Footer logo preview"
                  className="w-16 h-16 rounded-lg object-contain bg-[#1a1a2e] border border-[var(--border-secondary)] p-1"
                />
                <button
                  type="button"
                  onClick={(): void => setFooterLogoPending("")}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={(): void => footerLogoInputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-semibold border border-[var(--border-secondary)] rounded hover:border-[var(--border-primary)] text-[var(--text-primary)]"
            >
              {footerLogoPreviewSrc ? "Replace Footer Logo" : "Upload Footer Logo"}
            </button>
            <input
              ref={footerLogoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleFooterLogoUpload}
            />
            <p className="text-xs text-[var(--text-muted)]">PNG, JPG or SVG, max 2MB.</p>
          </div>
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

          {/* What's New */}
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={state.layout.whats_new.enabled}
              onChange={(e): void =>
                setState((s) => ({
                  ...s,
                  layout: {
                    ...s.layout,
                    whats_new: { ...s.layout.whats_new, enabled: e.target.checked },
                  },
                }))
              }
              className="accent-cyan"
            />
            Show &ldquo;What&apos;s New&rdquo; grid
          </label>
          {state.layout.whats_new.enabled && (
            <div className="flex items-center gap-2 ml-6 text-sm text-[var(--text-secondary)]">
              <span>What&apos;s New count:</span>
              <input
                type="number"
                min={1}
                max={12}
                value={state.layout.whats_new.count}
                onChange={(e): void =>
                  setState((s) => ({
                    ...s,
                    layout: {
                      ...s.layout,
                      whats_new: { ...s.layout.whats_new, count: parseInt(e.target.value, 10) || 4 },
                    },
                  }))
                }
                className="w-20 px-2 py-1 border rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              />
            </div>
          )}

          {/* More on {site_name} */}
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={state.layout.more_on.enabled}
              onChange={(e): void =>
                setState((s) => ({
                  ...s,
                  layout: {
                    ...s.layout,
                    more_on: { ...s.layout.more_on, enabled: e.target.checked },
                  },
                }))
              }
              className="accent-cyan"
            />
            Show &ldquo;More on {`{site_name}`}&rdquo; section
          </label>
          {state.layout.more_on.enabled && (
            <div className="flex items-center gap-2 ml-6 text-sm text-[var(--text-secondary)]">
              <span>Initial articles:</span>
              <input
                type="number"
                min={1}
                max={50}
                value={state.layout.more_on.page_size}
                onChange={(e): void =>
                  setState((s) => ({
                    ...s,
                    layout: {
                      ...s.layout,
                      more_on: { ...s.layout.more_on, page_size: parseInt(e.target.value, 10) || 8 },
                    },
                  }))
                }
                className="w-20 px-2 py-1 border rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
              />
            </div>
          )}

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
                    load_more: { page_size: parseInt(e.target.value, 10) || 4 },
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

      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-secondary)]">
        {dirty ? (
          <p className="text-xs text-amber-500">You have unsaved changes — click Save Theme to apply.</p>
        ) : (
          <span />
        )}
        <Button onClick={save} loading={saving} disabled={!dirty || saving}>Save Theme</Button>
      </div>
    </div>
  );
}
