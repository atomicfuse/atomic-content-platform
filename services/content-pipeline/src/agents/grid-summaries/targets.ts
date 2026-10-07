import { parse as parseYaml } from "yaml";

/** dashboard-index.yaml fields the summary agent needs. */
export interface IndexEntry {
  domain: string;
  status: string;
  custom_domain: string | null;
  deleted: boolean;
}

/** Parses dashboard-index.yaml (status lower-cased; deleted = deleted_at set or status "deleted"). */
export function parseDashboardIndex(yamlText: string): IndexEntry[] {
  const doc = (parseYaml(yamlText) ?? {}) as { sites?: Array<Record<string, unknown>> };
  return (doc.sites ?? [])
    .filter((s) => typeof s.domain === "string" && s.domain)
    .map((s) => {
      const status = String(s.status ?? "").toLowerCase();
      return {
        domain: s.domain as string,
        status,
        custom_domain: typeof s.custom_domain === "string" && s.custom_domain ? s.custom_domain : null,
        deleted: !!s.deleted_at || status === "deleted",
      };
    });
}

/** Where to fetch a Grid site's /api/pool (spec: prod host when Live, staging preview otherwise). */
export function poolUrlFor(entry: IndexEntry, env: { gridWorkerBaseUrl?: string; stagingWorkerUrl: string }): string {
  if (env.gridWorkerBaseUrl) return `${env.gridWorkerBaseUrl.replace(/\/$/, "")}/api/pool?_atl_site=${encodeURIComponent(entry.domain)}`;
  if (entry.status === "live" && entry.custom_domain) return `https://${entry.custom_domain}/api/pool`;
  return `${env.stagingWorkerUrl.replace(/\/$/, "")}/api/pool?_atl_site=${encodeURIComponent(entry.domain)}`;
}

/** Source id of Content Aggregator stories in Grid pools (mirrors the site-worker's AGGREGATOR_SOURCE_ID). */
export const AGGREGATOR_SITE = "aggregator";

/** Which story kinds get AI summaries on a Grid site; null when the config isn't a Grid site. */
export function gridSummaryModes(config: unknown): { network: boolean; external: boolean } | null {
  const c = (config ?? {}) as { theme?: { template?: unknown }; grid?: { story_mode?: unknown; external_story_mode?: unknown } };
  if (c.theme?.template !== "grid") return null;
  return { network: c.grid?.story_mode === "ai_summary", external: c.grid?.external_story_mode === "ai_summary" };
}

/** True when a pool item should get an AI summary under the site's modes. */
export function needsSummary(item: { site: string }, modes: { network: boolean; external: boolean }): boolean {
  return item.site === AGGREGATOR_SITE ? modes.external : modes.network;
}

/** True for a resolved KV site-config of a Grid site with any AI-summary mode on. */
export function isAiGridConfig(config: unknown): boolean {
  const modes = gridSummaryModes(config);
  return !!modes && (modes.network || modes.external);
}

/** Summary file slug of a pool item: the item id for aggregator stories ("<title-slug>-<id>"), else the slug. */
export function summarySlugOf(item: { site: string; slug: string }): string {
  return item.site === AGGREGATOR_SITE ? item.slug.slice(-24) : item.slug;
}

/** Site ids and slugs used in repo paths / KV keys: kebab-case, no traversal. */
export function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/i.test(value);
}
