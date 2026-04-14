"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WizardShell } from "@/components/wizard/WizardShell";
import { StepIdentity } from "@/components/wizard/StepIdentity";
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
  vertical: "Other",
  groups: [],
  themeBase: "modern",
  audience: "",
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
    pagesProject: string;
  } | null>(null);
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);

  // Fetch available "New" domains for the dropdown
  useEffect(() => {
    async function fetchDomains(): Promise<void> {
      try {
        const res = await fetch("/api/domains/available");
        if (res.ok) {
          const data = (await res.json()) as { domains: string[] };
          setAvailableDomains(data.domains);
        }
      } catch {
        // Fallback: if API not available, allow typed input
      }
    }
    void fetchDomains();
  }, []);

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
                availableDomains={availableDomains}
                onChange={updateForm}
                onNext={goNext}
                onCancel={(): void => router.push("/")}
              />
            );
          case 1:
            return (
              <StepGroups
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 2:
            return (
              <StepTheme
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 3:
            return (
              <StepContentBrief
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 4:
            return (
              <StepScriptVars
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 5:
            return (
              <StepPreview
                data={formData}
                onNext={goNext}
                onBack={goBack}
                onStagingResult={setStagingResult}
                existingResult={stagingResult}
              />
            );
          case 6:
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
