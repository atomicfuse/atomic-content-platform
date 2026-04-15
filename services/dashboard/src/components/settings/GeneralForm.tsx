"use client";

interface GeneralFormValue {
  organization: string;
  legal_entity: string;
  company_address: string;
  support_email_pattern: string;
  default_theme?: string;
  default_fonts?: { heading: string; body: string };
  default_monetization?: string;
}

export interface MonetizationOption {
  monetization_id: string;
  name?: string;
}

interface GeneralFormProps {
  value: GeneralFormValue;
  onChange: (value: GeneralFormValue) => void;
  monetizationOptions?: MonetizationOption[];
}

export function GeneralForm({
  value,
  onChange,
  monetizationOptions = [],
}: GeneralFormProps): React.ReactElement {
  function updateField<K extends keyof GeneralFormValue>(key: K, val: GeneralFormValue[K]): void {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Organization Name
        </label>
        <input
          type="text"
          value={value.organization}
          onChange={(e): void => updateField("organization", e.target.value)}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Legal Entity
        </label>
        <input
          type="text"
          value={value.legal_entity}
          onChange={(e): void => updateField("legal_entity", e.target.value)}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Company Address
        </label>
        <textarea
          value={value.company_address}
          onChange={(e): void => updateField("company_address", e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Support Email Pattern
        </label>
        <input
          type="text"
          value={value.support_email_pattern}
          placeholder="contact@{{domain}}"
          onChange={(e): void => updateField("support_email_pattern", e.target.value)}
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
        />
        <p className="text-xs text-[var(--text-muted)]">
          Use {"{{domain}}"} as a placeholder for the site domain.
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Default Theme
        </label>
        <select
          value={value.default_theme ?? "modern"}
          onChange={(e): void => updateField("default_theme", e.target.value)}
          className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
        >
          <option value="modern">Modern</option>
          <option value="editorial">Editorial</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Default Monetization Profile
        </label>
        <select
          value={value.default_monetization ?? ""}
          onChange={(e): void =>
            updateField("default_monetization", e.target.value || undefined)
          }
          className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-cyan/50 appearance-none"
        >
          <option value="">— No default —</option>
          {monetizationOptions.map((o) => (
            <option key={o.monetization_id} value={o.monetization_id}>
              {o.name ? `${o.name} (${o.monetization_id})` : o.monetization_id}
            </option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-muted)]">
          Sites without their own <code className="rounded bg-[var(--bg-elevated)] px-1">monetization:</code>{" "}
          field inherit this profile.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Default Heading Font
          </label>
          <input
            type="text"
            value={value.default_fonts?.heading ?? ""}
            placeholder="Inter"
            onChange={(e): void =>
              updateField("default_fonts", {
                heading: e.target.value,
                body: value.default_fonts?.body ?? "",
              })
            }
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          />
        </div>
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Default Body Font
          </label>
          <input
            type="text"
            value={value.default_fonts?.body ?? ""}
            placeholder="Inter"
            onChange={(e): void =>
              updateField("default_fonts", {
                heading: value.default_fonts?.heading ?? "",
                body: e.target.value,
              })
            }
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50"
          />
        </div>
      </div>
    </div>
  );
}
