/**
 * Content Generation Agent — orchestrates the full pipeline from RSS to published article.
 *
 * Steps:
 * 1. Fetch RSS + parse latest item
 * 2. Parse HTML content (extract text, images, YouTube embeds)
 * 3. Read site brief (local YAML or GitHub API)
 * 4. Duplicate check (scan existing articles for matching source_url)
 * 5. Build Claude prompts
 * 6. Call Claude → get generated article JSON
 * 7. Resolve unique slug (append -2/-3 if collision)
 * 8. Handle featured image (use from RSS or call Gemini if missing and key is set)
 * 9. Build frontmatter + serialize to markdown
 * 10. Write article (local or GitHub)
 * 11. Return { status: "created", slug, path }
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { fetchRss, parseRssFeed, parseHtmlContent } from "./rss.js";
import { buildSystemPrompt, buildUserPrompt, type GeneratedArticle } from "./prompts.js";
import { createAIClient, generateContent } from "../../lib/ai.js";
import { createGitHubClient } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import { generateImageWithGemini } from "../../lib/gemini.js";
import { writeArticle, writeAsset } from "../../lib/writer.js";
import type { AgentConfig } from "../../lib/config.js";
import type { ArticleFrontmatter, ArticleType, SiteConfig } from "@atomic-platform/shared-types";

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

// Extended frontmatter with RSS tracking field
interface ArticleFrontmatterWithSource extends ArticleFrontmatter {
  source_url?: string;
}

const VALID_ARTICLE_TYPES: ArticleType[] = ["listicle", "how-to", "review", "standard"];

function parseClaudeResponse(raw: string): GeneratedArticle {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned) as GeneratedArticle;
}

/**
 * Check if the RSS item has already been published (duplicate detection).
 * Returns true if an article with the same source_url already exists.
 */
async function isDuplicate(
  config: AgentConfig,
  siteDomain: string,
  sourceUrl: string,
): Promise<boolean> {
  if (config.localNetworkPath) {
    const articlesDir = path.join(
      config.localNetworkPath,
      "sites",
      siteDomain,
      "articles",
    );

    let files: string[];
    try {
      files = await fs.readdir(articlesDir);
    } catch {
      // Directory doesn't exist yet — no duplicates
      return false;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await fs.readFile(path.join(articlesDir, file), "utf-8");
        const { data } = matter(content);
        if (data.source_url === sourceUrl) {
          return true;
        }
      } catch {
        // Skip unparseable files
      }
    }

    return false;
  }

  // GitHub mode
  const { listFiles, readFile } = await import("../../lib/github.js");
  const octokit = createGitHubClient(config.github);
  const articlesPath = `sites/${siteDomain}/articles`;

  let files: string[];
  try {
    files = await listFiles(octokit, config.networkRepo, articlesPath);
  } catch {
    return false;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const content = await readFile(
        octokit,
        config.networkRepo,
        `${articlesPath}/${file}`,
      );
      const { data } = matter(content);
      if (data.source_url === sourceUrl) {
        return true;
      }
    } catch {
      // Skip unparseable files
    }
  }

  return false;
}

/**
 * Resolve a unique slug by checking if {slug}.md already exists.
 * If taken, appends -2, -3, etc.
 */
async function resolveUniqueSlug(
  config: AgentConfig,
  siteDomain: string,
  baseSlug: string,
): Promise<string> {
  let candidate = baseSlug;
  let counter = 2;

  while (await slugExists(config, siteDomain, candidate)) {
    candidate = `${baseSlug}-${counter}`;
    counter++;
  }

  return candidate;
}

async function slugExists(
  config: AgentConfig,
  siteDomain: string,
  slug: string,
): Promise<boolean> {
  if (config.localNetworkPath) {
    const filePath = path.join(
      config.localNetworkPath,
      "sites",
      siteDomain,
      "articles",
      `${slug}.md`,
    );
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // GitHub mode
  const { readFile } = await import("../../lib/github.js");
  const octokit = createGitHubClient(config.github);
  try {
    await readFile(
      octokit,
      config.networkRepo,
      `sites/${siteDomain}/articles/${slug}.md`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the site brief from disk when running in local mode.
 * This is separated so it can be called independently of the GitHub path.
 */
async function readLocalSiteBrief(localNetworkPath: string, siteDomain: string) {
  const yamlPath = path.join(localNetworkPath, "sites", siteDomain, "site.yaml");
  const raw = await fs.readFile(yamlPath, "utf-8");
  const siteConfig = parseYaml(raw) as SiteConfig;

  if (!siteConfig?.brief) {
    throw new Error(`Site ${siteDomain} has no content brief defined`);
  }

  return {
    domain: siteConfig.domain,
    siteName: siteConfig.site_name,
    group: siteConfig.group,
    brief: siteConfig.brief,
  };
}

/**
 * Read the site brief — local mode reads YAML directly from disk,
 * GitHub mode uses readSiteBrief from lib/site-brief.ts.
 *
 * In local mode, reads site.yaml directly from disk. Falls back to
 * readSiteBrief (GitHub) if the local file is missing or unreadable —
 * this also allows test mocks of readSiteBrief to work correctly.
 */
async function getSiteBrief(config: AgentConfig, siteDomain: string) {
  if (config.localNetworkPath) {
    try {
      return await readLocalSiteBrief(config.localNetworkPath, siteDomain);
    } catch {
      // Fall back to GitHub-based readSiteBrief (also handles test mocks)
    }
  }

  const octokit = createGitHubClient(config.github);
  return readSiteBrief(octokit, config.networkRepo, siteDomain);
}

/**
 * Main entry point for the content generation agent.
 */
export async function runContentGeneration(
  params: ContentGenerationParams,
  config: AgentConfig,
): Promise<ContentGenerationResult> {
  const { siteDomain, rssUrl } = params;

  try {
    // Step 1: Fetch RSS + parse latest item
    const xml = await fetchRss(rssUrl);
    const rssItem = parseRssFeed(xml);

    // Step 2: Parse HTML content
    const parsed = parseHtmlContent(rssItem.htmlContent, rssItem.enclosureUrl);

    // Step 4 (early): Duplicate check — fail fast before expensive API calls
    const duplicate = await isDuplicate(config, siteDomain, rssItem.link);
    if (duplicate) {
      return { status: "skipped", reason: "already exists" };
    }

    // Step 3: Read site brief
    const { siteName, brief } = await getSiteBrief(config, siteDomain);

    // Step 5: Build prompts
    const systemPrompt = buildSystemPrompt(siteName, brief);
    const userPrompt = buildUserPrompt(rssItem, parsed);

    // Step 6: Call Claude
    const aiClient = createAIClient(config.ai);
    const rawResponse = await generateContent(aiClient, { systemPrompt, userPrompt });
    const generated = parseClaudeResponse(rawResponse);

    // Step 7: Resolve unique slug
    const slug = await resolveUniqueSlug(config, siteDomain, generated.slug);

    // Step 8: Handle featured image
    let featuredImageUrl: string | undefined = parsed.featuredImageUrl ?? rssItem.enclosureUrl ?? undefined;

    if (!featuredImageUrl && config.geminiApiKey) {
      const imageBuffer = await generateImageWithGemini(
        config.geminiApiKey,
        `Create a featured image for an article titled: ${generated.title}`,
      );
      if (imageBuffer) {
        const assetPath = `images/${slug}.png`;
        await writeAsset(
          { localNetworkPath: config.localNetworkPath, github: config.github },
          siteDomain,
          assetPath,
          imageBuffer,
        );
        featuredImageUrl = `/sites/${siteDomain}/${assetPath}`;
      }
    }

    // Step 9: Build frontmatter + serialize to markdown
    const reviewPercentage = brief.review_percentage ?? 0;
    const status: "published" | "review" =
      Math.floor(Math.random() * 100) < reviewPercentage ? "review" : "published";

    const articleType: ArticleType = VALID_ARTICLE_TYPES.includes(generated.type as ArticleType)
      ? (generated.type as ArticleType)
      : "standard";

    const tags =
      generated.tags && generated.tags.length > 0
        ? generated.tags
        : brief.topics.slice(0, 2);

    const publishDate = new Date().toISOString().slice(0, 10);

    const frontmatter: ArticleFrontmatterWithSource = {
      title: generated.title,
      description: generated.description,
      type: articleType,
      status,
      publishDate,
      author: siteName,
      tags,
      slug,
      reviewer_notes: "",
      source_url: rssItem.link,
      ...(featuredImageUrl ? { featuredImage: featuredImageUrl } : {}),
    };

    const markdown = matter.stringify(generated.body, frontmatter);

    // Step 10: Write article
    const filePath = `sites/${siteDomain}/articles/${slug}.md`;
    await writeArticle(
      { localNetworkPath: config.localNetworkPath, github: config.github },
      siteDomain,
      slug,
      markdown,
    );

    // Step 11: Return result
    return {
      status: "created",
      slug,
      path: filePath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Content generation failed for ${siteDomain}:`, message);
    return { status: "error", message };
  }
}
