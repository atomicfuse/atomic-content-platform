import { parse as parseYaml } from "yaml";

/** Kebab-case id guard for site ids and slugs (repo paths, pipeline calls). */
export function isSafeId(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,199}$/i.test(v);
}

/** grid-summaries/<site>/<slug>.md → editor fields. */
export function parseSummaryFileText(raw: string): {
  markdown: string;
  edited: boolean;
  sourceChanged: boolean;
  generatedAt: string | null;
} | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return null;
  const fm = (parseYaml(m[1] ?? "") ?? {}) as Record<string, unknown>;
  return {
    markdown: (m[2] ?? "").trim(),
    edited: fm.edited === true,
    sourceChanged: fm.source_changed === true,
    generatedAt: fm.generated_at == null ? null : String(fm.generated_at),
  };
}

/** Summary file slug for a Grid pool item: the 24-hex item id for aggregator stories ("<title-slug>-<id>"), else the slug. */
export function summarySlugOf(item: { site: string; slug: string }): string {
  return item.site === "aggregator" ? item.slug.slice(-24) : item.slug;
}
