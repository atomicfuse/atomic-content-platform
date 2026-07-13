/**
 * Genre pack contract. A pack contributes register, non-negotiable rules,
 * structure, and headline guidance to the composed article prompt.
 * The shared core (core.ts) owns truth rules, input mapping, tagging,
 * the tone safety valve, and the output schema.
 */

export type GenreId = "news" | "evergreen" | "pop-culture" | "review-listicle";

export interface GenrePack {
  id: GenreId;
  /** Completes "You are ..." in the system prompt opener. */
  role: string;
  /** One paragraph describing the register/voice for this genre. */
  register: string;
  /** 5–8 non-negotiable genre rules, rendered as a bulleted list. */
  rules: string[];
  /** Structure template guidance. */
  structure: string;
  /** Headline guidance for this genre. */
  headlines: string;
  /** Fallback word-count range when content_guidelines don't specify one. */
  defaultWordCount: { min: number; max: number };
}
