"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { COMPANIES } from "@/lib/constants";
import { useAudiences, useVerticals } from "@/hooks/useReferenceData";
import type { WizardFormData } from "@/types/dashboard";

interface StepIdentityProps {
  data: WizardFormData;
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onCancel: () => void;
}

export function StepIdentity({
  data,
  onChange,
  onNext,
  onCancel,
}: StepIdentityProps): React.ReactElement {
  const { audiences } = useAudiences();
  const { verticals } = useVerticals();
  const [audienceSearch, setAudienceSearch] = useState("");
  const [audienceOpen, setAudienceOpen] = useState(false);
  const audienceRef = useRef<HTMLDivElement>(null);

  // Close audience dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (audienceRef.current && !audienceRef.current.contains(e.target as Node)) {
        setAudienceOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return (): void => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredAudiences = audiences
    .filter((a) => !data.audienceIds.includes(a.id))
    .filter((a) => a.name.toLowerCase().includes(audienceSearch.toLowerCase()));

  // EC-16: Trim whitespace before checking — "   " is truthy but blank.
  const canProceed =
    data.pagesProjectName?.trim() &&
    data.siteName?.trim() &&
    data.theme.trim().length > 0;

  function handleProjectNameChange(value: string): void {
    // EC-14: Enforce max length of 63 (DNS label limit / GitHub branch best practice).
    // EC-15: Collapse consecutive hyphens and strip leading/trailing hyphens.
    const sanitized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 63);
    onChange({ pagesProjectName: sanitized });
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Create Site</h2>

      <div className="space-y-1.5">
        <Input
          label="Site Slug"
          placeholder="coolnews-dev-v2"
          value={data.pagesProjectName}
          onChange={(e): void => handleProjectNameChange(e.target.value)}
          maxLength={63}
        />
        <p className="text-xs text-[var(--text-muted)]">
          Used as the network-repo folder name. Creates a staging branch{" "}
          <span className="font-mono text-cyan">staging/{data.pagesProjectName || "your-project"}</span>{" "}
          and a preview on the multi-tenant Worker.
          {/* EC-14: Character count */}
          <span className="ml-2 tabular-nums">{data.pagesProjectName.length}/63</span>
        </p>
      </div>

      <Input
        label="Site Name"
        placeholder="Cool News"
        value={data.siteName}
        onChange={(e): void => onChange({ siteName: e.target.value })}
        onBlur={(): void => {
          // EC-16: Trim whitespace on blur so "   " doesn't persist.
          const trimmed = data.siteName.trim();
          if (trimmed !== data.siteName) onChange({ siteName: trimmed });
        }}
      />

      <div className="space-y-1.5" ref={audienceRef}>
        <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Audiences
        </label>
        {data.audienceIds.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {data.audienceIds.map((id) => {
              const name = audiences.find((a) => a.id === id)?.name ?? id;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md bg-cyan/15 text-cyan px-2 py-0.5 text-xs font-semibold"
                >
                  {name}
                  <button
                    type="button"
                    onClick={(): void => {
                      onChange({
                        audienceIds: data.audienceIds.filter((x) => x !== id),
                        audiences: data.audiences.filter((_, i) => data.audienceIds[i] !== id),
                      });
                    }}
                    className="hover:text-red-400 transition-colors"
                  >
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <div className="relative">
          <input
            type="text"
            placeholder="Search audiences..."
            value={audienceSearch}
            onFocus={(): void => setAudienceOpen(true)}
            onChange={(e): void => {
              setAudienceSearch(e.target.value);
              setAudienceOpen(true);
            }}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-cyan/50 focus:border-cyan transition-colors"
          />
          {audienceOpen && (
            <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] shadow-lg">
              {filteredAudiences.length === 0 ? (
                <p className="px-3 py-2 text-sm text-[var(--text-muted)]">
                  {audienceSearch ? "No matching audiences" : "All audiences selected"}
                </p>
              ) : (
                filteredAudiences.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={(): void => {
                      onChange({
                        audienceIds: [...data.audienceIds, a.id],
                        audiences: [...data.audiences, a.name],
                      });
                      setAudienceSearch("");
                      setAudienceOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-primary)] transition-colors"
                  >
                    {a.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <Select
        label="Company"
        options={[
          { value: "", label: "No Company" },
          ...COMPANIES.map((c) => ({ value: c, label: c })),
        ]}
        value={data.company}
        onChange={(e): void =>
          onChange({ company: e.target.value as WizardFormData["company"] })
        }
      />

      {/* Category — display/organization label only. Sites grid groups by
          this; aggregator filtering is driven by topics_v2, not by category. */}
      <Select
        label="Category (optional)"
        options={[
          { value: "", label: "— None —" },
          ...verticals.map((v) => ({ value: v.id, label: v.name })),
        ]}
        value={data.verticalId}
        onChange={(e): void => {
          const id = e.target.value;
          const name = verticals.find((v) => v.id === id)?.name ?? "";
          onChange({ verticalId: id, vertical: name });
        }}
      />

      <div className="space-y-1.5">
        <label className="text-xs uppercase tracking-wider text-[var(--text-secondary)]">Site theme *</label>
        <p className="text-xs text-[var(--text-muted)]">1–2 lines describing the editorial angle. AI uses this to propose filters for each topic.</p>
        <textarea
          value={data.theme}
          onChange={(e): void => onChange({ theme: e.target.value })}
          placeholder="Travel and eating while traveling — destinations, food tourism, wine routes."
          className="w-full min-h-[64px] rounded border border-[var(--border-primary)] bg-[var(--bg-elevated)] p-2 text-sm"
        />
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Next &rarr;
        </Button>
      </div>
    </div>
  );
}
