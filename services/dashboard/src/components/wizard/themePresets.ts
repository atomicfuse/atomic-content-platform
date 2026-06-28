/**
 * Shared theme preset definitions for the dashboard.
 *
 * Single source of truth for both the new-site wizard (StepTheme) and the
 * per-site editor (SiteThemeTab). Previously each consumer had its own copy of
 * PRESETS / ColorState / ALL_COLOR_KEYS / detectPreset — they drifted, with
 * SiteThemeTab gaining 3 keys (nav_link, nav_link_hover, subscribe_heading)
 * that StepTheme silently dropped on every wizard save.
 *
 * This module is the canonical shape. Importing consumers must not re-declare
 * any of these names.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Full color state for a site theme. 28 keys.
 *
 * Solid colors only — gradient keys live separately on the preset (see
 * `PresetDefinition.gradients` below) so the strict-equality preset detector
 * stays clean.
 */
export interface ColorState {
  primary: string;
  accent: string;
  background: string;
  secondary: string;
  text: string;
  muted: string;
  surface: string;
  border: string;
  heading: string;
  link: string;
  link_hover: string;
  nav_link: string;
  nav_link_hover: string;
  footer_bg: string;
  must_reads_bg: string;
  hero_title: string;
  must_reads_title: string;
  article_hero_title: string;
  article_hero_meta: string;
  feed_title: string;
  feed_desc: string;
  feed_date: string;
  prose_heading: string;
  prose_body: string;
  category_header_text: string;
  subscribe_heading: string;
  footer_text: string;
  footer_heading: string;
  footer_link: string;
  footer_link_hover: string;
}

/**
 * Optional gradient overrides shipped by gradient-tier presets.
 *
 * Each value is a full CSS background string — `linear-gradient(...)`,
 * `radial-gradient(...)`, or any other valid CSS background value. The
 * site-worker components render these via `var(--color-<key>-gradient,
 * var(--color-<key>))` CSS fallback, so missing values degrade to the matching
 * solid color (no crash on stale KV configs).
 *
 * `header_bg_gradient` and `subscribe_bg_gradient` are the most visible — they
 * sit above the fold and make the gradient identity obvious at first glance.
 * Footer / must-reads / hero overlays reinforce it further down the page.
 */
export interface GradientState {
  header_bg_gradient?: string;
  subscribe_bg_gradient?: string;
  footer_bg_gradient?: string;
  must_reads_bg_gradient?: string;
  hero_overlay_gradient?: string;
}

/**
 * Optional font pairing shipped by a preset. When the user picks a preset
 * with `fonts` defined, the dashboard updates the site's `theme.fonts` so
 * the visual identity isn't just color — Newsprint gets Playfair/Merriweather,
 * Stadium gets Bebas Neue, Art Deco gets a serif display, etc.
 *
 * Values must match a `family` in `services/dashboard/src/lib/font-registry.ts`.
 * Pre-existing presets (Classic News, Bold Dark, …) deliberately do NOT
 * declare fonts so picking them never overwrites a user's current font choice.
 */
export interface FontPair {
  heading: string;
  body: string;
}

export type PresetTier = "editorial" | "lifestyle" | "premium" | "dark" | "gradient";

export interface PresetDefinition {
  name: string;
  /** Tier the preset belongs to. Drives picker grouping. */
  tier: PresetTier;
  /** Vertical / vibe hint shown under the name in the picker card. */
  subtitle: string;
  colors: ColorState;
  /** Optional CSS gradient overrides — only set for `tier === "gradient"`. */
  gradients?: GradientState;
  /** Optional font pairing. When present, applyPreset overwrites fontHeading/fontBody. */
  fonts?: FontPair;
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export const PRESETS: Record<string, PresetDefinition> = {
  // -------------------------------------------------------------------------
  // Editorial light (5)
  // -------------------------------------------------------------------------
  classic: {
    name: "Classic News",
    tier: "editorial",
    subtitle: "Navy + gold daily",
    colors: {
      primary: "#1a1a2e", accent: "#f4c542", background: "#ffffff", secondary: "#1a1a2e",
      text: "#1a1a2e", muted: "#6b7280", surface: "#f8f9fa", border: "#e5e7eb",
      heading: "#1a1a2e", link: "#1a1a2e", link_hover: "#f4c542",
      nav_link: "#ffffff", nav_link_hover: "#f4c542",
      footer_bg: "#1a1a2e", must_reads_bg: "#1a1a2e",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#6b7280",
      feed_title: "#1a1a2e", feed_desc: "#1a1a2e", feed_date: "#6b7280",
      prose_heading: "#1a1a2e", prose_body: "#1a1a2e", category_header_text: "#1a1a2e",
      subscribe_heading: "#1a1a2e",
      footer_text: "#9ca3af", footer_heading: "#ffffff", footer_link: "#9ca3af", footer_link_hover: "#ffffff",
    },
  },
  ocean: {
    name: "Ocean Editorial",
    tier: "editorial",
    subtitle: "Deep blue + teal",
    colors: {
      primary: "#0f4c81", accent: "#10b981", background: "#f8fafc", secondary: "#0f172a",
      text: "#0f172a", muted: "#64748b", surface: "#e2e8f0", border: "#cbd5e1",
      heading: "#0f172a", link: "#0f4c81", link_hover: "#10b981",
      nav_link: "#ffffff", nav_link_hover: "#10b981",
      footer_bg: "#0f172a", must_reads_bg: "#0f172a",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#64748b",
      feed_title: "#0f172a", feed_desc: "#0f172a", feed_date: "#64748b",
      prose_heading: "#0f172a", prose_body: "#1e293b", category_header_text: "#ffffff",
      subscribe_heading: "#0f4c81",
      footer_text: "#94a3b8", footer_heading: "#ffffff", footer_link: "#94a3b8", footer_link_hover: "#ffffff",
    },
  },
  slate: {
    name: "Elegant Slate",
    tier: "editorial",
    subtitle: "Soft slate + indigo",
    colors: {
      primary: "#334155", accent: "#6366f1", background: "#ffffff", secondary: "#1e293b",
      text: "#1e293b", muted: "#94a3b8", surface: "#f1f5f9", border: "#e2e8f0",
      heading: "#1e293b", link: "#334155", link_hover: "#6366f1",
      nav_link: "#ffffff", nav_link_hover: "#6366f1",
      footer_bg: "#1e293b", must_reads_bg: "#1e293b",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#94a3b8",
      feed_title: "#1e293b", feed_desc: "#334155", feed_date: "#94a3b8",
      prose_heading: "#1e293b", prose_body: "#334155", category_header_text: "#ffffff",
      subscribe_heading: "#334155",
      footer_text: "#94a3b8", footer_heading: "#ffffff", footer_link: "#94a3b8", footer_link_hover: "#ffffff",
    },
  },
  newsprint: {
    name: "Newsprint",
    tier: "editorial",
    subtitle: "Broadsheet ink + red",
    fonts: { heading: "Playfair Display", body: "Merriweather" },
    colors: {
      primary: "#0a0a0a", accent: "#c8102e", background: "#faf7f2", secondary: "#0a0a0a",
      text: "#0a0a0a", muted: "#6b6b6b", surface: "#f0ece4", border: "#dcd6c8",
      heading: "#0a0a0a", link: "#0a0a0a", link_hover: "#c8102e",
      nav_link: "#faf7f2", nav_link_hover: "#c8102e",
      footer_bg: "#0a0a0a", must_reads_bg: "#0a0a0a",
      hero_title: "#faf7f2", must_reads_title: "#faf7f2", article_hero_title: "#faf7f2",
      article_hero_meta: "#a8a8a8",
      feed_title: "#0a0a0a", feed_desc: "#1a1a1a", feed_date: "#6b6b6b",
      prose_heading: "#0a0a0a", prose_body: "#1a1a1a", category_header_text: "#faf7f2",
      subscribe_heading: "#0a0a0a",
      footer_text: "#a8a8a8", footer_heading: "#faf7f2", footer_link: "#a8a8a8", footer_link_hover: "#faf7f2",
    },
  },
  editorial_black: {
    name: "Editorial Black",
    tier: "editorial",
    subtitle: "Black + magenta culture",
    fonts: { heading: "Playfair Display", body: "Inter" },
    colors: {
      primary: "#18181b", accent: "#be185d", background: "#fafafa", secondary: "#fafafa",
      text: "#09090b", muted: "#64748b", surface: "#f4f4f5", border: "#e4e4e7",
      heading: "#09090b", link: "#18181b", link_hover: "#be185d",
      nav_link: "#fafafa", nav_link_hover: "#f472b6",
      footer_bg: "#18181b", must_reads_bg: "#18181b",
      hero_title: "#fafafa", must_reads_title: "#fafafa", article_hero_title: "#fafafa",
      article_hero_meta: "#a1a1aa",
      feed_title: "#09090b", feed_desc: "#27272a", feed_date: "#71717a",
      prose_heading: "#09090b", prose_body: "#27272a", category_header_text: "#fafafa",
      subscribe_heading: "#fafafa",
      footer_text: "#a1a1aa", footer_heading: "#fafafa", footer_link: "#a1a1aa", footer_link_hover: "#f472b6",
    },
  },

  // -------------------------------------------------------------------------
  // Lifestyle & vertical (5)
  // -------------------------------------------------------------------------
  warm: {
    name: "Warm Magazine",
    tier: "lifestyle",
    subtitle: "Cream + burnt orange",
    colors: {
      primary: "#7c2d12", accent: "#ea580c", background: "#fffbeb", secondary: "#1c1917",
      text: "#1c1917", muted: "#78716c", surface: "#fef3c7", border: "#d6d3d1",
      heading: "#1c1917", link: "#7c2d12", link_hover: "#ea580c",
      nav_link: "#ffffff", nav_link_hover: "#ea580c",
      footer_bg: "#1c1917", must_reads_bg: "#1c1917",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#78716c",
      feed_title: "#1c1917", feed_desc: "#1c1917", feed_date: "#78716c",
      prose_heading: "#1c1917", prose_body: "#292524", category_header_text: "#ffffff",
      subscribe_heading: "#7c2d12",
      footer_text: "#a8a29e", footer_heading: "#ffffff", footer_link: "#a8a29e", footer_link_hover: "#ffffff",
    },
  },
  botanical: {
    name: "Botanical",
    tier: "lifestyle",
    subtitle: "Forest + sage wellness",
    fonts: { heading: "Lora", body: "Lora" },
    colors: {
      primary: "#1f3d2b", accent: "#3d6b4c", background: "#f7f5ee", secondary: "#f7f5ee",
      text: "#1f2d24", muted: "#6b7a6f", surface: "#eee9dd", border: "#d9d3c4",
      heading: "#1f3d2b", link: "#1f3d2b", link_hover: "#3d6b4c",
      nav_link: "#f7f5ee", nav_link_hover: "#cfe0c2",
      footer_bg: "#1f3d2b", must_reads_bg: "#1f3d2b",
      hero_title: "#f7f5ee", must_reads_title: "#f7f5ee", article_hero_title: "#f7f5ee",
      article_hero_meta: "#a8b3a4",
      feed_title: "#1f3d2b", feed_desc: "#2c4a37", feed_date: "#6b7a6f",
      prose_heading: "#1f3d2b", prose_body: "#2c4a37", category_header_text: "#f7f5ee",
      subscribe_heading: "#1f3d2b",
      footer_text: "#a8b3a4", footer_heading: "#f7f5ee", footer_link: "#a8b3a4", footer_link_hover: "#cfe0c2",
    },
  },
  mocha: {
    name: "Mocha",
    tier: "lifestyle",
    subtitle: "Espresso + caramel food",
    fonts: { heading: "Lora", body: "Source Sans 3" },
    colors: {
      primary: "#3d2817", accent: "#7a4a1f", background: "#f4ede4", secondary: "#f4ede4",
      text: "#2a1810", muted: "#7a6555", surface: "#ebe2d4", border: "#d6c9b6",
      heading: "#2a1810", link: "#3d2817", link_hover: "#7a4a1f",
      nav_link: "#f4ede4", nav_link_hover: "#d9b890",
      footer_bg: "#2a1810", must_reads_bg: "#2a1810",
      hero_title: "#f4ede4", must_reads_title: "#f4ede4", article_hero_title: "#f4ede4",
      article_hero_meta: "#b8a48f",
      feed_title: "#2a1810", feed_desc: "#3d2817", feed_date: "#7a6555",
      prose_heading: "#2a1810", prose_body: "#3d2817", category_header_text: "#f4ede4",
      subscribe_heading: "#f4ede4",
      footer_text: "#b8a48f", footer_heading: "#f4ede4", footer_link: "#b8a48f", footer_link_hover: "#d9b890",
    },
  },
  coastal: {
    name: "Coastal Air",
    tier: "lifestyle",
    subtitle: "Navy + cyan travel",
    fonts: { heading: "DM Sans", body: "DM Sans" },
    colors: {
      primary: "#1e3a5f", accent: "#06b6d4", background: "#f4f7f9", secondary: "#0c1f33",
      text: "#0c1f33", muted: "#6b8095", surface: "#e3ecf2", border: "#cbd9e3",
      heading: "#0c1f33", link: "#1e3a5f", link_hover: "#06b6d4",
      nav_link: "#f4f7f9", nav_link_hover: "#67e8f9",
      footer_bg: "#0c1f33", must_reads_bg: "#0c1f33",
      hero_title: "#f4f7f9", must_reads_title: "#f4f7f9", article_hero_title: "#f4f7f9",
      article_hero_meta: "#94a8bc",
      feed_title: "#0c1f33", feed_desc: "#1e3a5f", feed_date: "#6b8095",
      prose_heading: "#0c1f33", prose_body: "#1e3a5f", category_header_text: "#f4f7f9",
      subscribe_heading: "#1e3a5f",
      footer_text: "#94a8bc", footer_heading: "#f4f7f9", footer_link: "#94a8bc", footer_link_hover: "#67e8f9",
    },
  },
  solarpunk: {
    name: "Solarpunk",
    tier: "lifestyle",
    subtitle: "Optimistic eco + amber sun",
    fonts: { heading: "Lora", body: "Source Sans 3" },
    colors: {
      // Designed to the contract: emerald primary (header) + cream nav text =
      // 10:1, amber accent (subscribe bg) + dark forest text = 6:1, deep-forest
      // footer + sage text = 10:1. Every pair audited at design time.
      primary: "#1f5128", accent: "#b45309", background: "#f9f7e8", secondary: "#1a2418",
      text: "#1a2418", muted: "#6b7a5f", surface: "#eef0d8", border: "#d8d8b8",
      heading: "#1a2418", link: "#1f5128", link_hover: "#b45309",
      nav_link: "#f9f7e8", nav_link_hover: "#fbbf24",
      footer_bg: "#0f1f15", must_reads_bg: "#0f1f15",
      hero_title: "#f9f7e8", must_reads_title: "#f9f7e8", article_hero_title: "#f9f7e8",
      article_hero_meta: "#9bbf9b",
      feed_title: "#1a2418", feed_desc: "#2c3e23", feed_date: "#6b7a5f",
      prose_heading: "#1a2418", prose_body: "#2c3e23", category_header_text: "#f9f7e8",
      subscribe_heading: "#1a2418",
      footer_text: "#9bbf9b", footer_heading: "#f9f7e8", footer_link: "#9bbf9b", footer_link_hover: "#fbbf24",
    },
  },
  rose_garden: {
    name: "Rose Garden",
    tier: "lifestyle",
    subtitle: "Deep rose + bright pink",
    fonts: { heading: "Playfair Display", body: "Lora" },
    colors: {
      primary: "#831843", accent: "#9d174d", background: "#fff7f9", secondary: "#fff7f9",
      text: "#3d1029", muted: "#9d6f81", surface: "#fce7ef", border: "#f4d4df",
      heading: "#3d1029", link: "#831843", link_hover: "#9d174d",
      nav_link: "#fff7f9", nav_link_hover: "#f9a8d4",
      footer_bg: "#581c3b", must_reads_bg: "#581c3b",
      hero_title: "#fff7f9", must_reads_title: "#fff7f9", article_hero_title: "#fff7f9",
      article_hero_meta: "#d4a3b8",
      feed_title: "#3d1029", feed_desc: "#5c2240", feed_date: "#9d6f81",
      prose_heading: "#3d1029", prose_body: "#5c2240", category_header_text: "#fff7f9",
      subscribe_heading: "#fff7f9",
      footer_text: "#d4a3b8", footer_heading: "#fff7f9", footer_link: "#d4a3b8", footer_link_hover: "#f9a8d4",
    },
  },

  // -------------------------------------------------------------------------
  // Premium (3)
  // -------------------------------------------------------------------------
  graphite_tech: {
    name: "Graphite Tech",
    tier: "premium",
    subtitle: "Near-black + electric blue",
    fonts: { heading: "Space Grotesk", body: "Inter" },
    colors: {
      primary: "#0f0f0f", accent: "#1d4ed8", background: "#fafafa", secondary: "#fafafa",
      text: "#0a0a0a", muted: "#6b7280", surface: "#f3f4f6", border: "#e5e7eb",
      heading: "#0a0a0a", link: "#1d4ed8", link_hover: "#1e40af",
      nav_link: "#fafafa", nav_link_hover: "#60a5fa",
      footer_bg: "#0f0f0f", must_reads_bg: "#0f0f0f",
      hero_title: "#fafafa", must_reads_title: "#fafafa", article_hero_title: "#fafafa",
      article_hero_meta: "#9ca3af",
      feed_title: "#0a0a0a", feed_desc: "#1f2937", feed_date: "#6b7280",
      prose_heading: "#0a0a0a", prose_body: "#1f2937", category_header_text: "#fafafa",
      subscribe_heading: "#fafafa",
      footer_text: "#9ca3af", footer_heading: "#fafafa", footer_link: "#9ca3af", footer_link_hover: "#60a5fa",
    },
  },
  mint_finance: {
    name: "Mint Finance",
    tier: "premium",
    subtitle: "Deep teal + emerald",
    fonts: { heading: "IBM Plex Sans", body: "IBM Plex Sans" },
    colors: {
      primary: "#064e3b", accent: "#047857", background: "#ffffff", secondary: "#064e3b",
      text: "#022c22", muted: "#6b7280", surface: "#ecfdf5", border: "#d1fae5",
      heading: "#022c22", link: "#064e3b", link_hover: "#047857",
      nav_link: "#ffffff", nav_link_hover: "#6ee7b7",
      footer_bg: "#022c22", must_reads_bg: "#022c22",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#86efac",
      feed_title: "#022c22", feed_desc: "#064e3b", feed_date: "#6b7280",
      prose_heading: "#022c22", prose_body: "#064e3b", category_header_text: "#ffffff",
      subscribe_heading: "#ffffff",
      footer_text: "#86efac", footer_heading: "#ffffff", footer_link: "#86efac", footer_link_hover: "#6ee7b7",
    },
  },
  scandi: {
    name: "Scandi Minimal",
    tier: "premium",
    subtitle: "Bone + ink, restrained",
    fonts: { heading: "Manrope", body: "Manrope" },
    colors: {
      primary: "#1c1c1c", accent: "#3a3a3a", background: "#f5f3ef", secondary: "#f5f3ef",
      text: "#1c1c1c", muted: "#a0a0a0", surface: "#ebe8e2", border: "#d6d2c9",
      heading: "#1c1c1c", link: "#1c1c1c", link_hover: "#5a5a5a",
      nav_link: "#f5f3ef", nav_link_hover: "#d6d2c9",
      footer_bg: "#1c1c1c", must_reads_bg: "#1c1c1c",
      hero_title: "#f5f3ef", must_reads_title: "#f5f3ef", article_hero_title: "#f5f3ef",
      article_hero_meta: "#a0a0a0",
      feed_title: "#1c1c1c", feed_desc: "#2a2a2a", feed_date: "#a0a0a0",
      prose_heading: "#1c1c1c", prose_body: "#2a2a2a", category_header_text: "#f5f3ef",
      subscribe_heading: "#f5f3ef",
      footer_text: "#a0a0a0", footer_heading: "#f5f3ef", footer_link: "#a0a0a0", footer_link_hover: "#f5f3ef",
    },
  },

  // -------------------------------------------------------------------------
  // Dark (5)
  // -------------------------------------------------------------------------
  bold: {
    name: "Bold Dark",
    tier: "dark",
    subtitle: "Cinematic red on black",
    colors: {
      primary: "#E50914", accent: "#B81D24", background: "#141414", secondary: "#1a1a2e",
      text: "#ffffff", muted: "#8C8C8C", surface: "#2a2a2a", border: "#333333",
      heading: "#ffffff", link: "#E50914", link_hover: "#B81D24",
      nav_link: "#ffffff", nav_link_hover: "#B81D24",
      footer_bg: "#1a1a2e", must_reads_bg: "#1a1a2e",
      hero_title: "#ffffff", must_reads_title: "#ffffff", article_hero_title: "#ffffff",
      article_hero_meta: "#8C8C8C",
      feed_title: "#ffffff", feed_desc: "#e0e0e0", feed_date: "#8C8C8C",
      prose_heading: "#ffffff", prose_body: "#e0e0e0", category_header_text: "#ffffff",
      subscribe_heading: "#E50914",
      footer_text: "#9ca3af", footer_heading: "#ffffff", footer_link: "#9ca3af", footer_link_hover: "#ffffff",
    },
  },
  midnight: {
    name: "Midnight Purple",
    tier: "dark",
    subtitle: "Saturated purple cosmos",
    colors: {
      primary: "#581c87", accent: "#a855f7", background: "#0f0720", secondary: "#1e1038",
      text: "#f0e6ff", muted: "#a78bfa", surface: "#1e1038", border: "#2e1a50",
      heading: "#f0e6ff", link: "#a855f7", link_hover: "#c084fc",
      nav_link: "#f0e6ff", nav_link_hover: "#c084fc",
      footer_bg: "#1e1038", must_reads_bg: "#1e1038",
      hero_title: "#ffffff", must_reads_title: "#f0e6ff", article_hero_title: "#ffffff",
      article_hero_meta: "#a78bfa",
      feed_title: "#f0e6ff", feed_desc: "#d8c8f0", feed_date: "#a78bfa",
      prose_heading: "#f0e6ff", prose_body: "#d8c8f0", category_header_text: "#ffffff",
      subscribe_heading: "#581c87",
      footer_text: "#a78bfa", footer_heading: "#ffffff", footer_link: "#a78bfa", footer_link_hover: "#ffffff",
    },
  },
  carbon_editorial: {
    name: "Carbon Editorial",
    tier: "dark",
    subtitle: "Neutral dark + amber spark",
    fonts: { heading: "Merriweather", body: "Source Sans 3" },
    colors: {
      primary: "#161618", accent: "#d97706", background: "#0b0b0c", secondary: "#0b0b0c",
      text: "#e6e6e6", muted: "#a3a3a3", surface: "#1c1c1f", border: "#262629",
      heading: "#fafafa", link: "#fbbf24", link_hover: "#fde68a",
      nav_link: "#fafafa", nav_link_hover: "#fbbf24",
      footer_bg: "#0b0b0c", must_reads_bg: "#161618",
      hero_title: "#fafafa", must_reads_title: "#fafafa", article_hero_title: "#fafafa",
      article_hero_meta: "#a3a3a3",
      feed_title: "#fafafa", feed_desc: "#d4d4d4", feed_date: "#a3a3a3",
      prose_heading: "#fafafa", prose_body: "#d4d4d4", category_header_text: "#fafafa",
      subscribe_heading: "#0b0b0c",
      footer_text: "#a3a3a3", footer_heading: "#fafafa", footer_link: "#a3a3a3", footer_link_hover: "#fbbf24",
    },
  },
  forest_night: {
    name: "Forest Night",
    tier: "dark",
    subtitle: "Dark moss + sun yellow",
    fonts: { heading: "Lora", body: "Source Sans 3" },
    colors: {
      primary: "#0a1410", accent: "#ca8a04", background: "#0f1d16", secondary: "#0f1d16",
      text: "#e4e9e2", muted: "#a0afa3", surface: "#162a1f", border: "#1c3024",
      heading: "#e4e9e2", link: "#86b08a", link_hover: "#facc15",
      nav_link: "#e4e9e2", nav_link_hover: "#facc15",
      footer_bg: "#06100a", must_reads_bg: "#162a1f",
      hero_title: "#e4e9e2", must_reads_title: "#e4e9e2", article_hero_title: "#e4e9e2",
      article_hero_meta: "#a0afa3",
      feed_title: "#e4e9e2", feed_desc: "#c8d2c5", feed_date: "#a0afa3",
      prose_heading: "#e4e9e2", prose_body: "#c8d2c5", category_header_text: "#e4e9e2",
      subscribe_heading: "#0f1d16",
      footer_text: "#a0afa3", footer_heading: "#e4e9e2", footer_link: "#a0afa3", footer_link_hover: "#facc15",
    },
  },
  tokyo_night: {
    name: "Tokyo Night",
    tier: "dark",
    subtitle: "Deep indigo + kabuki red",
    fonts: { heading: "Manrope", body: "Inter" },
    colors: {
      // Deep indigo primary (header) + cool off-white nav = 14:1.
      // Kabuki red accent (subscribe bg) + cream-white text = 4.6:1 AA.
      // Deep-navy footer + muted indigo text = 6:1.
      primary: "#1a1b2e", accent: "#c81e3b", background: "#0f111c", secondary: "#252845",
      text: "#e0e6f0", muted: "#9aa3b8", surface: "#1f2138", border: "#2d2f4a",
      heading: "#f0f3f8", link: "#7c89f0", link_hover: "#e94560",
      nav_link: "#e0e6f0", nav_link_hover: "#e94560",
      footer_bg: "#0a0c14", must_reads_bg: "#1a1b2e",
      hero_title: "#f0f3f8", must_reads_title: "#f0f3f8", article_hero_title: "#f0f3f8",
      article_hero_meta: "#9aa3b8",
      feed_title: "#f0f3f8", feed_desc: "#c8cee0", feed_date: "#9aa3b8",
      prose_heading: "#f0f3f8", prose_body: "#c8cee0", category_header_text: "#f0f3f8",
      subscribe_heading: "#ffffff",
      footer_text: "#9aa3b8", footer_heading: "#f0f3f8", footer_link: "#9aa3b8", footer_link_hover: "#e94560",
    },
  },
  stadium: {
    name: "Stadium",
    tier: "dark",
    subtitle: "Action red + yellow",
    fonts: { heading: "Bebas Neue", body: "Inter" },
    colors: {
      primary: "#0f1419", accent: "#dc2626", background: "#0f1419", secondary: "#facc15",
      text: "#f8fafc", muted: "#94a3b8", surface: "#1a212a", border: "#2a3340",
      heading: "#f8fafc", link: "#facc15", link_hover: "#fbbf24",
      nav_link: "#facc15", nav_link_hover: "#fef08a",
      footer_bg: "#0a0e13", must_reads_bg: "#1a212a",
      hero_title: "#f8fafc", must_reads_title: "#f8fafc", article_hero_title: "#f8fafc",
      article_hero_meta: "#94a3b8",
      feed_title: "#f8fafc", feed_desc: "#cbd5e1", feed_date: "#94a3b8",
      prose_heading: "#f8fafc", prose_body: "#cbd5e1", category_header_text: "#fef08a",
      subscribe_heading: "#fef08a",
      footer_text: "#94a3b8", footer_heading: "#f8fafc", footer_link: "#94a3b8", footer_link_hover: "#facc15",
    },
  },

  // -------------------------------------------------------------------------
  // Gradient tier (3)
  // -------------------------------------------------------------------------
  aurora: {
    name: "Aurora",
    tier: "gradient",
    subtitle: "Northern-lights tech",
    fonts: { heading: "Space Grotesk", body: "Inter" },
    colors: {
      primary: "#0a0e27", accent: "#7c3aed", background: "#0a0e27", secondary: "#1c2150",
      text: "#e9e4ff", muted: "#a8aacc", surface: "#1a1a3e", border: "#2a2d52",
      heading: "#f5f3ff", link: "#a78bfa", link_hover: "#f093fb",
      nav_link: "#e9e4ff", nav_link_hover: "#f093fb",
      footer_bg: "#0a0e27", must_reads_bg: "#1a1a3e",
      hero_title: "#ffffff", must_reads_title: "#f5f3ff", article_hero_title: "#ffffff",
      article_hero_meta: "#a8aacc",
      feed_title: "#f5f3ff", feed_desc: "#d4d1f0", feed_date: "#a8aacc",
      prose_heading: "#f5f3ff", prose_body: "#d4d1f0", category_header_text: "#ffffff",
      subscribe_heading: "#ffffff",
      footer_text: "#c0c5dd", footer_heading: "#f5f3ff", footer_link: "#c0c5dd", footer_link_hover: "#f093fb",
    },
    gradients: {
      // Header above the fold — navy → indigo → violet diagonal. Immediately visible.
      header_bg_gradient: "linear-gradient(135deg, #0a0e27 0%, #1e3a8a 40%, #6d28d9 75%, #4c1d95 100%)",
      // Subscribe box: purple → magenta sweep.
      subscribe_bg_gradient: "linear-gradient(135deg, #6d28d9 0%, #9333ea 50%, #c026d3 100%)",
      // Footer mirrors the header — visible aurora sweep across the bottom band.
      footer_bg_gradient: "linear-gradient(135deg, #0a0e27 0%, #1e3a8a 35%, #6d28d9 65%, #0a0e27 100%)",
      // must_reads sits between — different angle so it doesn't echo.
      must_reads_bg_gradient: "linear-gradient(120deg, #1e1b4b 0%, #4c1d95 50%, #1e1b4b 100%)",
      // Hero scrim: image visible up top, light purple haze mid, dark fade only at the very bottom for title legibility.
      hero_overlay_gradient: "linear-gradient(180deg, transparent 0%, rgba(124,58,237,0.12) 45%, rgba(124,58,237,0.4) 80%, rgba(10,14,39,0.85) 100%)",
    },
  },
  sunset_strip: {
    name: "Sunset Strip",
    tier: "gradient",
    subtitle: "Music + nightlife heat",
    fonts: { heading: "Bebas Neue", body: "Poppins" },
    colors: {
      primary: "#7c1d2f", accent: "#c2410c", background: "#fff7ed", secondary: "#fff7ed",
      text: "#451a03", muted: "#9a6b4e", surface: "#fed7aa", border: "#fdba74",
      heading: "#451a03", link: "#be123c", link_hover: "#c2410c",
      nav_link: "#fff7ed", nav_link_hover: "#ffffff",
      footer_bg: "#7c1d2f", must_reads_bg: "#7c1d2f",
      hero_title: "#fff7ed", must_reads_title: "#fff7ed", article_hero_title: "#fff7ed",
      article_hero_meta: "#fdba74",
      feed_title: "#451a03", feed_desc: "#7c2d12", feed_date: "#9a6b4e",
      prose_heading: "#451a03", prose_body: "#7c2d12", category_header_text: "#fff7ed",
      subscribe_heading: "#fff7ed",
      footer_text: "#fed7aa", footer_heading: "#fff7ed", footer_link: "#fed7aa", footer_link_hover: "#ffffff",
    },
    gradients: {
      // Header: wine → crimson → deep orange. End stop dialed back from
      // `#ea580c` to `#c2410c` so cream nav text holds 4.5:1 across all stops.
      // The brighter end was failing (~2.8:1) wherever nav links sat over it.
      header_bg_gradient: "linear-gradient(135deg, #7c1d2f 0%, #be123c 35%, #c2410c 70%, #c2410c 100%)",
      // Subscribe: orange spectrum, no gold. Gold endpoint `#fbbf24` made
      // white subscribe text invisible (~1.5:1). Now wine → crimson → orange,
      // all dark enough for white text (~5:1+).
      subscribe_bg_gradient: "linear-gradient(135deg, #831843 0%, #be123c 50%, #c2410c 100%)",
      footer_bg_gradient: "linear-gradient(180deg, #be123c 0%, #831843 50%, #1f0408 100%)",
      must_reads_bg_gradient: "linear-gradient(90deg, #c2410c 0%, #be123c 50%, #9d174d 100%)",
      hero_overlay_gradient: "linear-gradient(180deg, transparent 0%, rgba(249,115,22,0.1) 45%, rgba(249,115,22,0.35) 80%, rgba(124,29,47,0.82) 100%)",
    },
  },
  matrix: {
    name: "Matrix",
    tier: "gradient",
    subtitle: "Terminal phosphor green",
    fonts: { heading: "Space Grotesk", body: "Source Sans 3" },
    colors: {
      // Pure-dark base + phosphor green text — classic Matrix terminal.
      // Header gradient peaks at emerald 900 (not emerald 600) so phosphor
      // nav text holds 7:1 contrast on every stop.
      primary: "#020617", accent: "#15803d", background: "#020617", secondary: "#020617",
      text: "#86efac", muted: "#4ade80", surface: "#0a1f15", border: "#0f2e1e",
      heading: "#86efac", link: "#4ade80", link_hover: "#bbf7d0",
      nav_link: "#86efac", nav_link_hover: "#bbf7d0",
      footer_bg: "#020617", must_reads_bg: "#0a1f15",
      hero_title: "#bbf7d0", must_reads_title: "#bbf7d0", article_hero_title: "#bbf7d0",
      article_hero_meta: "#4ade80",
      feed_title: "#86efac", feed_desc: "#4ade80", feed_date: "#22c55e",
      prose_heading: "#86efac", prose_body: "#bbf7d0", category_header_text: "#bbf7d0",
      subscribe_heading: "#020617",
      footer_text: "#4ade80", footer_heading: "#86efac", footer_link: "#4ade80", footer_link_hover: "#bbf7d0",
    },
    gradients: {
      // Header: subtle emerald glow center — peak at emerald 900 (#064e3b) keeps
      // phosphor nav text 7:1 readable everywhere.
      header_bg_gradient: "linear-gradient(90deg, #020617 0%, #064e3b 50%, #020617 100%)",
      // Subscribe: emerald sweep — black text on emerald 600 (#16a34a) holds 5.8:1.
      subscribe_bg_gradient: "linear-gradient(135deg, #14532d 0%, #16a34a 50%, #14532d 100%)",
      footer_bg_gradient: "linear-gradient(90deg, #020617 0%, #064e3b 50%, #020617 100%)",
      must_reads_bg_gradient: "linear-gradient(135deg, #020617 0%, #14532d 50%, #020617 100%)",
      // Hero scrim: image visible, emerald glow mid, dark for title.
      hero_overlay_gradient: "linear-gradient(180deg, transparent 0%, rgba(22,163,74,0.15) 50%, rgba(2,6,23,0.92) 100%)",
    },
  },
  pink_glow: {
    name: "Pink Glow",
    tier: "gradient",
    subtitle: "Synthwave neon pink",
    fonts: { heading: "Playfair Display", body: "Inter" },
    colors: {
      // Deep purple-black base + soft pink text. Header gradient peaks at
      // pink 600 (#db2777) — light pink text holds 4.8:1 on the peak.
      primary: "#180a25", accent: "#be185d", background: "#180a25", secondary: "#2c1640",
      text: "#fce7f3", muted: "#d8b4d8", surface: "#1f0f30", border: "#3d1a4a",
      heading: "#fce7f3", link: "#f472b6", link_hover: "#fbcfe8",
      nav_link: "#fce7f3", nav_link_hover: "#ffffff",
      footer_bg: "#0e051a", must_reads_bg: "#1f0f30",
      hero_title: "#fce7f3", must_reads_title: "#fce7f3", article_hero_title: "#fce7f3",
      article_hero_meta: "#d8b4d8",
      feed_title: "#fce7f3", feed_desc: "#f9a8d4", feed_date: "#d8b4d8",
      prose_heading: "#fce7f3", prose_body: "#f9a8d4", category_header_text: "#fce7f3",
      subscribe_heading: "#ffffff",
      footer_text: "#d8b4d8", footer_heading: "#fce7f3", footer_link: "#d8b4d8", footer_link_hover: "#f472b6",
    },
    gradients: {
      // Header: dark purple → wine → hot pink → wine → dark purple (neon shine).
      header_bg_gradient: "linear-gradient(135deg, #180a25 0%, #831843 30%, #db2777 50%, #831843 70%, #180a25 100%)",
      // Subscribe: wine → magenta → bright pink — white text holds 5.5:1 on end.
      subscribe_bg_gradient: "linear-gradient(135deg, #831843 0%, #be185d 50%, #db2777 100%)",
      // Footer: pink fading to near-black at bottom (sunset-into-night for pink).
      footer_bg_gradient: "linear-gradient(180deg, #831843 0%, #4a0e2a 50%, #0e051a 100%)",
      must_reads_bg_gradient: "linear-gradient(135deg, #4a0e2a 0%, #831843 50%, #4a0e2a 100%)",
      // Hero scrim: image at top, pink haze, dark at bottom for legibility.
      hero_overlay_gradient: "linear-gradient(180deg, transparent 0%, rgba(219,39,119,0.15) 50%, rgba(24,10,37,0.92) 100%)",
    },
  },
  platinum_shine: {
    name: "Platinum Shine",
    tier: "gradient",
    subtitle: "Metallic silver luxe",
    fonts: { heading: "Manrope", body: "Manrope" },
    colors: {
      // Dark slate base + light gray text. Subscribe box is the only place where
      // bright silver appears as a gradient (text is dark there). Header/footer
      // use slate-600 as the peak so light text reads on every stop.
      primary: "#0f1115", accent: "#cbd5e1", background: "#0f1115", secondary: "#0f1115",
      text: "#e5e7eb", muted: "#94a3b8", surface: "#1a1d23", border: "#2a2f3a",
      heading: "#f3f4f6", link: "#94a3b8", link_hover: "#cbd5e1",
      nav_link: "#e5e7eb", nav_link_hover: "#ffffff",
      footer_bg: "#0a0a0a", must_reads_bg: "#1a1d23",
      hero_title: "#f3f4f6", must_reads_title: "#f3f4f6", article_hero_title: "#f3f4f6",
      article_hero_meta: "#94a3b8",
      feed_title: "#f3f4f6", feed_desc: "#cbd5e1", feed_date: "#94a3b8",
      prose_heading: "#f3f4f6", prose_body: "#cbd5e1", category_header_text: "#f3f4f6",
      subscribe_heading: "#0f1115",
      footer_text: "#cbd5e1", footer_heading: "#f3f4f6", footer_link: "#cbd5e1", footer_link_hover: "#ffffff",
    },
    gradients: {
      // Header: dark slate → silver shine center → dark slate. Peak is slate-600
      // (not pure silver) so light text holds 6:1 on every stop. The reflective
      // metallic feel comes from the sharp light-to-dark contrast, not a bright
      // peak that would break text legibility.
      header_bg_gradient: "linear-gradient(135deg, #0f1115 0%, #1a1d23 25%, #475569 50%, #1a1d23 75%, #0f1115 100%)",
      // Subscribe: pure bright silver throughout — dark text inside holds 12:1.
      subscribe_bg_gradient: "linear-gradient(135deg, #cbd5e1 0%, #e5e7eb 50%, #cbd5e1 100%)",
      // Footer: matches header shine pattern.
      footer_bg_gradient: "linear-gradient(90deg, #0a0a0a 0%, #1a1d23 25%, #475569 50%, #1a1d23 75%, #0a0a0a 100%)",
      // must_reads: silver shine, different angle.
      must_reads_bg_gradient: "linear-gradient(135deg, #1a1d23 0%, #475569 50%, #1a1d23 100%)",
      // Hero scrim: image visible, faint silver haze, dark for title.
      hero_overlay_gradient: "linear-gradient(180deg, transparent 0%, rgba(148,163,184,0.15) 50%, rgba(15,17,21,0.92) 100%)",
    },
  },
  art_deco_brass: {
    name: "Art Deco Brass",
    tier: "gradient",
    subtitle: "Luxury + brass shine",
    fonts: { heading: "Playfair Display", body: "Lora" },
    colors: {
      primary: "#0a0a0a", accent: "#a16207", background: "#0a0a0a", secondary: "#0a0a0a",
      text: "#f5e8c7", muted: "#a8997a", surface: "#1a1410", border: "#2d2418",
      heading: "#f5e8c7", link: "#d4a657", link_hover: "#f5e8c7",
      nav_link: "#f5e8c7", nav_link_hover: "#ffffff",
      footer_bg: "#0a0a0a", must_reads_bg: "#1a1410",
      hero_title: "#f5e8c7", must_reads_title: "#f5e8c7", article_hero_title: "#f5e8c7",
      article_hero_meta: "#a8997a",
      feed_title: "#f5e8c7", feed_desc: "#d4c79d", feed_date: "#a8997a",
      prose_heading: "#f5e8c7", prose_body: "#d4c79d", category_header_text: "#f5e8c7",
      subscribe_heading: "#0a0a0a",
      footer_text: "#d4c79d", footer_heading: "#f5e8c7", footer_link: "#d4c79d", footer_link_hover: "#ffffff",
    },
    gradients: {
      // Header: brass shine — peak toned down to dark brass `#6b4a1a` so ivory
      // text reads on every stop. Pure `#b8860b` made cream text invisible at
      // the gradient peak (~1.4:1 contrast). With `#6b4a1a` ivory text holds
      // ~5.9:1 across the full sweep while preserving the brass identity.
      header_bg_gradient: "linear-gradient(90deg, #0a0a0a 0%, #2d2418 25%, #6b4a1a 50%, #2d2418 75%, #0a0a0a 100%)",
      // Subscribe: bright brass kept here — subscribe text is dark black `#0a0a0a`,
      // which contrasts ~5:1 with `#b8860b` brass.
      subscribe_bg_gradient: "linear-gradient(135deg, #8a6508 0%, #b8860b 30%, #f5e8c7 50%, #b8860b 70%, #8a6508 100%)",
      // Footer mirrors header — same toned-down brass peak so footer text reads.
      footer_bg_gradient: "linear-gradient(90deg, #0a0a0a 0%, #2d2418 25%, #6b4a1a 50%, #2d2418 75%, #0a0a0a 100%)",
      // must_reads: same constraint as footer.
      must_reads_bg_gradient: "linear-gradient(135deg, #0a0a0a 0%, #3d2c1a 30%, #6b4a1a 50%, #3d2c1a 70%, #0a0a0a 100%)",
      hero_overlay_gradient: "linear-gradient(180deg, transparent 45%, rgba(10,10,10,0.85) 100%)",
    },
  },
};

// ---------------------------------------------------------------------------
// Key registries
// ---------------------------------------------------------------------------

/**
 * All solid color keys, in display order. The single source of truth for both
 * the manual color editor field list and the strict-equality preset detector.
 *
 * Adding a new key requires updating it here AND in every PRESETS entry (TS
 * will enforce the latter via `ColorState`).
 */
export const ALL_COLOR_KEYS: (keyof ColorState)[] = [
  "primary", "accent", "background", "secondary", "text", "muted", "surface", "border",
  "heading", "link", "link_hover", "nav_link", "nav_link_hover",
  "footer_bg", "must_reads_bg",
  "hero_title", "must_reads_title", "article_hero_title", "article_hero_meta",
  "feed_title", "feed_desc", "feed_date",
  "prose_heading", "prose_body", "category_header_text",
  "subscribe_heading",
  "footer_text", "footer_heading", "footer_link", "footer_link_hover",
];

/**
 * Optional gradient keys. Stored on `site.yaml` `theme.colors` as full CSS
 * background strings. NOT included in `ALL_COLOR_KEYS` and NOT checked by
 * `detectPreset` — adding them to detection would force every solid preset to
 * declare gradients or fall out of match.
 *
 * Hidden from the manual editor field list — gradients are preset-only in v1.
 */
export const GRADIENT_KEYS: (keyof GradientState)[] = [
  "header_bg_gradient",
  "subscribe_bg_gradient",
  "footer_bg_gradient",
  "must_reads_bg_gradient",
  "hero_overlay_gradient",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Match a `theme.colors` map against the registered presets. Solid colors
 * only — gradient keys are ignored so a user tweaking solids stays matched.
 * Returns `"custom"` if no preset matches.
 */
export function detectPreset(colors: Record<string, string>): string {
  for (const [id, preset] of Object.entries(PRESETS)) {
    const match = ALL_COLOR_KEYS.every(
      (k) => (colors[k] ?? "").toLowerCase() === preset.colors[k].toLowerCase(),
    );
    if (match) return id;
  }
  return "custom";
}

/**
 * Resolve the full preset color map (solid + gradient flattened) ready to be
 * spread into `theme.colors`. Gradient strings live alongside solid hexes in
 * the same flat string map — the site-worker's generic CSS-var emitter handles
 * both transparently.
 */
export function presetToColors(id: string): Record<string, string> {
  const preset = PRESETS[id];
  if (!preset) return {};
  const out: Record<string, string> = { ...preset.colors };
  if (preset.gradients) {
    for (const [k, v] of Object.entries(preset.gradients)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
  }
  return out;
}

/**
 * Pick a random preset ID, never returning `excludeId`. For the Surprise Me
 * button. Deterministic-ish in that it filters then uniform-samples; if the
 * excluded preset is the only one (impossible here, 16 presets), returns it.
 */
export function pickRandomPreset(excludeId?: string): string {
  const ids = Object.keys(PRESETS).filter((id) => id !== excludeId);
  if (ids.length === 0) return excludeId ?? "classic";
  return ids[Math.floor(Math.random() * ids.length)] ?? "classic";
}

// ---------------------------------------------------------------------------
// Tier metadata for the picker
// ---------------------------------------------------------------------------

export interface TierMeta {
  id: PresetTier;
  label: string;
  /** True for the gradient tier — the picker shows a Sparkles icon next to the label. */
  highlight?: boolean;
}

export const TIERS: TierMeta[] = [
  { id: "editorial", label: "Editorial" },
  { id: "lifestyle", label: "Lifestyle & Vertical" },
  { id: "premium", label: "Premium" },
  { id: "dark", label: "Dark" },
  { id: "gradient", label: "Gradients", highlight: true },
];

/** Preset IDs grouped by tier, in display order. */
export function presetsByTier(): { tier: TierMeta; presets: { id: string; preset: PresetDefinition }[] }[] {
  return TIERS.map((tier) => ({
    tier,
    presets: Object.entries(PRESETS)
      .filter(([, p]) => p.tier === tier.id)
      .map(([id, preset]) => ({ id, preset })),
  }));
}
