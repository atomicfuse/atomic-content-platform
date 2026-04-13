# Content Pipeline

The content pipeline is an autonomous service that generates articles for sites in the network. It runs as a CloudGrid service and is triggered either on-demand from the dashboard or by a scheduled cron job.

## Architecture

```
services/content-pipeline/
  src/
    index.ts                          -- HTTP server (health, /content-generate, /scheduled-publish)
    agents/
      content-generation/
        index.ts                      -- HTTP handler
        agent.ts                      -- orchestration logic
        aggregator.ts                 -- Content Aggregator API client
        rss.ts                        -- HTML parsing
        prompts.ts                    -- Claude prompt templates
      content-quality/
        scorer.ts                     -- quality scoring with Claude
      article-regeneration/
        index.ts                      -- rewrite low-scoring articles
      scheduled-publisher/
        index.ts                      -- cron-triggered batch publishing
    lib/
      ai.ts                          -- Claude / CloudGrid AI abstraction
      github.ts                      -- Git operations for committing articles
      writer.ts                      -- markdown file generation
      site-brief.ts                  -- read site briefs from data repo
      config.ts                      -- environment config loader
```

## Content Generation Flow

```
Content Aggregator API
        |
        v
  1. Query for source articles (using site brief: vertical, audience, topics)
        |
        v
  2. Scrape full HTML from source URLs
        |
        v
  3. Claude rewrites each article (original content, SEO-optimized, ~1000 words)
        |
        v
  4. Quality scoring (5 criteria, weighted average)
        |
        v
  5. Status assignment: score >= threshold -> "published", below -> "review"
        |
        v
  6. Commit markdown files to data repo (staging branch or main)
        |
        v
  7. Trigger site rebuild via GitHub Actions
```

## Content Aggregator

The pipeline does not crawl RSS feeds directly. Instead, it queries a centralized Content Aggregator API that indexes articles from many sources.

Query parameters are derived from the site brief:

| Parameter | Source |
|-----------|--------|
| `vertical` | `brief.vertical` (Tech, Travel, News, etc.) |
| `audience_type` | `brief.audience_type` (Young 18-24, Adult 25-44, etc.) |
| `content_format` | Inferred from highest-weight `article_types` entry |
| `freshness` | "Today" for news topics, "This week" otherwise |
| `source_quality` | Default "High" |
| `language` | `brief.language` (default "EN") |

The aggregator client has a **progressive fallback** strategy. If the strict query returns too few results, it broadens filters step by step: relax freshness, drop content format, lower source quality, drop audience type, until enough articles are found.

## Article Types

Each article is generated as one of four types:

| Type | Weight (default) | Description |
|------|------------------|-------------|
| `listicle` | 40% | "Top 10..." style articles |
| `standard` | 30% | Narrative articles |
| `how-to` | 20% | Step-by-step guides |
| `review` | 10% | Product/service reviews |

Weights are configured per-site in `brief.article_types` and influence the `content_format` parameter sent to the aggregator.

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
- `brief.review_percentage` controls what fraction of articles always go to review regardless of score

## Article Frontmatter

Generated articles are committed as markdown files with YAML frontmatter:

```yaml
---
title: "10 Hidden Beaches You Need to Visit in 2026"
description: "Discover secluded coastal gems..."
type: listicle
status: published
publishDate: 2026-04-12
author: "Wanderlust Weekly"
tags: ["travel", "beaches", "destinations"]
featuredImage: "https://example.com/beach.jpg"
slug: "hidden-beaches-2026"
quality_score: 82
score_breakdown:
  seo_quality: 85
  tone_match: 80
  content_length: 78
  factual_accuracy: 90
  keyword_relevance: 77
quality_note: "Strong SEO and accurate content. Slightly under target word count."
reviewer_notes: ""
---
```

## Scheduled Publisher

A CloudGrid cron job (`0 */4 * * * EST`) hits the content pipeline's `/scheduled-publish` endpoint every 4 hours.

For each site in the network, the scheduled publisher:

1. Reads the site brief and publishing schedule
2. Checks if today is a preferred publishing day
3. Checks if the current time is within the preferred time window (+-2 hours)
4. Checks when the last article was published
5. If the site is due (enough days have passed based on `articles_per_week`), triggers content generation for 1 article

## Review Queue

Articles with status `review` appear in the dashboard's review queue at `/review`. Reviewers can:

- **Approve**: frontmatter updated to `status: published`, committed to Git
- **Reject**: article file deleted from the repo

Decisions are batched per-domain: one commit for approvals, one for rejections, one build trigger. If the site is Live or Ready, staging is automatically merged to main after review.

## Triggering Content Generation

### From Dashboard
The dashboard's Content Agent tab sends a POST to the content pipeline:
```json
POST /content-generate
{ "siteDomain": "coolnews.dev", "branch": "staging/coolnews-dev", "count": 5 }
```

### From Cron
The scheduled publisher calls `runContentGeneration()` directly (same process).
