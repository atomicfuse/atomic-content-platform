import type { ResolvedConfig } from '@atomic-platform/shared-types';

/**
 * Phase 2 MVP: returns a hardcoded ResolvedConfig-shaped object so the
 * homepage and article pages render with real theme + real content. The
 * Phase 3 KV middleware will replace this with `Astro.locals.site.config`,
 * resolved per-hostname at request time.
 *
 * To swap sites locally today, set `SITE_DOMAIN` in the environment.
 * Content collection (see src/content.config.ts) reads markdown from
 * NETWORK_DATA_PATH/sites/<SITE_DOMAIN>/articles/.
 */

const SITE_DOMAIN = (import.meta.env.SITE_DOMAIN as string | undefined) ?? 'coolnews-atl';
const SITE_NAME = (import.meta.env.SITE_NAME as string | undefined) ?? 'Cool News ATL';
const SITE_TAGLINE = (import.meta.env.SITE_TAGLINE as string | undefined) ?? null;

const stub: ResolvedConfig = {
  domain: SITE_DOMAIN,
  site_name: SITE_NAME,
  site_tagline: SITE_TAGLINE,
  pages_project: SITE_DOMAIN,
  group: null,
  groups: [],
  active: true,
  theme: {
    base: 'modern',
    logo: null,
    favicon: null,
    fonts: { heading: 'Inter', body: 'Inter' },
    colors: {
      primary: '#0066ff',
      secondary: '#1a1a2e',
      accent: '#00ccff',
      background: '#ffffff',
      text: '#1a1a2e',
      muted: '#6b7280',
      surface: '#f8f9fa',
      border: '#e5e7eb',
    },
  },
  tracking: {
    ga4: null,
    gtm: null,
    google_ads: null,
    facebook_pixel: null,
    custom: [],
  },
  scripts: { head: [], body_start: [], body_end: [] },
  scripts_vars: {},
  ads_config: { interstitial: false, layout: 'standard', ad_placements: [] },
  ad_placeholder_heights: {
    'above-content': 90,
    'after-paragraph': 280,
    sidebar: 600,
    'sticky-bottom': 50,
  },
  ads_txt: [],
  legal: {
    company_name: 'Atomic Labs Ltd',
    company_country: 'Israel',
    effective_date: '2026-01-01',
    site_description: SITE_NAME,
  },
  brief: {
    audience: '',
    tone: '',
    article_types: {},
    topics: ['Current Events', 'In-Depth Analysis', 'Policy & Politics', 'Local Stories'],
    seo_keywords_focus: [],
    content_guidelines: [],
    vertical: 'News',
    review_percentage: 0,
    schedule: { preferred_days: [], preferred_time: '10:00', articles_per_day: 0 },
    quality_threshold: 0,
    quality_weights: {
      seo_quality: 20,
      tone_match: 20,
      content_length: 20,
      factual_accuracy: 20,
      keyword_relevance: 20,
    },
  },
  preview_page: { enabled: false },
  categories: { enabled: false, root_path: '/category' },
  sidebar: { enabled: false, widgets: [] },
  search: { enabled: false },
  inlineAdConfig: null,
} as unknown as ResolvedConfig;

export async function getConfig(): Promise<ResolvedConfig> {
  return stub;
}
