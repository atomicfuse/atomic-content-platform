# Content Pipeline

The content pipeline is an autonomous service that generates articles for sites in the network. It consumes pre-enriched content from the **Content Aggregator v2 API** and routes articles through a dual-model generation pipeline — Claude Sonnet for news/factual content, OpenAI GPT-4o-mini for general/evergreen content. It runs as a CloudGrid service, triggered on-demand from the dashboard or by a scheduled cron job. Jobs are processed through a **BullMQ queue** backed by Redis for reliability and observability.

## Architecture

```
services/content-pipeline/
  src/
    agents/
      content-generation/
        index.ts                          -- HTTP server + queue bootstrap
        agent.ts                          -- v2 orchestrator (fetch, route, generate, image, SEO, write)
        api-client.ts                     -- Content Aggregator v2 typed HTTP client
        router.ts                         -- isFactual() classifier (Claude or OpenAI)
        types.ts                          -- ContentItem, ArticlePackage, SEOMetadata, etc.
        generators/
          base-generator.ts               -- Generator interface + shared prompt context builder
          claude-generator.ts             -- News/factual via CloudGrid AI (@cloudgrid-io/ai)
          openai-generator.ts             -- General/evergreen via OpenAI SDK (GPT-4o-mini)
        prompts/
          news-article.ts                 -- Factual prompt: journalist tone, no invented facts
          general-article.ts              -- General prompt: engagement + SEO, conversational, TL;DR
        image-pipeline/
          generator.ts                    -- Three-tier image ladder (Gemini, OpenAI, exhausted)
          types.ts                        -- ImageGenAttempt, ImageLadderResult
        seo/
          slug-generator.ts               -- Title to kebab-case slug, stop-word removal
          metadata-generator.ts           -- Meta tags, schema.org, OG tags, reading time
      content-quality/
        scorer.ts                         -- Quality scoring with Claude (5 criteria)
      article-regeneration/
        index.ts                          -- Revise rejected articles using generator pipeline
        prompts.ts                        -- Revision prompt templates
      scheduled-publisher/
        index.ts                          -- Cron-triggered batch publishing
        history.ts                        -- Per-site run history persistence
    lib/
      ai.ts                              -- Claude / CloudGrid AI abstraction
      github.ts                          -- Git operations for committing articles
      writer.ts                          -- Markdown file generation (local or GitHub)
      site-brief.ts                      -- Read site briefs from data repo
      config.ts                          -- Environment config loader
      gemini.ts                          -- Gemini Flash image generation (Tier A)
      openai-image.ts                    -- OpenAI gpt-image-1 generation (Tier B)
      concurrency.ts                     -- processWithConcurrency helper
    queue/
      connection.ts                      -- Redis / IORedis connection factory
      content-generation.ts              -- BullMQ worker processor
      scheduler-flow.ts                  -- BullMQ Flow for scheduled runs
      types.ts                           -- Queue type definitions
      index.ts                           -- Worker + queue bootstrap
```

## Content Generation Flow

```
  Content Aggregator v2 API (enriched items with summaries, taxonomy, thumbnails)
        |
        v
  1. Fetch enriched items with pagination (up to 5 pages of 20 items)
        |
        v
  2. Deduplicate against existing articles (by URL + title, via dedup-index.json)
        |
        v
  2b. If ALL items are duplicates and tags were used:
      retry with broader search (categories only, no tags)
        |
        v
  3. Route each item: factual -> Claude Sonnet, general -> OpenAI GPT-4o-mini
        |
        v
  4. Generate article from structured summary (NO URL scraping)
        |
        v
  5. Image pipeline: three-tier ladder (Gemini -> OpenAI -> exhausted)
     Image is MANDATORY -- article is skipped if all tiers fail
        |
        v
  6. SEO metadata: slug, meta title/description, schema.org, OG tags, reading time
        |
        v
  7. Quality scoring (5 criteria, weighted average)
        |
        v
  8. Status assignment: score >= threshold -> "published", below -> "review"
        |
        v
  9. Batch commit all articles + images + dedup index to data repo (single git commit)
```

## BullMQ Queue

All content generation jobs run through a **BullMQ queue** backed by Redis. This provides:

- **Reliability**: jobs survive server restarts; failed jobs are retried up to 3 times with exponential backoff
- **Observability**: the Queue Monitor page shows job history, status, error reasons, and article counts
- **Concurrency control**: only 2 jobs run at a time to avoid API rate limits
- **Scheduled runs**: the scheduler creates a BullMQ Flow (parent + child jobs per site)

### Job lifecycle

1. Dashboard or scheduler sends a request to the content pipeline
2. A BullMQ job is created with site domain, branch, and count
3. The worker picks up the job and runs `runContentGeneration()`
4. On success, the result (articles created, errors, duplicates) is stored in the job's return value
5. On failure, the job is retried up to 3 times before being marked as failed

### Retention

- Completed jobs are retained for **7 days**
- Failed jobs are retained for **30 days**

### Direct execution fallback

If `REDIS_URL` is not set, jobs run synchronously (direct execution mode). This is useful for local development without Redis.

### Queue Monitor

The dashboard includes a **Queue Monitor** page at `/queue` that shows all BullMQ jobs with:

- Status filters (All, Active, Completed, Failed)
- Expandable job cards with article breakdown (created, failed, duplicates)
- Error reasons for failed jobs and individual article errors
- Auto-refresh every 10 seconds

## Aggregator Search Strategy

The pipeline uses a two-phase search strategy to find fresh content:

### Phase 1: Narrow search (categories + tags)

The pipeline fetches items from the Content Aggregator filtered by both `category_ids` (from the site's vertical and category config) and `tag_ids` (resolved from the site's topics). This returns the most relevant content.

Pages are fetched incrementally (up to 5 pages of 20 items) until enough fresh (non-duplicate) items are found.

### Phase 2: Broad search fallback (categories only)

If the narrow search returned items but **all** were duplicates (already exist on the site), the pipeline automatically retries with a broader search using **only category_ids** (dropping tag_ids). This widens the content pool to find articles the site hasn't covered yet.

The fallback only triggers when:
- The narrow search actually returned items (not empty)
- ALL returned items were duplicates
- Tags were being used (no point retrying without tags if there were none)

### Deduplication

Articles are deduplicated by both source URL and title. A `dedup-index.json` file is maintained alongside articles to avoid reading every article file on each run. The index is updated atomically in the same commit as new articles.

## Content Aggregator v2 API

The pipeline consumes pre-enriched content from the Content Aggregator v2 API. Each item arrives with a structured summary, taxonomy, and thumbnail — ready to use without scraping.

**Primary endpoint:** `GET /api/content?enriched=true&status=active&content_type=article`

**Key fields per item:**

| Field | Description |
|-------|-------------|
| `id` | Unique content item ID |
| `url` | Original source URL (for attribution, not scraping) |
| `title` | Source article title |
| `summary` | Structured brief: "What happened... Why it matters... Content opportunity..." |
| `thumbnail.url` | Source image (used as reference for style, never copied) |
| `vertical.name` | Content vertical (Tech, News, Finance, etc.) |
| `categories[].name` | Content categories |
| `tags[].name` | Content tags (used for factual classification) |
| `audience_types[].name` | Target audience types |
| `source.name` | Source publication name |
| `published_at` | Original publication date |
| `language` | Content language |

**Settings endpoint:** `GET /api/settings` returns classification config (e.g. `factual_tags: ["news", "announcement", "breaking"]`).

## Dual-Model Routing

Each content item is classified as **factual** or **general** before generation. This determines which AI model produces the article.

### How Routing Works

The router checks two things in order:

1. **Vertical name** — if the item's vertical is News, Politics, Finance, or World News -> **factual**
2. **Tags** — if any tag matches the `factual_tags` list from aggregator settings (e.g. "news", "announcement", "breaking") -> **factual**
3. **Otherwise** -> **general**

### Why Two Models

| | News / Factual | General / Evergreen |
|---|---|---|
| **Model** | Claude Sonnet (via CloudGrid AI) | OpenAI GPT-4o-mini |
| **Priority** | Accuracy and factual fidelity | Engagement and SEO |
| **Tone** | Journalist, objective | Conversational, scannable |
| **Word count** | 600-900 words | 800-1200 words |
| **Use case** | Breaking news, finance, politics | How-tos, listicles, lifestyle |

### Cross-Model Fallback

If the primary model fails, the pipeline falls back to the other model:

- Claude fails -> falls back to OpenAI for that item
- OpenAI fails -> falls back to Claude for that item
- The fallback is logged so you can see which model actually generated each article

## Image Pipeline

Every article **requires** an original image. Image generation is mandatory — if all providers fail, the article is skipped and the pipeline moves to the next source item.

### Three-Tier Ladder

The image pipeline uses a three-tier fallback ladder:

**Tier A: Gemini Flash (2 attempts)**
- Model: `gemini-2.5-flash-image` via Google's Generative Language API
- If the source item has a `thumbnail.url`, the thumbnail is fetched and sent as a reference image for style matching
- Transient failures (HTTP 5xx, 429 rate limit, timeouts) trigger a second attempt
- Permanent failures (HTTP 4xx, auth errors, content policy blocks) skip the retry and fall through immediately

**Tier B: OpenAI gpt-image-1 (1 attempt)**
- Model: `gpt-image-1` via OpenAI Images API
- Size: 1536x1024
- Always generates from the text prompt alone (no reference image)
- One attempt only — if it fails, the ladder is exhausted

**Tier C: Exhausted**
- If both Gemini and OpenAI fail, the article is skipped
- The full error chain is logged (e.g. "gemini:server_error:500, gemini:timeout, openai:client_error:400")
- The error appears in the Queue Monitor with the reason chain

### Error Classification

Each image generation attempt returns a structured result:
- **Success**: `{ ok: true, data: Buffer }` — raw PNG image data
- **Transient failure**: `{ ok: false, retriable: true, reason: "server_error:500" }` — worth retrying
- **Permanent failure**: `{ ok: false, retriable: false, reason: "client_error:403" }` — skip retry

Transient errors: HTTP 5xx, 429 (rate limit), network timeouts, connection errors
Permanent errors: HTTP 4xx (bad request, auth, content policy), missing API keys, malformed responses

## SEO Metadata

Each article gets SEO metadata generated algorithmically (no extra AI call needed):

| Field | Details |
|-------|---------|
| **Slug** | Title to kebab-case, stop words removed, max 60 chars |
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
| All aggregator results are duplicates | Retry with broader search (categories only, drop tags) |
| Claude generation fails | Fall back to OpenAI for that item |
| OpenAI generation fails | Fall back to Claude for that item |
| Gemini image fails (transient) | Retry once, then fall through to OpenAI gpt-image-1 |
| Gemini image fails (permanent) | Skip retry, fall through to OpenAI gpt-image-1 immediately |
| OpenAI image fails | Article skipped (image is mandatory), move to next source item |
| Both image providers fail | Article skipped with "image_gen_exhausted" error |
| SEO generation fails | Generate basic metadata algorithmically |
| Quality scoring fails | Default to `published` status |
| BullMQ job fails | Retry up to 3 times with exponential backoff |

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

## Article Regeneration

Articles rejected during review can be automatically revised. The regeneration agent:

1. Reads the original article + reviewer notes from the network repo
2. Uses Claude to revise the article addressing all feedback points
3. Commits the updated article with status `review` for re-evaluation

## Scheduled Publisher

A CloudGrid cron job (`0 * * * * EST`) hits the content pipeline's `/scheduled-publish` endpoint every hour. Most ticks return in ~50ms as no-ops — the global `scheduler/config.yaml` in the network repo decides which ticks actually publish.

When Redis is configured, the scheduler creates a **BullMQ Flow** — a parent job with one child job per site. This provides per-site error isolation and parallel processing.

For each active site in the network, the scheduled publisher:

1. Reads the global scheduler config (skip tick unless enabled and current hour is in `run_at_hours`)
2. Reads the site brief and publishing schedule from the staging branch
3. Checks if today is a preferred publishing day
4. Creates a BullMQ child job for each eligible site
5. Each child job generates `articles_per_day` articles, committed to the site's staging branch via GitHub API

See **Scheduler Agent** in the guide for the full spec, config shapes, and dashboard controls.

## Review Queue

Articles with status `review` appear in the dashboard's review queue at `/review`. Reviewers can:

- **Approve**: frontmatter updated to `status: published`, committed to Git
- **Reject**: article file deleted from the repo

Decisions are batched per-domain: one commit for approvals, one for rejections, one build trigger. If the site is Live or Ready, staging is automatically merged to main after review.

## Triggering Content Generation

### From Dashboard
The dashboard's Content Brief tab sends a POST to the content pipeline via `/api/agent/generate`. When BullMQ is configured, this creates a queue job and returns a job ID. The dashboard polls `/api/agent/job/:id` for status updates.

```json
POST /content-generate
{ "siteDomain": "coolnews.dev", "branch": "staging/coolnews-dev", "count": 5 }
```

### From Cron
The scheduled publisher calls `runContentGeneration()` via BullMQ child jobs (or directly if Redis is not configured). The `articles_per_day` from the site brief becomes the `targetCount`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | For GPT-4o-mini (general articles) + gpt-image-1 (image Tier B) |
| `ANTHROPIC_API_KEY` | Local dev | For Claude (news articles) — not needed in CloudGrid |
| `GEMINI_API_KEY` | Yes | For Gemini Flash image generation (image Tier A) |
| `CONTENT_API_BASE_URL` | No | Content Aggregator v2 URL (has default) |
| `GITHUB_TOKEN` | Yes | For committing articles to network repo |
| `NETWORK_REPO` | Yes | Network repo in `owner/repo` format |
| `LOCAL_NETWORK_PATH` | Dev only | Write articles to local filesystem instead of GitHub |
| `REDIS_URL` | Production | Redis connection for BullMQ (e.g. `redis://localhost:6379`) |
