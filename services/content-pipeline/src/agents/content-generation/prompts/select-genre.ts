/**
 * Genre pack auto-detection.
 *
 * The SITE BRIEF is the register authority — item categories/tags only
 * corroborate, never override. Rationale: aggregator categories are noisy
 * (observed: a true-crime video categorized "Pop Culture / Humor and
 * Satire"); a register as risky as snark must be opted into by the site.
 *
 * Precedence: pop-culture → review-listicle → news (factual) → evergreen.
 */

import type { GenreId } from "./genres/index.js";
import type { SiteBrief } from "../../../types.js";
import type { ContentItem } from "../types.js";

const POP_CULTURE = /celebrit|gossip|pop[\s-]?culture|entertainment|hollywood|showbiz|reality\s*tv/i;
const REVIEW = /review|ranking|ranked|best[\s-]of|buying\s*guide|buyer|top[\s-]?\d+|comparison|versus/i;

function briefSignalText(brief: SiteBrief): string {
  const parts: string[] = [...brief.topics, brief.tone];
  if (brief.theme) parts.push(brief.theme);
  return parts.join(" ");
}

function itemSignalText(item: ContentItem): string {
  return [
    ...item.categories.map((c) => c.name),
    ...item.tags.map((t) => t.name),
  ].join(" ");
}

export interface SelectGenreInput {
  brief: SiteBrief;
  /** Absent for dedicated (user-prompted) articles. */
  item?: ContentItem;
  /** Router decision — true means the factual/news path chose this item. */
  isFactual?: boolean;
}

export function selectGenre(input: SelectGenreInput): GenreId {
  const { brief, item, isFactual } = input;
  const siteText = briefSignalText(brief);
  const sitePop = POP_CULTURE.test(siteText);
  const siteReview = REVIEW.test(siteText);
  const itemText = item ? itemSignalText(item) : "";
  const itemPop = item ? POP_CULTURE.test(itemText) : false;
  const itemReview = item ? REVIEW.test(itemText) : false;

  // Pop-culture: the site must allow it. Non-factual items on a pop site
  // always take it; factual items only when the item corroborates (gossip
  // with a news peg), otherwise they fall through to news.
  if (sitePop && (!isFactual || itemPop)) return "pop-culture";

  // Review/listicle: site allows it AND (item corroborates OR no item —
  // dedicated articles on a review site default to the review register).
  if (siteReview && (itemReview || !item)) return "review-listicle";

  if (isFactual) return "news";
  return "evergreen";
}
