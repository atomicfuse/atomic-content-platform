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
  const canProceed = data.domain && data.siteName;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Site Identity</h2>

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Domain"
          options={availableDomains.map((d) => ({ value: d, label: d }))}
          placeholder="Select a domain..."
          value={data.domain}
          onChange={(e): void => onChange({ domain: e.target.value })}
        />
        <Input
          label="Site Name"
          placeholder="My Awesome Site"
          value={data.siteName}
          onChange={(e): void => onChange({ siteName: e.target.value })}
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
