"use server";

import { stringify as stringifyYaml } from "yaml";
import { commitSiteFiles, readDashboardIndex, writeDashboardIndex, updateSiteInIndex } from "@/lib/github";
import { triggerPagesBuild } from "@/lib/cloudflare";
import type { WizardFormData } from "@/types/dashboard";
import { revalidatePath } from "next/cache";

interface StagingResult {
  stagingUrl: string;
}

/** Create site files in the network repo and trigger staging build. */
export async function createSiteAndBuildStaging(
  data: WizardFormData
): Promise<StagingResult> {
  // 1. Build site.yaml content
  const siteConfig = {
    domain: data.domain,
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    group: "premium-ads",
    active: true,
    brief: {
      audience: data.audience,
      tone: data.tone,
      article_types: {
        listicle: 40,
        standard: 30,
        "how-to": 20,
        review: 10,
      },
      topics: data.topics,
      seo_keywords_focus: [],
      content_guidelines: data.contentGuidelines
        ? data.contentGuidelines.split("\n").filter(Boolean)
        : [],
      review_percentage: 5,
      schedule: {
        articles_per_week: data.articlesPerWeek,
        preferred_days: data.preferredDays,
        preferred_time: "10:00",
      },
    },
    theme: {
      base: data.themeBase,
    },
  };

  // 2. Build skill.md content
  const skillContent = `# Content Agent Instructions for ${data.siteName}

## Target Audience
${data.audience}

## Tone
${data.tone}

## Topics
${data.topics.map((t) => `- ${t}`).join("\n")}

## Content Guidelines
${data.contentGuidelines || "Follow standard editorial guidelines."}

## Schedule
- ${data.articlesPerWeek} articles per week
- Preferred days: ${data.preferredDays.join(", ")}
`;

  // 3. Commit files to network repo
  const files = [
    {
      path: `sites/${data.domain}/site.yaml`,
      content: stringifyYaml(siteConfig, { lineWidth: 0 }),
    },
    {
      path: `sites/${data.domain}/skill.md`,
      content: skillContent,
    },
    {
      path: `sites/${data.domain}/assets/.gitkeep`,
      content: "",
    },
    {
      path: `sites/${data.domain}/articles/.gitkeep`,
      content: "",
    },
  ];

  await commitSiteFiles(data.domain, files, "create site");

  // 4. Update dashboard index status to Preview
  await updateSiteInIndex(data.domain, {
    status: "Preview",
    company: data.company,
    vertical: data.vertical,
  });

  // 5. Trigger Cloudflare Pages staging build
  const domainSlug = data.domain.replace(/\./g, "-");
  let stagingUrl = `https://staging-${domainSlug}.pages.dev`;

  try {
    const build = await triggerPagesBuild(`${domainSlug}-dev`);
    stagingUrl = build.url || stagingUrl;
  } catch {
    // If CF build fails, still return the expected staging URL
  }

  revalidatePath("/");

  return { stagingUrl };
}

/** Deploy site to production and update status to Ready. */
export async function goLive(domain: string): Promise<void> {
  // 1. Trigger production Cloudflare Pages build
  const domainSlug = domain.replace(/\./g, "-");
  try {
    await triggerPagesBuild(domainSlug);
  } catch {
    // Continue even if CF build trigger fails — status still updates
  }

  // 2. Update dashboard index status to Ready
  await updateSiteInIndex(domain, { status: "Ready" });

  revalidatePath("/");
  revalidatePath(`/sites/${domain}`);
}
