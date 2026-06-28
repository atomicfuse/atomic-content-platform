"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { ColorPickerField } from "@/components/wizard/ColorPickerField";
import { FontPickerField } from "@/components/wizard/FontPickerField";
import {
  PRESETS,
  detectPreset,
  presetToColors,
} from "@/components/wizard/themePresets";
import { ThemePresetPicker } from "@/components/wizard/ThemePresetPicker";
import type { WizardFormData } from "@/types/dashboard";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StepThemeProps {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepTheme({
  data,
  onChange,
  onNext,
  onBack,
}: StepThemeProps): React.ReactElement {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [topicInput, setTopicInput] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const footerLogoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const colors = data.themeColors;

  function applyPreset(id: string): void {
    const preset = PRESETS[id];
    if (!preset) return;
    const updates: Partial<WizardFormData> = {
      themePreset: id,
      themeColors: presetToColors(id),
      primaryColor: preset.colors.primary,
      accentColor: preset.colors.accent,
    };
    // If the preset ships a font pairing, overwrite heading + body. Existing
    // presets (Classic News etc.) omit `fonts` so they never touch font state.
    if (preset.fonts) {
      updates.fontHeading = preset.fonts.heading;
      updates.fontBody = preset.fonts.body;
    }
    onChange(updates);
  }

  function setColor(key: string, value: string): void {
    const next = { ...colors, [key]: value };
    onChange({
      themeColors: next,
      themePreset: detectPreset(next),
      primaryColor: key === "primary" ? value : data.primaryColor,
      accentColor: key === "accent" ? value : data.accentColor,
    });
  }

  function setLayout(patch: Partial<WizardFormData["themeLayout"]>): void {
    onChange({ themeLayout: { ...data.themeLayout, ...patch } });
  }

  function addExplicitTopic(raw: string): void {
    const tag = raw.trim();
    if (tag && !data.themeLayout.sidebar_topics.explicit.includes(tag)) {
      setLayout({
        sidebar_topics: {
          ...data.themeLayout.sidebar_topics,
          explicit: [...data.themeLayout.sidebar_topics.explicit, tag],
        },
      });
    }
    setTopicInput("");
  }

  function removeExplicitTopic(tag: string): void {
    setLayout({
      sidebar_topics: {
        ...data.themeLayout.sidebar_topics,
        explicit: data.themeLayout.sidebar_topics.explicit.filter((t) => t !== tag),
      },
    });
  }

  // --- File upload handlers ---
  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      if (base64Data) onChange({ logoBase64: base64Data });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
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
      if (base64Data) onChange({ footerLogoBase64: base64Data });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleFaviconUpload(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && file.type !== "image/x-icon") return;
    if (file.size > 500 * 1024) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      const result = reader.result as string;
      const base64Data = result.split(",")[1];
      if (base64Data) onChange({ faviconBase64: base64Data });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleUseLogoAsFavicon(): void {
    if (data.logoBase64) onChange({ faviconBase64: data.logoBase64 });
  }

  const faviconSrc = data.faviconBase64
    ? `data:image/png;base64,${data.faviconBase64}`
    : null;
  const label = data.domain || data.siteName || "mysite";

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Theme</h2>

      {/* Theme Presets */}
      <ThemePresetPicker value={data.themePreset} onChange={applyPreset} />

      {/* Brand Colors */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Brand Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorPickerField
            label="Main color (header / nav)"
            value={colors.primary ?? "#1a1a2e"}
            onChange={(v): void => setColor("primary", v)}
            helperText="Used for the header band and accents"
          />
          <ColorPickerField
            label="Accent color (CTA / newsletter)"
            value={colors.accent ?? "#f4c542"}
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
            value={colors.background ?? "#ffffff"}
            onChange={(v): void => setColor("background", v)}
            helperText="Main content area"
          />
          <ColorPickerField
            label="Footer background"
            value={colors.footer_bg ?? "#1a1a2e"}
            onChange={(v): void => setColor("footer_bg", v)}
            helperText="Footer section"
          />
          <ColorPickerField
            label="Must Reads background"
            value={colors.must_reads_bg ?? "#1a1a2e"}
            onChange={(v): void => setColor("must_reads_bg", v)}
            helperText="Must Reads section"
          />
        </div>
      </div>

      {/* Text Colors */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Text Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColorPickerField
            label="Body text"
            value={colors.text ?? "#1a1a2e"}
            onChange={(v): void => setColor("text", v)}
            helperText="Default body color (paragraphs, etc.)"
          />
          <ColorPickerField
            label="Headings"
            value={colors.heading ?? colors.text ?? "#1a1a2e"}
            onChange={(v): void => setColor("heading", v)}
            helperText="Page headings (h1–h6). Defaults to body text."
          />
          <ColorPickerField
            label="Muted (dates, meta)"
            value={colors.muted ?? "#6b7280"}
            onChange={(v): void => setColor("muted", v)}
            helperText="Secondary text"
          />
          <ColorPickerField
            label="Link"
            value={colors.link ?? colors.primary ?? "#1a1a2e"}
            onChange={(v): void => setColor("link", v)}
            helperText="Inline links. Defaults to main color."
          />
          <ColorPickerField
            label="Link hover"
            value={colors.link_hover ?? colors.accent ?? "#f4c542"}
            onChange={(v): void => setColor("link_hover", v)}
            helperText="Link color on hover. Defaults to accent."
          />
          <ColorPickerField
            label="Borders"
            value={colors.border ?? "#e5e7eb"}
            onChange={(v): void => setColor("border", v)}
            helperText="Dividers and outlines"
          />
          <ColorPickerField
            label="Surface (card bg)"
            value={colors.surface ?? "#f8f9fa"}
            onChange={(v): void => setColor("surface", v)}
            helperText="Card backgrounds"
          />
          <ColorPickerField
            label="Secondary (dark sections)"
            value={colors.secondary ?? "#1a1a2e"}
            onChange={(v): void => setColor("secondary", v)}
            helperText="Dark section fallback"
          />
        </div>
      </div>

      {/* Advanced Text Colors */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={(): void => setShowAdvanced((v) => !v)}
          className="text-sm font-semibold text-cyan hover:underline"
        >
          {showAdvanced ? "\u25BC" : "\u25B6"} Advanced text colors (per-element overrides)
        </button>
        {showAdvanced && (
          <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-surface)] p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">On dark overlays</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ColorPickerField label="Hero card title" value={colors.hero_title ?? "#ffffff"} onChange={(v): void => setColor("hero_title", v)} helperText="Default: white" />
                <ColorPickerField label="Must Reads card title" value={colors.must_reads_title ?? "#ffffff"} onChange={(v): void => setColor("must_reads_title", v)} helperText="Default: white" />
                <ColorPickerField label="Article hero title" value={colors.article_hero_title ?? "#ffffff"} onChange={(v): void => setColor("article_hero_title", v)} helperText="Default: white" />
                <ColorPickerField label="Article hero byline (date/author)" value={colors.article_hero_meta ?? colors.muted ?? "#6b7280"} onChange={(v): void => setColor("article_hero_meta", v)} helperText="Default: muted" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Feed cards</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ColorPickerField label="Feed card title" value={colors.feed_title ?? "#1a1a2e"} onChange={(v): void => setColor("feed_title", v)} helperText="Default: text color" />
                <ColorPickerField label="Feed card description" value={colors.feed_desc ?? "#1a1a2e"} onChange={(v): void => setColor("feed_desc", v)} helperText="Default: text color" />
                <ColorPickerField label="Feed card date" value={colors.feed_date ?? "#6b7280"} onChange={(v): void => setColor("feed_date", v)} helperText="Default: muted color" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Article page</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ColorPickerField label="Prose headings (h2, h3)" value={colors.prose_heading ?? "#1a1a2e"} onChange={(v): void => setColor("prose_heading", v)} helperText="Default: text color" />
                <ColorPickerField label="Prose body text" value={colors.prose_body ?? "#1a1a2e"} onChange={(v): void => setColor("prose_body", v)} helperText="Default: text color" />
                <ColorPickerField label="Category header text" value={colors.category_header_text ?? "#ffffff"} onChange={(v): void => setColor("category_header_text", v)} helperText="Default: white" />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Footer</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ColorPickerField
                  label="Footer text"
                  value={colors.footer_text ?? colors.muted ?? "#9ca3af"}
                  onChange={(v): void => setColor("footer_text", v)}
                  helperText="Tagline, description, copyright. Default: muted."
                />
                <ColorPickerField
                  label="Footer column headings"
                  value={colors.footer_heading ?? "#ffffff"}
                  onChange={(v): void => setColor("footer_heading", v)}
                  helperText="Default: white"
                />
                <ColorPickerField
                  label="Footer link"
                  value={colors.footer_link ?? colors.muted ?? "#9ca3af"}
                  onChange={(v): void => setColor("footer_link", v)}
                  helperText="Quick Links and similar. Default: muted."
                />
                <ColorPickerField
                  label="Footer link hover"
                  value={colors.footer_link_hover ?? "#ffffff"}
                  onChange={(v): void => setColor("footer_link_hover", v)}
                  helperText="Default: white"
                />
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
            value={data.fontHeading}
            onChange={(v): void => onChange({ fontHeading: v })}
          />
          <FontPickerField
            label="Body font"
            value={data.fontBody}
            onChange={(v): void => onChange({ fontBody: v })}
          />
        </div>
      </div>

      {/* Layout */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Layout</h3>
        <div className="space-y-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4">
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={data.themeLayout.hero.enabled}
              onChange={(e): void =>
                setLayout({ hero: { ...data.themeLayout.hero, enabled: e.target.checked } })
              }
              className="accent-cyan"
            />
            Show hero grid
          </label>
          {data.themeLayout.hero.enabled && (
            <div className="flex items-center gap-2 ml-6 text-sm text-[var(--text-secondary)]">
              <span>Hero count:</span>
              <select
                value={data.themeLayout.hero.count}
                onChange={(e): void =>
                  setLayout({ hero: { ...data.themeLayout.hero, count: parseInt(e.target.value, 10) as 3 | 4 } })
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
              checked={data.themeLayout.must_reads.enabled}
              onChange={(e): void =>
                setLayout({ must_reads: { ...data.themeLayout.must_reads, enabled: e.target.checked } })
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
              value={data.themeLayout.load_more.page_size}
              onChange={(e): void =>
                setLayout({ load_more: { page_size: parseInt(e.target.value, 10) || 10 } })
              }
              className="w-20 px-2 py-1 border rounded bg-[var(--bg-elevated)] text-[var(--text-primary)]"
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={data.themeLayout.sidebar_topics.auto}
                onChange={(e): void =>
                  setLayout({ sidebar_topics: { ...data.themeLayout.sidebar_topics, auto: e.target.checked } })
                }
                className="accent-cyan"
              />
              Auto-select sidebar topics
            </label>
            {!data.themeLayout.sidebar_topics.auto && (
              <div className="ml-6 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {data.themeLayout.sidebar_topics.explicit.map((tag) => (
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

      {/* Brand Colors */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Brand Colors</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ColorPickerField
            label="Main color (header / nav)"
            value={data.primaryColor}
            onChange={(v): void => onChange({ primaryColor: v })}
            helperText="Used for the header band and accents"
          />
          <ColorPickerField
            label="Accent color (CTA / newsletter)"
            value={data.accentColor}
            onChange={(v): void => onChange({ accentColor: v })}
            helperText="Used for the subscribe band and call-to-action buttons"
          />
        </div>
      </div>

      {/* Typography */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Typography</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FontPickerField
            label="Heading font"
            value={data.fontHeading}
            onChange={(v): void => onChange({ fontHeading: v })}
          />
          <FontPickerField
            label="Body font"
            value={data.fontBody}
            onChange={(v): void => onChange({ fontBody: v })}
          />
        </div>
      </div>

      {/* Assets (optional) */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">Assets (optional)</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Optional — AI will generate a logo if you skip this
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Logo upload */}
          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Logo</h4>
            {data.logoBase64 && (
              <div className="flex items-center gap-3">
                <img
                  src={`data:image/png;base64,${data.logoBase64}`}
                  alt="Logo preview"
                  className="w-16 h-16 rounded-lg object-contain bg-white border border-[var(--border-secondary)]"
                />
                <button
                  type="button"
                  onClick={(): void => onChange({ logoBase64: undefined })}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => logoInputRef.current?.click()}
            >
              {data.logoBase64 ? "Replace Logo" : "Upload Logo"}
            </Button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleLogoUpload}
            />
            <p className="text-xs text-[var(--text-muted)]">PNG, JPG or SVG, max 2MB.</p>

            <div className="pt-2 border-t border-[var(--border-secondary)] space-y-3">
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
                    value={data.logoHeight ?? 52}
                    onChange={(e): void => onChange({ logoHeight: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-cyan"
                  />
                  <span className="text-xs font-mono text-[var(--text-muted)] w-12 text-right">
                    {data.logoHeight ?? 52}px
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
                    value={data.logoHeightFooter ?? Math.round((data.logoHeight ?? 52) * 0.92)}
                    onChange={(e): void => onChange({ logoHeightFooter: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-cyan"
                  />
                  <span className="text-xs font-mono text-[var(--text-muted)] w-12 text-right">
                    {data.logoHeightFooter ?? Math.round((data.logoHeight ?? 52) * 0.92)}px
                  </span>
                  {data.logoHeightFooter != null && (
                    <button
                      type="button"
                      onClick={(): void => onChange({ logoHeightFooter: undefined })}
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
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">
                  Menu item size
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={10}
                    max={24}
                    step={1}
                    value={data.menuItemFontSize ?? 14}
                    onChange={(e): void => onChange({ menuItemFontSize: parseInt(e.target.value, 10) })}
                    className="flex-1 accent-cyan"
                  />
                  <span className="text-xs font-mono text-[var(--text-muted)] w-12 text-right">
                    {data.menuItemFontSize ?? 14}px
                  </span>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Navigation menu item font size. Increase it alongside a larger logo. Defaults to 14px.
                </p>
              </div>
            </div>
          </div>

          {/* Footer logo (optional) */}
          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">Footer logo</h4>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Optional — use if your footer background needs a different logo variant (e.g. light-on-dark). Defaults to the main logo.
              </p>
            </div>
            {data.footerLogoBase64 && (
              <div className="flex items-center gap-3">
                <img
                  src={`data:image/png;base64,${data.footerLogoBase64}`}
                  alt="Footer logo preview"
                  className="w-16 h-16 rounded-lg object-contain bg-[#1a1a2e] border border-[var(--border-secondary)] p-1"
                />
                <button
                  type="button"
                  onClick={(): void => onChange({ footerLogoBase64: undefined })}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => footerLogoInputRef.current?.click()}
            >
              {data.footerLogoBase64 ? "Replace Footer Logo" : "Upload Footer Logo"}
            </Button>
            <input
              ref={footerLogoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              className="hidden"
              onChange={handleFooterLogoUpload}
            />
            <p className="text-xs text-[var(--text-muted)]">PNG, JPG or SVG, max 2MB.</p>
          </div>

          {/* Favicon upload */}
          <div className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-secondary)] p-4 space-y-3">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Favicon</h4>
            {data.faviconBase64 && (
              <div className="flex items-center gap-3">
                <img
                  src={`data:image/png;base64,${data.faviconBase64}`}
                  alt="Favicon preview"
                  className="w-8 h-8 rounded object-contain bg-white border border-[var(--border-secondary)]"
                />
                <button
                  type="button"
                  onClick={(): void => onChange({ faviconBase64: undefined })}
                  className="text-xs text-[var(--text-muted)] hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            )}
            {/* Browser tab mockup */}
            <div className="inline-block">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg bg-[var(--bg-elevated)] border border-b-0 border-[var(--border-secondary)] max-w-[180px]">
                {faviconSrc ? (
                  <img src={faviconSrc} alt="" className="w-4 h-4 rounded-sm object-contain flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-sm bg-[var(--border-secondary)] flex-shrink-0" />
                )}
                <span className="text-xs text-[var(--text-primary)] truncate">{label}</span>
              </div>
              <div className="border border-[var(--border-secondary)] rounded-tr-lg rounded-b-lg bg-[var(--bg-primary)] px-3 py-2 w-56">
                <div className="h-2 w-3/4 rounded bg-[var(--border-secondary)]" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={(): void => faviconInputRef.current?.click()}
              >
                {data.faviconBase64 ? "Replace" : "Upload Favicon"}
              </Button>
              {data.logoBase64 && !data.faviconBase64 && (
                <Button variant="secondary" size="sm" onClick={handleUseLogoAsFavicon}>
                  Use Logo
                </Button>
              )}
            </div>
            <input
              ref={faviconInputRef}
              type="file"
              accept=".png,.ico,.svg,image/png,image/x-icon,image/svg+xml"
              className="hidden"
              onChange={handleFaviconUpload}
            />
            <p className="text-xs text-[var(--text-muted)]">PNG, ICO or SVG, max 500KB.</p>
          </div>
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <Button onClick={onNext}>Next &rarr;</Button>
      </div>
    </div>
  );
}
