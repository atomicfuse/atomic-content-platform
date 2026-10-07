import matter from "gray-matter";

/** Frontmatter of grid-summaries/<site>/<slug>.md. */
export interface SummaryFrontmatter {
  source_site: string;
  slug: string;
  body_hash: string;
  generated_at: string;
  model: string;
  edited: boolean;
  edited_by: string | null;
  edited_at: string | null;
  source_changed: boolean;
  /** Shown on the story page regardless of the Grid site's story mode. */
  pinned: boolean;
}

/** Repo path of a summary file. */
export function summaryPath(site: string, slug: string): string {
  return `grid-summaries/${site}/${slug}.md`;
}

/** Summary file text. Dates are kept as strings so YAML never turns them into Date objects. */
export function serializeSummaryFile(fm: SummaryFrontmatter, markdown: string): string {
  return matter.stringify(`${markdown.trim()}\n`, { ...fm, generated_at: String(fm.generated_at) });
}

/** Parses a summary file; null when it has no usable frontmatter. */
export function parseSummaryFile(raw: string): { fm: SummaryFrontmatter; markdown: string } | null {
  const parsed = matter(raw);
  const d = parsed.data as Record<string, unknown>;
  if (typeof d.source_site !== "string" || typeof d.slug !== "string") return null;
  const str = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));
  return {
    fm: {
      source_site: d.source_site,
      slug: d.slug,
      body_hash: str(d.body_hash),
      generated_at: str(d.generated_at),
      model: str(d.model),
      edited: d.edited === true,
      edited_by: typeof d.edited_by === "string" ? d.edited_by : null,
      edited_at: d.edited_at == null ? null : str(d.edited_at),
      source_changed: d.source_changed === true,
      pinned: d.pinned === true,
    },
    markdown: parsed.content.trim(),
  };
}
