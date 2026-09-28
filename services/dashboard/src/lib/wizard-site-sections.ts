import type { WizardFormData } from "@/types/dashboard";
import type { GridFields } from "@/types/grid";

/**
 * Pure builders for the template-dependent parts of the wizard's site.yaml
 * (`brief`, `theme`, `grid`). Used by `createSiteAndBuildStaging`.
 *
 * Modern output must stay deep-equal to what the wizard wrote before the
 * Grid template existed (guarded by `wizard-site-sections.test.ts`).
 */

/** True when the wizard's Grid template was chosen. */
export function isGridWizard(data: WizardFormData): boolean {
  return data.template === "grid";
}

/**
 * For a Grid site, clear every content-agent field (audiences, tone, topics,
 * topic filters, guidelines, schedule, AI site theme). A Grid site never
 * generates articles, and values left over from an earlier pass through the
 * Modern steps must not leak into its site.yaml, skill.md or logo prompt.
 * Modern data is returned unchanged (same reference).
 */
export function wizardDataForTemplate(data: WizardFormData): WizardFormData {
  if (!isGridWizard(data)) return data;
  return {
    ...data,
    audiences: [],
    audienceIds: [],
    tone: "",
    theme: "",
    topics: [],
    topics_v2: [],
    contentGuidelines: "",
    imageGuidelines: "",
    articlesPerDay: 0,
    preferredDays: [],
  };
}

/**
 * Display-only category label: explicit vertical, then the first topic
 * filter name, then the first plain topic. Grid data has no topics, so it
 * reduces to the explicit vertical.
 */
export function wizardDisplayVertical(data: WizardFormData): string | undefined {
  return data.vertical || data.topics_v2[0]?.name || data.topics[0] || undefined;
}

export interface WizardSiteSections {
  brief: Record<string, unknown>;
  theme: Record<string, unknown>;
  /** Top-level `grid:` block. Only set for Grid sites. */
  grid?: GridFields;
}

/**
 * Build site.yaml `brief`, `theme` and (Grid only) `grid`. Pass the output
 * of `wizardDataForTemplate` so a Grid site gets the minimal brief
 * (no audiences/tone/topics, zero-article schedule).
 */
export function buildWizardSiteSections(data: WizardFormData): WizardSiteSections {
  const topics_v2 = data.topics_v2;
  const isGrid = isGridWizard(data);

  const brief: Record<string, unknown> = {
    audiences: data.audiences,
    audience_type_ids: data.audienceIds.length > 0 ? data.audienceIds : undefined,
    tone: data.tone,
    article_types: {
      listicle: 40,
      standard: 30,
      "how-to": 20,
      review: 10,
    },
    // For per-topic sites the nav menu + category routing read `topics`, so
    // it must mirror topics_v2 names. Fall back to the raw collected topics
    // for legacy (non-per-topic) sites.
    topics: topics_v2.length > 0 ? topics_v2.map((t) => t.name) : data.topics,
    theme: data.theme || undefined,
    topics_v2: topics_v2.length > 0 ? topics_v2 : undefined,
    seo_keywords_focus: [],
    content_guidelines: data.contentGuidelines
      ? data.contentGuidelines.split("\n").filter(Boolean)
      : [],
    image_guidelines: data.imageGuidelines
      ? data.imageGuidelines.split("\n").filter(Boolean)
      : undefined,
    vertical: wizardDisplayVertical(data),
    vertical_id: data.verticalId || undefined,
    review_percentage: 5,
    schedule: {
      articles_per_day: data.articlesPerDay,
      preferred_days: data.preferredDays,
      preferred_time: "10:00",
    },
  };

  const card = data.card && Object.keys(data.card).length > 0 ? data.card : undefined;

  const theme: Record<string, unknown> = {
    base: data.themePreset,
    // Only ever write `template: "grid"`. Never write `template: "modern"`:
    // a Modern site's site.yaml must stay byte-identical to what the wizard
    // wrote before this field existed.
    ...(isGrid ? { template: "grid" as const } : {}),
    colors: data.themeColors,
    logo_height: data.logoHeight ?? 52,
    menu_item_font_size: data.menuItemFontSize ?? 14,
    // Omit logo_height_footer entirely when auto so saved YAML signals
    // "let CSS auto-derive (92% of header)".
    ...(data.logoHeightFooter != null ? { logo_height_footer: data.logoHeightFooter } : {}),
    fonts: {
      heading: data.fontHeading,
      body: data.fontBody,
    },
    ...(isGrid && card ? { card } : {}),
  };

  return {
    brief,
    theme,
    ...(isGrid ? { grid: data.grid ?? {} } : {}),
  };
}
