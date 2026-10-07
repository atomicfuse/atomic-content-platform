# Grid Template

The **Grid** template turns a site into a card-grid news feed (like dazzr.com). It shows stories from other **Live** sites in our network, chosen by **vertical**, instead of the site's own articles.

## Create a Grid site
1. In the new-site wizard, pick **Template → Grid** on the first step (**Create Site**). Audiences and the AI site theme are hidden because a Grid site never generates articles.
2. The wizard skips **Content Brief** and **Topic Filters** (no AI topic suggestions). Instead, the **Grid Feed** step asks for the **topic pills** and their verticals, and which sites to also include or never include. **Next** unlocks once one pill has a label and a vertical, or one site is included.
3. On the **Theme** step, the Modern **Layout** section is replaced by the **Card look** (card style, corners, image ratio and so on). Grid colours can be edited later in the site's Theme tab.
4. **Review** shows the template, the topic pills and the included/excluded site counts.
5. Grid sites never get generated articles: the site gets an empty content brief (0 articles a day), and the scheduler skips any site whose own Theme template is Grid.

To convert an existing site instead: **Site Settings → Theme → Template → Grid**, then **Save Theme**. A **Grid** tab appears where you add the topic pills and choose the verticals that feed each one.

## How stories are chosen
- A site feeds a pill when its vertical is in that pill's verticals. The homepage ("All") shows every pill's sites.
- Only **Live** sites. Never the Grid site itself or another Grid site. Never the legacy-account sites (financenewsbase, muvizzcom).
- **Also include / Never include** override the vertical rule for single sites. Sites with no vertical (e.g. hiddenstorydaily) only appear through "Also include".
- Each source contributes its newest **Articles per source site** (default 10). **Maximum age** can hide older stories.
- **Pinned** stories (Grid tab → Stories → Pin) always show first until their end date.
- **Hide** (Grid tab → Stories) removes one story from this site: from the feed and its story page (which returns "not found"). Hiding a pinned story also unpins it. Hidden stories are listed under the table (**Hidden from this site**) with **Unhide**. Works for network and aggregator stories, and only affects this Grid site.

## Aggregator bundles
A pill can also pull stories straight from the **Content Aggregator**: add one or more **Bundles** to the pill (Grid tab → Topic pills → **+ Add bundle**). A bundle not added to any pill is not shown.
- Only articles with an image are used (videos, trends and imageless items are skipped). If one of our network sites already rewrote the same story, only the network version is shown.
- **Stories per bundle** (default 20) is the bundle equivalent of "Articles per source site". **Maximum age** and **Pinned** work the same way.
- **Blocked categories**: aggregator categories (e.g. "War and Conflicts") whose stories never appear on this site — in the feed or on story pages. A story is hidden if *any* of its categories is blocked, so blocking a main category also blocks its subcategories.
- **Blocked publishers**: type a website (or paste any link from it) to block every aggregator story from that publisher and its subdomains, whatever bundle it comes from. E.g. `thetruthseeker.co.uk`.
- Bundles refresh **hourly**. Once picked up, a story stays on the site — the aggregator's own expiry does not remove it; newer stories push it down the feed.
- In Grid → Stories, aggregator stories show an **External · <publisher>** badge.
- Cards show the publisher's domain (e.g. cnn.com) with its real favicon. Each publisher's icon is fetched once and stored on our own storage, so visitors never load it from a third party; a publisher with no icon gets a letter badge. New publishers get their icon on the next hourly sync.

## Story pages
Clicking a card opens a story page on the Grid site with a **Read full story** button to the original article (new tab, with UTM tags unless turned off).
- **Excerpt** (default): the opening paragraphs of the source article, never more than half of it.
- **AI summary**: a ~200-word rewrite. Until a summary exists, the page shows the excerpt. Summaries are written hourly for sites that Grid sites actually use.
- **Edit** a summary in Grid → Stories → Edit. Hand edits are never overwritten automatically. If the source article later changes, the story shows **Stale** so you can decide.
- **Regenerate** replaces the summary now (asks first if it was edited).

**Aggregator stories** have their own setting, **Aggregator stories** (next to **Network stories**):
- **What It Covers** (default): the aggregator's short description of the story.
- **AI summary**: a ~120–150-word rewrite of the aggregator's facts. Until it exists, the page shows What It Covers.

**Per-story AI summary**: in Grid → Stories, **Use AI summary** creates a summary for that one story and shows it whatever the site's setting is. **Back to default** returns the story to the site's setting (the summary is kept, so you can switch back at no cost).

## Look & feel
Theme tab (Grid mode): the same colour presets as Modern, the Grid colours, and **Card look**: style, corners, image ratio, image position, density, source-line position.

## Ads
- In-feed ads: add an ad placement with position **Grid feed** (Ads settings). **Ad every Nth tile** (Grid tab, default 3) sets the cadence; 0 turns in-feed ads off.
- Story pages use the normal article positions (above content, after paragraph N, sidebar, below content, sticky bottom).

## Timing
| Change | Appears on the Grid site |
|---|---|
| Grid settings / pins / theme | after the site re-syncs (≈1 min) |
| New article on a source site | after that site syncs, within ≈5 min |
| A site changes vertical or goes Live | within the hour |
| New stories in an aggregator bundle | within the hour |
| AI summary created / edited | after the next Grid sync (a few minutes) |
