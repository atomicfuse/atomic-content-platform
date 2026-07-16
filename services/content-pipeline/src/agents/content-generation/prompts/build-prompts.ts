/**
 * Composes the full article prompt: shared core + genre pack + source mode.
 * Single entry point for all article generation call sites.
 */

import type { SiteBrief } from "../../../types.js";
import type { ContentItem } from "../types.js";
import { buildPromptContext } from "../generators/base-generator.js";
import { parseWordCountFromGuidelines } from "../../word-count.js";
import { GENRE_PACKS, type GenreId } from "./genres/index.js";
import { selectGenre } from "./select-genre.js";
import {
  craftRulesSection,
  inputMappingSection,
  originalUserPrompt,
  outputSchemaSection,
  siteIdentitySection,
  sourcedUserPrompt,
  taggingSection,
  truthRulesSection,
  type SourceMode,
} from "./core.js";

export interface BuildPromptsParams {
  siteName: string;
  brief: SiteBrief;
  mode: SourceMode;
  /** Required when mode === "sourced". */
  item?: ContentItem;
  /** Router decision hint (sourced mode). */
  isFactual?: boolean;
  /** Required when mode === "original". */
  userRequest?: string;
}

export interface ArticlePrompts {
  system: string;
  user: string;
  genre: GenreId;
}

export function buildArticlePrompts(params: BuildPromptsParams): ArticlePrompts {
  const { siteName, brief, mode, item, isFactual, userRequest } = params;

  if (mode === "sourced" && !item) {
    throw new Error("buildArticlePrompts: sourced mode requires an item");
  }
  if (mode === "original" && !userRequest) {
    throw new Error("buildArticlePrompts: original mode requires a userRequest");
  }

  const genre = selectGenre({ brief, item, isFactual });
  const pack = GENRE_PACKS[genre];
  // Original (dedicated) articles keep the pre-v2 600-900 default; genre pack
  // word-count defaults apply to sourced items only. Site content_guidelines
  // override both.
  const wcDefaults = mode === "original" ? { min: 600, max: 900 } : pack.defaultWordCount;
  const wc = parseWordCountFromGuidelines(
    brief.content_guidelines,
    wcDefaults.min,
    wcDefaults.max,
  );

  const sections: string[] = [
    siteIdentitySection(siteName, brief, pack.role),
    `## Register\n${pack.register}`,
    `## Genre Rules (non-negotiable)\n${pack.rules.map((r) => `- ${r}`).join("\n")}`,
    truthRulesSection(mode),
  ];
  if (mode === "sourced") {
    sections.push(inputMappingSection());
  }
  sections.push(
    craftRulesSection(),
    `## Structure\n${pack.structure}`,
    taggingSection(brief),
    outputSchemaSection(pack.headlines, wc, mode),
  );

  const system = sections.join("\n\n");
  const user = mode === "sourced"
    ? sourcedUserPrompt(buildPromptContext(item!))
    : originalUserPrompt(userRequest!);

  return { system, user, genre };
}
