"use server";

import { readDashboardIndex, readFileContent, commitSiteFiles, invalidateSiteCaches } from "@/lib/github";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import { revalidatePath } from "next/cache";
import { upsertSiteConfig } from "@/lib/db/site-configs";

interface BriefUpdate {
  audience: string;
  tone: string;
  topics: string[];
  articles_per_day: number;
  preferred_days: string[];
  content_guidelines: string[];
}

/** Update the content brief in a site's site.yaml. */
export async function updateSiteBrief(
  domain: string,
  updates: BriefUpdate
): Promise<void> {
  const path = `sites/${domain}/site.yaml`;

  // Determine the correct branch (staging sites have files only on their staging branch)
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  const branch = site?.staging_branch ?? undefined;

  // Read current site.yaml from the correct branch
  const yamlContent = await readFileContent(path, branch);
  if (!yamlContent) {
    throw new Error(`site.yaml not found for ${domain}`);
  }
  const config = parseYaml(yamlContent) as Record<string, unknown>;

  // Update brief fields
  const brief = (config.brief as Record<string, unknown>) ?? {};
  brief.audience = updates.audience;
  brief.tone = updates.tone;
  brief.topics = updates.topics;
  brief.content_guidelines = updates.content_guidelines;

  const schedule = (brief.schedule as Record<string, unknown>) ?? {};
  schedule.articles_per_day = updates.articles_per_day;
  schedule.preferred_days = updates.preferred_days;
  // Drop the legacy field if present — dual-read falls back to articles_per_day.
  delete schedule.articles_per_week;
  brief.schedule = schedule;
  config.brief = brief;

  // Write back to the correct branch
  const newContent = stringifyYaml(config, { lineWidth: 0 });
  await commitSiteFiles(
    domain,
    [{ path, content: newContent }],
    `update content brief`,
    branch ?? "main",
  );

  // Dual-write: mirror updated config to MongoDB (soft-fail)
  await upsertSiteConfig(domain, config);

  invalidateSiteCaches(domain, branch);
  revalidatePath(`/sites/${domain}`);
}
