import { describe, it, expect } from "vitest";
import type { WizardFormData } from "@/types/dashboard";
import {
  buildWizardSiteSections,
  wizardDataForTemplate,
  wizardDisplayVertical,
} from "../wizard-site-sections";

function makeFormData(overrides: Partial<WizardFormData> = {}): WizardFormData {
  return {
    domain: "testsite.com",
    pagesProjectName: "testsite",
    siteName: "Test Site",
    siteTagline: "A test",
    company: "ATL",
    vertical: "",
    verticalId: "v1",
    iabVerticalCode: "IAB20",
    groups: [],
    themePreset: "classic",
    themeColors: { primary: "#111111", accent: "#222222" },
    themeLayout: {
      hero: { enabled: true, count: 3 },
      must_reads: { enabled: true, count: 4 },
      whats_new: { enabled: true, count: 4 },
      more_on: { enabled: true, page_size: 8 },
      sidebar_topics: { auto: true, explicit: [] },
      load_more: { page_size: 12 },
    },
    audiences: ["Travelers"],
    audienceIds: ["a1"],
    theme: "Travel and food tourism",
    topics_v2: [
      { name: "Destinations", source: { type: "filter", category_ids: ["c1"], tag_ids: ["t1"] }, schedule: { articles_per_week: 2, preferred_days: ["Mon"] } },
    ],
    tone: "informative",
    topics: ["Destinations"],
    articlesPerDay: 2,
    preferredDays: ["Monday", "Wednesday"],
    contentGuidelines: "Be concise\nCite sources",
    imageGuidelines: "No faces",
    primaryColor: "#111111",
    accentColor: "#222222",
    fontHeading: "Inter",
    fontBody: "Lora",
    scriptsVars: {},
    ...overrides,
  };
}

/**
 * Verbatim copy of the brief/theme construction in createSiteAndBuildStaging
 * before Task G (incl. Task F's template line). The Modern guard below
 * asserts the helper still produces exactly this.
 */
function legacySections(data: WizardFormData): { brief: unknown; theme: unknown } {
  const topics_v2 = data.topics_v2;
  const displayVertical: string | undefined =
    data.vertical || topics_v2[0]?.name || data.topics[0] || undefined;
  return {
    brief: {
      audiences: data.audiences,
      audience_type_ids: data.audienceIds.length > 0 ? data.audienceIds : undefined,
      tone: data.tone,
      article_types: { listicle: 40, standard: 30, "how-to": 20, review: 10 },
      topics: topics_v2.length > 0 ? topics_v2.map((t) => t.name) : data.topics,
      theme: data.theme || undefined,
      topics_v2: topics_v2.length > 0 ? topics_v2 : undefined,
      seo_keywords_focus: [],
      content_guidelines: data.contentGuidelines ? data.contentGuidelines.split("\n").filter(Boolean) : [],
      image_guidelines: data.imageGuidelines ? data.imageGuidelines.split("\n").filter(Boolean) : undefined,
      vertical: displayVertical,
      vertical_id: data.verticalId || undefined,
      review_percentage: 5,
      schedule: {
        articles_per_day: data.articlesPerDay,
        preferred_days: data.preferredDays,
        preferred_time: "10:00",
      },
    },
    theme: {
      base: data.themePreset,
      ...(data.template === "grid" ? { template: "grid" as const } : {}),
      colors: data.themeColors,
      logo_height: data.logoHeight ?? 52,
      menu_item_font_size: data.menuItemFontSize ?? 14,
      ...(data.logoHeightFooter != null ? { logo_height_footer: data.logoHeightFooter } : {}),
      fonts: { heading: data.fontHeading, body: data.fontBody },
    },
  };
}

describe("buildWizardSiteSections — Modern (byte-identical guard)", () => {
  const cases: Array<[string, Partial<WizardFormData>]> = [
    ["template unset, per-topic", {}],
    ["template modern", { template: "modern" }],
    ["legacy topics, no topics_v2, no guidelines", { topics_v2: [], contentGuidelines: "", imageGuidelines: "", audienceIds: [] }],
    ["explicit vertical + logo heights", { vertical: "Travel", logoHeight: 60, logoHeightFooter: 40, menuItemFontSize: 16 }],
    // Grid-only inputs must be ignored for a Modern site.
    ["modern with stray grid/card", { template: "modern", grid: { topics: [{ label: "X", verticals: ["Y"] }] }, card: { style: "flat" } }],
  ];

  for (const [name, overrides] of cases) {
    it(`matches the pre-Task-G output: ${name}`, () => {
      const data = makeFormData(overrides);
      const out = buildWizardSiteSections(wizardDataForTemplate(data));
      const legacy = legacySections(data);
      expect(out.brief).toStrictEqual(legacy.brief);
      expect(out.theme).toStrictEqual(legacy.theme);
      expect(Object.keys(out.theme)).toEqual(Object.keys(legacy.theme as object));
      expect(Object.keys(out.brief)).toEqual(Object.keys(legacy.brief as object));
      expect("grid" in out).toBe(false);
    });
  }

  it("wizardDataForTemplate returns Modern data unchanged (same reference)", () => {
    const data = makeFormData({ template: "modern" });
    expect(wizardDataForTemplate(data)).toBe(data);
  });
});

describe("buildWizardSiteSections — Grid", () => {
  const grid = {
    topics: [{ label: "Health", verticals: ["Health & Wellness"] }],
    include_sites: ["foo"],
  };

  it("writes the minimal brief, top-level grid and theme.card", () => {
    const data = makeFormData({ template: "grid", vertical: "News", grid, card: { style: "shadow", corners: "square" } });
    const out = buildWizardSiteSections(wizardDataForTemplate(data));

    expect(out.brief).toStrictEqual({
      audiences: [],
      audience_type_ids: undefined,
      tone: "",
      article_types: { listicle: 40, standard: 30, "how-to": 20, review: 10 },
      topics: [],
      theme: undefined,
      topics_v2: undefined,
      seo_keywords_focus: [],
      content_guidelines: [],
      image_guidelines: undefined,
      vertical: "News",
      vertical_id: "v1",
      review_percentage: 5,
      schedule: { articles_per_day: 0, preferred_days: [], preferred_time: "10:00" },
    });
    expect(out.grid).toStrictEqual(grid);
    expect(out.theme.template).toBe("grid");
    expect(out.theme.card).toStrictEqual({ style: "shadow", corners: "square" });
    expect(out.theme.base).toBe("classic");
    expect(out.theme.fonts).toStrictEqual({ heading: "Inter", body: "Lora" });
  });

  it("omits theme.card when the card look is empty or unset", () => {
    for (const card of [undefined, {}]) {
      const out = buildWizardSiteSections(wizardDataForTemplate(makeFormData({ template: "grid", grid, card })));
      expect("card" in out.theme).toBe(false);
    }
  });

  it("writes an empty grid block when no feed settings were given", () => {
    const out = buildWizardSiteSections(wizardDataForTemplate(makeFormData({ template: "grid" })));
    expect(out.grid).toStrictEqual({});
  });

  it("display vertical ignores leftover topics for Grid (explicit vertical only)", () => {
    const data = wizardDataForTemplate(makeFormData({ template: "grid", vertical: "" }));
    expect(wizardDisplayVertical(data)).toBeUndefined();
    expect(wizardDisplayVertical(makeFormData({ vertical: "" }))).toBe("Destinations");
  });
});
