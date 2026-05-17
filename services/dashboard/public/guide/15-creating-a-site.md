# How to Create a Site

This guide walks you through creating a new site on the Atomic Content Network, from the wizard to going live with a custom domain.

## Before You Start

You need:
- Access to the dashboard (sign in with your Google account)
- A site name and general idea of the content niche
- The rest (theme, schedule, topics) can be configured during or after the wizard

## Two Ways to Create Sites

- **Wizard** — one site at a time, step-by-step (described below)
- **CSV Import** — bulk-create multiple sites from a spreadsheet. Go to **Import** in the sidebar. See the [WordPress Import](18-wordpress-import) guide for details.

## The Wizard

Navigate to **Sites** in the sidebar and click **New Site**, or go directly to `/wizard`.

The wizard has 7 steps. You can go back to any completed step to make changes.

---

### Step 1: Create Site

| Field | What it means |
|-------|--------------|
| **Site Slug** | The folder name in the data repo and the staging branch name (`staging/{slug}`). Lowercase, hyphens only, max 63 characters. Choose carefully -- this becomes the permanent identifier. |
| **Site Name** | The display name shown in the header and browser tab. Can be changed later. |
| **Company** | ATL or NGC. Determines branding context. |
| **Audiences** | Who reads this site. Search and select from the Content Aggregator's audience list. Optional but helps AI generate better content. |

Click **Next** when Site Slug and Site Name are filled in.

---

### Step 2: Niche Targeting

Defines what content the site covers. Two modes:

**Use Existing Bundle** -- Pick a pre-configured content bundle from the dropdown. This fills in the category, subcategories, and tags automatically. Good when a bundle already exists for your niche.

**Create New** -- Build a niche from scratch:

| Field | What it means |
|-------|--------------|
| **Category** | The top-level IAB category (e.g., "Arts & Entertainment", "Technology"). This is the broadest content vertical. |
| **Subcategories** | Narrow the focus within the category. Select at least one. Use the filter input to search, and "Select all filtered" to bulk-add matches. |
| **Tags** | Optional keywords for finer targeting. You can search existing tags or create new ones. |
| **Check Match Count** | Shows how many articles in the Content Aggregator match your selections. Fewer than 5 is a warning. |

After the wizard, a content bundle is created automatically from your selections.

---

### Step 3: Groups

Groups are shared configuration bundles. A site can belong to zero or more groups. Groups control things like ad partners, tracking IDs, theme overrides, and scripts.

- Check the groups you want this site to belong to
- If you select more than one, you can reorder them -- groups are merged left-to-right (later groups override earlier ones)
- This step is optional. You can add groups later from the site detail page.

Common groups: ad network partners, theme variants, regional config.

---

### Step 4: Theme

Configure the visual appearance of the site.

**Color Preset** -- Pick from 6 presets (classic, bold, ocean, warm, slate, midnight) or go custom. Selecting a preset fills all 19 color fields at once.

**Brand Colors:**
- **Primary** -- Header, navigation background
- **Accent** -- Call-to-action buttons, newsletter section
- **Background** -- Main page background

**Typography:**
- **Heading Font** and **Body Font** -- Select from Google Fonts

**Layout Settings:**
- **Hero Grid** -- Enable/disable the featured articles grid at the top. Choose 3 or 4 articles.
- **Must Reads** -- Show/hide the Must Reads section below the hero
- **Page Size** -- How many articles to show per "Load More" click (1-50)
- **Sidebar Topics** -- Auto-select from content, or specify explicit topic labels

**Logo and Favicon:**
- Upload a logo (PNG/JPG/SVG, max 2MB) or let AI generate one in the next step
- Upload a favicon, or use "Use Logo" to derive it from the logo
- Both are optional at this stage -- AI will generate a logo if you skip it

---

### Step 5: Content Brief

Defines the editorial voice and publishing schedule.

| Field | What it means |
|-------|--------------|
| **Audiences** | Same as Step 1. You can add or remove here. |
| **Tone** | Writing style (e.g., "Informative, friendly" or "Professional, authoritative"). Guides the AI writer. |
| **Topics** | What the site writes about. AI auto-suggests topics based on your site name, category, and tone. You can edit, remove, or add your own. Max 20. |
| **Content Guidelines** | Free-form instructions for the AI writer (e.g., "Focus on practical advice", "Include data citations"). |
| **Articles Per Day** | How many articles the scheduler publishes daily (1-10). |
| **Preferred Days** | Which days of the week to publish. Select at least one. The scheduler only runs on these days. |

---

### Step 6: Preview

Deploys your site to staging and shows a live preview.

1. Click **Deploy to Staging** -- this commits your site files to a staging branch and seeds the Worker KV
2. Wait for KV sync (typically 30-60 seconds) -- the progress indicator shows each step
3. Once live, the preview appears in an embedded browser frame

If the preview times out, you can click **Check Again** to re-poll, or **Show Preview Anyway** to force-display the URL.

The staging URL looks like: `https://atomic-site-worker-staging.accounts-4a8.workers.dev?_atl_site={slug}`

---

### Step 7: Review & Go Live

Shows a summary of your site configuration. From here you can:

- **View Site Details** -- goes to the site management page where you can fine-tune settings, attach a custom domain, and publish to production
- **Back to Dashboard** -- returns to the site list

---

## After the Wizard

Your site is now in **Staging** status. Here is what to do next.

### Review and Edit Settings

Go to **Sites** > click your site. The site detail page has three top-level tabs:

**Site Settings** (5 sub-tabs):
- **Identity** -- Change name, tagline, attach a custom domain
- **Content Brief** -- Edit topics, schedule, content guidelines. The "Niche Targeting" section shows your category and subcategories as violet badges. You can create a content bundle here if one was not created during the wizard.
- **Groups** -- Add or remove group memberships
- **Overrides** -- See which config overrides apply to this site
- **Config** -- Full configuration form (tracking, scripts, ads, theme, legal). Shows inheritance badges indicating where each value comes from (org, group, override, or site level).

**Deployments** -- Deploy status and staging URL

**Content** -- Article list with status filters (published, draft, archived)

Each sub-tab has its own **Save** button. Changes are saved to the staging branch.

### Generate Content

From the **Content Brief** sub-tab, scroll to **Generate Articles** and click the button. This sends a request to the content pipeline, which will write articles to the staging branch. Articles appear in the **Content** tab.

The scheduler also generates content automatically based on your articles-per-day and preferred-days settings.

### Preview Your Site

Click the **Worker Preview** button on the Deployments tab, or visit the staging URL directly:

```
https://atomic-site-worker-staging.accounts-4a8.workers.dev?_atl_site={slug}
```

The `?_atl_site={slug}` parameter tells the staging Worker which site to serve. This parameter propagates automatically when you click links on the preview -- you do not need to add it manually to every URL.

### Publish to Production

When you are satisfied with the staging content:

1. From the site detail page, click **Publish** (merges staging branch to main)
2. The `sync-kv.yml` workflow runs automatically, seeding production KV
3. Site status changes to **Ready**

### Attach a Custom Domain

1. Go to **Site Settings** > **Identity**
2. Enter the custom domain (e.g., `coolnews.dev`)
3. The dashboard registers it as a Worker Custom Domain on the production Worker
4. Set up DNS: create a CNAME record pointing to the Worker hostname
5. Once DNS propagates, site status changes to **Live**

---

## Key Concepts

### Config Inheritance

Your site inherits configuration from multiple layers:

```
org.yaml --> groups --> config overrides --> site.yaml
```

The Config sub-tab shows colored badges next to each field indicating where the value comes from:
- **Cyan** = org-level default
- **Violet** = inherited from a group
- **Amber** = applied by a config override
- **Emerald** = set at site level

You only need to set values at the site level if you want to override what the org/group provides.

### Content Bundles

A content bundle defines what articles the Content Aggregator serves to your site. It combines categories and tags into a single reusable filter. If you used "Create New" in the wizard's Niche Targeting step, a bundle was created automatically.

### Staging vs Production

- **Staging**: Your site files live on the `staging/{slug}` branch. The staging Worker serves previews via `?_atl_site=`. All edits go here first.
- **Production**: After publishing (merging staging to main), the production Worker serves the site on its custom domain.

### Server Islands

Tracking pixels (GA4, GTM, Facebook Pixel), ad placements, and interstitial ads are loaded as Astro Server Islands. They render per-request from the latest KV config, so changes to tracking IDs or ad settings take effect on the next page load without redeployment.

---

## Troubleshooting

**Preview shows wrong site content** -- Make sure the URL has `?_atl_site={your-slug}`. If you open a bare workers.dev URL, it may resolve to a different site.

**Preview shows no tracking tags** -- Check Config > Tracking on the site detail page. If blank, the site is inheriting from org/group. Verify the org-level GA4 ID is set under Settings > Org.

**Articles not appearing** -- After generating, wait for the staging KV sync (up to 60 seconds). Refresh the preview. Check the Content tab for article status.

**Custom domain not resolving** -- DNS propagation can take up to 48 hours. Verify the CNAME record points to the correct Worker hostname. The dashboard shows DNS verification status on the Identity tab.

**"No content bundle" warning** -- Go to Content Brief > Niche Targeting and click "Create Bundle". You need a category and at least one subcategory selected first.
