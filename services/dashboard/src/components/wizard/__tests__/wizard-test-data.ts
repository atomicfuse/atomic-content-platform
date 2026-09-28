import type { WizardFormData } from "@/types/dashboard";

/** Minimal complete WizardFormData for wizard step tests. */
export function makeWizardFormData(overrides: Partial<WizardFormData> = {}): WizardFormData {
  return {
    domain: "testsite.com",
    pagesProjectName: "testsite",
    siteName: "Test Site",
    siteTagline: "",
    company: "ATL",
    vertical: "Travel",
    verticalId: "v1",
    groups: [],
    themePreset: "classic",
    themeColors: {},
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
    preferredDays: [],
    contentGuidelines: "",
    imageGuidelines: "",
    primaryColor: "#1a1a2e",
    accentColor: "#f4c542",
    fontHeading: "Inter",
    fontBody: "Inter",
    scriptsVars: {},
    ...overrides,
  };
}
