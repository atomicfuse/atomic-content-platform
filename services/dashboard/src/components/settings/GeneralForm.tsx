"use client";

import { useState, useEffect } from "react";

interface GroupOption {
  group_id: string;
  name?: string;
}

interface GeneralFormValue {
  organization: string;
  legal_entity: string;
  company_address: string;
  support_email_pattern: string;
  default_theme?: string;
  default_fonts?: { heading: string; body: string };
  default_groups?: string[];
}

interface GeneralFormProps {
  value: GeneralFormValue;
  onChange: (value: GeneralFormValue) => void;
}

export function GeneralForm({
  value,
  onChange,
}: GeneralFormProps): React.ReactElement {
  const [availableGroups, setAvailableGroups] = useState<GroupOption[]>([]);

  useEffect(() => {
    async function fetchGroups(): Promise<void> {
      try {
        const res = await fetch("/api/groups");
        if (res.ok) {
          setAvailableGroups((await res.json()) as GroupOption[]);
        }
      } catch {
        // ignore
      }
    }
    void fetchGroups();
  }, []);

  function updateField<K extends keyof GeneralFormValue>(key: K, val: GeneralFormValue[K]): void {
    onChange({ ...value, [key]: val });
  }

  function toggleDefaultGroup(groupId: string): void {
    const current = value.default_groups ?? [];
    if (current.includes(groupId)) {
      updateField("default_groups", current.filter((g) => g !== groupId));
    } else {
      updateField("default_groups", [...current, groupId]);
    }
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
          Default Groups
        </label>
        <div className="space-y-1">
          {availableGroups.map((g) => {
            const selected = (value.default_groups ?? []).includes(g.group_id);
            return (
              <button
                key={g.group_id}
                type="button"
                onClick={(): void => toggleDefaultGroup(g.group_id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  selected
                    ? "border-cyan bg-cyan/10"
                    : "border-[var(--border-primary)] hover:border-[var(--border-secondary)]"
                }`}
              >
                <span className="font-medium">{g.name ?? g.group_id}</span>
                <span className="ml-2 text-xs text-[var(--text-muted)]">{g.group_id}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Sites without their own <code className="rounded bg-[var(--bg-elevated)] px-1">groups:</code>{" "}
          field inherit these default groups.
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
