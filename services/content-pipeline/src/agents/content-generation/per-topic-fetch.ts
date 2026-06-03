/**
 * Per-topic content fetch helpers.
 *
 * Used when a site's brief carries `topics_v2` (the new per-topic model).
 * The dispatcher in agent.ts checks for this field and calls into the helpers
 * here; legacy sites take the existing flat-bundle path unchanged.
 */

import type { TopicV2, SiteBrief } from "../../types.js";
import type { ContentItem } from "./types.js";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Return the topic's per-run article target.
 *  We don't track week-level budgets across runs; instead each preferred-day
 *  run aims for `ceil(articles_per_week / preferred_days.length)` items. Over
 *  a week the budget is approximately respected. */
export function computePerRunTarget(schedule: TopicV2["schedule"]): number {
  if (!schedule.articles_per_week || schedule.articles_per_week <= 0) return 0;
  const daysCount = schedule.preferred_days.length;
  if (daysCount === 0) return 0;
  return Math.ceil(schedule.articles_per_week / daysCount);
}

/** Check whether the given date falls on one of this topic's preferred days. */
export function isTopicEligibleToday(
  schedule: TopicV2["schedule"],
  now: Date = new Date(),
): boolean {
  if (computePerRunTarget(schedule) === 0) return false;
  const dayName = DAY_NAMES[now.getDay()] as string | undefined;
  if (dayName === undefined) return false;
  return schedule.preferred_days.includes(dayName);
}

/** Evaluate whether an article matches a topic's filter rules.
 *
 *  Mirrors the aggregator's bundle filter semantic: OR within each dimension,
 *  AND across dimensions (an item must overlap every non-empty dimension).
 *  Empty dimensions are treated as "no constraint".
 *
 *  For topics with `source.type === "bundle"`, we treat the bundle as opaque:
 *  the article matches iff it was fetched against that bundle id (the caller
 *  passes `wasFetchedFromBundleId` to indicate this). Cross-topic evaluation
 *  against a bundle-source topic without re-querying isn't possible from
 *  metadata alone, so we under-match (false negatives) rather than guess.
 */
export function articleMatchesTopicFilter(
  item: ContentItem,
  topic: TopicV2,
  wasFetchedFromBundleId?: string,
): boolean {
  if (topic.source.type === "bundle") {
    return wasFetchedFromBundleId === topic.source.bundle_id;
  }
  const itemCategoryIds = new Set(item.category_ids ?? []);
  const itemTagIds = new Set(item.tag_ids ?? []);

  const wantCats = topic.source.category_ids;
  const wantTags = topic.source.tag_ids;

  const catsOk =
    wantCats.length === 0 || wantCats.some((id) => itemCategoryIds.has(id));
  const tagsOk =
    wantTags.length === 0 || wantTags.some((id) => itemTagIds.has(id));

  // OR-within / AND-across — both dimensions must be satisfied (or empty).
  // If both dimensions are empty the topic matches everything, which is
  // intentional (an unconfigured filter is effectively "anything"); callers
  // should treat an unset filter as "empty topic, skip" upstream.
  return catsOk && tagsOk;
}

/** For an item fetched as part of `primaryTopic`'s run, find all OTHER topics
 *  on this site whose filters also match it. Returns an ordered list of
 *  topic names: primary first, then secondaries.
 *
 *  Bundle-source topics other than the primary are not evaluated as
 *  secondaries — we can't tell from the item alone whether it belongs to an
 *  arbitrary bundle without an aggregator round-trip. They simply never
 *  receive cross-topic assignments from other topics' fetches.
 */
export function resolveArticleTopics(
  item: ContentItem,
  primaryTopic: TopicV2,
  allTopics: TopicV2[],
  primaryFetchedFromBundleId?: string,
): string[] {
  const result = [primaryTopic.name];
  for (const t of allTopics) {
    if (t.name === primaryTopic.name) continue;
    if (t.source.type === "bundle") continue; // see comment above
    if (articleMatchesTopicFilter(item, t)) {
      result.push(t.name);
    }
  }
  // Suppress the unused-parameter lint by referencing it; the parameter exists
  // for future use (e.g. cross-topic against a known bundle).
  void primaryFetchedFromBundleId;
  return result;
}

/** Discriminator: does this brief use the per-topic model?
 *  Presence (and non-emptiness) of `topics_v2` is the signal. */
export function isPerTopicSite(brief: SiteBrief): boolean {
  return Array.isArray(brief.topics_v2) && brief.topics_v2.length > 0;
}
