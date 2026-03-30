"use server";

import { stringify as stringifyYaml } from "yaml";
import {
  commitSiteFiles,
  readDashboardIndex,
  readSiteConfig as readSiteConfigFromGit,
  updateSiteInIndex,
  addSitesToIndex,
  createBranch,
  mergeBranchToMain,
  deleteBranch,
  triggerWorkflowViaPush,
} from "@/lib/github";
import {
  createPagesProject,
  addCustomDomainToProject,
  listDeployments,
} from "@/lib/cloudflare";
import type { WizardFormData, DashboardSiteEntry } from "@/types/dashboard";
import { revalidatePath } from "next/cache";

interface StagingResult {
  stagingUrl: string;
  pagesProject: string;
}

/** Create site files in a staging branch and set up CF Pages project. */
export async function createSiteAndBuildStaging(
  data: WizardFormData
): Promise<StagingResult> {
  const projectName = data.pagesProjectName;

  // The site folder in the network repo uses the project name as identifier.
  // deploy.yml iterates sites/*/ and uses basename as SITE_DOMAIN.
  // For pages-only sites (no real domain yet), the project name IS the domain.
  // When a real domain is attached later, the folder stays the same — the
  // custom domain is just an alias on the CF Pages project.
  const siteFolder = projectName;

  // 1. Build site.yaml content
  // domain = projectName so Astro builds with the right site URL
  // (site URL becomes https://{projectName}.pages.dev in production)
  // Build config — pages_project is set later after CF project creation
  const siteConfig = {
    domain: projectName,
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    pages_project: projectName, // placeholder — updated after CF creation
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
    } as Record<string, unknown>,
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

  // 3. Generate logo with Gemini (non-blocking — site still works without it)
  let logoBuffer: Buffer | null = null;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      logoBuffer = await generateLogoWithGemini(
        geminiKey,
        data.siteName,
        data.vertical,
        data.audience
      );
    } catch (err) {
      console.warn("[wizard] Logo generation failed, continuing without:", err);
    }
  }

  // 4. Prepare files — all under sites/{projectName}/
  const files: Array<{ path: string; content: string | Buffer }> = [
    {
      path: `sites/${siteFolder}/site.yaml`,
      content: stringifyYaml(siteConfig, { lineWidth: 0 }),
    },
    {
      path: `sites/${siteFolder}/skill.md`,
      content: skillContent,
    },
    {
      path: `sites/${siteFolder}/assets/.gitkeep`,
      content: "",
    },
    {
      path: `sites/${siteFolder}/articles/.gitkeep`,
      content: "",
    },
  ];

  // Add logo if generated and update site config to reference it
  if (logoBuffer) {
    files.push({
      path: `sites/${siteFolder}/assets/logo.png`,
      content: logoBuffer,
    });
    // Update theme config to reference the logo
    siteConfig.theme.logo = "/assets/logo.png";
    siteConfig.theme.favicon = "/assets/logo.png";
  }

  // 5. Create CF Pages project on Cloudflare
  // CF may rename the project (e.g. "travel" → "travel-6jj" if name is reserved)
  const cfProject = await createPagesProject(projectName);
  const actualProjectName = cfProject.name; // Use whatever CF actually named it

  // Update site.yaml with the actual CF project name (so deploy workflow can read it)
  siteConfig.pages_project = actualProjectName;

  // Re-generate site.yaml with final values (logo refs + actual project name)
  files[0] = {
    path: `sites/${siteFolder}/site.yaml`,
    content: stringifyYaml(siteConfig, { lineWidth: 0 }),
  };

  // 6. Create staging branch in git
  const stagingBranch = `staging/${projectName}`;
  await createBranch(stagingBranch);

  // 7. Commit site files to the staging branch
  // Use siteFolder as the "domain" parameter for the commit message
  await commitSiteFiles(siteFolder, files, "create site", stagingBranch);

  // 6b. Trigger the deploy workflow via a Contents API push.
  // Git Data API commits don't trigger GitHub Actions — only the Contents API does.
  await triggerWorkflowViaPush(stagingBranch, siteFolder);

  // 7. Create site entry in dashboard index
  // Use siteFolder as domain so the dashboard can find the site by its folder name
  // Preview URL uses actual CF project name (may differ from user-chosen name)
  const branchSlug = stagingBranch.replace(/\//g, "-");
  const previewUrl = `https://${branchSlug}.${actualProjectName}.pages.dev`;
  const now = new Date().toISOString();
  const siteEntry: DashboardSiteEntry = {
    domain: siteFolder,
    company: data.company,
    vertical: data.vertical,
    status: "Staging",
    site_id: `${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`,
    exclusivity: null,
    ob_epid: null,
    ga_info: null,
    cf_apo: false,
    fixed_ad: false,
    last_updated: now,
    created_at: now,
    pages_project: actualProjectName,
    zone_id: null,
    staging_branch: stagingBranch,
    preview_url: previewUrl,
    saved_previews: null,
    custom_domain: null,
  };

  // Check if site already exists (e.g. from domain sync), update it; otherwise create new
  const index = await readDashboardIndex();
  const existing = index.sites.find((s) => s.domain === siteFolder);
  if (existing) {
    await updateSiteInIndex(siteFolder, {
      status: "Staging",
      company: data.company,
      vertical: data.vertical,
      pages_project: actualProjectName,
      staging_branch: stagingBranch,
      preview_url: previewUrl,
    });
  } else {
    await addSitesToIndex([siteEntry]);
  }

  revalidatePath("/");

  // 8. Return result
  return { stagingUrl: previewUrl, pagesProject: actualProjectName };
}

/** Merge staging branch to main and update status to Ready. */
export async function goLive(domain: string): Promise<void> {
  // 1. Read dashboard index to get the site entry
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  // 2. Get staging_branch and pages_project
  const stagingBranch = site.staging_branch;
  if (!stagingBranch) {
    throw new Error(`No staging branch found for ${domain}`);
  }

  // 3. Merge staging branch to main
  await mergeBranchToMain(stagingBranch, `site(${domain}): go live`);

  // 4. Delete staging branch
  await deleteBranch(stagingBranch);

  // 5. Update index: status = Ready, staging_branch = null (keep preview_url)
  await updateSiteInIndex(domain, {
    status: "Ready",
    staging_branch: null,
  });

  revalidatePath("/");
  revalidatePath(`/sites/${domain}`);
}

/** Attach a custom domain to the site's CF Pages project. */
export async function attachCustomDomain(
  domain: string,
  customDomain: string
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.pages_project) throw new Error(`No Pages project for ${domain}`);

  await addCustomDomainToProject(site.pages_project, customDomain);
  await updateSiteInIndex(domain, { custom_domain: customDomain, status: "Live" });

  revalidatePath("/");
  revalidatePath(`/sites/${domain}`);
}

/** Save a staging preview URL for later reference. */
export async function saveStagingPreview(
  domain: string,
  url: string,
  label: string
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found`);

  const previews = site.saved_previews ?? [];
  previews.push({ url, label, saved_at: new Date().toISOString() });

  await updateSiteInIndex(domain, { saved_previews: previews });
  revalidatePath(`/sites/${domain}`);
}

/** Refresh the preview URL from the latest CF Pages preview deployment. */
export async function refreshPreviewUrl(domain: string): Promise<string | null> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.pages_project) return null;

  const deployments = await listDeployments(site.pages_project, "preview");
  if (deployments.length === 0) return null;

  const latestUrl = deployments[0]!.url;
  const previewUrl = latestUrl.startsWith("https://") ? latestUrl : `https://${latestUrl}`;
  await updateSiteInIndex(domain, { preview_url: previewUrl });

  revalidatePath(`/sites/${domain}`);
  return previewUrl;
}

// ---------------------------------------------------------------------------
// Staging site editing
// ---------------------------------------------------------------------------

export interface StagingSiteConfig {
  siteName: string;
  siteTagline: string;
  audience: string;
  tone: string;
  topics: string[];
  contentGuidelines: string;
  articlesPerWeek: number;
  preferredDays: string[];
  themeBase: string;
}

/** Read the current site config from the staging branch. */
export async function readStagingConfig(
  domain: string
): Promise<StagingSiteConfig | null> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) return null;

  const config = await readSiteConfigFromGit(domain, site.staging_branch);
  if (!config) return null;

  const brief = config.brief as Record<string, unknown> | undefined;
  const schedule = brief?.schedule as Record<string, unknown> | undefined;

  return {
    siteName: (config.site_name as string) ?? "",
    siteTagline: (config.site_tagline as string) ?? "",
    audience: (brief?.audience as string) ?? "",
    tone: (brief?.tone as string) ?? "",
    topics: (brief?.topics as string[]) ?? [],
    contentGuidelines: Array.isArray(brief?.content_guidelines)
      ? (brief.content_guidelines as string[]).join("\n")
      : (brief?.content_guidelines as string) ?? "",
    articlesPerWeek:
      (schedule?.articles_per_week as number) ??
      (brief?.articles_per_week as number) ??
      5,
    preferredDays:
      (schedule?.preferred_days as string[]) ??
      (brief?.preferred_days as string[]) ??
      [],
    themeBase: ((config.theme as Record<string, unknown>)?.base as string) ?? "modern",
  };
}

/** Update site.yaml on the staging branch and trigger a rebuild. */
export async function updateStagingSite(
  domain: string,
  updates: Partial<StagingSiteConfig>
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) throw new Error("No staging branch for this site");

  // Read existing config
  const existing = await readSiteConfigFromGit(domain, site.staging_branch);
  if (!existing) throw new Error("Could not read site config from staging branch");

  // Apply updates
  if (updates.siteName !== undefined) existing.site_name = updates.siteName;
  if (updates.siteTagline !== undefined) existing.site_tagline = updates.siteTagline || null;

  // Update brief
  const brief = (existing.brief ?? {}) as Record<string, unknown>;
  if (updates.audience !== undefined) brief.audience = updates.audience;
  if (updates.tone !== undefined) brief.tone = updates.tone;
  if (updates.topics !== undefined) brief.topics = updates.topics;
  if (updates.contentGuidelines !== undefined) {
    brief.content_guidelines = updates.contentGuidelines
      ? updates.contentGuidelines.split("\n").filter(Boolean)
      : [];
  }

  // Update schedule
  const schedule = (brief.schedule ?? {}) as Record<string, unknown>;
  if (updates.articlesPerWeek !== undefined) schedule.articles_per_week = updates.articlesPerWeek;
  if (updates.preferredDays !== undefined) schedule.preferred_days = updates.preferredDays;
  brief.schedule = schedule;
  existing.brief = brief;

  // Update theme
  if (updates.themeBase !== undefined) {
    const theme = (existing.theme ?? {}) as Record<string, unknown>;
    theme.base = updates.themeBase;
    existing.theme = theme;
  }

  // Commit updated site.yaml
  const files: Array<{ path: string; content: string | Buffer }> = [
    {
      path: `sites/${domain}/site.yaml`,
      content: stringifyYaml(existing, { lineWidth: 0 }),
    },
  ];

  await commitSiteFiles(domain, files, "update site config", site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);

  revalidatePath(`/sites/${domain}`);
}

/** Generate a logo preview (returns base64 PNG, does NOT commit). */
export async function generateLogoPreview(domain: string): Promise<string | null> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY not configured");

  const config = site?.staging_branch
    ? await readSiteConfigFromGit(domain, site.staging_branch)
    : null;
  const siteName = (config?.site_name as string) ?? domain;
  const vertical = site?.vertical ?? "Other";
  const brief = config?.brief as Record<string, unknown> | undefined;
  const audience = brief?.audience as string | undefined;

  const logoBuffer = await generateLogoWithGemini(geminiKey, siteName, vertical, audience);
  if (!logoBuffer) return null;

  return logoBuffer.toString("base64");
}

/**
 * Save all staging edits in a single commit.
 * Accepts optional config updates AND/OR a base64 logo to include.
 * Only triggers ONE build.
 */
export async function saveAllStagingEdits(
  domain: string,
  configUpdates: Partial<StagingSiteConfig> | null,
  logoBase64: string | null
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) throw new Error("No staging branch for this site");

  const existing = await readSiteConfigFromGit(domain, site.staging_branch);
  if (!existing) throw new Error("Could not read site config from staging branch");

  // Apply config updates if provided
  if (configUpdates) {
    if (configUpdates.siteName !== undefined) existing.site_name = configUpdates.siteName;
    if (configUpdates.siteTagline !== undefined) existing.site_tagline = configUpdates.siteTagline || null;

    const brief = (existing.brief ?? {}) as Record<string, unknown>;
    if (configUpdates.audience !== undefined) brief.audience = configUpdates.audience;
    if (configUpdates.tone !== undefined) brief.tone = configUpdates.tone;
    if (configUpdates.topics !== undefined) brief.topics = configUpdates.topics;
    if (configUpdates.contentGuidelines !== undefined) {
      brief.content_guidelines = configUpdates.contentGuidelines
        ? configUpdates.contentGuidelines.split("\n").filter(Boolean)
        : [];
    }

    const schedule = (brief.schedule ?? {}) as Record<string, unknown>;
    if (configUpdates.articlesPerWeek !== undefined) schedule.articles_per_week = configUpdates.articlesPerWeek;
    if (configUpdates.preferredDays !== undefined) schedule.preferred_days = configUpdates.preferredDays;
    brief.schedule = schedule;
    existing.brief = brief;

    if (configUpdates.themeBase !== undefined) {
      const theme = (existing.theme ?? {}) as Record<string, unknown>;
      theme.base = configUpdates.themeBase;
      existing.theme = theme;
    }
  }

  // If we have a logo, set theme references
  if (logoBase64) {
    const theme = (existing.theme ?? {}) as Record<string, unknown>;
    theme.logo = "/assets/logo.png";
    theme.favicon = "/assets/logo.png";
    existing.theme = theme;
  }

  // Build the file list — single commit for everything
  const files: Array<{ path: string; content: string | Buffer }> = [
    {
      path: `sites/${domain}/site.yaml`,
      content: stringifyYaml(existing, { lineWidth: 0 }),
    },
  ];

  if (logoBase64) {
    files.push({
      path: `sites/${domain}/assets/logo.png`,
      content: Buffer.from(logoBase64, "base64"),
    });
  }

  const commitMsg = logoBase64 && configUpdates
    ? "update site config and logo"
    : logoBase64
      ? "update logo"
      : "update site config";

  await commitSiteFiles(domain, files, commitMsg, site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);

  revalidatePath(`/sites/${domain}`);
}

/** Upload a custom logo to the staging branch. Expects base64-encoded image data. */
export async function uploadStagingLogo(
  domain: string,
  base64Data: string
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) throw new Error("No staging branch for this site");

  const logoBuffer = Buffer.from(base64Data, "base64");

  // Read existing config to update theme references
  const config = await readSiteConfigFromGit(domain, site.staging_branch);

  const files: Array<{ path: string; content: string | Buffer }> = [
    {
      path: `sites/${domain}/assets/logo.png`,
      content: logoBuffer,
    },
  ];

  if (config) {
    const theme = (config.theme ?? {}) as Record<string, unknown>;
    theme.logo = "/assets/logo.png";
    theme.favicon = "/assets/logo.png";
    config.theme = theme;
    files.push({
      path: `sites/${domain}/site.yaml`,
      content: stringifyYaml(config, { lineWidth: 0 }),
    });
  }

  await commitSiteFiles(domain, files, "upload custom logo", site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);

  revalidatePath(`/sites/${domain}`);
}

// ---------------------------------------------------------------------------
// Gemini logo generation (internal helper)
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function generateLogoWithGemini(
  apiKey: string,
  siteName: string,
  vertical: string,
  audience?: string
): Promise<Buffer | null> {
  const prompt = `Create a modern, professional logo icon for a website called "${siteName}".
The website is in the "${vertical}" vertical${audience ? ` targeting ${audience}` : ""}.

Requirements:
- Simple, clean icon/symbol design (NOT text-heavy)
- Works well at small sizes (favicon, header icon)
- Modern flat design style with vibrant colors
- Square aspect ratio
- No text or letters in the logo — pure icon/symbol only
- Professional quality suitable for a content website
- White or transparent-feeling background`;

  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });

    if (!response.ok) {
      console.warn(`[wizard] Logo generation failed: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: {
          parts: Array<{
            inlineData?: { mimeType: string; data: string };
            text?: string;
          }>;
        };
      }>;
    };

    const imagePart = data.candidates?.[0]?.content.parts.find(
      (p) => p.inlineData
    );
    if (!imagePart?.inlineData) {
      console.warn("[wizard] No image in Gemini response");
      return null;
    }

    return Buffer.from(imagePart.inlineData.data, "base64");
  } catch (err) {
    console.warn("[wizard] Logo generation error:", err);
    return null;
  }
}
