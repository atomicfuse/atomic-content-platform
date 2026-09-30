import type { DashboardSiteEntry } from "@/types/dashboard";

/**
 * Single source of truth for the Sites table's optional columns: their
 * default visibility, where their data comes from, whether they're
 * sortable, and how to render a CSV cell for them.
 *
 * `Website` and `Actions` are NOT modeled here — they're always visible,
 * never appear in the column chooser, and (for `Actions`) never exported.
 * See task-I-brief.md §1.
 */

/**
 * Live per-site config values, read from the site's resolved KV config at
 * request time by `/api/sites/live-config`. All fields are `null` when the
 * read failed, the site has never been seeded, or the endpoint has not
 * been called yet (no live column enabled).
 */
export interface LiveConfigEntry {
  template: "grid" | "modern" | null;
  ga4: string | null;
  facebook_pixel: string | null;
  gtm: string | null;
  google_ads: string | null;
  articles_per_day: number | null;
  /** `brief.schedule.preferred_days` as stored (e.g. "monday"). Empty or
   *  null means the scheduler runs every day. */
  publish_days: string[] | null;
  last_synced_at: string | null;
}

export type SiteColumnSource = "index" | "groups" | "articles" | "live";

/** Everything a column's `csv` accessor might need, gathered from the
 *  table's various data sources (some fetched eagerly, some lazily). */
export interface SiteColumnContext {
  siteGroups: Record<string, string[]>;
  articleCounts: Record<string, number>;
  latestArticles: Record<string, string>;
  liveConfig: Record<string, LiveConfigEntry>;
}

export interface SiteColumnDef {
  id: string;
  label: string;
  /** Whether this column is visible for a user who has never touched the
   *  chooser. Must match today's table exactly — see task-I-brief.md. */
  defaultVisible: boolean;
  source: SiteColumnSource;
  sortable?: boolean;
  /** Shown as a header tooltip for live-config columns (task-I-brief.md §3):
   *  resolved config includes values inherited from groups/org. */
  tooltip?: string;
  /** Renders this column's value for one site as a CSV cell (unescaped —
   *  `buildSitesCsvForColumns` applies `csvCell` on top of this). */
  csv: (site: DashboardSiteEntry, ctx: SiteColumnContext) => string;
}

const LIVE_TOOLTIP = "From the live site config (includes values inherited from groups)";

const WEEK_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

/** "3/day · Mon, Wed, Fri" — articles per publishing day plus the days the
 *  scheduler runs. No days (or all seven) reads "Every day"; Mon–Fri reads
 *  "Weekdays". Unknown day names are shown as stored. Empty when the
 *  schedule isn't known. */
export function formatSchedule(perDay: number | null, days: string[] | null): string {
  if (perDay == null) return "";
  const normalised = [...new Set((days ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean))];
  const known = WEEK_DAYS.filter((d) => normalised.includes(d));
  const unknown = normalised.filter((d) => !WEEK_DAYS.includes(d));
  let dayText: string;
  if (normalised.length === 0 || (known.length === 7 && unknown.length === 0)) {
    dayText = "Every day";
  } else if (unknown.length === 0 && known.join(",") === WEEK_DAYS.slice(0, 5).join(",")) {
    dayText = "Weekdays";
  } else {
    dayText = [...known.map((d) => DAY_LABELS[d]), ...unknown].join(", ");
  }
  return `${perDay}/day · ${dayText}`;
}

function emptyLiveEntry(): LiveConfigEntry {
  return {
    template: null,
    ga4: null,
    facebook_pixel: null,
    gtm: null,
    google_ads: null,
    articles_per_day: null,
    publish_days: null,
    last_synced_at: null,
  };
}

function liveEntryFor(domain: string, ctx: SiteColumnContext): LiveConfigEntry {
  return ctx.liveConfig[domain] ?? emptyLiveEntry();
}

/** Chooser columns, in the order they render after Website and before
 *  Actions. The first nine match today's table exactly (same ids implicitly
 *  via array order — see `DEFAULT_VISIBLE_COLUMN_IDS`); the rest are new,
 *  default-hidden columns appended after them. */
export const SITE_COLUMNS: SiteColumnDef[] = [
  {
    id: "company",
    label: "Company",
    defaultVisible: true,
    source: "index",
    csv: (site) => site.company ?? "",
  },
  {
    id: "group",
    label: "Group",
    defaultVisible: true,
    source: "groups",
    csv: (site, ctx) => (ctx.siteGroups[site.domain] ?? []).join(";"),
  },
  {
    id: "category",
    label: "Category",
    defaultVisible: true,
    source: "index",
    csv: (site) => site.vertical ?? "",
  },
  {
    id: "status",
    label: "Status",
    defaultVisible: true,
    source: "index",
    csv: (site) => site.status,
  },
  {
    id: "articles",
    label: "Articles",
    defaultVisible: true,
    source: "articles",
    sortable: true,
    csv: (site, ctx) =>
      ctx.articleCounts[site.domain] != null ? String(ctx.articleCounts[site.domain]) : "",
  },
  {
    id: "lastArticles",
    label: "Last Articles",
    defaultVisible: true,
    source: "articles",
    sortable: true,
    csv: (site, ctx) => ctx.latestArticles[site.domain] ?? "",
  },
  {
    id: "siteId",
    label: "Site ID",
    defaultVisible: true,
    source: "index",
    csv: (site) => site.site_id || "",
  },
  {
    id: "created",
    label: "Created",
    defaultVisible: true,
    source: "index",
    sortable: true,
    csv: (site) => site.created_at ?? "",
  },
  {
    id: "lastUpdated",
    label: "Last Updated",
    defaultVisible: true,
    source: "index",
    csv: (site) => site.last_updated ?? "",
  },
  {
    id: "template",
    label: "Template",
    defaultVisible: false,
    source: "live",
    tooltip: LIVE_TOOLTIP,
    csv: (site, ctx) => {
      const t = liveEntryFor(site.domain, ctx).template;
      if (t === "grid") return "Grid";
      if (t === "modern") return "Modern";
      return "";
    },
  },
  {
    id: "ga4",
    label: "Google Analytics",
    defaultVisible: false,
    source: "live",
    tooltip: LIVE_TOOLTIP,
    csv: (site, ctx) => liveEntryFor(site.domain, ctx).ga4 ?? "",
  },
  {
    id: "facebookPixel",
    label: "Facebook Pixel",
    defaultVisible: false,
    source: "live",
    tooltip: LIVE_TOOLTIP,
    csv: (site, ctx) => liveEntryFor(site.domain, ctx).facebook_pixel ?? "",
  },
  {
    id: "gtm",
    label: "GTM",
    defaultVisible: false,
    source: "live",
    tooltip: LIVE_TOOLTIP,
    csv: (site, ctx) => liveEntryFor(site.domain, ctx).gtm ?? "",
  },
  {
    id: "googleAds",
    label: "Google Ads",
    defaultVisible: false,
    source: "live",
    tooltip: LIVE_TOOLTIP,
    csv: (site, ctx) => liveEntryFor(site.domain, ctx).google_ads ?? "",
  },
  {
    id: "articlesPerDay",
    label: "Schedule",
    defaultVisible: false,
    source: "live",
    tooltip: "Articles per publishing day, and the days the scheduler publishes. " + LIVE_TOOLTIP,
    csv: (site, ctx) => {
      const entry = liveEntryFor(site.domain, ctx);
      return formatSchedule(entry.articles_per_day, entry.publish_days);
    },
  },
  {
    id: "lastSync",
    label: "Last sync",
    defaultVisible: false,
    source: "live",
    tooltip:
      "When the site's content was last pushed to the live site (staging preview for sites not yet Live). " +
      "Live sites auto-publish after each scheduled run, so this is often close to Last Articles.",
    csv: (site, ctx) => liveEntryFor(site.domain, ctx).last_synced_at ?? "",
  },
  {
    id: "customDomain",
    label: "Custom domain",
    defaultVisible: false,
    source: "index",
    csv: (site) => site.custom_domain ?? "",
  },
];

export const DEFAULT_VISIBLE_COLUMN_IDS: string[] = SITE_COLUMNS.filter(
  (c) => c.defaultVisible,
).map((c) => c.id);

export const COLUMN_STORAGE_KEY = "sites-table-columns-v1";

const VALID_COLUMN_IDS = new Set(SITE_COLUMNS.map((c) => c.id));

/**
 * Loads the visible chooser-column ids from `localStorage`, in the order
 * they were saved, dropping any id that no longer names a real column
 * (e.g. after a column was renamed/removed). Falls back to
 * `DEFAULT_VISIBLE_COLUMN_IDS` whenever storage is unavailable, empty, or
 * holds something other than a JSON array — the table must never throw or
 * end up unable to render because of a storage failure. A stored selection
 * that legitimately hides every chooser column (all ids filtered out) is
 * returned as `[]`, not silently overridden back to the defaults.
 */
export function loadVisibleColumnIds(): string[] {
  try {
    const raw = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMN_IDS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE_COLUMN_IDS;
    return parsed.filter((id): id is string => typeof id === "string" && VALID_COLUMN_IDS.has(id));
  } catch {
    return DEFAULT_VISIBLE_COLUMN_IDS;
  }
}

/** Persists the visible chooser-column ids. Silently no-ops on failure
 *  (private browsing, quota exceeded, etc.) — visibility just won't survive
 *  a reload; the in-memory state for the current session is unaffected. */
export function saveVisibleColumnIds(ids: string[]): void {
  try {
    window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage unavailable — nothing to recover; see doc comment above.
  }
}

export function getColumnById(id: string): SiteColumnDef | undefined {
  return SITE_COLUMNS.find((c) => c.id === id);
}

/** Whether any currently-visible column reads from the live-config endpoint
 *  — the table only fetches `/api/sites/live-config` when this is true. */
export function hasLiveColumn(visibleIds: string[]): boolean {
  const visible = new Set(visibleIds);
  return SITE_COLUMNS.some((c) => c.source === "live" && visible.has(c.id));
}
