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

## Story pages
Clicking a card opens a story page on the Grid site with a **Read full story** button to the original article (new tab, with UTM tags unless turned off).
- **Excerpt** (default): the opening paragraphs of the source article, never more than half of it.
- **AI summary**: a ~200-word rewrite. Until a summary exists, the page shows the excerpt. Summaries are written hourly for sites that Grid sites actually use.
- **Edit** a summary in Grid → Stories → Edit. Hand edits are never overwritten automatically. If the source article later changes, the story shows **Stale** so you can decide.
- **Regenerate** replaces the summary now (asks first if it was edited).

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
| AI summary created / edited | after the next Grid sync (a few minutes) |
