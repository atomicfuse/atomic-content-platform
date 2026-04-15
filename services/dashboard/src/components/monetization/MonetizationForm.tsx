"use client";

import { Input } from "@/components/ui/Input";

interface MonetizationFormValue {
  monetization_id: string;
  name: string;
  provider: string;
}

interface MonetizationFormProps {
  value: MonetizationFormValue;
  onChange: (next: MonetizationFormValue) => void;
  /** When true, monetization_id is shown read-only (existing profile). */
  idReadOnly?: boolean;
}

export function MonetizationForm({
  value,
  onChange,
  idReadOnly = true,
}: MonetizationFormProps): React.ReactElement {
  return (
    <div className="space-y-4 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-4">
      <Input
        label="Monetization ID"
        value={value.monetization_id}
        readOnly={idReadOnly}
        onChange={
          idReadOnly
            ? undefined
            : (e): void => onChange({ ...value, monetization_id: e.target.value })
        }
        className={idReadOnly ? "opacity-60 cursor-not-allowed" : ""}
      />
      <Input
        label="Name"
        value={value.name}
        placeholder="Premium Ads"
        onChange={(e): void => onChange({ ...value, name: e.target.value })}
      />
      <Input
        label="Provider"
        value={value.provider}
        placeholder="network-alpha, taboola, adsense, …"
        onChange={(e): void => onChange({ ...value, provider: e.target.value })}
      />
      <p className="text-xs text-[var(--text-muted)]">
        The monetization id is fixed once a profile exists — it determines the
        filename (<code className="rounded bg-[var(--bg-surface)] px-1">monetization/{value.monetization_id || "id"}.yaml</code>) and is
        referenced by sites via <code className="rounded bg-[var(--bg-surface)] px-1">monetization: {value.monetization_id || "id"}</code>.
      </p>
    </div>
  );
}
