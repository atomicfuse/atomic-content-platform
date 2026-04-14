"use client";

interface ThemeFormProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}

export function ThemeForm({ value, onChange }: ThemeFormProps): React.ReactElement {
  function updateField(key: string, val: string): void {
    onChange({ ...value, [key]: val || undefined });
  }

  const colors = (value.colors ?? {}) as Record<string, string>;

  function updateColor(key: string, val: string): void {
    const updated = { ...colors, [key]: val || undefined };
    onChange({ ...value, colors: updated });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Theme
          </label>
          <select
            value={(value.theme as string) ?? "modern"}
            onChange={(e): void => updateField("theme", e.target.value)}
            className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
          >
            <option value="modern">Modern</option>
            <option value="editorial">Editorial</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Colors
        </h4>
        <div className="grid grid-cols-2 gap-4">
          {(["primary", "secondary", "accent", "background"] as const).map((colorKey) => (
            <div key={colorKey} className="space-y-1.5">
              <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {colorKey}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={colors[colorKey] ?? "#000000"}
                  onChange={(e): void => updateColor(colorKey, e.target.value)}
                  className="h-9 w-9 rounded border border-[var(--border-primary)] bg-transparent cursor-pointer"
                />
                <input
                  type="text"
                  value={colors[colorKey] ?? ""}
                  placeholder="#000000"
                  onChange={(e): void => updateColor(colorKey, e.target.value)}
                  className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Heading Font
          </label>
          <input
            type="text"
            value={(value.heading_font as string) ?? ""}
            placeholder="Inter"
            onChange={(e): void => updateField("heading_font", e.target.value)}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Body Font
          </label>
          <input
            type="text"
            value={(value.body_font as string) ?? ""}
            placeholder="Inter"
            onChange={(e): void => updateField("body_font", e.target.value)}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          />
        </div>
      </div>
    </div>
  );
}
