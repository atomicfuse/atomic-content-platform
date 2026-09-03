# Generate Dedicated Article — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Generate Dedicated Article" option next to the existing "Generate Articles" button that lets users write a custom prompt, generates exactly 1 article via Claude (no content aggregator), and triggers n8n image generation.

**Architecture:** New endpoint on the content-pipeline (`POST /content-generate-dedicated`) with a dedicated orchestrator that reads the site brief, generates an article from a user-provided prompt using Claude, scores quality, commits to the staging branch, and triggers n8n for image generation. Dashboard gets a new API route (`POST /api/agent/generate-dedicated`) and the `ContentGenerationPanel` gets a new collapsible section with a textarea for the prompt.

**Tech Stack:** TypeScript, Next.js API routes (dashboard), Node HTTP handler (content-pipeline), Claude via `ai.ts` wrapper, gray-matter for frontmatter, existing quality scorer, existing n8n trigger, existing git writer.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `services/content-pipeline/src/agents/content-generation/prompts/dedicated-article.ts` | Create | System + user prompt templates for dedicated article generation |
| `services/content-pipeline/src/agents/content-generation/dedicated-agent.ts` | Create | `runDedicatedGeneration()` orchestrator — reads brief, generates article, scores, builds markdown, commits, triggers n8n |
| `services/content-pipeline/src/agents/content-generation/index.ts` | Modify | Add `POST /content-generate-dedicated` route handler |
| `services/dashboard/src/app/api/agent/generate-dedicated/route.ts` | Create | Dashboard API route — proxies to content-pipeline (same URL fallback pattern) |
| `services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx` | Modify | Add "Generate Dedicated Article" UI section with textarea + button |

---

### Task 1: Create Dedicated Article Prompt Templates

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/prompts/dedicated-article.ts`

- [ ] **Step 1: Create the prompt template file**

```typescript
// services/content-pipeline/src/agents/content-generation/prompts/dedicated-article.ts

/**
 * Prompt templates for dedicated (user-prompted) article generation.
 *
 * Unlike news-article.ts which rewrites aggregator content, this generates
 * original articles from a user-provided topic/description with no source content.
 */

import type { SiteBrief } from "../../../types.js";
import { parseWordCountFromGuidelines } from "../../word-count.js";

/**
 * Build the system prompt for dedicated article generation.
 */
export function buildDedicatedSystemPrompt(siteName: string, brief: SiteBrief): string {
  const guidelines = Array.isArray(brief.content_guidelines)
    ? brief.content_guidelines.map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  const wc = parseWordCountFromGuidelines(brief.content_guidelines, 600, 900);

  const themeLine = brief.theme && brief.theme.trim()
    ? `\n\n## Editorial Angle\n${brief.theme.trim()}`
    : "";

  return `You are an expert content writer for ${siteName}, a publication covering ${brief.topics.join(", ")} for ${brief.audience}.${themeLine}

## CRITICAL RULES
- Write original, well-researched content based on the user's topic description
- Do NOT invent specific statistics, quotes, or attributions — use general knowledge responsibly
- If making a factual claim, qualify it appropriately ("studies suggest", "experts recommend", etc.)
- Maintain authority and depth — this is a dedicated piece, not a news rewrite

## Site Voice
- Tone: ${brief.tone}
- Audience: ${brief.audience}
- Topics: ${brief.topics.join(", ")}
- SEO focus keywords: ${brief.seo_keywords_focus.join(", ")}

## Editorial Guidelines
${guidelines}

## Tagging Rules
The site has these main topics: ${brief.topics.join(", ")}
- The FIRST tag MUST be one of the site's topics (exact match, case-insensitive)
- After the topic tag(s), add 2-4 additional descriptive tags
- If the article doesn't clearly fit any topic, pick the closest one

## Output Format
Respond ONLY with a valid JSON object (no markdown fences). Schema:
{
  "title": "string — compelling, informative headline (50-70 chars)",
  "slug": "string — URL-safe kebab-case slug",
  "description": "string — 1-2 sentence meta description (150-160 chars)",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string — FIRST must be a site topic, then 2-4 descriptive tags"],
  "body": "string — ${wc.label} article in markdown with H2 subheadings. Do NOT include an H1 title — it is rendered separately from frontmatter. STRICT: never exceed ${wc.max} words."
}`;
}

/**
 * Build the user prompt for dedicated article generation from user's free-text description.
 */
export function buildDedicatedUserPrompt(userPrompt: string): string {
  return `## Article Request

${userPrompt}

Write a comprehensive, original article based on the request above. Structure it with clear H2 subheadings, engaging introduction, and a strong conclusion. Make it informative and valuable for the target audience.`;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/prompts/dedicated-article.ts
git commit -m "feat(content-pipeline): add dedicated article prompt templates"
```

---

### Task 2: Create Dedicated Article Orchestrator

**Files:**
- Create: `services/content-pipeline/src/agents/content-generation/dedicated-agent.ts`
- Reference: `services/content-pipeline/src/agents/content-generation/agent.ts` (reuse patterns from `processItem` and `runContentGeneration`)

This is the core orchestrator. It reuses `generateContent` (ai.ts), quality scorer, slug generator, frontmatter builder, and writer — but skips the aggregator entirely.

- [ ] **Step 1: Create the dedicated agent file**

```typescript
// services/content-pipeline/src/agents/content-generation/dedicated-agent.ts

/**
 * Dedicated Article Generation Agent — generates a single article from a
 * user-provided prompt. No content aggregator involved.
 *
 * Reuses: ai.ts (Claude), quality scorer, slug generator, writer, n8n image trigger.
 */

import { randomUUID } from "node:crypto";
import matter from "gray-matter";

import { generateContent } from "../../lib/ai.js";
import { buildDedicatedSystemPrompt, buildDedicatedUserPrompt } from "./prompts/dedicated-article.js";
import { parseGeneratedArticle } from "./generators/base-generator.js";
import type { GeneratedArticle } from "./types.js";
import { generateSlug } from "./seo/slug-generator.js";
import { scoreArticle, resolveStatus as resolveQualityStatus } from "../content-quality/scorer.js";
import { validateArticleBody } from "./agent.js";
import { ensureTopicTag } from "./agent.js";
import { writeArticleBatch } from "../../lib/writer.js";
import type { PendingArticle } from "../../lib/writer.js";
import { triggerN8nImage, trackPendingImage } from "./n8n-image.js";
import { notifyImageDefaultFallback } from "../../lib/notifications.js";
import { createOctokit } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import { recordTextUsage } from "../../costs/recorder.js";
import type { AgentConfig } from "../../lib/config.js";
import type { ArticleFrontmatter, ArticleType, QualityScoreBreakdown, SiteBrief } from "../../types.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface DedicatedGenerationParams {
  siteDomain: string;
  branch: string;
  /** The user's free-text prompt describing what article to write. */
  userPrompt: string;
}

export interface DedicatedGenerationResult {
  status: "created" | "error";
  slug?: string;
  path?: string;
  message?: string;
  qualityScore?: number;
  articleStatus?: "approved" | "review";
  n8nImageTriggered: boolean;
}

// ---------------------------------------------------------------------------
// Slug uniqueness (reuses pattern from agent.ts)
// ---------------------------------------------------------------------------

async function resolveUniqueSlug(
  config: AgentConfig,
  siteDomain: string,
  baseSlug: string,
  branch: string,
): Promise<string> {
  let candidate = baseSlug;
  let counter = 2;

  const octokit = createOctokit(config.github);
  while (true) {
    try {
      await octokit.rest.repos.getContent({
        ...parseRepo(config.github.repo),
        path: `sites/${siteDomain}/articles/${candidate}.md`,
        ref: branch,
      });
      // File exists — try next candidate
      candidate = `${baseSlug}-${counter}`;
      counter++;
    } catch {
      // 404 — slug is available
      break;
    }
  }
  return candidate;
}

function parseRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  return { owner: owner!, repo: name! };
}

// ---------------------------------------------------------------------------
// Valid article types
// ---------------------------------------------------------------------------

const VALID_ARTICLE_TYPES: ArticleType[] = ["listicle", "how-to", "review", "standard"];

// ---------------------------------------------------------------------------
// Extended frontmatter (matches agent.ts pattern)
// ---------------------------------------------------------------------------

interface DedicatedFrontmatter extends ArticleFrontmatter {
  generated_by: string;
  quality_score?: number;
  score_breakdown?: QualityScoreBreakdown;
  quality_note?: string;
  reading_time?: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate a single dedicated article from a user prompt.
 * Handles the full pipeline: generate → validate → score → commit → trigger image.
 */
export async function runDedicatedGeneration(
  params: DedicatedGenerationParams,
  config: AgentConfig,
): Promise<DedicatedGenerationResult> {
  const { siteDomain, branch, userPrompt } = params;

  try {
    // Step 1: Read site brief
    console.log(`[dedicated] Reading brief for ${siteDomain} (branch: ${branch})`);
    const octokit = createOctokit(config.github);
    const { siteName, author: siteAuthor, brief } = await readSiteBrief(
      octokit,
      config.networkRepo,
      siteDomain,
      branch,
    );

    // Step 2: Generate article with Claude
    console.log(`[dedicated] Generating article for ${siteDomain} from user prompt`);
    const systemPrompt = buildDedicatedSystemPrompt(siteName, brief);
    const dedicatedUserPrompt = buildDedicatedUserPrompt(userPrompt);

    const { text, usage } = await generateContent({
      systemPrompt,
      userPrompt: dedicatedUserPrompt,
      maxTokens: 4096,
    });

    // Record generation cost (fire-and-forget)
    if (usage) {
      void recordTextUsage({
        siteDomain,
        source: "dashboard",
        model: "claude-sonnet-4-20250514",
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimated: usage.estimated,
      });
    }

    const generated: GeneratedArticle = parseGeneratedArticle(text);

    // Step 3: Validate body
    const bodyCheck = validateArticleBody(generated.body);
    if (!bodyCheck.valid) {
      console.warn(`[dedicated] Body validation failed: ${bodyCheck.reason}`);
      return { status: "error", message: `Body validation failed: ${bodyCheck.reason}`, n8nImageTriggered: false };
    }

    // Step 4: Generate unique slug
    const baseSlug = generated.slug || generateSlug(generated.title);
    const slug = await resolveUniqueSlug(config, siteDomain, baseSlug, branch);

    // Step 5: Ensure topic tag
    const tags = ensureTopicTag(generated.tags ?? [], brief.topics, generated.title);

    // Step 6: Quality scoring
    let qualityScore: number | undefined;
    let scoreBreakdown: QualityScoreBreakdown | undefined;
    let qualityNote: string | undefined;
    let articleStatus: "approved" | "review" = "approved";

    try {
      console.log(`[dedicated] Scoring article: "${generated.title}"`);
      const qualityResult = await scoreArticle(
        {
          title: generated.title,
          description: generated.description,
          body: generated.body,
          tags,
          type: (VALID_ARTICLE_TYPES.includes(generated.type as ArticleType)
            ? generated.type
            : "standard") as ArticleType,
        },
        siteName,
        brief,
        brief.quality_weights,
      );

      qualityScore = qualityResult.overallScore;
      scoreBreakdown = qualityResult.breakdown;
      qualityNote = qualityResult.note;
      articleStatus = resolveQualityStatus(qualityResult.overallScore, brief.quality_threshold);

      if (qualityResult.usage) {
        void recordTextUsage({
          siteDomain,
          source: "dashboard",
          model: "claude-sonnet-4-20250514",
          inputTokens: qualityResult.usage.inputTokens,
          outputTokens: qualityResult.usage.outputTokens,
          estimated: qualityResult.usage.estimated,
        });
      }

      console.log(
        `[dedicated] Quality score: ${qualityScore}/100 → ${articleStatus}` +
        ` (threshold: ${brief.quality_threshold ?? 40})`,
      );
    } catch (scoreErr) {
      const errMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
      console.warn(`[dedicated] Quality scoring failed, defaulting to review: ${errMsg}`);
      qualityNote = `Quality scoring failed: ${errMsg}`;
      qualityScore = 0;
      articleStatus = "review";
    }

    // Step 7: Build frontmatter + markdown
    const articleType: ArticleType = VALID_ARTICLE_TYPES.includes(generated.type as ArticleType)
      ? (generated.type as ArticleType)
      : "standard";
    const publishDate = new Date().toISOString().slice(0, 10);
    const defaultImagePath = `/assets/images/${siteDomain}-general-article.webp`;

    // Estimate reading time
    const wordCount = generated.body.split(/\s+/).filter(Boolean).length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 250));

    const frontmatter: DedicatedFrontmatter = {
      title: generated.title,
      description: generated.description.slice(0, 160),
      type: articleType,
      status: articleStatus,
      publishDate,
      author: siteAuthor || "Editorial Team",
      tags,
      slug,
      reviewer_notes: articleStatus === "review" ? (qualityNote ?? "") : "",
      generated_by: "claude-dedicated",
      featuredImage: defaultImagePath,
      ...(qualityScore !== undefined ? { quality_score: qualityScore } : {}),
      ...(scoreBreakdown ? { score_breakdown: scoreBreakdown } : {}),
      ...(qualityNote ? { quality_note: qualityNote } : {}),
      ...(readingTime ? { reading_time: readingTime } : {}),
    };

    // Strip leading H1 from body
    const cleanBody = generated.body.replace(/^\s*#\s+[^\n]+\n*/, "");
    const markdown = matter.stringify(cleanBody, frontmatter);
    const filePath = `sites/${siteDomain}/articles/${slug}.md`;

    // Step 8: Commit to Git
    console.log(`[dedicated] Committing article ${slug} to ${branch}`);
    const pendingArticle: PendingArticle = { siteDomain, slug, content: markdown };
    await writeArticleBatch(
      { localNetworkPath: config.localNetworkPath, github: config.github, branch },
      [pendingArticle],
      [],
      `feat(content): add dedicated article ${slug} for ${siteDomain}`,
    );

    // Step 9: Trigger n8n image generation
    let n8nImageTriggered = false;
    if (config.n8nImageWebhookUrl) {
      const callbackUrl = config.imageCallbackUrl
        ?? "https://sites-platform-e297--atomic.cloudgrid.io/api/agent/image-callback";
      const requestId = `img_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

      const accepted = await triggerN8nImage(config.n8nImageWebhookUrl, {
        request_id: requestId,
        callback_url: callbackUrl,
        job_id: "",
        site_domain: siteDomain,
        slug,
        branch,
        article: {
          title: generated.title,
          description: generated.description,
          summary: cleanBody.slice(0, 500),
          vertical: tags[0] ?? "General",
          source_thumbnail_url: null,
          image_guidelines: Array.isArray(brief.image_guidelines)
            ? brief.image_guidelines.join("\n")
            : brief.image_guidelines ?? null,
        },
      });

      if (accepted) {
        n8nImageTriggered = true;
        trackPendingImage(requestId, siteDomain, slug, generated.title, config.notifications);
      } else {
        void notifyImageDefaultFallback(config.notifications, {
          site: siteDomain,
          articleTitle: generated.title,
          slug,
          reason: "n8n webhook trigger failed",
        });
      }
    }

    console.log(
      `[dedicated] Article created: ${slug} (score: ${qualityScore}, status: ${articleStatus}, image: ${n8nImageTriggered})`,
    );

    return {
      status: "created",
      slug,
      path: filePath,
      qualityScore,
      articleStatus,
      n8nImageTriggered,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dedicated] Generation failed for ${siteDomain}:`, message);
    return { status: "error", message, n8nImageTriggered: false };
  }
}
```

**Key differences from the existing `processItem` in `agent.ts`:**
- No `ContentItem` from aggregator — works from user prompt directly
- Commits to Git inline (no separate Phase 2 — this is a single-article flow)
- Triggers n8n inline (no separate Phase 3)
- No dedup index update (no aggregator source to dedup against)
- Marks `generated_by: "claude-dedicated"` for tracking

- [ ] **Step 2: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/dedicated-agent.ts
git commit -m "feat(content-pipeline): add dedicated article generation orchestrator"
```

---

### Task 3: Add HTTP Endpoint to Content Pipeline

**Files:**
- Modify: `services/content-pipeline/src/agents/content-generation/index.ts` (add handler before the existing `/content-generate` catch-all around line 1088)

- [ ] **Step 1: Add the `/content-generate-dedicated` handler**

In `index.ts`, find the line:

```typescript
  if (req.method !== "POST" || req.url !== "/content-generate") {
```

Insert the new handler BEFORE it (around line 1083, after the `/propose-filter` handler):

```typescript
  // Dedicated article generation — single article from user prompt, no aggregator
  if (req.method === "POST" && req.url === "/content-generate-dedicated") {
    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch {
      sendJson(res, 413, { status: "error", message: "Payload too large" });
      return;
    }

    let payload: { siteDomain?: unknown; branch?: unknown; userPrompt?: unknown };
    try {
      payload = JSON.parse(rawBody) as typeof payload;
    } catch {
      sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
      return;
    }

    const { siteDomain, branch, userPrompt } = payload;
    if (!siteDomain || typeof siteDomain !== "string") {
      sendJson(res, 400, { status: "error", message: "siteDomain is required (string)" });
      return;
    }
    if (!userPrompt || typeof userPrompt !== "string" || userPrompt.trim().length === 0) {
      sendJson(res, 400, { status: "error", message: "userPrompt is required (non-empty string)" });
      return;
    }

    const branchStr = typeof branch === "string" ? branch : `staging/${siteDomain}`;

    console.log(
      `[server] POST /content-generate-dedicated — site: ${siteDomain}, branch: ${branchStr}`,
    );

    try {
      const { runDedicatedGeneration } = await import("./dedicated-agent.js");
      const result = await runDedicatedGeneration(
        { siteDomain, branch: branchStr, userPrompt: userPrompt.trim() },
        config,
      );

      if (result.status === "created") {
        sendJson(res, 201, result as unknown as Record<string, unknown>);
      } else {
        sendJson(res, 500, result as unknown as Record<string, unknown>);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] Dedicated agent error:", message);
      sendJson(res, 502, { status: "error", message });
    }
    return;
  }
```

Also add a startup log line after the existing log at line ~1240:

```typescript
  console.log(`[server] POST http://localhost:${config.port}/content-generate-dedicated`);
```

- [ ] **Step 2: Commit**

```bash
git add services/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(content-pipeline): add /content-generate-dedicated HTTP endpoint"
```

---

### Task 4: Create Dashboard API Route

**Files:**
- Create: `services/dashboard/src/app/api/agent/generate-dedicated/route.ts`
- Reference: `services/dashboard/src/app/api/agent/generate/route.ts` (copy the URL fallback pattern)

- [ ] **Step 1: Create the API route**

```typescript
// services/dashboard/src/app/api/agent/generate-dedicated/route.ts
import { NextRequest, NextResponse } from "next/server";
import { invalidateSiteCaches } from "@/lib/github";
import { revalidatePath } from "next/cache";

const CONTENT_AGENT_URL =
  process.env.CONTENT_AGENT_URL ?? "http://localhost:5000";
const LOCAL_FALLBACK = "http://localhost:5000";
const isLocalDev = process.env.NODE_ENV === "development";

function getAgentUrl(): string {
  if (isLocalDev && CONTENT_AGENT_URL.includes("content-pipeline-app")) {
    return LOCAL_FALLBACK;
  }
  return CONTENT_AGENT_URL;
}

/**
 * POST /api/agent/generate-dedicated
 *
 * Proxies to the content-pipeline's /content-generate-dedicated endpoint.
 * Generates a single article from a user-provided prompt (no content aggregator).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as {
    siteDomain?: string;
    branch?: string | null;
    userPrompt?: string;
  };

  if (!body.siteDomain) {
    return NextResponse.json(
      { status: "error", message: "siteDomain is required" },
      { status: 400 },
    );
  }

  if (!body.userPrompt || body.userPrompt.trim().length === 0) {
    return NextResponse.json(
      { status: "error", message: "userPrompt is required" },
      { status: 400 },
    );
  }

  const agentUrl = getAgentUrl();
  try {
    const agentResponse = await fetch(`${agentUrl}/content-generate-dedicated`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteDomain: body.siteDomain,
        branch: body.branch ?? `staging/${body.siteDomain}`,
        userPrompt: body.userPrompt.trim(),
      }),
    });
    const result = (await agentResponse.json()) as Record<string, unknown>;
    if (agentResponse.ok) {
      const branch = body.branch ?? `staging/${body.siteDomain}`;
      invalidateSiteCaches(body.siteDomain, branch);
      revalidatePath(`/sites/${encodeURIComponent(body.siteDomain)}`);
    }
    return NextResponse.json(result, { status: agentResponse.status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to reach content agent";
    return NextResponse.json(
      {
        status: "error",
        message: `Content agent unavailable: ${message}. Is the agent running?`,
      },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add services/dashboard/src/app/api/agent/generate-dedicated/route.ts
git commit -m "feat(dashboard): add /api/agent/generate-dedicated API route"
```

---

### Task 5: Update ContentGenerationPanel UI

**Files:**
- Modify: `services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx`

Add a "Generate Dedicated Article" collapsible section below the existing "Generate Articles" button. When in idle state, shows a textarea + generate button. When generating, shows a simplified pipeline progress (no aggregator steps).

- [ ] **Step 1: Add state variables for dedicated mode**

After the existing state declarations (around line 130), add:

```typescript
  const [dedicatedMode, setDedicatedMode] = useState(false);
  const [dedicatedPrompt, setDedicatedPrompt] = useState("");
```

- [ ] **Step 2: Add the `handleDedicatedGenerate` function**

After the existing `handleGenerate` function (around line 290, after its closing brace), add:

```typescript
  async function handleDedicatedGenerate(): Promise<void> {
    if (!dedicatedPrompt.trim()) {
      toast.error("Please describe the article you want to generate.");
      return;
    }

    const startTime = Date.now();
    setPipeline({
      step: "reading_brief",
      message: `Loading site brief for ${domain}...`,
      startedAt: startTime,
    });

    try {
      advancePipeline("reading_brief", `Loading site brief for ${domain}...`);
      await delay(300);

      advancePipeline(
        "generating_article",
        "Claude is writing your dedicated article..."
      );

      const generationMessages = [
        { msg: "Analyzing your article request...", delay: 2000 },
        { msg: "Claude is researching the topic...", delay: 3000 },
        { msg: "Crafting the article structure...", delay: 3000 },
        { msg: "Writing the introduction...", delay: 3000 },
        { msg: "Expanding main content sections...", delay: 4000 },
        { msg: "Adding depth and detail...", delay: 3500 },
        { msg: "Writing the conclusion...", delay: 2500 },
        { msg: "Generating SEO metadata...", delay: 2000 },
        { msg: "Almost done — finalizing article...", delay: 5000 },
      ];

      let messageIndex = 0;
      let cancelled = false;
      const messageTimer = setInterval(() => {
        if (cancelled) return;
        if (messageIndex < generationMessages.length) {
          const current = generationMessages[messageIndex]!;
          setPipeline((prev) =>
            prev.step === "generating_article"
              ? { ...prev, message: current.msg }
              : prev
          );
          messageIndex++;
        }
      }, 2500);

      const res = await fetch("/api/agent/generate-dedicated", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteDomain: domain,
          branch: stagingBranch,
          userPrompt: dedicatedPrompt.trim(),
        }),
      });

      cancelled = true;
      clearInterval(messageTimer);

      const data = (await res.json()) as {
        status: string;
        slug?: string;
        path?: string;
        message?: string;
        qualityScore?: number;
        articleStatus?: string;
        n8nImageTriggered?: boolean;
      };

      if (data.status === "created") {
        advancePipeline("scoring_quality", "Article scored and saved!");
        await delay(300);

        advancePipeline("writing_article", "Article committed to staging branch...");
        await delay(300);

        const batchResults = [{
          status: "created" as const,
          slug: data.slug,
          path: data.path,
          qualityScore: data.qualityScore,
          articleStatus: data.articleStatus,
        }];

        setPipeline((prev) => ({
          ...prev,
          step: "complete",
          message: "Dedicated article created successfully!",
          completedAt: Date.now(),
          batchSummary: `1 article created${data.n8nImageTriggered ? " (image generating in background)" : ""}`,
          batchResults,
        }));

        setDedicatedPrompt("");
        toast.success(`Article "${data.slug}" created!`);
      } else {
        setPipeline((prev) => ({
          ...prev,
          step: "error",
          message: data.message || "Failed to generate dedicated article",
          error: data.message,
          completedAt: Date.now(),
        }));
        toast.error(data.message || "Generation failed");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      setPipeline((prev) => ({
        ...prev,
        step: "error",
        message: errMsg,
        error: errMsg,
        completedAt: Date.now(),
      }));
      toast.error(`Generation failed: ${errMsg}`);
    }
  }
```

- [ ] **Step 3: Add UI section in the idle state**

Find the existing "Generation Controls" section (around line 524-565). It renders when `pipeline.step === "idle"`. Add the dedicated article section **inside** this same idle block, after the existing button's `</div>` closing tag (after line 563), before the closing `</div>` of the section:

```tsx
          {/* Dedicated Article */}
          <div className="border-t border-[var(--border-primary)] pt-4 mt-4">
            <button
              type="button"
              onClick={() => setDedicatedMode((v) => !v)}
              className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <svg
                className={`w-3 h-3 transition-transform ${dedicatedMode ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Generate Dedicated Article
            </button>
            {dedicatedMode && (
              <div className="mt-3 space-y-3">
                <textarea
                  value={dedicatedPrompt}
                  onChange={(e) => setDedicatedPrompt(e.target.value)}
                  placeholder="Describe the article you want to generate. E.g.: 'Write an article about the top 10 budget travel destinations in Southeast Asia for 2026, focusing on food and culture...'"
                  rows={4}
                  className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-cyan focus:outline-none focus:ring-1 focus:ring-cyan resize-y"
                />
                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleDedicatedGenerate}
                    disabled={!dedicatedPrompt.trim()}
                  >
                    <svg
                      className="w-4 h-4 mr-2"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
                      />
                    </svg>
                    Generate Dedicated Article
                  </Button>
                  <p className="text-xs text-[var(--text-muted)]">
                    Generates 1 original article from your prompt using Claude.
                    No content aggregator — pure AI generation.
                  </p>
                </div>
              </div>
            )}
          </div>
```

- [ ] **Step 4: Verify the `delay` helper exists**

The existing code already uses a `delay` function (used in `handleGenerate`). Search for it — it should already be defined in the file. If not, add it near the top of the component:

```typescript
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 5: Commit**

```bash
git add services/dashboard/src/components/site-detail/ContentGenerationPanel.tsx
git commit -m "feat(dashboard): add Generate Dedicated Article UI in ContentGenerationPanel"
```

---

### Task 6: Typecheck and Manual Verification

**Files:**
- All files from Tasks 1-5

- [ ] **Step 1: Run typecheck on content-pipeline**

```bash
cd services/content-pipeline && pnpm typecheck
```

Expected: no errors. Fix any import path or type issues.

- [ ] **Step 2: Run typecheck on dashboard**

```bash
cd services/dashboard && pnpm typecheck
```

Expected: no errors. Fix any import or type issues.

- [ ] **Step 3: Run existing tests**

```bash
pnpm test
```

Expected: all existing tests pass (no regressions).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve typecheck issues from dedicated article feature"
```

(Only if there were fixes needed.)
