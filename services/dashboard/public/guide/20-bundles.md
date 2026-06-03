# Content Bundles & Site Subscriptions

A site subscribes to one or more **content bundles** on the aggregator. At publish time the content pipeline fetches articles from each subscribed bundle, dedupes across the union, and applies the site's freshness, quality, and ranking pipeline.

## Why multiple bundles per site

The aggregator's bundle filter is **OR within each dimension, AND across dimensions** — every article must satisfy every non-empty rule dimension. That makes a single bundle like `{ categories: [Travel, Food], tags: [culinary-travel] }` exclude pure Travel articles that don't carry the tag, and a single bundle like `{ categories: [Travel, Food] }` admit generic food content.

The union of N focused bundles fixes this:

- `travel` — `{ categories: [Travel] }` — broad travel coverage
- `travel-food` — `{ categories: [Food], tags: [culinary-travel, food-travel, food-tours] }` — only travel-themed food
- `travel-culture` — `{ categories: [Culture, Society], tags: [travel-culture, cultural-tourism] }` — only travel-themed culture

A site subscribed to all three gets the OR-of-AND-groups semantic the editorial intent actually wants.

## Naming convention

Name bundles after **what's in them**, not after the site that uses them:

- `travel`, `travel-food`, `travel-culture`
- `wine`, `wine-tourism`
- `science-news`, `space-news`

When the wizard creates a starter bundle from a single site's picks, it defaults to `{domain}-starter` so it's obvious the bundle hasn't been generalized yet. Rename it for reuse once you confirm the rules work.

## Where to manage bundles

- **Subscribe a site to bundles:** Site detail → Site Settings → Content Brief → Content Bundles → "+ Add Bundle"
- **Create a focused bundle:** same modal → "Or create a new bundle" section
- **Deep curation (rename, edit rules, add/remove articles manually):** the Content Aggregator UI directly. The dashboard tracks subscriptions; bundle internals are aggregator-side.

## Backwards compatibility

Sites with a legacy singular `bundle_id` field in `site.yaml` are read as if they had `bundle_ids: [<that id>]`. The next save rewrites the file to the new shape. No data loss; no migration script required.
