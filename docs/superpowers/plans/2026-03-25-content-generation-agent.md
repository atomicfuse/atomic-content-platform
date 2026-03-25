# Content Generation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native Node HTTP server that accepts a POST request with a site domain and RSS URL, fetches the latest article, rewrites it via Claude in the site's voice, and commits the result as a markdown article to the network data repo.

**Architecture:** Native Node `http` server wraps a pure agent function. Each concern (RSS parsing, Gemini image gen, article writing, prompt building) lives in its own focused module. The agent function is independently testable with all external calls mocked.

**Tech Stack:** TypeScript (strict), Node `http`, `fast-xml-parser` (RSS/XML), `node-html-parser` (HTML content), `@anthropic-ai/sdk` (Claude), Gemini REST API via `fetch`, `@octokit/rest` (GitHub writes), `gray-matter` (frontmatter), `vitest` (tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/agents/content-generation/index.ts` | **Replace stub** | HTTP server — parse request, call agent, return JSON |
| `src/agents/content-generation/agent.ts` | **Create** | Orchestrates all 11 steps from spec |
| `src/agents/content-generation/rss.ts` | **Create** | Fetch RSS feed, parse XML, extract HTML content + media |
| `src/agents/content-generation/prompts.ts` | **Replace stub** | Build system + user prompts from site brief + RSS content |
| `src/lib/gemini.ts` | **Create** | Gemini REST API call for image generation |
| `src/lib/writer.ts` | **Create** | Write article to local filesystem or GitHub |
| `src/lib/config.ts` | **Modify** | Add PORT, LOCAL_NETWORK_PATH, GEMINI_API_KEY |
| `src/__tests__/rss.test.ts` | **Create** | Unit tests for RSS parsing logic |
| `src/__tests__/prompts.test.ts` | **Create** | Unit tests for prompt builders |
| `src/__tests__/writer.test.ts` | **Create** | Unit tests for article writer |
| `src/__tests__/agent.test.ts` | **Create** | Integration tests for full agent flow (all deps mocked) |
| `.env.example` | **Modify** | Add PORT, LOCAL_NETWORK_PATH, GEMINI_API_KEY |

**Existing libs used unchanged:** `lib/ai.ts`, `lib/github.ts`, `lib/site-brief.ts`, `lib/notifications.ts`

---

## Task 1: Install Dependencies & Update Config

**Files:**
- Modify: `packages/content-pipeline/package.json`
- Modify: `packages/content-pipeline/src/lib/config.ts`
- Modify: `packages/content-pipeline/.env.example`

- [ ] **Step 1: Install new dependencies**

```bash
cd packages/content-pipeline
pnpm add fast-xml-parser node-html-parser
```

Expected: both packages appear in `package.json` dependencies.

- [ ] **Step 2: Verify TypeScript types are available**

```bash
pnpm typecheck
```

Expected: no errors (both packages ship their own types).

- [ ] **Step 3: Extend config.ts with new env vars**

Replace `packages/content-pipeline/src/lib/config.ts` with:

```typescript
/**
 * Configuration loader for agents.
 */

import type { GitHubConfig } from "./github.js";
import type { AIConfig } from "./ai.js";

export interface AgentConfig {
  github: GitHubConfig;
  ai: AIConfig;
  networkRepo: string;
  localNetworkPath: string | undefined;
  geminiApiKey: string | undefined;
  port: number;
  notifications: {
    telegramBotToken?: string;
    telegramChatId?: string;
    slackWebhookUrl?: string;
  };
}

export function loadConfig(): AgentConfig {
  const anthropicKey = requireEnv("ANTHROPIC_API_KEY");

  const localNetworkPath = process.env.LOCAL_NETWORK_PATH;
  const githubToken = process.env.GITHUB_TOKEN;
  const networkRepo = process.env.NETWORK_REPO;

  // Validate at least one write mode is configured
  if (!localNetworkPath && (!githubToken || !networkRepo)) {
    throw new Error(
      "Either LOCAL_NETWORK_PATH or both GITHUB_TOKEN + NETWORK_REPO must be set",
    );
  }

  return {
    github: {
      token: githubToken ?? "",
      repo: networkRepo ?? "",
    },
    ai: {
      apiKey: anthropicKey,
    },
    networkRepo: networkRepo ?? "",
    localNetworkPath,
    geminiApiKey: process.env.GEMINI_API_KEY,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    notifications: {
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
      telegramChatId: process.env.TELEGRAM_CHAT_ID,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    },
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
```

- [ ] **Step 4: Update .env.example**

```
# GitHub API token with repo access to network repos
GITHUB_TOKEN=ghp_xxxxxxxxxxxxx

# Anthropic API key for Claude
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx

# Gemini API key for image generation (optional — skips featuredImage if absent)
GEMINI_API_KEY=AIzaSy_xxxxxxxxxxxxx

# Network repo (org/repo format) — required for prod GitHub write mode
NETWORK_REPO=atomicfuse/atomic-labs-network

# Local network repo path — takes priority over GitHub write if set (dev mode)
LOCAL_NETWORK_PATH=/path/to/atomic-labs-network

# HTTP server port (default: 3001)
PORT=3001

# Optional: notification webhooks
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SLACK_WEBHOOK_URL=
```

- [ ] **Step 5: Typecheck**

```bash
cd packages/content-pipeline
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/content-pipeline/package.json packages/content-pipeline/pnpm-lock.yaml packages/content-pipeline/src/lib/config.ts packages/content-pipeline/.env.example
git commit -m "feat(content-pipeline): install xml/html parsers, extend agent config"
```

---

## Task 2: RSS Module

**Files:**
- Create: `packages/content-pipeline/src/agents/content-generation/rss.ts`
- Create: `packages/content-pipeline/src/__tests__/rss.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/content-pipeline/src/__tests__/rss.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseRssFeed, parseHtmlContent } from "../agents/content-generation/rss.js";

describe("parseRssFeed", () => {
  it("returns the latest item from an RSS feed", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Latest Article</title>
          <link>https://example.com/latest</link>
          <pubDate>Wed, 25 Mar 2026 10:00:00 GMT</pubDate>
          <description><![CDATA[<p>Some content</p>]]></description>
        </item>
        <item>
          <title>Older Article</title>
          <link>https://example.com/older</link>
          <pubDate>Mon, 23 Mar 2026 10:00:00 GMT</pubDate>
          <description><![CDATA[<p>Older content</p>]]></description>
        </item>
      </channel>
    </rss>`;

    const item = parseRssFeed(xml);
    expect(item.title).toBe("Latest Article");
    expect(item.link).toBe("https://example.com/latest");
    expect(item.htmlContent).toContain("<p>Some content</p>");
  });

  it("uses content:encoded over description when both present", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel>
        <item>
          <title>Article</title>
          <link>https://example.com/article</link>
          <description><![CDATA[<p>Short</p>]]></description>
          <content:encoded><![CDATA[<p>Full content with <img src="https://img.com/a.jpg" /></p>]]></content:encoded>
        </item>
      </channel>
    </rss>`;

    const item = parseRssFeed(xml);
    expect(item.htmlContent).toContain("Full content");
  });

  it("extracts enclosure URL when present", () => {
    const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>Article</title>
          <link>https://example.com/article</link>
          <description><![CDATA[content]]></description>
          <enclosure url="https://img.com/hero.jpg" type="image/jpeg" />
        </item>
      </channel>
    </rss>`;

    const item = parseRssFeed(xml);
    expect(item.enclosureUrl).toBe("https://img.com/hero.jpg");
  });

  it("throws if feed has no items", () => {
    const xml = `<?xml version="1.0"?><rss><channel></channel></rss>`;
    expect(() => parseRssFeed(xml)).toThrow("RSS feed contains no items");
  });
});

describe("parseHtmlContent", () => {
  it("extracts first image as featured and rest inline", () => {
    const html = `<p>Intro</p>
      <img src="https://img.com/hero.jpg" alt="Hero" />
      <p>Body</p>
      <img src="https://img.com/inline.jpg" alt="Inline" />`;

    const result = parseHtmlContent(html, undefined);
    expect(result.featuredImageUrl).toBe("https://img.com/hero.jpg");
    expect(result.inlineImages).toEqual([{ src: "https://img.com/inline.jpg", alt: "Inline" }]);
  });

  it("uses enclosureUrl as featured image, all body images become inline", () => {
    const html = `<img src="https://img.com/body.jpg" alt="Body" /><p>Text</p>`;
    const result = parseHtmlContent(html, "https://img.com/enclosure.jpg");
    expect(result.featuredImageUrl).toBe("https://img.com/enclosure.jpg");
    expect(result.inlineImages).toEqual([{ src: "https://img.com/body.jpg", alt: "Body" }]);
  });

  it("extracts YouTube iframes", () => {
    const html = `<p>Watch this:</p>
      <iframe width="560" height="315" src="https://www.youtube.com/embed/abc123" frameborder="0" allowfullscreen></iframe>`;

    const result = parseHtmlContent(html, undefined);
    expect(result.youtubeEmbeds).toHaveLength(1);
    expect(result.youtubeEmbeds[0]).toContain('src="https://www.youtube.com/embed/abc123"');
  });

  it("returns null featuredImageUrl when no images and no enclosure", () => {
    const result = parseHtmlContent("<p>Text only</p>", undefined);
    expect(result.featuredImageUrl).toBeNull();
  });

  it("produces clean text body (no script/style tags)", () => {
    const html = `<script>alert('x')</script><style>.a{}</style><p>Clean text</p>`;
    const result = parseHtmlContent(html, undefined);
    expect(result.textBody).not.toContain("alert");
    expect(result.textBody).not.toContain(".a{}");
    expect(result.textBody).toContain("Clean text");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/content-pipeline
pnpm test -- --reporter=verbose src/__tests__/rss.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement rss.ts**

Create `packages/content-pipeline/src/agents/content-generation/rss.ts`:

```typescript
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  htmlContent: string;
  enclosureUrl: string | undefined;
}

export interface ParsedContent {
  textBody: string;
  featuredImageUrl: string | null;
  inlineImages: Array<{ src: string; alt: string }>;
  youtubeEmbeds: string[];
}

/**
 * Fetch an RSS feed URL and return raw XML.
 */
export async function fetchRss(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Parse RSS XML and return the latest item.
 */
export function parseRssFeed(xml: string): RssItem {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "__cdata",
  });

  const parsed = parser.parse(xml) as Record<string, unknown>;
  const channel = (parsed["rss"] as Record<string, unknown>)?.["channel"] as Record<string, unknown>;

  if (!channel) {
    throw new Error("Invalid RSS feed: missing channel element");
  }

  const rawItems = channel["item"];
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  if (items.length === 0) {
    throw new Error("RSS feed contains no items");
  }

  // First item is always latest in RSS
  const item = items[0] as Record<string, unknown>;

  const title = extractText(item["title"]);
  const link = extractText(item["link"]);
  const pubDate = extractText(item["pubDate"]) ?? "";

  // Prefer content:encoded over description
  const contentEncoded = item["content:encoded"] ?? item["encoded"];
  const htmlContent = extractText(contentEncoded) ?? extractText(item["description"]) ?? "";

  // Enclosure image
  const enclosure = item["enclosure"] as Record<string, unknown> | undefined;
  const mediaContent = item["media:content"] as Record<string, unknown> | undefined;
  const enclosureUrl =
    (enclosure?.["@_url"] as string | undefined) ??
    (mediaContent?.["@_url"] as string | undefined);

  return { title, link, pubDate, htmlContent, enclosureUrl };
}

/**
 * Parse HTML content from an RSS item.
 * Extracts featured image, inline images, YouTube embeds, and clean text.
 */
export function parseHtmlContent(html: string, enclosureUrl: string | undefined): ParsedContent {
  const root = parseHtml(html);

  // Remove script and style tags
  root.querySelectorAll("script, style").forEach((el) => el.remove());

  // Extract all images
  const allImages = root.querySelectorAll("img").map((img) => ({
    src: img.getAttribute("src") ?? "",
    alt: img.getAttribute("alt") ?? "",
  })).filter((img) => img.src);

  // Determine featuredImageUrl
  let featuredImageUrl: string | null = enclosureUrl ?? null;
  let inlineImages: Array<{ src: string; alt: string }>;

  if (enclosureUrl) {
    // All body images become inline
    inlineImages = allImages;
  } else if (allImages.length > 0) {
    // First body image becomes featured
    featuredImageUrl = allImages[0]!.src;
    inlineImages = allImages.slice(1);
  } else {
    inlineImages = [];
  }

  // Extract YouTube iframes (preserve full HTML)
  const youtubeEmbeds: string[] = [];
  root.querySelectorAll("iframe").forEach((iframe) => {
    const src = iframe.getAttribute("src") ?? "";
    if (src.includes("youtube.com/embed") || src.includes("youtu.be")) {
      youtubeEmbeds.push(iframe.outerHTML);
      iframe.remove();
    }
  });

  // Remove inline img tags from DOM (they'll be re-inserted in markdown)
  root.querySelectorAll("img").forEach((el) => el.remove());

  // Extract clean text body
  const textBody = root.text.replace(/\n{3,}/g, "\n\n").trim();

  return { textBody, featuredImageUrl, inlineImages, youtubeEmbeds };
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if ("__cdata" in obj) return String(obj["__cdata"]);
    if ("#text" in obj) return String(obj["#text"]);
  }
  return "";
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/content-pipeline
pnpm test -- --reporter=verbose src/__tests__/rss.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/content-pipeline/src/agents/content-generation/rss.ts packages/content-pipeline/src/__tests__/rss.test.ts
git commit -m "feat(content-pipeline): implement RSS fetcher and HTML content parser"
```

---

## Task 3: Gemini Image Generation

**Files:**
- Create: `packages/content-pipeline/src/lib/gemini.ts`
- Create: `packages/content-pipeline/src/__tests__/gemini.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/content-pipeline/src/__tests__/gemini.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateImageWithGemini } from "../lib/gemini.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("generateImageWithGemini", () => {
  it("returns a Buffer when Gemini responds with image data", async () => {
    const fakeImageBase64 = Buffer.from("fake-png-data").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: "image/png", data: fakeImageBase64 } }],
            },
          },
        ],
      }),
    });

    const result = await generateImageWithGemini("my-api-key", "A photo of a snake");
    expect(result).toBeInstanceOf(Buffer);
    expect(result!.toString()).toBe("fake-png-data");
  });

  it("returns null when Gemini response has no image part", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "I cannot generate" }] } }] }),
    });

    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toBeNull();
  });

  it("returns null when fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toBeNull();
  });

  it("returns null when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    const result = await generateImageWithGemini("my-api-key", "prompt");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test -- --reporter=verbose src/__tests__/gemini.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement gemini.ts**

Create `packages/content-pipeline/src/lib/gemini.ts`:

```typescript
/**
 * Gemini image generation via REST API.
 * Returns null on any failure — Gemini is optional; callers skip featuredImage.
 */

const GEMINI_IMAGE_MODEL = "gemini-2.0-flash-preview-image-generation";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Generate an image for the given prompt using Gemini.
 * Returns a PNG Buffer or null if generation fails or key is absent.
 */
export async function generateImageWithGemini(
  apiKey: string,
  prompt: string,
): Promise<Buffer | null> {
  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });

    if (!response.ok) {
      console.warn(`[gemini] Image generation failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: { parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> };
      }>;
    };

    const imagePart = data.candidates?.[0]?.content.parts.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      console.warn("[gemini] No image in response");
      return null;
    }

    return Buffer.from(imagePart.inlineData.data, "base64");
  } catch (err) {
    console.warn("[gemini] Image generation error:", err);
    return null;
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test -- --reporter=verbose src/__tests__/gemini.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content-pipeline/src/lib/gemini.ts packages/content-pipeline/src/__tests__/gemini.test.ts
git commit -m "feat(content-pipeline): add Gemini image generation lib"
```

---

## Task 4: Article Writer

**Files:**
- Create: `packages/content-pipeline/src/lib/writer.ts`
- Create: `packages/content-pipeline/src/__tests__/writer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/content-pipeline/src/__tests__/writer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeArticle, type WriterConfig } from "../lib/writer.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

vi.mock("node:fs/promises");
vi.mock("../lib/github.js", () => ({
  createGitHubClient: vi.fn(() => ({})),
  commitFile: vi.fn().mockResolvedValue("abc123"),
}));

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleContent = `---\ntitle: Test\n---\n\nBody`;

describe("writeArticle (local mode)", () => {
  const config: WriterConfig = {
    localNetworkPath: "/tmp/network",
    github: { token: "", repo: "" },
  };

  it("writes file to local filesystem at correct path", async () => {
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeArticle(config, "coolnews.dev", "my-slug", sampleContent);

    expect(mockFs.writeFile).toHaveBeenCalledWith(
      path.join("/tmp/network", "sites", "coolnews.dev", "articles", "my-slug.md"),
      sampleContent,
      "utf-8",
    );
  });
});

describe("writeArticle (GitHub mode)", () => {
  const config: WriterConfig = {
    localNetworkPath: undefined,
    github: { token: "token", repo: "owner/repo" },
  };

  it("commits file via GitHub API", async () => {
    const { commitFile } = await import("../lib/github.js");
    await writeArticle(config, "coolnews.dev", "my-slug", sampleContent);

    expect(commitFile).toHaveBeenCalledWith(
      expect.anything(),
      "owner/repo",
      expect.objectContaining({
        path: "sites/coolnews.dev/articles/my-slug.md",
        content: sampleContent,
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test -- --reporter=verbose src/__tests__/writer.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement writer.ts**

Create `packages/content-pipeline/src/lib/writer.ts`:

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createGitHubClient, commitFile } from "./github.js";
import type { GitHubConfig } from "./github.js";

export interface WriterConfig {
  localNetworkPath: string | undefined;
  github: GitHubConfig;
}

/**
 * Write an article markdown file to local filesystem or GitHub.
 * LOCAL_NETWORK_PATH takes priority over GitHub if both are configured.
 */
export async function writeArticle(
  config: WriterConfig,
  siteDomain: string,
  slug: string,
  content: string,
): Promise<void> {
  const filePath = `sites/${siteDomain}/articles/${slug}.md`;

  if (config.localNetworkPath) {
    const fullPath = join(config.localNetworkPath, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf-8");
    console.log(`[writer] Wrote article locally: ${fullPath}`);
    return;
  }

  const octokit = createGitHubClient(config.github);
  await commitFile(octokit, config.github.repo, {
    path: filePath,
    content,
    message: `feat(content): add article ${slug} for ${siteDomain}`,
  });
  console.log(`[writer] Committed article to GitHub: ${filePath}`);
}

/**
 * Write a binary asset (e.g. Gemini-generated image) to local filesystem or GitHub.
 */
export async function writeAsset(
  config: WriterConfig,
  siteDomain: string,
  assetPath: string,
  data: Buffer,
): Promise<void> {
  const filePath = `sites/${siteDomain}/${assetPath}`;

  if (config.localNetworkPath) {
    const fullPath = join(config.localNetworkPath, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, data);
    return;
  }

  const octokit = createGitHubClient(config.github);
  await commitFile(octokit, config.github.repo, {
    path: filePath,
    content: data.toString("base64"),
    message: `feat(assets): add generated image ${assetPath}`,
  });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test -- --reporter=verbose src/__tests__/writer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content-pipeline/src/lib/writer.ts packages/content-pipeline/src/__tests__/writer.test.ts
git commit -m "feat(content-pipeline): add article writer lib (local + GitHub modes)"
```

---

## Task 5: Prompt Builders

**Files:**
- Replace: `packages/content-pipeline/src/agents/content-generation/prompts.ts`
- Create: `packages/content-pipeline/src/__tests__/prompts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/content-pipeline/src/__tests__/prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserPrompt } from "../agents/content-generation/prompts.js";
import type { SiteBrief } from "@atomic-platform/shared-types";
import type { RssItem, ParsedContent } from "../agents/content-generation/rss.js";

const mockBrief: SiteBrief = {
  audience: "Tech-savvy millennials",
  tone: "Conversational and informative",
  article_types: { listicle: 40, standard: 30 },
  topics: ["AI", "gadgets"],
  seo_keywords_focus: ["tech news 2026"],
  content_guidelines: ["Lead with a compelling hook", "Include one statistic"],
  review_percentage: 5,
  schedule: { articles_per_week: 3, preferred_days: ["Monday"], preferred_time: "10:00" },
};

const mockRssItem: RssItem = {
  title: "Snake Found in Bedroom",
  link: "https://example.com/snake-article",
  pubDate: "Wed, 25 Mar 2026 10:00:00 GMT",
  htmlContent: "<p>A snake was found.</p>",
  enclosureUrl: undefined,
};

const mockParsedContent: ParsedContent = {
  textBody: "A snake was found in a bedroom.",
  featuredImageUrl: "https://img.com/snake.jpg",
  inlineImages: [{ src: "https://img.com/removal.jpg", alt: "Removal" }],
  youtubeEmbeds: ['<iframe src="https://www.youtube.com/embed/abc"></iframe>'],
};

describe("buildSystemPrompt", () => {
  it("includes site name and tone", () => {
    const prompt = buildSystemPrompt("CoolNews", mockBrief);
    expect(prompt).toContain("CoolNews");
    expect(prompt).toContain("Conversational and informative");
  });

  it("includes audience and content guidelines", () => {
    const prompt = buildSystemPrompt("CoolNews", mockBrief);
    expect(prompt).toContain("Tech-savvy millennials");
    expect(prompt).toContain("Lead with a compelling hook");
  });

  it("instructs Claude to respond with JSON", () => {
    const prompt = buildSystemPrompt("CoolNews", mockBrief);
    expect(prompt).toContain("JSON");
  });
});

describe("buildUserPrompt", () => {
  it("includes the source article title and text body", () => {
    const prompt = buildUserPrompt(mockRssItem, mockParsedContent);
    expect(prompt).toContain("Snake Found in Bedroom");
    expect(prompt).toContain("A snake was found in a bedroom.");
  });

  it("includes YouTube embed placeholder", () => {
    const prompt = buildUserPrompt(mockRssItem, mockParsedContent);
    expect(prompt).toContain("youtube.com/embed/abc");
  });

  it("includes inline image info", () => {
    const prompt = buildUserPrompt(mockRssItem, mockParsedContent);
    expect(prompt).toContain("https://img.com/removal.jpg");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test -- --reporter=verbose src/__tests__/prompts.test.ts
```

Expected: FAIL

- [ ] **Step 3: Implement prompts.ts**

Replace `packages/content-pipeline/src/agents/content-generation/prompts.ts`:

```typescript
/**
 * Prompt builders for content generation from RSS sources.
 */

import type { SiteBrief } from "@atomic-platform/shared-types";
import type { RssItem, ParsedContent } from "./rss.js";

export interface GeneratedArticle {
  title: string;
  slug: string;
  description: string;
  type: string;
  tags: string[];
  body: string;
}

/**
 * Build the system prompt instructing Claude on the site's voice and output format.
 */
export function buildSystemPrompt(siteName: string, brief: SiteBrief): string {
  // content_guidelines can be string or string[] depending on YAML source
  const guidelines = Array.isArray(brief.content_guidelines)
    ? (brief.content_guidelines as string[]).map((g) => `- ${g}`).join("\n")
    : `- ${brief.content_guidelines}`;

  return `You are a content writer for ${siteName}, a website focused on technology news and trends.

## Site Voice
- Tone: ${brief.tone}
- Audience: ${brief.audience}
- Topics: ${brief.topics.join(", ")}
- SEO focus keywords: ${brief.seo_keywords_focus.join(", ")}

## Editorial Guidelines
${guidelines}

## Task
You will receive a source article. Rewrite it for ${siteName}'s audience in the site's voice.
Do NOT copy text verbatim — rewrite meaningfully while preserving all facts.
Preserve all media (images and YouTube embeds) from the source — include them in the body at natural positions.

## Output Format
Respond ONLY with a valid JSON object (no markdown fences). Schema:
{
  "title": "string — compelling headline for the site",
  "slug": "string — URL-safe kebab-case slug (lowercase, hyphens only)",
  "description": "string — 1-2 sentence SEO meta description",
  "type": "string — one of: listicle, how-to, review, standard",
  "tags": ["string", ...],
  "body": "string — full article body in markdown, with images as ![alt](url) and YouTube embeds as <div class=\\"embed-block embed-object\\"><iframe ...></iframe></div>"
}`;
}

/**
 * Build the user prompt with the source article content and media inventory.
 */
export function buildUserPrompt(item: RssItem, parsed: ParsedContent): string {
  const mediaSection = buildMediaSection(parsed);

  return `## Source Article

Title: ${item.title}
URL: ${item.link}

## Content
${parsed.textBody}

${mediaSection}

Rewrite this article for the site. Include all media at appropriate positions in the body.`;
}

function buildMediaSection(parsed: ParsedContent): string {
  const parts: string[] = ["## Media to Include"];

  if (parsed.featuredImageUrl) {
    parts.push(`Featured image: ${parsed.featuredImageUrl}`);
  }

  if (parsed.inlineImages.length > 0) {
    parts.push("Inline images:");
    parsed.inlineImages.forEach((img) => {
      parts.push(`  - ![${img.alt}](${img.src})`);
    });
  }

  if (parsed.youtubeEmbeds.length > 0) {
    parts.push("YouTube embeds (include in body wrapped in embed-block div):");
    parsed.youtubeEmbeds.forEach((embed) => {
      parts.push(`  ${embed}`);
    });
  }

  if (parts.length === 1) {
    return ""; // No media
  }

  return parts.join("\n");
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test -- --reporter=verbose src/__tests__/prompts.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/content-pipeline/src/agents/content-generation/prompts.ts packages/content-pipeline/src/__tests__/prompts.test.ts
git commit -m "feat(content-pipeline): implement content generation prompt builders"
```

---

## Task 6: Agent Core

**Files:**
- Create: `packages/content-pipeline/src/agents/content-generation/agent.ts`
- Create: `packages/content-pipeline/src/__tests__/agent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/content-pipeline/src/__tests__/agent.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runContentGeneration } from "../agents/content-generation/agent.js";
import type { AgentConfig } from "../lib/config.js";

// Mock all external dependencies
vi.mock("../agents/content-generation/rss.js", () => ({
  fetchRss: vi.fn().mockResolvedValue("<rss/>"),
  parseRssFeed: vi.fn().mockReturnValue({
    title: "Test Article",
    link: "https://example.com/test",
    pubDate: "Wed, 25 Mar 2026 10:00:00 GMT",
    htmlContent: "<p>Content</p><img src='https://img.com/hero.jpg' />",
    enclosureUrl: undefined,
  }),
  parseHtmlContent: vi.fn().mockReturnValue({
    textBody: "Article content here.",
    featuredImageUrl: "https://img.com/hero.jpg",
    inlineImages: [],
    youtubeEmbeds: [],
  }),
}));

vi.mock("../lib/site-brief.js", () => ({
  readSiteBrief: vi.fn().mockResolvedValue({
    domain: "coolnews.dev",
    siteName: "CoolNews",
    group: "premium-ads",
    brief: {
      audience: "Tech readers",
      tone: "Conversational",
      article_types: { standard: 100 },
      topics: ["AI"],
      seo_keywords_focus: ["tech"],
      content_guidelines: ["Be clear"],
      review_percentage: 0,
      schedule: { articles_per_week: 3, preferred_days: [], preferred_time: "10:00" },
    },
  }),
}));

vi.mock("../lib/ai.js", () => ({
  createAIClient: vi.fn(() => ({})),
  generateContent: vi.fn().mockResolvedValue(
    JSON.stringify({
      title: "Generated Title",
      slug: "generated-title",
      description: "A description.",
      type: "standard",
      tags: ["AI", "tech"],
      body: "Generated article body.",
    }),
  ),
}));

vi.mock("../lib/writer.js", () => ({
  writeArticle: vi.fn().mockResolvedValue(undefined),
  writeAsset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/gemini.js", () => ({
  generateImageWithGemini: vi.fn().mockResolvedValue(null),
}));

// Mock duplicate check — no existing articles
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const config: AgentConfig = {
  github: { token: "token", repo: "owner/repo" },
  ai: { apiKey: "sk-test" },
  networkRepo: "owner/repo",
  localNetworkPath: "/tmp/network",
  geminiApiKey: undefined,
  port: 3001,
  notifications: {},
};

describe("runContentGeneration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns created status with slug and path", async () => {
    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev", rssUrl: "https://rss.example.com/feed.xml" },
      config,
    );

    expect(result.status).toBe("created");
    expect(result.slug).toBe("generated-title");
    expect(result.path).toContain("coolnews.dev/articles/generated-title.md");
  });

  it("returns skipped when source_url already exists", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    vi.mocked(readdir).mockResolvedValueOnce(["existing.md"] as unknown as string[]);
    vi.mocked(readFile).mockResolvedValueOnce(
      `---\nsource_url: https://example.com/test\n---\nBody`,
    );

    const result = await runContentGeneration(
      { siteDomain: "coolnews.dev", rssUrl: "https://rss.example.com/feed.xml" },
      config,
    );

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("already exists");
  });

  it("sets status to published when review_percentage is 0", async () => {
    const { writeArticle } = await import("../lib/writer.js");

    await runContentGeneration(
      { siteDomain: "coolnews.dev", rssUrl: "https://rss.example.com/feed.xml" },
      config,
    );

    const writtenContent = vi.mocked(writeArticle).mock.calls[0]?.[3] ?? "";
    expect(writtenContent).toContain("status: published");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pnpm test -- --reporter=verbose src/__tests__/agent.test.ts
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement agent.ts**

Create `packages/content-pipeline/src/agents/content-generation/agent.ts`:

```typescript
import * as path from "node:path";
import * as fs from "node:fs/promises";
import matter from "gray-matter";
import { fetchRss, parseRssFeed, parseHtmlContent } from "./rss.js";
import { buildSystemPrompt, buildUserPrompt, type GeneratedArticle } from "./prompts.js";
import { createAIClient, generateContent } from "../../lib/ai.js";
import { createGitHubClient } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import { generateImageWithGemini } from "../../lib/gemini.js";
import { writeArticle, writeAsset } from "../../lib/writer.js";
import type { AgentConfig } from "../../lib/config.js";
import type { ArticleFrontmatter, ArticleType } from "@atomic-platform/shared-types";

const VALID_ARTICLE_TYPES: ArticleType[] = ["listicle", "how-to", "review", "standard"];

export interface ContentGenerationParams {
  siteDomain: string;
  rssUrl: string;
}

export interface ContentGenerationResult {
  status: "created" | "skipped" | "error";
  slug?: string;
  path?: string;
  reason?: string;
  message?: string;
}

/**
 * Extended frontmatter with RSS tracking field.
 */
interface ArticleFrontmatterWithSource extends ArticleFrontmatter {
  source_url?: string;
}

/**
 * Run the content generation agent.
 */
export async function runContentGeneration(
  params: ContentGenerationParams,
  config: AgentConfig,
): Promise<ContentGenerationResult> {
  const { siteDomain, rssUrl } = params;

  // Step 1: Fetch and parse RSS
  const xml = await fetchRss(rssUrl);
  const rssItem = parseRssFeed(xml);

  // Step 2: Parse HTML content
  const parsed = parseHtmlContent(rssItem.htmlContent, rssItem.enclosureUrl);

  // Step 3: Read site brief
  let siteBriefData;
  if (config.localNetworkPath) {
    const { parse: parseYaml } = await import("yaml");
    const yamlContent = await fs.readFile(
      path.join(config.localNetworkPath, `sites/${siteDomain}/site.yaml`),
      "utf-8",
    );
    const siteConfig = parseYaml(yamlContent) as { brief: typeof siteBriefData extends { brief: infer B } ? B : never; site_name: string; group: string; domain: string };
    siteBriefData = {
      domain: siteDomain,
      siteName: siteConfig.site_name,
      group: siteConfig.group,
      brief: (siteConfig as Record<string, unknown>)["brief"] as (typeof siteBriefData)["brief"],
    };
  } else {
    const octokit = createGitHubClient(config.github);
    siteBriefData = await readSiteBrief(octokit, config.networkRepo, siteDomain);
  }

  if (!siteBriefData?.brief) {
    return { status: "error", message: `Site ${siteDomain} has no content brief` };
  }

  // Step 4: Duplicate check
  const isDuplicate = await checkDuplicate(config, siteDomain, rssItem.link);
  if (isDuplicate) {
    return { status: "skipped", reason: "already exists" };
  }

  // Step 5: Generate article via Claude
  const aiClient = createAIClient(config.ai);
  const systemPrompt = buildSystemPrompt(siteBriefData.siteName, siteBriefData.brief);
  const userPrompt = buildUserPrompt(rssItem, parsed);

  const rawResponse = await generateContent(aiClient, {
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
  });

  const generated = parseClaudeResponse(rawResponse);

  // Step 6: Resolve slug
  const slug = await resolveUniqueSlug(config, siteDomain, generated.slug);

  // Step 7: Handle featured image
  let featuredImage = parsed.featuredImageUrl ?? undefined;
  if (!featuredImage && config.geminiApiKey) {
    const imagePrompt = `High-quality editorial photo for a tech article titled: "${generated.title}"`;
    const imageBuffer = await generateImageWithGemini(config.geminiApiKey, imagePrompt);
    if (imageBuffer) {
      const assetPath = `assets/images/${slug}.png`;
      await writeAsset(config as Parameters<typeof writeAsset>[0], siteDomain, assetPath, imageBuffer);
      featuredImage = `/assets/images/${slug}.png`;
    }
  }

  // Step 8: Build frontmatter
  const random = Math.floor(Math.random() * 100);
  const reviewPct = siteBriefData.brief.review_percentage ?? 0;
  const status = random < reviewPct ? "review" : "published";

  const frontmatter: ArticleFrontmatterWithSource = {
    title: generated.title,
    slug,
    description: generated.description,
    type: VALID_ARTICLE_TYPES.includes(generated.type as ArticleType)
      ? (generated.type as ArticleType)
      : "standard",
    status,
    author: "Editorial Team",
    publishDate: new Date().toISOString().slice(0, 10),
    tags: generated.tags.length > 0 ? generated.tags : siteBriefData.brief.topics.slice(0, 2),
    reviewer_notes: "",
    source_url: rssItem.link,
    ...(featuredImage ? { featuredImage } : {}),
  };

  // Step 9: Serialize to markdown
  const fileContent = matter.stringify(generated.body, frontmatter);
  const filePath = `sites/${siteDomain}/articles/${slug}.md`;

  // Step 10: Write article
  const writerConfig = {
    localNetworkPath: config.localNetworkPath,
    github: config.github,
  };
  await writeArticle(writerConfig, siteDomain, slug, fileContent);

  return { status: "created", slug, path: filePath };
}

/**
 * Check if an article with the same source_url already exists.
 */
async function checkDuplicate(
  config: AgentConfig,
  siteDomain: string,
  sourceUrl: string,
): Promise<boolean> {
  try {
    let files: string[];

    if (config.localNetworkPath) {
      const articlesDir = path.join(config.localNetworkPath, `sites/${siteDomain}/articles`);
      files = (await fs.readdir(articlesDir)).filter((f) => f.endsWith(".md"));
    } else {
      const { listFiles } = await import("../../lib/github.js");
      const octokit = createGitHubClient(config.github);
      const allFiles = await listFiles(octokit, config.networkRepo, `sites/${siteDomain}/articles`);
      files = allFiles.filter((f) => f.endsWith(".md"));
    }

    for (const file of files) {
      try {
        let content: string;
        if (config.localNetworkPath) {
          content = await fs.readFile(
            path.join(config.localNetworkPath, `sites/${siteDomain}/articles/${file}`),
            "utf-8",
          );
        } else {
          const { readFile } = await import("../../lib/github.js");
          const octokit = createGitHubClient(config.github);
          content = await readFile(octokit, config.networkRepo, `sites/${siteDomain}/articles/${file}`);
        }

        const parsed = matter(content);
        if (parsed.data["source_url"] === sourceUrl) {
          return true;
        }
      } catch {
        // Skip unparseable files
      }
    }
  } catch {
    // Articles dir doesn't exist yet — no duplicates
  }

  return false;
}

/**
 * Ensure slug is unique by appending -2, -3, etc. if needed.
 */
async function resolveUniqueSlug(
  config: AgentConfig,
  siteDomain: string,
  baseSlug: string,
): Promise<string> {
  let slug = baseSlug;
  let counter = 2;

  while (await articleExists(config, siteDomain, slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

async function articleExists(
  config: AgentConfig,
  siteDomain: string,
  slug: string,
): Promise<boolean> {
  try {
    if (config.localNetworkPath) {
      await fs.readFile(
        path.join(config.localNetworkPath, `sites/${siteDomain}/articles/${slug}.md`),
      );
      return true;
    } else {
      const { readFile } = await import("../../lib/github.js");
      const octokit = createGitHubClient(config.github);
      await readFile(octokit, config.networkRepo, `sites/${siteDomain}/articles/${slug}.md`);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Parse Claude's JSON response into a GeneratedArticle.
 * Claude is instructed to return pure JSON — strip any accidental fences.
 */
function parseClaudeResponse(raw: string): GeneratedArticle {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned) as GeneratedArticle;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pnpm test -- --reporter=verbose src/__tests__/agent.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/content-pipeline/src/agents/content-generation/agent.ts packages/content-pipeline/src/__tests__/agent.test.ts
git commit -m "feat(content-pipeline): implement content generation agent core"
```

---

## Task 7: HTTP Server

**Files:**
- Replace: `packages/content-pipeline/src/agents/content-generation/index.ts`

No unit tests — this is a thin transport layer. Verified via Postman.

- [ ] **Step 1: Implement index.ts**

Replace `packages/content-pipeline/src/agents/content-generation/index.ts`:

```typescript
/**
 * Content Generation Agent — HTTP Server
 *
 * Listens for POST /content-generate requests and runs the content generation agent.
 *
 * Usage:
 *   pnpm agent:content-generation
 *
 * Then POST to http://localhost:3001/content-generate:
 *   { "siteDomain": "coolnews.dev", "rssUrl": "https://rss.app/feeds/..." }
 */

import * as http from "node:http";
import "dotenv/config";
import { loadConfig } from "../../lib/config.js";
import { runContentGeneration } from "./agent.js";

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ReturnType<typeof loadConfig>,
): Promise<void> {
  if (req.method !== "POST" || req.url !== "/content-generate") {
    sendJson(res, 404, { status: "error", message: "Not found. Use POST /content-generate" });
    return;
  }

  // Read request body
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  await new Promise<void>((resolve) => req.on("end", resolve));

  let payload: { siteDomain?: unknown; rssUrl?: unknown };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    sendJson(res, 400, { status: "error", message: "Invalid JSON body" });
    return;
  }

  // Validate
  const { siteDomain, rssUrl } = payload;
  if (!siteDomain || typeof siteDomain !== "string") {
    sendJson(res, 400, { status: "error", message: "siteDomain is required (string)" });
    return;
  }
  if (!rssUrl || typeof rssUrl !== "string" || !isValidUrl(rssUrl)) {
    sendJson(res, 400, { status: "error", message: "rssUrl is required and must be a valid HTTP/HTTPS URL" });
    return;
  }

  console.log(`[server] POST /content-generate — site: ${siteDomain}, rss: ${rssUrl}`);

  try {
    const result = await runContentGeneration({ siteDomain, rssUrl }, config);

    if (result.status === "created") {
      sendJson(res, 201, result);
    } else if (result.status === "skipped") {
      sendJson(res, 200, result);
    } else {
      sendJson(res, 400, result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[server] Agent error:", message);
    sendJson(res, 502, { status: "error", message });
  }
}

// Load config at startup — fails fast if env is misconfigured
let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig();
} catch (err) {
  console.error("[server] Configuration error:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res, config).catch((err) => {
    console.error("[server] Unhandled error:", err);
    sendJson(res, 502, { status: "error", message: "Internal server error" });
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${config.port} is already in use`);
  } else {
    console.error("[server] Server error:", err.message);
  }
  process.exit(1);
});

server.listen(config.port, () => {
  console.log(`[server] Content generation agent running on http://localhost:${config.port}`);
  console.log(`[server] POST http://localhost:${config.port}/content-generate`);
  console.log(`[server] Write mode: ${config.localNetworkPath ? `local (${config.localNetworkPath})` : "GitHub API"}`);
});
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/content-pipeline
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Run the server**

```bash
cd packages/content-pipeline
pnpm agent:content-generation
```

Expected output:
```
[server] Content generation agent running on http://localhost:3001
[server] POST http://localhost:3001/content-generate
[server] Write mode: local (/path/to/atomic-labs-network)
```

- [ ] **Step 4: Test via Postman**

Send:
```
POST http://localhost:3001/content-generate
Content-Type: application/json

{
  "siteDomain": "coolnews.dev",
  "rssUrl": "https://rss.app/feeds/_F25xcSWf0J1m3Nmz.xml"
}
```

Expected response (201):
```json
{
  "status": "created",
  "slug": "some-article-slug",
  "path": "sites/coolnews.dev/articles/some-article-slug.md"
}
```

- [ ] **Step 5: Verify article appears in Astro dev server**

1. Open a new terminal
2. Run: `cd packages/site-builder && SITE_DOMAIN=coolnews.dev NETWORK_DATA_PATH=~/Documents/ATL-content-network/atomic-labs-network pnpm dev`
3. Visit `http://localhost:4321`
4. Confirm new article appears with correct title, body, featured image, and any video embeds

- [ ] **Step 6: Send duplicate request — verify skipped**

Send the same Postman request again.

Expected response (200):
```json
{
  "status": "skipped",
  "reason": "already exists"
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/content-pipeline/src/agents/content-generation/index.ts
git commit -m "feat(content-pipeline): implement content generation HTTP server"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
cd packages/content-pipeline
pnpm test
```

Expected: all tests pass.

- [ ] **Run typecheck on all packages**

```bash
cd ../.. && pnpm typecheck
```

Expected: no errors across all packages.

- [ ] **Final commit tag**

```bash
git add -p  # review any remaining unstaged changes
git commit -m "feat(content-pipeline): content generation agent complete"
```
