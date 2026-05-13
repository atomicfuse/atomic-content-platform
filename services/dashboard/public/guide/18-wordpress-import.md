# WordPress Import

Bulk-create sites from a CSV spreadsheet and import articles from WordPress REST APIs. Located at **Dashboard > Import** (`/import`).

## CSV Site Creation

Upload a CSV with site definitions to create fully configured sites in one step. Each row becomes a complete site with staging branch, site.yaml, skill.md, content bundle, theme, and optional logo/favicon.

### CSV Format

Download the template from the Import page. Required columns:

| Column | Example | Description |
|--------|---------|-------------|
| Site Name | Travel Beauty Tips | Display name for the site |
| domain | travelbeautytips.com | Domain slug (used to derive siteId) |
| Website Category | Style & Fashion | Primary vertical for content |
| Menu Items | Beauty, Fashion, Hair | Comma-separated topic list |
| IAB Top Categories (Vertical) | Style & Fashion, Healthy Living | IAB vertical names |
| Sub Categories | Hair Care, Skin Care | Subcategory names matched to aggregator |
| Color Palette | primary: #F43656, secondary: #C87137, accent: #B80000, text: #000000, background: #FFFFFF | 5 color keys expanded to full 19-color theme |
| Logo | https://example.com/logo.png | URL to fetch logo image |
| Favicon | https://example.com/favicon.png | URL to fetch favicon image |
| Posts REST API (articles) | https://example.com/wp-json/wp/v2/posts | WordPress REST API URL for article import |
| GA Info | 328395426, G-HL2D8CQ0Z9, GT-5R65N74B | GA property ID, measurement ID, GTM ID |

### What Happens Per Site

1. **Category Resolution** — matches Website Category and Sub Categories to the Content Aggregator API, creates a content bundle
2. **Asset Fetching** — downloads logo and favicon from provided URLs (5-second timeout, skips with warning on failure)
3. **Config Building** — generates full site.yaml (matching wizard output), skill.md, and random author name
4. **Branch Creation** — creates `staging/<siteId>` branch from main
5. **File Commit** — batch commits site.yaml, skill.md, .gitkeep directories, and binary logo/favicon
6. **Dashboard Index** — adds the site entry to dashboard-index.yaml on main
7. **KV Sync** — pushes .build-trigger to trigger the sync-kv workflow

Progress is streamed in real-time via SSE. Each site shows its current phase during creation.

### After Creation

Each created site shows:
- Staging preview link (opens in new tab)
- Any warnings (e.g., "Could not fetch favicon")
- **Import Articles** button if a Posts REST API URL was provided

## Article Import

Two ways to import WordPress articles:

### From CSV Results (Inline)

Click **Import Articles** on any created site card. This triggers the WP migration agent inline, showing progress (fetching, converting, generating images, committing) directly on the card.

### Standalone Import

The **Import Articles from WordPress** section below the CSV creator allows importing articles into any existing site. Select a site, provide the WordPress API URL, choose staging or live target, and start the import.

### What the Article Import Does

1. Fetches articles from the WordPress REST API (respects `per_page` parameter)
2. Converts HTML content to clean Markdown
3. Generates hero images via AI
4. Uploads images to R2
5. Commits article markdown files to the site's branch

## Theme Color Expansion

The CSV provides 5 colors (primary, secondary, accent, text, background). These are automatically expanded into the full 19-color palette used by the site-worker theme:

- **Direct mapping:** primary, secondary, accent, text, background
- **Derived:** muted, surface, border, footer_bg, hero_title, must_reads_title, must_reads_bg, article_hero_title, feed_title, feed_desc, feed_date, category_header_text, prose_heading, prose_body

Colors are derived using luminance detection, brightness adjustment, and color mixing based on the provided palette.

## Troubleshooting

- **"Could not fetch logo/favicon"** — the URL returned a non-image response or timed out. Upload manually via Site Settings > Identity.
- **"Category resolution failed"** — the Website Category didn't match any aggregator vertical. Check spelling against the Content Aggregator categories.
- **"Failed to update dashboard-index"** — git conflict on main. The site files are still committed to the staging branch; retry or update the index manually.
- **Article import shows 0 articles** — check the WordPress API URL. It should return JSON array of posts. Try opening it in a browser first.
