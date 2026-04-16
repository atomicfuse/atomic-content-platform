"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface ThemeOption {
  id: WizardFormData["themeBase"];
  name: string;
  description: string;
  gradient: string;
}

const THEMES: ThemeOption[] = [
  {
    id: "modern",
    name: "Modern",
    description: "Clean, minimal design with bold typography",
    gradient: "from-teal-400 to-cyan-600",
  },
  {
    id: "editorial",
    name: "Editorial",
    description: "Magazine-style layout with rich media support",
    gradient: "from-orange-400 to-pink-500",
  },
  {
    id: "bold",
    name: "Bold",
    description: "High-contrast, image-heavy with strong CTAs",
    gradient: "from-emerald-500 to-teal-700",
  },
  {
    id: "classic",
    name: "Classic",
    description: "Traditional blog layout, content-first approach",
    gradient: "from-indigo-400 to-purple-600",
  },
];

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
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

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
    if (data.logoBase64) {
      onChange({ faviconBase64: data.logoBase64 });
    }
  }

  // Resolve favicon preview for browser-tab mockup
  const faviconSrc = data.faviconBase64
    ? `data:image/png;base64,${data.faviconBase64}`
    : null;

  const label = data.domain || data.siteName || "mysite";

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Choose Theme</h2>

      <div className="grid grid-cols-2 gap-4">
        {THEMES.map((theme) => {
          const isSelected = data.themeBase === theme.id;
          return (
            <button
              key={theme.id}
              onClick={(): void => {
                onChange({ themeBase: theme.id });
              }}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                isSelected
                  ? "border-cyan bg-cyan/5"
                  : "border-[var(--border-primary)] hover:border-[var(--border-primary)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {isSelected && (
                <p className="text-xs font-semibold text-cyan mb-2">
                  &#10003; Selected
                </p>
              )}
              <div
                className={`w-full h-24 rounded-lg bg-gradient-to-br ${theme.gradient} mb-3`}
              />
              <p className="font-bold text-[var(--text-primary)]">
                {theme.name}
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                {theme.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Assets (optional) */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            Assets (optional)
          </h3>
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleUseLogoAsFavicon}
                >
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
