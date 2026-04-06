"use server";

import {
  readDashboardIndex,
  readArticles,
  readFileContent,
  commitSiteFiles,
  deleteFilesFromBranch,
  triggerWorkflowViaPush,
  mergeBranchToMain,
} from "@/lib/github";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { revalidatePath } from "next/cache";
import type { ArticleEntry } from "@/types/dashboard";

/**
 * Fetch all articles flagged for review across all sites.
 */
export interface ReviewArticle extends ArticleEntry {
  domain: string;
  /** Staging preview base URL (e.g., "https://staging-mysite.mysite.pages.dev") */
  stagingBaseUrl: string | null;
  /** Git branch where the article lives */
  branch: string | null;
}

export async function getReviewQueue(): Promise<ReviewArticle[]> {
  const index = await readDashboardIndex();

  const reviewArticles: ReviewArticle[] = [];

  for (const site of index.sites) {
    const branch = site.staging_branch ?? undefined;
    const stagingBaseUrl = site.preview_url ?? null;

    const articles = await readArticles(site.domain, branch);
    for (const article of articles) {
      if (article.status !== "review") continue;
      reviewArticles.push({
        ...article,
        domain: site.domain,
        stagingBaseUrl,
        branch: site.staging_branch ?? null,
      });
    }
  }

  return reviewArticles;
}

/**
 * Apply all review decisions in one batch.
 *
 * Per domain:
 * 1. ONE commitSiteFiles() for all approved articles (Git Data API — no webhook)
 * 2. ONE deleteFilesFromBranch() for all rejected articles (Git Data API — no webhook)
 * 3. ONE triggerWorkflowViaPush() to fire Cloudflare build
 * 4. If site is Live/Ready → merge staging to main
 */
export async function applyReviewDecisions(decisions: {
  approved: Array<{ domain: string; slug: string }>;
  rejected: Array<{ domain: string; slug: string }>;
}): Promise<{ summary: string }> {
  const index = await readDashboardIndex();

  // Group all decisions by domain
  const byDomain = new Map<string, { approved: string[]; rejected: string[] }>();

  for (const { domain, slug } of decisions.approved) {
    const entry = byDomain.get(domain) ?? { approved: [], rejected: [] };
    entry.approved.push(slug);
    byDomain.set(domain, entry);
  }
  for (const { domain, slug } of decisions.rejected) {
    const entry = byDomain.get(domain) ?? { approved: [], rejected: [] };
    entry.rejected.push(slug);
    byDomain.set(domain, entry);
  }

  const summaryParts: string[] = [];

  for (const [domain, { approved, rejected }] of byDomain) {
    const site = index.sites.find((s) => s.domain === domain);
    const branch = site?.staging_branch ?? "main";

    // 1. Update approved articles' frontmatter → status: published
    if (approved.length > 0) {
      const fileUpdates: Array<{ path: string; content: string }> = [];

      for (const slug of approved) {
        const path = `sites/${domain}/articles/${slug}.md`;
        const content = await readFileContent(path, branch);
        if (!content) continue;

        const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!fmMatch) continue;

        const frontmatter = parseYaml(fmMatch[1]!) as Record<string, unknown>;
        const body = fmMatch[2] ?? "";

        frontmatter.status = "published";
        frontmatter.reviewer_notes = "Approved via review queue.";

        const newFm = stringifyYaml(frontmatter, { lineWidth: 0 });
        fileUpdates.push({ path, content: `---\n${newFm}---\n${body}` });
      }

      if (fileUpdates.length > 0) {
        await commitSiteFiles(
          domain,
          fileUpdates,
          `review: approve ${fileUpdates.length} article${fileUpdates.length > 1 ? "s" : ""}`,
          branch,
        );
      }
    }

    // 2. Delete rejected articles
    if (rejected.length > 0) {
      const filePaths = rejected.map((slug) => `sites/${domain}/articles/${slug}.md`);
      await deleteFilesFromBranch(filePaths, branch);
    }

    // 3. ONE build trigger per domain
    if (site?.staging_branch) {
      await triggerWorkflowViaPush(site.staging_branch, domain);
    }

    // 4. If site is Live or Ready → merge staging to main
    if (site?.staging_branch && (site.status === "Live" || site.status === "Ready")) {
      try {
        await mergeBranchToMain(
          site.staging_branch,
          `review: merge ${domain} staging → main (${approved.length} approved, ${rejected.length} rejected)`,
        );
      } catch {
        // Merge may fail if branches diverged — non-fatal
      }
    }

    const parts: string[] = [];
    if (approved.length > 0) parts.push(`${approved.length} approved`);
    if (rejected.length > 0) parts.push(`${rejected.length} rejected`);
    summaryParts.push(`${domain}: ${parts.join(", ")}`);

    revalidatePath(`/sites/${domain}`);
  }

  revalidatePath("/review");

  return {
    summary: summaryParts.join("; "),
  };
}
