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

function parseTarget(b: Record<string, unknown>): { site: string; slug: string } {
  if (!isSafeId(b.site) || !isSafeId(b.slug)) throw new GridSummaryError("site and slug are required kebab-case ids", 400);
  return { site: b.site, slug: b.slug };
}

/** POST /grid-summaries/regenerate body. `pin: true` = the dashboard's "Use AI summary". */
export function parseRegenerateBody(raw: string): { site: string; slug: string; pin: boolean } {
  const b = parseJson(raw);
  return { ...parseTarget(b), pin: b.pin === true };
}

/** POST /grid-summaries/pin body. */
export function parsePinBody(raw: string): { site: string; slug: string; pinned: boolean } {
  const b = parseJson(raw);
  const target = parseTarget(b);
  if (typeof b.pinned !== "boolean") throw new GridSummaryError("pinned (boolean) is required", 400);
  return { ...target, pinned: b.pinned };
}

/** POST /grid-summaries/save body. */
export function parseSaveBody(raw: string): { site: string; slug: string; markdown: string; editedBy: string } {
  const { site, slug } = parseTarget(parseJson(raw));
  const b = parseJson(raw);
  if (typeof b.markdown !== "string" || b.markdown.length > 20_000) throw new GridSummaryError("markdown is required (max 20000 chars)", 400);
  const editedBy = typeof b.editedBy === "string" && b.editedBy.trim() ? b.editedBy.trim().slice(0, 100) : "dashboard";
  return { site, slug, markdown: b.markdown, editedBy };
}
