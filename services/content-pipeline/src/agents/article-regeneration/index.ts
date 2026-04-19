/**
 * Article Regeneration Agent (v2)
 *
 * Revises articles that were rejected during review, using the
 * dual-model generator pipeline.
 *
 * Flow:
 * 1. Receive rejected article path + reviewer notes
 * 2. Fetch original article from network repo
 * 3. Read site brief for context
 * 4. Route through appropriate generator (Claude for news, OpenAI for general)
 * 5. Commit updated .md with status: review
 */

import matter from "gray-matter";
import { generateContent } from "../../lib/ai.js";
import { createGitHubClient, readFile, commitFile } from "../../lib/github.js";
import { readSiteBrief } from "../../lib/site-brief.js";
import type { AgentConfig } from "../../lib/config.js";
import type { SiteBrief } from "../../types.js";
import { buildRevisionSystemPrompt, buildRevisionUserPrompt } from "./prompts.js";

export interface RegenerationParams {
  /** Path to article in network repo, e.g. "sites/coolnews.dev/articles/my-slug.md" */
  articlePath: string;
  /** Reviewer feedback / notes on what to improve. */
  reviewerNotes: string;
  /** Branch the article lives on. */
  branch?: string;
}

export interface RegenerationResult {
  status: "revised" | "error";
  articlePath: string;
  message?: string;
}

/**
 * Regenerate / revise a rejected article using the appropriate model.
 */
export async function regenerateArticle(
  params: RegenerationParams,
  config: AgentConfig,
): Promise<RegenerationResult> {
  const { articlePath, reviewerNotes, branch } = params;

  try {
    // Read original article
    const octokit = createGitHubClient(config.github);
    const raw = await readFile(octokit, config.networkRepo, articlePath, branch);
    const { data: frontmatter, content: body } = matter(raw);

    // Extract site domain from path
    const pathParts = articlePath.split("/");
    const siteDomain = pathParts[1]; // sites/<domain>/articles/<slug>.md
    if (!siteDomain) {
      throw new Error(`Could not extract domain from path: ${articlePath}`);
    }

    // Read site brief
    const { siteName, brief } = await readSiteBrief(octokit, config.networkRepo, siteDomain, branch);

    // Use Claude for revisions (accuracy-first for corrections)
    const systemPrompt = buildRevisionSystemPrompt({ siteName, brief });
    const userPrompt = buildRevisionUserPrompt({
      originalArticle: body,
      reviewerNotes,
      frontmatter,
    });

    console.log(`[regen] Revising article: ${articlePath}`);

    const rawResponse = await generateContent({
      systemPrompt,
      userPrompt,
      maxTokens: 4096,
    });

    // Parse response
    const fenceMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const cleaned = fenceMatch ? fenceMatch[1]! : rawResponse;
    const revised = JSON.parse(cleaned.trim()) as {
      title: string;
      description: string;
      body: string;
      tags: string[];
    };

    // Update frontmatter
    const updatedFrontmatter = {
      ...frontmatter,
      title: revised.title,
      description: revised.description,
      tags: revised.tags,
      status: "review",
      reviewer_notes: `Revised based on feedback: ${reviewerNotes}`,
      quality_note: "Auto-revised by regeneration agent",
    };

    const markdown = matter.stringify(revised.body, updatedFrontmatter);

    // Commit revised article
    await commitFile(octokit, config.networkRepo, {
      path: articlePath,
      content: markdown,
      message: `fix(content): revise article ${articlePath.split("/").pop()?.replace(".md", "")}`,
      branch,
    });

    console.log(`[regen] Revision committed: ${articlePath}`);

    return { status: "revised", articlePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[regen] Failed to revise ${articlePath}:`, message);
    return { status: "error", articlePath, message };
  }
}

export class ArticleRegenerationAgent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async revise(params: RegenerationParams): Promise<RegenerationResult> {
    return regenerateArticle(params, this.config);
  }
}
