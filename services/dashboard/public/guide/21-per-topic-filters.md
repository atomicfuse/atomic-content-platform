# Per-Topic Content Filters

The per-topic-filters model treats each topic (menu section) as an editorial unit with its own content source. It replaces the older flat "Content Bundles" model on opted-in sites.

## What changes

- **Topic = the editorial unit.** Each topic on the site (Wine & Beer, Destinations, etc.) gets its own filter — either a raw `category_ids` + `tag_ids` selection (AI-proposed by default) or a pointer to a shared bundle on the aggregator.
- **Articles are auto-tagged by topic.** When an article is fetched against a topic's filter, it's tagged with that topic. If the article also matches another topic's filter, it's tagged with that topic too — so it appears on both section pages.
- **Scheduling is site-level with round-robin rotation.** The site's `brief.schedule` controls when and how many articles are generated. Topics are selected in round-robin order across runs — see [Topic Rotation (Round-Robin)](?page=23-topic-rotation) for details.
- **Site theme replaces "Primary Category" for AI context.** The free-text site theme (1–2 lines) is what AI uses to propose filters. Primary Category stays as identification metadata only (drives ads.txt IAB code, dashboard categorization).

## When does this apply?

Only sites with `brief.topics_v2` set in their config use this model. Legacy sites (with `brief.bundle_ids`) continue to work exactly as before, with the existing Content Brief UI. To opt a legacy site into the new model, use the "Migrate to per-topic filters" toggle on Site Settings → Identity.

## Creating new sites

The wizard creates per-topic sites by default. You enter the site theme as part of the Identity step, define topics, and the Topic Filters step uses AI to propose a filter per topic that you can review and edit.

## Migrating an existing site

1. Open the site detail → Site Settings → Identity tab.
2. Click "Migrate to per-topic filters →".
3. Enter the site theme (1–2 lines) if it's not already set.
4. Review the AI-proposed filter for each of the site's existing topics. Edit any that don't look right.
5. Decide whether to delete this site's orphan bundles on the aggregator (default: yes; shared bundles are kept).
6. Click "Confirm migration".

The migration writes the new shape to site.yaml and removes the old bundle subscriptions. Reverting requires a git revert of the migration commit.

## Limitations

- The AI proposes filters using only existing categories and tags on the aggregator — it never invents new ones.
- A topic with no filter set produces no articles for that section. The site renders the section page empty (with no fallback).
- Cross-topic membership is evaluated only against topics with raw filters. Topics that use a linked bundle don't receive cross-topic assignments (we can't tell from an item alone whether it's in an arbitrary bundle without an aggregator round-trip).
