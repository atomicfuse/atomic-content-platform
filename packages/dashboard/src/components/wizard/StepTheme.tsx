"use client";

import { Button } from "@/components/ui/Button";
import type { WizardFormData } from "@/types/dashboard";

interface ThemeOption {
  id: "modern" | "editorial";
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
  // Visual-only options (these map to the same base themes with style tweaks)
];

const EXTRA_THEMES: ThemeOption[] = [
  {
    id: "modern",
    name: "Bold",
    description: "High-contrast, image-heavy with strong CTAs",
    gradient: "from-emerald-500 to-teal-700",
  },
  {
    id: "editorial",
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
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Choose Theme</h2>

      <div className="grid grid-cols-2 gap-4">
        {[...THEMES, ...EXTRA_THEMES].map((theme, i) => {
          const isSelected = data.themeBase === theme.id && i < 2;
          const isPrimaryOption = i < 2;
          return (
            <button
              key={`${theme.id}-${i}`}
              onClick={(): void => {
                if (isPrimaryOption) {
                  onChange({ themeBase: theme.id });
                }
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

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          &larr; Back
        </Button>
        <Button onClick={onNext}>Next &rarr;</Button>
      </div>
    </div>
  );
}
