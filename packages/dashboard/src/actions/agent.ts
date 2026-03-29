"use server";

import { readSiteConfig, commitSiteFiles } from "@/lib/github";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { revalidatePath } from "next/cache";
import {
  NETWORK_REPO_OWNER,
  NETWORK_REPO_NAME,
} from "@/lib/constants";
import { Octokit } from "@octokit/rest";

interface BriefUpdate {
  audience: string;
  tone: string;
  topics: string[];
  articles_per_week: number;
  preferred_days: string[];
  content_guidelines: string[];
}

/** Update the content brief in a site's site.yaml. */
export async function updateSiteBrief(
  domain: string,
  updates: BriefUpdate
): Promise<void> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const path = `sites/${domain}/site.yaml`;

  // Read current site.yaml
  const { data } = await octokit.repos.getContent({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path,
  });

  if (!("content" in data) || !data.content) {
    throw new Error(`site.yaml not found for ${domain}`);
  }

  const content = Buffer.from(data.content, "base64").toString("utf-8");
  const config = parseYaml(content) as Record<string, unknown>;

  // Update brief fields
  const brief = (config.brief as Record<string, unknown>) ?? {};
  brief.audience = updates.audience;
  brief.tone = updates.tone;
  brief.topics = updates.topics;
  brief.content_guidelines = updates.content_guidelines;

  const schedule = (brief.schedule as Record<string, unknown>) ?? {};
  schedule.articles_per_week = updates.articles_per_week;
  schedule.preferred_days = updates.preferred_days;
  brief.schedule = schedule;
  config.brief = brief;

  // Write back
  const newContent = stringifyYaml(config, { lineWidth: 0 });
  await octokit.repos.createOrUpdateFileContents({
    owner: NETWORK_REPO_OWNER,
    repo: NETWORK_REPO_NAME,
    path,
    message: `site(${domain}): update content brief`,
    content: Buffer.from(newContent).toString("base64"),
    sha: data.sha,
  });

  revalidatePath(`/sites/${domain}`);
}
