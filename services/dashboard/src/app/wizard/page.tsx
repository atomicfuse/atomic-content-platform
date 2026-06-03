"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WizardShell } from "@/components/wizard/WizardShell";
import { StepIdentity } from "@/components/wizard/StepIdentity";
import { StepTopicFilters } from "@/components/wizard/StepTopicFilters";
import { StepGroups } from "@/components/wizard/StepGroups";
import { StepTheme } from "@/components/wizard/StepTheme";
import { StepContentBrief } from "@/components/wizard/StepContentBrief";
import { StepPreview } from "@/components/wizard/StepPreview";
import { StepGoLive } from "@/components/wizard/StepGoLive";
import type { WizardFormData } from "@/types/dashboard";

const DEFAULT_FORM: WizardFormData = {
  domain: "",
  pagesProjectName: "",
  siteName: "",
  siteTagline: "",
  company: "",
  vertical: "",
  verticalId: "",
  groups: [],
  themePreset: "classic",
  themeColors: {
    primary: "#1a1a2e", accent: "#f4c542", background: "#ffffff", secondary: "#1a1a2e",
    text: "#1a1a2e", muted: "#6b7280", surface: "#f8f9fa", border: "#e5e7eb",
    footer_bg: "#1a1a2e", must_reads_bg: "#1a1a2e",
    hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
    feed_title: "#1a1a2e", feed_desc: "#1a1a2e", feed_date: "#6b7280",
    prose_heading: "#1a1a2e", prose_body: "#1a1a2e", category_header_text: "#ffffff",
  },
  themeLayout: {
    hero: { enabled: true, count: 4 },
    must_reads: { enabled: true, count: 5 },
    whats_new: { enabled: true, count: 4 },
    more_on: { enabled: true, page_size: 8 },
    sidebar_topics: { auto: true, explicit: [] },
    load_more: { page_size: 4 },
  },
  audiences: [],
  audienceIds: [],
  iabVerticalCode: "",
  theme: "",
  topics_v2: [],
  tone: "",
  topics: [],
  articlesPerDay: 1,
  preferredDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
  contentGuidelines: "",
  imageGuidelines: "",
  primaryColor: "#1a1a2e",
  accentColor: "#f4c542",
  fontHeading: "Inter",
  fontBody: "Inter",
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
              <StepContentBrief
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 2:
            return (
              <StepTopicFilters
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 3:
            return (
              <StepGroups
                data={formData}
                onChange={updateForm}
                onNext={goNext}
                onBack={goBack}
              />
            );
          case 4:
            return (
              <StepTheme
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
