# Content Generation Agent — Design Spec

**Date:** 2026-03-25
**Status:** Approved

---

## Overview

Implement the `content-generation` agent in `packages/content-pipeline`. The agent fetches the latest article from an RSS feed, extracts content and media, rewrites it via Claude in the target site's voice, and commits the result as a markdown article to the network data repo.

Exposed as a lightweight HTTP server (native Node `http`) for local testing via Postman, and runnable in production as a CLI process.

---

## Endpoint

```
POST http://localhost:3001/content-generate
Content-Type: application/json

{
  "siteDomain": "coolnews.dev",
  "rssUrl": "https://rss.app/feeds/_F25xcSWf0J1m3Nmz.xml"
}
```

**Request validation (400 if invalid):**
- `siteDomain`: required, non-empty string, must match an existing site in the network repo
- `rssUrl`: required, must be a valid HTTP/HTTPS URL

**Responses:**
- `201 { "status": "created", "slug": "...", "path": "sites/coolnews.dev/articles/....md" }`
- `200 { "status": "skipped", "reason": "already exists" }`
- `400 { "status": "error", "message": "..." }` — bad input / site not found / no brief
- `502 { "status": "error", "message": "..." }` — upstream failure (RSS, Claude, GitHub)

---

## File Structure

```
packages/content-pipeline/src/agents/content-generation/
├── index.ts       — HTTP server entry point (native Node http)
├── agent.ts       — Core agent logic (orchestrates full flow)
├── rss.ts         — RSS fetcher + HTML content/media extractor
└── prompts.ts     — Claude prompt builders (system + user prompts)
```

Existing libs used unchanged: `lib/ai.ts`, `lib/github.ts`, `lib/config.ts`, `lib/site-brief.ts`, `lib/notifications.ts`.

---

## Agent Flow

```
1. Validate request body: siteDomain (non-empty string) + rssUrl (valid URL) → 400 if invalid

2. Fetch RSS feed → parse XML → get latest item
   - Extract: title, link (source URL), pubDate, HTML content, enclosure/media image

3. Parse HTML content from RSS item:
   - Clean text body (strip <script>/<style>, preserve paragraphs)
   - Featured image: RSS <enclosure> or <media:content> → featuredImage
     └─ If no enclosure: first <img> in body → featuredImage
     └─ If no image anywhere: call Gemini API → save as assets/images/<slug>.png
   - Remaining inline images (after featuredImage) → kept as ![alt](original_url)
   - YouTube <iframe> embeds → converted to:
     <div class="embed-block embed-object"><iframe ...></iframe></div>
     (all other iframe attributes preserved, src kept as-is)

4. Read site brief (local filesystem or GitHub API) → 400 if site not found or no brief

5. Duplicate check:
   - List articles in sites/<siteDomain>/articles/
   - Read frontmatter of each → check source_url field
   - If a file fails to parse or lacks source_url → skip that file, continue scan (do not throw)
   - Match found → return 200 { status: "skipped", reason: "already exists" }
   - Note: acceptable O(n) scan for current article volumes; revisit if site exceeds ~500 articles

6. Build Claude prompts:
   - System: site name, tone, audience, content guidelines from brief
   - User: extracted article text + media inventory + instruction to rewrite in site voice

7. Call Claude → receive generated article body + suggested title, slug, description, tags, type

8. Resolve slug uniqueness (independent of step 5 — step 5 checks source_url, this checks filename):
   - If <slug>.md already exists in articles dir → append -2, then -3, etc. until unique
   - A slug collision here means a different article already uses that slug; the new article gets a suffixed slug

9. Build .md file with frontmatter:
   - title, slug, type, description, tags — from Claude output
   - status: random number 0–100 < brief.review_percentage → "review"; else → "published"
              if review_percentage missing from brief → default to "published"
   - author: "Editorial Team"
   - publishDate: `new Date().toISOString().slice(0, 10)` (always UTC, YYYY-MM-DD)
   - featuredImage: <url or assets/images/<slug>.png> — omit field entirely if no image and Gemini is skipped
   - source_url: <original RSS item link>   ← enables future duplicate detection
   - reviewer_notes: ""
   - type: use value from Claude output if it matches ArticleType ("listicle"|"how-to"|"review"|"standard"); fallback to "standard" if invalid or missing
   - tags: array of strings from Claude output (2–5 tags expected); if Claude returns empty array, fall back to first 2 values from brief.topics

10. Write article:
    - LOCAL_NETWORK_PATH set → write file to local filesystem
    - Otherwise → commit via Octokit GitHub API

11. Return 201 { status: "created", slug, path }
```

---

## Frontmatter & Shared Types

Use `ArticleFrontmatter` from `@atomic-platform/shared-types` as the base type for frontmatter. Extend it with `source_url: string` (optional field for RSS ingestion tracking) using an intersection type or local extension interface. TypeScript strict mode must remain satisfied.

---

## Media Extraction Rules

| Source | Handling |
|--------|----------|
| RSS `<enclosure>` or `<media:content>` | → `featuredImage` frontmatter value |
| First `<img>` in HTML body (if no enclosure) | → `featuredImage` frontmatter value |
| Subsequent `<img>` in HTML body | → inline `![alt](url)` in markdown |
| YouTube `<iframe>` | → `<div class="embed-block embed-object"><iframe ...></iframe></div>` |
| No image found anywhere | → Gemini generates PNG → saved to `assets/images/<slug>.png` in network repo |

---

## Write Modes

| Env var | Mode | Behaviour |
|---------|------|-----------|
| `LOCAL_NETWORK_PATH` set | **Dev** | Write `.md` directly to filesystem; Astro hot-reloads at `localhost:4321` |
| `GITHUB_TOKEN` + `NETWORK_REPO` set | **Prod** | Commit via Octokit; triggers Cloudflare Pages build |

`LOCAL_NETWORK_PATH` takes priority if both are set.

---

## Environment Variables

```
PORT=3001                   # HTTP server port (default: 3001)
ANTHROPIC_API_KEY=...       # Claude — required
GEMINI_API_KEY=...          # Gemini image generation — optional; if absent, featuredImage skipped when no image found in RSS
GITHUB_TOKEN=...            # GitHub writes — required for prod mode
NETWORK_REPO=owner/repo     # e.g. atomicfuse/atomic-labs-network — required for prod mode
LOCAL_NETWORK_PATH=...      # Local dev path — takes priority over GitHub if set
```

---

## Error Handling

| Failure | Behaviour |
|---------|-----------|
| Invalid request body | Return 400 with specific message |
| RSS fetch / parse fails | Return 502 |
| Site not found or no brief | Return 400 |
| Article already exists | Return 200 skipped |
| Claude API fails | Return 502 |
| Gemini fails or key absent | Skip featuredImage, continue article creation |
| Slug collision | Append -2 / -3 suffix until unique |
| GitHub write fails (prod) | Return 502 |
| Port already in use | Log error and exit with code 1 |
| Neither `LOCAL_NETWORK_PATH` nor `GITHUB_TOKEN`+`NETWORK_REPO` set | Fail at startup with clear error message, exit code 1 |

---

## Testing

**Dev mode (local filesystem write):**
1. Ensure `LOCAL_NETWORK_PATH` is set in `.env`
2. Run `pnpm agent:content-generation` in `packages/content-pipeline` → server starts on `PORT` (default 3001)
3. POST to `http://localhost:3001/content-generate` via Postman
4. Verify new `.md` file appears in `$LOCAL_NETWORK_PATH/sites/<domain>/articles/`
5. Check article renders at `http://localhost:4321` (Astro dev server running separately)
6. When satisfied: `git commit + push` in `atomic-labs-network` → triggers Cloudflare Pages deploy

**Prod mode (GitHub API write):**
1. Ensure `GITHUB_TOKEN` and `NETWORK_REPO` are set; `LOCAL_NETWORK_PATH` must be unset
2. Run agent + POST via Postman as above
3. Verify commit appears in the GitHub network repo → Cloudflare Pages auto-deploys
4. No manual git step required
