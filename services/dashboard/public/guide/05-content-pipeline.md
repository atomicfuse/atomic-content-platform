# Content Pipeline

The content pipeline is an autonomous service that generates articles for sites in the network. It consumes pre-enriched content from the **Content Aggregator v2 API** and routes articles through a dual-model generation pipeline — Claude Sonnet for news/factual content, OpenAI GPT-4o-mini for general/evergreen content. It runs as a CloudGrid service, triggered on-demand from the dashboard or by a scheduled cron job.

## Architecture

```
services/content-pipeline/
  src/
    index.ts                              -- HTTP server (health, /content-generate, /scheduled-publish)
    agents/
      content-generation/
        index.ts                          -- HTTP handler
        agent.ts                          -- v2 orchestrator (fetch → route → generate → image → SEO → write)
        api-client.ts                     -- Content Aggregator v2 typed HTTP client
        router.ts                         -- isFactual() classifier → Claude or OpenAI
        types.ts                          -- ContentItem, ArticlePackage, SEOMetadata, etc.
        generators/
          base-generator.ts               -- Generator interface + shared prompt context builder
          claude-generator.ts             -- News/factual via CloudGrid AI (@cloudgrid-io/ai)
          openai-generator.ts             -- General/evergreen via OpenAI SDK (GPT-4o-mini)
        prompts/
          news-article.ts                 -- Factual prompt: journalist tone, no invented facts
          general-article.ts              -- General prompt: engagement + SEO, conversational, TL;DR
        image-pipeline/
          analyzer.ts                     -- GPT-4o-mini vision: extract style/mood from thumbnail
          generator.ts                    -- DALL-E 3: generate original image (never copy source)
          types.ts                        -- ImageAnalysis, ImageGenerationResult
        seo/
          slug-generator.ts               -- Title → kebab-case slug, stop-word removal
          metadata-generator.ts           -- Meta tags, schema.org, OG tags, reading time
      content-quality/
        scorer.ts                         -- Quality scoring with Claude (5 criteria)
      article-regeneration/
        index.ts                          -- Revise rejected articles using generator pipeline
        prompts.ts                        -- Revision prompt templates
      scheduled-publisher/
        index.ts                          -- Cron-triggered batch publishing
    lib/
      ai.ts                              -- Claude / CloudGrid AI abstraction
      github.ts                          -- Git operations for committing articles
      writer.ts                          -- Markdown file generation (local or GitHub)
      site-brief.ts                      -- Read site briefs from data repo
      config.ts                          -- Environment config loader
```

## Content Generation Flow

```
  Content Aggregator v2 API (enriched items with summaries, taxonomy, thumbnails)
        |
        v
  1. Fetch enriched items (targetCount * 2 — lightweight, no pagination loops)
        |
        v
  2. Deduplicate against existing articles (by URL + title)
        |
        v
  3. Route each item: factual → Claude Sonnet, general → OpenAI GPT-4o-mini
        |
        v
  4. Generate article from structured summary (NO URL scraping)
        |
        v
  5. Image pipeline: analyze source thumbnail → generate original image (DALL-E 3)
        |
        v
  6. SEO metadata: slug, meta title/description, schema.org, OG tags, reading time
        |
        v
  7. Quality scoring (5 criteria, weighted average)
        |
        v
  8. Status assignment: score >= threshold → "published", below → "review"
        |
        v
  9. Batch commit all articles + images to data repo (single git commit)
```

## Content Aggregator v2 API

The pipeline consumes pre-enriched content from the Content Aggregator v2 API. Each item arrives with a structured summary, taxonomy, and thumbnail — ready to use without scraping.

**Primary endpoint:** `GET /api/content?enriched=true&status=active&content_type=article`

**Key fields per item:**

| Field | Description |
|-------|-------------|
| `id` | Unique content item ID |
| `url` | Original source URL (for attribution, not scraping) |
| `title` | Source article title |
| `summary` | Structured brief: "What happened… Why it matters… Content opportunity…" |
| `thumbnail.url` | Source image (analyzed for style, never copied) |
| `vertical.name` | Content vertical (Tech, News, Finance, etc.) |
| `categories[].name` | Content categories |
| `tags[].name` | Content tags (used for factual classification) |
| `audience_types[].name` | Target audience types |
| `source.name` | Source publication name |
| `published_at` | Original publication date |
| `language` | Content language |

**Settings endpoint:** `GET /api/settings` returns classification config (e.g. `factual_tags: ["news", "announcement", "breaking"]`).

## Lightweight Fetching

The pipeline follows a strict "fetch only what you need" rule. The orchestrator receives a `targetCount` (how many articles to produce) and fetches exactly `targetCount * 2` items from the API as a buffer for filtering and failures.

- User wants 3 articles → fetch `page_size=6` from API
- User wants 10 articles → fetch `page_size=20`
- Generate until `targetCount` articles succeed, then **stop**
- If the 2x buffer wasn't enough (too many failures), log a warning and return what we have
- **No pagination loops.** One fetch with the right `page_size`, that's it

## Dual-Model Routing

Each content item is classified as **factual** or **general** before generation. This determines which AI model produces the article.

### How Routing Works

The router checks two things in order:

1. **Vertical name** — if the item's vertical is News, Politics, Finance, or World News → **factual**
2. **Tags** — if any tag matches the `factual_tags` list from aggregator settings (e.g. "news", "announcement", "breaking") → **factual**
3. **Otherwise** → **general**

### Why Two Models

| | News / Factual | General / Evergreen |
|---|---|---|
| **Model** | Claude Sonnet (via CloudGrid AI) | OpenAI GPT-4o-mini |
| **Priority** | Accuracy and factual fidelity | Engagement and SEO |
| **Tone** | Journalist, objective | Conversational, scannable |
| **Word count** | 600-900 words | 800-1200 words |
| **Cost** | ~$0.012/article | ~$0.0006/article |
| **Use case** | Breaking news, finance, politics | How-tos, listicles, lifestyle |

### Cross-Model Fallback

If the primary model fails, the pipeline falls back to the other model:

- Claude fails → falls back to OpenAI for that item
- OpenAI fails → falls back to Claude for that item
- The fallback is logged so you can see which model actually generated each article

## Image Pipeline

Every article gets an original image generated by DALL-E 3. The pipeline **never** copies or directly uses source thumbnails (copyright compliance).

### How It Works

1. **Analyze** — if the source item has a `thumbnail.url`, GPT-4o-mini vision extracts the style, mood, color palette, subject, and composition
2. **Generate** — DALL-E 3 creates a completely new, original image inspired by the analysis + article context
3. **Alt text** — generated automatically for accessibility and SEO

If the source has no thumbnail, the image is generated purely from the article title and summary.

### Failure Handling

Image generation is **non-critical**. If analysis or generation fails:
- The article is still committed without a featured image
- The failure is logged but doesn't block the pipeline

## SEO Metadata

Each article gets SEO metadata generated algorithmically (no extra AI call needed):

| Field | Details |
|-------|---------|
| **Slug** | Title → kebab-case, stop words removed, max 60 chars |
| **Meta title** | Truncated to 60 chars at word boundary |
| **Meta description** | Truncated to 160 chars at word boundary |
| **Schema.org** | `NewsArticle` for factual content, `Article` for general |
| **Open Graph tags** | `og:title`, `og:description`, `og:type`, `og:image` |
| **Reading time** | Estimated at 250 words/minute |

## Article Types

Each article is generated as one of four types:

| Type | Weight (default) | Description |
|------|------------------|-------------|
| `listicle` | 40% | "Top 10..." style articles |
| `standard` | 30% | Narrative articles |
| `how-to` | 20% | Step-by-step guides |
| `review` | 10% | Product/service reviews |

Weights are configured per-site in `brief.article_types`.

## Quality Scoring

After generation, each article is scored by Claude on five criteria (each 0-100):

| Criterion | What it measures |
|-----------|-----------------|
| `seo_quality` | Title length, meta description, heading structure, keyword integration |
| `tone_match` | Writing style matches the site's stated tone and audience |
| `content_length` | Target ~1000 words. Penalized below 500 or above 1500 |
| `factual_accuracy` | No hallucinations, contradictions, or fabricated claims |
| `keyword_relevance` | Coverage of the site's topics and SEO keywords |

The weighted average (default: equal 20% each) produces an overall score. Weights can be customized per-site via `brief.quality_weights`.

### Auto-publish vs Review

- **Score >= threshold** (default 75): article status set to `published` (appears on site)
- **Score < threshold**: article status set to `review` (held in review queue)
- The threshold is configurable via `brief.quality_threshold`

## Error Handling & Fallbacks

The pipeline is designed to degrade gracefully — no single failure kills the batch.

| Failure | Recovery |
|---------|----------|
| API fetch fails | Retry 3x with exponential backoff (1s, 2s, 4s), then skip batch |
| Claude generation fails | Fall back to OpenAI for that item |
| OpenAI generation fails | Fall back to Claude for that item |
| Image analysis fails | Skip analysis, generate image from article context only |
| Image generation fails | Commit article without featured image |
| SEO generation fails | Generate basic metadata algorithmically |
| Quality scoring fails | Default to `published` status |

## Article Frontmatter

Generated articles are committed as markdown files with YAML frontmatter:

```yaml
---
title: "10 Hidden Beaches You Need to Visit in 2026"
description: "Discover secluded coastal gems perfect for a quiet getaway..."
type: listicle
status: published
publishDate: 2026-04-19
author: "Editorial Team"
tags: ["travel", "beaches", "destinations"]
featuredImage: "/assets/images/hidden-beaches-2026.png"
slug: "hidden-beaches-2026"
source_url: "https://example.com/original-article"
source_item_id: "agg-12345"
generated_by: "openai"
quality_score: 82
score_breakdown:
  seo_quality: 85
  tone_match: 80
  content_length: 78
  factual_accuracy: 90
  keyword_relevance: 77
quality_note: "Strong SEO and accurate content. Slightly under target word count."
reading_time: 4
reviewer_notes: ""
---
```

New fields in v2: `source_item_id` (aggregator item reference), `generated_by` (which model: "claude" or "openai"), `reading_time` (estimated minutes).

## Article Regeneration

Articles rejected during review can be automatically revised. The regeneration agent:

1. Reads the original article + reviewer notes from the network repo
2. Uses Claude to revise the article addressing all feedback points
3. Commits the updated article with status `review` for re-evaluation

## Scheduled Publisher

A CloudGrid cron job (`0 * * * * EST`) hits the content pipeline's `/scheduled-publish` endpoint every hour. Most ticks return in ~50ms as no-ops — the global `scheduler/config.yaml` in the network repo decides which ticks actually publish.

For each active site in the network, the scheduled publisher:

1. Reads the global scheduler config (skip tick unless enabled and current hour is in `run_at_hours`)
2. Reads the site brief and publishing schedule from the staging branch
3. Checks if today is a preferred publishing day
4. Generates `articles_per_day` articles in one batch, committed to the site's staging branch via GitHub API

See **Scheduler Agent** in the guide for the full spec, config shapes, and dashboard controls.

## Review Queue

Articles with status `review` appear in the dashboard's review queue at `/review`. Reviewers can:

- **Approve**: frontmatter updated to `status: published`, committed to Git
- **Reject**: article file deleted from the repo

Decisions are batched per-domain: one commit for approvals, one for rejections, one build trigger. If the site is Live or Ready, staging is automatically merged to main after review.

## Triggering Content Generation

### From Dashboard
The dashboard's Content Brief tab sends a POST to the content pipeline:
```json
POST /content-generate
{ "siteDomain": "coolnews.dev", "branch": "staging/coolnews-dev", "count": 5 }
```

The `count` becomes the `targetCount` — the pipeline fetches `count * 2` items and generates until `count` articles succeed.

### From Cron
The scheduled publisher calls `runContentGeneration()` directly (same process). The `articles_per_day` from the site brief becomes the `targetCount`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | For GPT-4o-mini (general articles) + DALL-E 3 (images) |
| `ANTHROPIC_API_KEY` | Local dev | For Claude (news articles) — not needed in CloudGrid |
| `CONTENT_API_BASE_URL` | No | Content Aggregator v2 URL (has default) |
| `GITHUB_TOKEN` | Yes | For committing articles to network repo |
| `NETWORK_REPO` | Yes | Network repo in `owner/repo` format |
| `LOCAL_NETWORK_PATH` | Dev only | Write articles to local filesystem instead of GitHub |
