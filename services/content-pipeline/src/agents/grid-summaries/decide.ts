import { createHash } from "node:crypto";
import type { SummaryFrontmatter } from "./files.js";

/** What to do with one needed article this run. */
export type SummaryAction = "generate" | "regenerate" | "skip" | "flag_source_changed";

/** sha256 hex of the source article body — detects source edits. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Spec matrix: missing → generate; unchanged → skip; changed+auto → regenerate; changed+hand-edited → flag once. */
export function decideAction(existing: SummaryFrontmatter | null, bodyHash: string): SummaryAction {
  if (!existing) return "generate";
  if (existing.body_hash === bodyHash) return "skip";
  if (existing.edited) return existing.source_changed ? "skip" : "flag_source_changed";
  return "regenerate";
}
