"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WizardShell } from "@/components/wizard/WizardShell";
import { StepIdentity } from "@/components/wizard/StepIdentity";
import { StepNicheTargeting } from "@/components/wizard/StepNicheTargeting";
import { StepGroups } from "@/components/wizard/StepGroups";
import { StepTheme } from "@/components/wizard/StepTheme";
import { StepContentBrief } from "@/components/wizard/StepContentBrief";
import { StepScriptVars } from "@/components/wizard/StepScriptVars";
import { StepPreview } from "@/components/wizard/StepPreview";
import { StepGoLive } from "@/components/wizard/StepGoLive";
import type { WizardFormData } from "@/types/dashboard";

const DEFAULT_FORM: WizardFormData = {
  domain: "",
  pagesProjectName: "",
  siteName: "",
  siteTagline: "",
  company: "ATL",
  vertical: "",
  verticalId: "",
  groups: [],
  themeBase: "modern",
  audiences: [],
  audienceIds: [],
  selectedCategories: [],
  selectedTags: [],
  iabVerticalCode: "",
  bundleId: "",
  tone: "",
  topics: [],
  articlesPerDay: 1,
  preferredDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  contentGuidelines: "",
  scriptsVars: {},
};

export default function WizardPage(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedDomain = searchParams.get("domain") ?? "";

  const [formData, setFormData] = useState<WizardFormData>({
    ...DEFAULT_FORM,
    domain: preselectedDomain || "",
  });
  const [stagingResult, setStagingResult] = useState<{
    stagingUrl: string;
    siteFolder: string;
  } | null>(null);

  function updateForm(updates: Partial<WizardFormData>): void {
    setFormData((prev) => ({ ...prev, ...updates }));
  }

  return (
    <WizardShell>
      {({ currentStep, goNext, goBack }): React.ReactNode => {
        switch (currentStep) {
          case 0:
            return (
              <StepIdentity
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onCancel={(): void => router.push("/")}
              />
            );
          case 1:
            return (
              <StepNicheTargeting
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 2:
            return (
              <StepGroups
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 3:
            return (
              <StepTheme
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 4:
            return (
              <StepContentBrief
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 5:
            return (
              <StepScriptVars
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 6:
            return (
              <StepPreview
                data={formData}
                onNext={goNext}
                onBack={goBack}
                onStagingResult={setStagingResult}
                existingResult={stagingResult}
              />
            );
          case 7:
            return (
              <StepGoLive
                data={formData}
                stagingResult={stagingResult}
                onBack={goBack}
              />
            );
          default:
            return null;
        }
      }}
    </WizardShell>
  );
}
