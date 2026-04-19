"use client";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { COMPANIES, VERTICALS } from "@/lib/constants";
import type { WizardFormData } from "@/types/dashboard";

interface StepIdentityProps {
  data: WizardFormData;
  availableDomains: string[];
  onChange: (updates: Partial<WizardFormData>) => void;
  onNext: () => void;
  onCancel: () => void;
}

export function StepIdentity({
  data,
  availableDomains,
  onChange,
  onNext,
  onCancel,
}: StepIdentityProps): React.ReactElement {
  const canProceed = data.pagesProjectName && data.siteName;

  function handleProjectNameChange(value: string): void {
    // Sanitize: lowercase, alphanumeric and hyphens only
    const sanitized = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    // The project name IS the domain/folder name in the network repo.
    // When a real domain is attached later, it becomes an alias on the CF project.
    const updates: Partial<WizardFormData> = { pagesProjectName: sanitized };
    // Auto-set domain to match project name unless user picked a real domain
    if (!data.domain || data.domain === data.pagesProjectName || !availableDomains.includes(data.domain)) {
      updates.domain = sanitized;
    }
    onChange(updates);
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Create Site</h2>

      <div className="space-y-1.5">
        <Input
          label="Pages Project Name"
          placeholder="coolnews-dev-v2"
          value={data.pagesProjectName}
          onChange={(e): void => handleProjectNameChange(e.target.value)}
        />
        <p className="text-xs text-[var(--text-muted)]">
          This creates <span className="font-mono text-cyan">{data.pagesProjectName || "your-project"}.pages.dev</span> on Cloudflare Pages
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Site Name"
          placeholder="Cool News"
          value={data.siteName}
          onChange={(e): void => onChange({ siteName: e.target.value })}
        />
        <Select
          label="Domain (optional)"
          options={[
            { value: "", label: "None — attach later" },
            ...availableDomains.map((d) => ({ value: d, label: d })),
          ]}
          placeholder="Attach a domain later..."
          value={availableDomains.includes(data.domain) ? data.domain : ""}
          onChange={(e): void => onChange({ domain: e.target.value || data.pagesProjectName })}
        />
      </div>

      <Input
        label="Audience"
        placeholder="Describe your target audience (e.g. Women 25-45 interested in home decor and DIY projects)"
        value={data.audience}
        onChange={(e): void => onChange({ audience: e.target.value })}
      />

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Company"
          options={COMPANIES.map((c) => ({ value: c, label: c }))}
          placeholder="Select..."
          value={data.company}
          onChange={(e): void =>
            onChange({ company: e.target.value as WizardFormData["company"] })
          }
        />
        <Select
          label="Vertical"
          options={VERTICALS.map((v) => ({ value: v, label: v }))}
          value={data.vertical}
          onChange={(e): void =>
            onChange({ vertical: e.target.value as WizardFormData["vertical"] })
          }
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
