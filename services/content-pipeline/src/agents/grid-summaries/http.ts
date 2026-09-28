// Dependency-free (only imports ./errors.js and ./targets.js) so this module and its test never
// load GitHub/AI/Mongo modules.
import { GridSummaryError } from "./errors.js";
import { isSafeId } from "./targets.js";

function parseJson(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object") return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new GridSummaryError("Invalid JSON body", 400);
}

/** POST /grid-summaries/regenerate body. */
export function parseRegenerateBody(raw: string): { site: string; slug: string } {
  const b = parseJson(raw);
  if (!isSafeId(b.site) || !isSafeId(b.slug)) throw new GridSummaryError("site and slug are required kebab-case ids", 400);
  return { site: b.site, slug: b.slug };
}

/** POST /grid-summaries/save body. */
export function parseSaveBody(raw: string): { site: string; slug: string; markdown: string; editedBy: string } {
  const { site, slug } = parseRegenerateBody(raw);
  const b = parseJson(raw);
  if (typeof b.markdown !== "string" || b.markdown.length > 20_000) throw new GridSummaryError("markdown is required (max 20000 chars)", 400);
  const editedBy = typeof b.editedBy === "string" && b.editedBy.trim() ? b.editedBy.trim().slice(0, 100) : "dashboard";
  return { site, slug, markdown: b.markdown, editedBy };
}
