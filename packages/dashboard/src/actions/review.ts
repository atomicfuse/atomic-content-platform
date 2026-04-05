"use server";

import { readDashboardIndex } from "@/lib/github";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { revalidatePath } from "next/cache";
import {
  NETWORK_REPO_OWNER,
  NETWORK_REPO_NAME,
} from "@/lib/constants";
import { Octokit } from "@octokit/rest";
import type { ArticleEntry } from "@/types/dashboard";

/**
 * Update an article's status (approve/reject from review queue).
 */
export async function updateArticleStatus(
  domain: string,
  slug: string,
  newStatus: "published" | "review" | "draft",
  reviewerNotes?: string,
): Promise<void> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const path = `sites/${domain}/articles/${slug}.md`;

  // Determine the correct branch
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  const branch = site?.staging_branch ?? undefined;

  // Read the article
  const { data } = await octokit.repos.getContent({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path,
    ...(branch ? { ref: branch } : {}),
  });

  if (!("content" in data) || !data.content) {
    throw new Error(`Article not found: ${path}`);
  }

  const content = Buffer.from(data.content, "base64").toString("utf-8");

  // Parse frontmatter and body
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    throw new Error(`Invalid article format: ${path}`);
  }

  const frontmatter = parseYaml(fmMatch[1]!) as Record<string, unknown>;
  const body = fmMatch[2] ?? "";

  // Update status and reviewer notes
  frontmatter.status = newStatus;
  if (reviewerNotes !== undefined) {
    frontmatter.reviewer_notes = reviewerNotes;
  }

  // Rebuild the markdown
  const newFm = stringifyYaml(frontmatter, { lineWidth: 0 });
  const newContent = `---\n${newFm}---\n${body}`;

  await octokit.repos.createOrUpdateFileContents({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path,
    message: `review(${domain}): ${newStatus === "published" ? "approve" : "reject"} ${slug}`,
    content: Buffer.from(newContent).toString("base64"),
    sha: data.sha,
    ...(branch ? { branch } : {}),
  });

  revalidatePath(`/sites/${domain}`);
  revalidatePath("/review");
}

/**
 * Fetch all articles flagged for review across all sites.
 */
export interface ReviewArticle extends ArticleEntry {
  domain: string;
  /** Staging preview base URL (e.g., "https://staging-mysite.mysite.pages.dev") */
  stagingBaseUrl: string | null;
}

/**
 * Build the staging preview base URL for a site.
 * Cloudflare Pages branch deploys: https://{branch}.{project}.pages.dev
 */
function buildStagingBaseUrl(
  stagingBranch: string | null,
  pagesProject: string | null,
): string | null {
  if (!stagingBranch || !pagesProject) return null;
  // Cloudflare uses the branch name with slashes replaced by hyphens
  const branchSlug = stagingBranch.replace(/\//g, "-");
  return `https://${branchSlug}.${pagesProject}.pages.dev`;
}

export async function getReviewQueue(): Promise<ReviewArticle[]> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const index = await readDashboardIndex();
  const reviewArticles: ReviewArticle[] = [];

  for (const site of index.sites) {
    const branch = site.staging_branch ?? undefined;
    const articlesPath = `sites/${site.domain}/articles`;
    const stagingBaseUrl = buildStagingBaseUrl(
      site.staging_branch,
      site.pages_project,
    );

    try {
      const { data } = await octokit.repos.getContent({
        owner: NETWORK_REPO_OWNER,
        repo: NETWORK_REPO_NAME,
        path: articlesPath,
        ...(branch ? { ref: branch } : {}),
      });

      if (!Array.isArray(data)) continue;

      for (const file of data) {
        if (file.type !== "file" || !file.name.endsWith(".md")) continue;

        try {
          const { data: fileData } = await octokit.repos.getContent({
            owner: NETWORK_REPO_OWNER,
            repo: NETWORK_REPO_NAME,
            path: file.path,
            ...(branch ? { ref: branch } : {}),
          });

          if (!("content" in fileData) || !fileData.content) continue;

          const content = Buffer.from(fileData.content, "base64").toString("utf-8");
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (!fmMatch) continue;

          const fm = parseYaml(fmMatch[1]!) as Record<string, unknown>;

          if (fm.status !== "review") continue;

          reviewArticles.push({
            domain: site.domain,
            slug: file.name.replace(".md", ""),
            title: (fm.title as string) ?? file.name,
            type: (fm.type as string) ?? "standard",
            status: "review",
            publishDate: (fm.publishDate as string) ?? "",
            score: (fm.quality_score as number) ?? undefined,
            scoreBreakdown: fm.score_breakdown as ArticleEntry["scoreBreakdown"],
            qualityNote: fm.quality_note as string | undefined,
            reviewerNotes: fm.reviewer_notes as string | undefined,
            stagingBaseUrl,
          });
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Skip sites without articles directory
    }
  }

  return reviewArticles;
}
