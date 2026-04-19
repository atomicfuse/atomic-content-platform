# Spec: Content Agent v2 — Summary-Based Dual-Model Generation
> Date: 2026-04-19
> Status: Ready for implementation
> Author: Michal + Claude planning session

---

## Goal
Restructure the content generation agents to consume pre-enriched items from the Content Aggregator v2 API, route through Claude (news) or OpenAI (general) based on factual classification, generate copyright-safe images inspired by source thumbnails, and output SEO-optimized articles.

---

## Architecture

### System Context
```
┌─────────────────────────┐
│  Content Aggregator v2   │ ← Already deployed on CloudGrid
│  (enrichment + taxonomy) │    https://content-aggregator-cloudgrid.atomic.cloudgrid.io/api
└───────────┬─────────────┘
            │ GET /api/content?enriched=true
            ▼
┌─────────────────────────┐
│  Content Pipeline Agent  │ ← THIS IS WHAT WE'RE REBUILDING
│  (article generation)    │
└───────────┬─────────────┘
            │ Generated articles + images + SEO metadata
            ▼
┌─────────────────────────┐
│  Site Publishing Layer   │ ← e.g. coolnews.dev / Astro / MongoDB
└─────────────────────────┘
```

### Internal Architecture
```
                    ┌──────────────┐
                    │  API Client   │ typed HTTP client for Aggregator v2
                    └──────┬───────┘
                           │ ContentItem[]
                           ▼
                    ┌──────────────┐
                    │   Router      │ isFactual(item, settings) → boolean
                    └──┬───────┬───┘
                       │       │
              factual  │       │  general
                       ▼       ▼
              ┌────────────┐ ┌────────────┐
              │   Claude    │ │   OpenAI    │
              │  Generator  │ │  Generator  │
              │  (Sonnet)   │ │ (4o-mini)   │
              └──────┬─────┘ └──────┬─────┘
                     │              │
                     └──────┬───────┘
                            │ GeneratedArticle (markdown)
                            ▼
                    ┌──────────────┐
                    │ Image Pipeline│
                    │  analyze →    │
                    │  generate     │
                    └──────┬───────┘
                           │ + hero image + alt text
                           ▼
                    ┌──────────────┐
                    │  SEO Module   │ meta title, description, schema.org,
                    │               │ slug, OG tags, reading time
                    └──────┬───────┘
                           │
                           ▼
                    ArticlePackage (complete output)
```

---

## Components — Files to Create/Modify

### CREATE — New Files

| File | Purpose |
|------|---------|
| `content-generation/types.ts` | TypeScript interfaces: `ContentItem`, `GeneratedArticle`, `ArticlePackage`, `ImageAsset`, `SEOMetadata`, `GeneratorConfig`, `RouterDecision` |
| `content-generation/api-client.ts` | Typed HTTP client for Content Aggregator v2. Handles pagination, filtering, retry logic |
| `content-generation/router.ts` | `isFactual()` classifier + `routeContent()` that returns which generator to use |
| `content-generation/generators/base-generator.ts` | Abstract `Generator` interface: `generate(item, config) → GeneratedArticle` |
| `content-generation/generators/claude-generator.ts` | News generator via `@cloudgrid-io/ai`. Accuracy-first prompting |
| `content-generation/generators/openai-generator.ts` | General generator via `openai` SDK. Engagement + SEO-first prompting |
| `content-generation/prompts/news-article.ts` | System + user prompt template for factual articles (Claude) |
| `content-generation/prompts/general-article.ts` | System + user prompt template for general articles (OpenAI) |
| `content-generation/prompts/seo-metadata.ts` | Prompt for generating meta title, meta description |
| `content-generation/image-pipeline/types.ts` | `ImageAnalysis`, `ImageGenerationResult`, `ImagePipelineConfig` |
| `content-generation/image-pipeline/analyzer.ts` | Uses vision model on thumbnail URL → extracts style, mood, palette, subject |
| `content-generation/image-pipeline/generator.ts` | Takes analysis + article context → DALL-E 3 prompt → original image |
| `content-generation/seo/metadata-generator.ts` | Generates: meta title (50-60 chars), meta description (150-160 chars), schema.org JSON-LD (Article or NewsArticle), Open Graph tags, reading time |
| `content-generation/seo/slug-generator.ts` | Title → URL-safe slug with stop-word removal |

### MODIFY — Existing Files

| File | Changes |
|------|---------|
| `content-generation/index.ts` | Complete rewrite as orchestrator. Old: scrape URL → generate. New: fetch API → route → generate → image → SEO → output |
| `article-regeneration/index.ts` | Update to use new generator pipeline instead of old direct-generation |

---

## Data Flow — Step by Step

### 1. Fetch enriched content (LIGHTWEIGHT — only what you need)
```typescript
// targetCount = how many articles caller wants (e.g. 3 from scheduler, 5 from dashboard)
// Fetch 2x buffer for filtering/failures — ONE request, no pagination loops
const fetchLimit = targetCount * 2;
const items = await apiClient.getContent({
  enriched: true,
  status: 'active',
  content_type: 'article',
  page_size: fetchLimit  // e.g. want 3 → fetch 6, want 10 → fetch 20
});
```

### 2. Fetch settings (for factual_tags)
```typescript
const settings = await apiClient.getSettings();
// settings.classification.factual_tags → ["news", "announcement", "breaking"]
```

### 3. For each item, route and generate
```typescript
for (const item of items) {
  const decision = router.classify(item, settings);
  // decision: { isFactual: boolean, reason: string, generator: 'claude' | 'openai' }

  const article = decision.isFactual
    ? await claudeGenerator.generate(item)
    : await openaiGenerator.generate(item);
}
```

### 4. Prompt construction (what goes INTO the model)
The prompt is built from API fields — NO URL scraping:
```
INPUT TO MODEL:
- summary    (primary — the structured brief from enrichment)
- title      (for SEO headline reference)
- description (supplementary context)
- categories  (for topical focus)
- tags        (for keyword integration)
- audience_types (for tone calibration)
- vertical    (for section/beat context)
- source.name (for attribution)
- published_at (for timeliness context)
```

### 5. Image pipeline
```typescript
// Step A: Analyze source thumbnail (if exists)
const analysis = item.thumbnail?.url
  ? await imageAnalyzer.analyze(item.thumbnail.url)
  : null;

// Step B: Generate original image
const heroImage = await imageGenerator.generate({
  analysis,          // style/mood/palette extracted from thumbnail
  articleTitle: article.title,
  articleSummary: item.summary,
  vertical: item.vertical?.name
});

// Step C: Generate alt text
const altText = generateAltText(heroImage, article.title);
```

### 6. SEO pass
```typescript
const seo = await seoGenerator.generate({
  article,
  item,     // original API item for category/tag data
  image: heroImage
});
// → { metaTitle, metaDescription, slug, schemaOrg, ogTags, readingTime }
```

### 7. Output + Early Stop
```typescript
const pkg: ArticlePackage = {
  article,      // markdown content
  heroImage,    // generated image URL/buffer
  seo,          // all metadata
  sourceItem: item.id,  // reference back to aggregator
  generatedBy: decision.generator, // 'claude' or 'openai'
  generatedAt: new Date()
};

results.push(pkg);

// EARLY STOP — once we have enough, don't waste tokens on remaining items
if (results.length >= targetCount) break;
```

**Lightweight principle**: The entire pipeline is driven by `targetCount`. We never process more items than needed. The 2x fetch buffer exists for failures — not to generate extra articles.

---

## Error Handling

| Failure | Recovery |
|---------|----------|
| API fetch fails | Retry 3x with exponential backoff (1s, 2s, 4s). Then skip batch, log error |
| Claude generation fails | Fallback to OpenAI for that item. Log the fallback |
| OpenAI generation fails | Fallback to Claude (via CloudGrid AI). Log the fallback |
| Image thumbnail analysis fails | Skip image analysis, generate image from article context only |
| DALL-E image generation fails | Use branded placeholder image. Don't block article |
| SEO generation fails | Generate basic SEO from title/description algorithmically (no AI) |
| Rate limit hit | Exponential backoff with jitter. Reduce concurrency |

**Principle**: Never let one failure mode kill the whole pipeline. Degrade gracefully.

---

## Edge Cases

| Edge Case | Handling |
|-----------|---------|
| Item has no summary (unenriched leaked through) | Skip — log warning. These shouldn't appear with `enriched=true` default |
| Item has no thumbnail | Skip image analysis step. Generate image purely from article context |
| Summary is extremely short (<50 chars) | Supplement with title + description in prompt |
| Duplicate content (same article from multiple sources) | API handles dedup upstream. If we get duplicates, skip by tracking `item.url` |
| Non-English content | Detect via `item.language`. For now: skip non-EN items, log for future support |
| Very long summary (>2000 chars) | Truncate to 2000 chars for prompt. Summary should already be concise |

---

## Out of Scope (YAGNI)
- Multi-language article generation (future phase)
- Video content generation from video items
- Social media post formatting
- A/B testing article variants
- Real-time streaming generation
- Custom per-site styling in articles
- Automatic publishing (output only — publishing is separate)

---

## Token Budget

| Step | Model | Input | Output | Cost |
|------|-------|-------|--------|------|
| Article (news) | Claude Sonnet | ~800 | ~1500 | ~$0.012 |
| Article (general) | GPT-4o-mini | ~800 | ~1500 | ~$0.0006 |
| Image analysis | GPT-4o-mini vision | ~300 | ~200 | ~$0.0003 |
| Image generation | DALL-E 3 (1024x1024) | — | — | ~$0.04 |
| SEO metadata | Same model as article | ~200 | ~300 | included |

**Per article average**: ~$0.01 (general) to ~$0.05 (news + image)
**100 articles/day estimate**: ~$1-5/day

---

## Environment Setup

### CloudGrid secrets (run once):
```bash
cloudgrid secrets set OPENAI_API_KEY=<your-openai-key>
```

### cloudgrid.yaml env (or cloudgrid env set):
```bash
cloudgrid env set CONTENT_API_BASE_URL=https://content-aggregator-cloudgrid.atomic.cloudgrid.io/api
```

### Local .env:
```
OPENAI_API_KEY=<your-openai-key>
CONTENT_API_BASE_URL=https://content-aggregator-cloudgrid.atomic.cloudgrid.io/api
```

**⚠️ IMPORTANT: Rotate the OpenAI key after setup — it was shared in a chat message.**