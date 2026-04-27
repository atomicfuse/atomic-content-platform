"use server";

import { stringify as stringifyYaml } from "yaml";
import {
  commitSiteFiles,
  readDashboardIndex,
  writeDashboardIndex,
  readSiteConfig as readSiteConfigFromGit,
  updateSiteInIndex,
  addSitesToIndex,
  createBranch,
  mergeBranchToMain,
  deleteBranch,
  branchExists,
  triggerWorkflowViaPush,
  readFileBase64,
} from "@/lib/github";
import { listZones } from "@/lib/cloudflare";
import { workerPreviewUrl } from "@/lib/constants";
import type { WizardFormData, DashboardSiteEntry } from "@/types/dashboard";
import { revalidatePath } from "next/cache";
import { removeBackground } from "@/lib/remove-background";
import {
  enableEmailRouting,
  createEmailRoutingRule,
} from "@/lib/email-routing";

const AGGREGATOR_URL =
  process.env.CONTENT_AGGREGATOR_URL ??
  process.env.CONTENT_API_BASE_URL ??
  "https://content-aggregator-cloudgrid.apps.cloudgrid.io";

interface StagingResult {
  stagingUrl: string;
  /** The network-repo folder name and dashboard-index `domain` for the new site. */
  siteFolder: string;
}

/** Create a content bundle on the aggregator. Handles 409 duplicate by appending " (2)". */
async function createBundle(
  name: string,
  verticalId: string,
  categoryIds: string[],
  tagIds: string[],
): Promise<{ id: string; name: string } | null> {
  const payload = {
    name,
    description: `Auto-created content bundle for ${name}`,
    active: true,
    rules: {
      vertical_ids: [verticalId],
      category_ids: categoryIds,
      tag_ids: tagIds,
    },
  };

  try {
    let res = await fetch(`${AGGREGATOR_URL}/api/bundles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Handle 409 (duplicate name) — retry with " (2)" suffix
    if (res.status === 409) {
      payload.name = `${name} (2)`;
      res = await fetch(`${AGGREGATOR_URL}/api/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }

    if (res.status === 201) {
      return (await res.json()) as { id: string; name: string };
    }
    console.error("[wizard] Bundle creation failed:", res.status);
    return null;
  } catch (err) {
    console.error("[wizard] Bundle creation error:", err);
    return null;
  }
}

/** Create site files in a staging branch and trigger sync-kv to seed
 *  CONFIG_KV_STAGING + R2 for the multi-tenant site-worker. */
export async function createSiteAndBuildStaging(
  data: WizardFormData
): Promise<StagingResult> {
  const projectName = data.pagesProjectName;

  // The site folder in the network repo uses the project name as identifier.
  // sync-kv.yml iterates sites/*/ on commits to staging/** and main, and
  // writes CONFIG_KV under `site:<folder-name>` so the worker middleware
  // can resolve the right config when the hostname matches.
  const siteFolder = projectName;

  // 0. Resolve niche targeting: existing bundle or create new
  let bundleId: string | undefined = data.bundleId || undefined;
  let categoryIds: string[] = data.selectedCategories.map((c) => c.id);
  let tagIds: string[] = data.selectedTags.map((t) => t.id);
  const iabCategoryCodes = data.selectedCategories
    .map((c) => c.iabCode)
    .filter(Boolean);

  if (bundleId) {
    // Existing bundle — fetch its rules for site.yaml fields
    try {
      const res = await fetch(`${AGGREGATOR_URL}/api/bundles/${bundleId}`);
      if (res.ok) {
        const bundle = (await res.json()) as {
          rules?: { category_ids?: string[]; tag_ids?: string[] };
        };
        categoryIds = bundle.rules?.category_ids ?? categoryIds;
        tagIds = bundle.rules?.tag_ids ?? tagIds;
      }
    } catch {
      // Best-effort — proceed with what we have
    }
  } else if (data.verticalId && categoryIds.length > 0) {
    // Create new bundle
    const bundle = await createBundle(
      data.siteName,
      data.verticalId,
      categoryIds,
      tagIds,
    );
    if (bundle) bundleId = bundle.id;
  }

  // 1. Build site.yaml content. `domain` is the site folder identifier
  // used by sync-kv.yml + middleware (CONFIG_KV key `site:<domain>`).
  const siteConfig = {
    domain: projectName,
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    groups: data.groups.length > 0 ? data.groups : ["adsense-default"],
    active: true,
    bundle_id: bundleId || undefined,
    iab_vertical_code: data.iabVerticalCode || undefined,
    iab_category_codes:
      iabCategoryCodes.length > 0 ? iabCategoryCodes : undefined,
    scripts_vars: Object.keys(data.scriptsVars).length > 0 ? data.scriptsVars : undefined,
    brief: {
      audiences: data.audiences,
      audience_type_ids: data.audienceIds.length > 0 ? data.audienceIds : undefined,
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
      vertical: data.vertical || undefined,
      vertical_id: data.verticalId || undefined,
      category_ids: categoryIds.length > 0 ? categoryIds : undefined,
      tag_ids: tagIds.length > 0 ? tagIds : undefined,
      review_percentage: 5,
      schedule: {
        articles_per_day: data.articlesPerDay,
        preferred_days: data.preferredDays,
        preferred_time: "10:00",
      },
    },
    theme: {
      base: data.themeBase,
      colors: {
        primary: data.primaryColor,
        accent: data.accentColor,
      },
      fonts: {
        heading: data.fontHeading,
        body: data.fontBody,
      },
    } as Record<string, unknown>,
  };

  // 2. Build skill.md content
  const skillContent = `# Content Agent Instructions for ${data.siteName}

## Target Audiences
${data.audiences.join(", ") || "General"}

## Tone
${data.tone}

## Topics
${data.topics.map((t) => `- ${t}`).join("\n")}

## Content Guidelines
${data.contentGuidelines || "Follow standard editorial guidelines."}

## Schedule
- ${data.articlesPerDay} article(s) per day
- Preferred days: ${data.preferredDays.join(", ")}
`;

  // 3. Use uploaded logo or generate with Gemini
  let logoBuffer: Buffer | null = null;
  let faviconBuffer: Buffer | null = null;

  if (data.logoBase64) {
    logoBuffer = Buffer.from(data.logoBase64, "base64");
  } else {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        logoBuffer = await generateLogoWithGemini(
          geminiKey,
          data.siteName,
          data.vertical,
          data.audiences.join(", ") || undefined
        );
      } catch (err) {
        console.warn("[wizard] Logo generation failed, continuing without:", err);
      }
    }
  }

  if (data.faviconBase64) {
    faviconBuffer = Buffer.from(data.faviconBase64, "base64");
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

  // Add logo if generated/uploaded and update site config to reference it
  if (logoBuffer) {
    files.push({
      path: `sites/${siteFolder}/assets/logo.png`,
      content: logoBuffer,
    });
    siteConfig.theme.logo = "/assets/logo.png";
    // Default favicon to logo unless a separate favicon was uploaded
    if (!faviconBuffer) {
      siteConfig.theme.favicon = "/assets/logo.png";
    }
  }

  // Add separate favicon if uploaded
  if (faviconBuffer) {
    files.push({
      path: `sites/${siteFolder}/assets/favicon.png`,
      content: faviconBuffer,
    });
    siteConfig.theme.favicon = "/assets/favicon.png";
  }

  // 5. Compute the staging URL up-front. The site folder = projectName.
  const previewUrl = workerPreviewUrl(siteFolder);

  // Re-serialize site.yaml so any theme.logo / theme.favicon mutations
  // applied above (after the initial files[] build) make it into the commit.
  files[0] = {
    path: `sites/${siteFolder}/site.yaml`,
    content: stringifyYaml(siteConfig, { lineWidth: 0 }),
  };

  // 6. Create staging branch in git, branched from main.
  const stagingBranch = `staging/${projectName}`;
  await createBranch(stagingBranch);

  // 7. Commit site files to the staging branch via the Git Data API.
  await commitSiteFiles(siteFolder, files, "create site", stagingBranch);

  // 8. Fire sync-kv.yml. The Git Data API push above does NOT trigger
  // GitHub Actions; only a Contents-API push does. triggerWorkflowViaPush
  // writes a .build-trigger file via the Contents API to wake up sync-kv,
  // which then seeds CONFIG_KV_STAGING + R2 for the new site.
  // (workflow_dispatch would be cleaner but the token lacks actions:write.)
  await triggerWorkflowViaPush(stagingBranch, siteFolder);

  // 9. Create / update dashboard-index entry. Pages-related fields are
  // null post-migration (kept on the type for backwards compat).
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
    pages_project: null,
    pages_subdomain: null,
    zone_id: null,
    staging_branch: stagingBranch,
    preview_url: previewUrl,
    saved_previews: null,
    custom_domain: null,
  };

  const index = await readDashboardIndex();
  const existing = index.sites.find((s) => s.domain === siteFolder);
  if (existing) {
    await updateSiteInIndex(siteFolder, {
      status: "Staging",
      company: data.company,
      vertical: data.vertical,
      staging_branch: stagingBranch,
      preview_url: previewUrl,
    });
  } else {
    await addSitesToIndex([siteEntry]);
  }

  revalidatePath("/");

  // 10. Return result
  return { stagingUrl: previewUrl, siteFolder };
}

/**
 * Merge staging branch to main and update status to Ready.
 * The staging branch is KEPT (reset to main HEAD) so future edits
 * still go through the staging → preview → approve flow.
 */
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

  // 4. Delete and recreate staging branch from the new main HEAD
  // This resets it to be in sync with production, ready for future edits
  await deleteBranch(stagingBranch);
  await createBranch(stagingBranch, "main");

  // 5. Update index: status = Ready, KEEP staging_branch and preview_url
  await updateSiteInIndex(domain, {
    status: "Ready",
  });

  revalidatePath("/");
  revalidatePath(`/sites/${domain}`);
}

/**
 * Publish staged edits to production for an already-live/ready site.
 * Merges staging → main, then resets staging branch to main HEAD.
 */
export async function publishStagingToProduction(domain: string): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  const stagingBranch = site.staging_branch;
  if (!stagingBranch) {
    throw new Error(`No staging branch found for ${domain}`);
  }

  // Merge staging → main (triggers production deploy via GitHub Actions)
  await mergeBranchToMain(
    stagingBranch,
    `site(${domain}): publish staging edits to production`
  );

  // Reset staging branch to match main (clean slate for next edit cycle)
  await deleteBranch(stagingBranch);
  await createBranch(stagingBranch, "main");

  revalidatePath("/");
  revalidatePath(`/sites/${domain}`);
}

/**
 * Ensure a staging branch exists for a site.
 * If the branch was somehow lost, recreate it from main.
 * Returns the staging branch name.
 */
export async function ensureStagingBranch(domain: string): Promise<string> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  // If a branch is already recorded, keep it (or recreate from main if it
  // was deleted externally).
  if (site.staging_branch) {
    const exists = await branchExists(site.staging_branch);
    if (exists) return site.staging_branch;
    await createBranch(site.staging_branch, "main");
    return site.staging_branch;
  }

  // No branch recorded — branch from main using the domain as the slug.
  // Folder name = domain, NOT pages_project (CF may have renamed legacy
  // ones; not relevant post-migration).
  const stagingBranch = `staging/${domain}`;
  const exists = await branchExists(stagingBranch);
  if (!exists) await createBranch(stagingBranch, "main");

  await updateSiteInIndex(domain, {
    staging_branch: stagingBranch,
    preview_url: workerPreviewUrl(domain),
  });

  revalidatePath(`/sites/${domain}`);
  return stagingBranch;
}

/** Fetch Cloudflare zones not already used as a site identifier or as
 *  another site's custom_domain. */
export async function getAvailableZones(): Promise<
  Array<{ domain: string; zoneId: string }>
> {
  const [zones, index] = await Promise.all([
    listZones(),
    readDashboardIndex(),
  ]);

  const usedAsSite = new Set(index.sites.map((s) => s.domain));
  const usedCustomDomains = new Set(
    index.sites.map((s) => s.custom_domain).filter((d): d is string => Boolean(d)),
  );

  return zones
    .filter((z) => !usedAsSite.has(z.name) && !usedCustomDomains.has(z.name))
    .map((z) => ({ domain: z.name, zoneId: z.id }));
}

/** Attach a custom domain to a site by writing it to dashboard-index.yaml.
 *  Post-migration this is just a data change — the production worker only
 *  picks up the route on the next `pnpm deploy:production` run (which feeds
 *  emit-env-configs.ts). The UI surfaces a "redeploy required" callout to
 *  the operator. Best-effort email-routing setup happens here too since it's
 *  zone-level and unrelated to the legacy Pages flow. */
export async function attachCustomDomain(
  domain: string,
  customDomain: string,
): Promise<{ redeployRequired: true }> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  // Merge a duplicate zone-only entry's zone_id into this site, then drop the dupe.
  const dupeIndex = index.sites.findIndex((s) => s.domain === customDomain);
  if (dupeIndex !== -1) {
    const dupe = index.sites[dupeIndex]!;
    if (dupe.zone_id) site.zone_id = dupe.zone_id;
    index.sites.splice(dupeIndex, 1);
  }

  // Best-effort zone-level setup. Failures here must NOT abort the attach
  // — the data write is the contract; email routing is a nicety.
  if (site.zone_id) {
    try {
      await enableEmailRouting(site.zone_id);
      await createEmailRoutingRule(site.zone_id, customDomain);
    } catch (err) {
      console.error('[attachCustomDomain] email routing setup failed', err);
    }
  }

  site.custom_domain = customDomain;
  site.status = 'Live';
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: attach ${customDomain} to ${domain}`,
  );

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { redeployRequired: true };
}

/** Detach a custom domain from a site (clears the field; reverts status).
 *  Post-migration: pure data change. Production deploy must be re-run for
 *  the prod worker to actually drop the route. */
export async function detachCustomDomain(
  domain: string,
): Promise<{ redeployRequired: true }> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.custom_domain) {
    throw new Error(`No custom domain to detach for ${domain}`);
  }

  site.custom_domain = null;
  site.status = 'Ready';
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: detach custom domain from ${domain}`,
  );

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { redeployRequired: true };
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

// ---------------------------------------------------------------------------
// Staging site editing
// ---------------------------------------------------------------------------

export interface StagingSiteConfig {
  siteName: string;
  siteTagline: string;
  audiences?: string[];
  /** Content Aggregator audience type IDs. */
  audienceIds?: string[];
  tone: string;
  topics: string[];
  contentGuidelines: string;
  articlesPerDay: number;
  preferredDays: string[];
  themeBase: string;
  logoBase64: string | null;
  // Phase 1 config fields
  groups?: string[];
  tracking?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  scripts_vars?: Record<string, string>;
  ads_config?: Record<string, unknown>;
  quality_threshold?: number;
  quality_weights?: Record<string, number>;
  // Layout v2 theme fields
  theme_colors?: { primary: string; accent: string };
  theme_fonts?: { heading: string; body: string };
  layout?: Record<string, unknown>;
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
    audiences: (brief?.audiences as string[] | undefined) ?? (brief?.audience ? [brief.audience as string] : []),
    tone: (brief?.tone as string) ?? "",
    topics: (brief?.topics as string[]) ?? [],
    contentGuidelines: Array.isArray(brief?.content_guidelines)
      ? (brief.content_guidelines as string[]).join("\n")
      : (brief?.content_guidelines as string) ?? "",
    // Dual-read: prefer articles_per_day; fall back to legacy articles_per_week.
    articlesPerDay:
      (schedule?.articles_per_day as number) ??
      (brief?.articles_per_day as number) ??
      (() => {
        const perWeek =
          (schedule?.articles_per_week as number | undefined) ??
          (brief?.articles_per_week as number | undefined) ??
          5;
        const days =
          (schedule?.preferred_days as string[] | undefined)?.length ??
          (brief?.preferred_days as string[] | undefined)?.length ??
          7;
        return Math.max(1, Math.ceil(perWeek / Math.max(1, days)));
      })(),
    preferredDays:
      (schedule?.preferred_days as string[]) ??
      (brief?.preferred_days as string[]) ??
      [],
    themeBase: ((config.theme as Record<string, unknown>)?.base as string) ?? "modern",
    logoBase64: (config.theme as Record<string, unknown>)?.logo
      ? await readFileBase64(`sites/${domain}/assets/logo.png`, site.staging_branch)
      : null,
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
  if (updates.audiences !== undefined) brief.audiences = updates.audiences;
  if (updates.audienceIds !== undefined) brief.audience_type_ids = updates.audienceIds;
  if (updates.tone !== undefined) brief.tone = updates.tone;
  if (updates.topics !== undefined) brief.topics = updates.topics;
  if (updates.contentGuidelines !== undefined) {
    brief.content_guidelines = updates.contentGuidelines
      ? updates.contentGuidelines.split("\n").filter(Boolean)
      : [];
  }

  // Update schedule
  const schedule = (brief.schedule ?? {}) as Record<string, unknown>;
  if (updates.articlesPerDay !== undefined) {
    schedule.articles_per_day = updates.articlesPerDay;
    delete schedule.articles_per_week;
  }
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
  const audiences = (brief?.audiences as string[] | undefined) ?? (brief?.audience ? [brief.audience as string] : []);
  const audience = audiences.join(", ") || undefined;

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
    if (configUpdates.audiences !== undefined) brief.audiences = configUpdates.audiences;
    if (configUpdates.audienceIds !== undefined) brief.audience_type_ids = configUpdates.audienceIds;
    if (configUpdates.tone !== undefined) brief.tone = configUpdates.tone;
    if (configUpdates.topics !== undefined) brief.topics = configUpdates.topics;
    if (configUpdates.contentGuidelines !== undefined) {
      brief.content_guidelines = configUpdates.contentGuidelines
        ? configUpdates.contentGuidelines.split("\n").filter(Boolean)
        : [];
    }

    const schedule = (brief.schedule ?? {}) as Record<string, unknown>;
    if (configUpdates.articlesPerDay !== undefined) {
      schedule.articles_per_day = configUpdates.articlesPerDay;
      delete schedule.articles_per_week;
    }
    if (configUpdates.preferredDays !== undefined) schedule.preferred_days = configUpdates.preferredDays;
    brief.schedule = schedule;
    existing.brief = brief;

    if (configUpdates.themeBase !== undefined) {
      const theme = (existing.theme ?? {}) as Record<string, unknown>;
      theme.base = configUpdates.themeBase;
      existing.theme = theme;
    }
  }

  // If we have a logo, set theme references (preserve separate favicon if set)
  if (logoBase64) {
    const theme = (existing.theme ?? {}) as Record<string, unknown>;
    theme.logo = "/assets/logo.png";
    if (theme.favicon !== "/assets/favicon.png") {
      theme.favicon = "/assets/logo.png";
    }
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
    const raw = Buffer.from(logoBase64, "base64");
    const transparent = await removeBackground(raw);
    files.push({
      path: `sites/${domain}/assets/logo.png`,
      content: transparent,
    });
  }

  const commitMsg = logoBase64 && configUpdates
    ? "update site config and logo"
    : logoBase64
      ? "update logo"
      : "update site config";

  await commitSiteFiles(domain, files, commitMsg, site.staging_branch);
  await triggerWorkflowViaPush(site.staging_branch, domain);
}

/** Upload a custom logo to the staging branch. Expects base64-encoded image data. */
export async function uploadStagingLogo(
  domain: string,
  base64Data: string
): Promise<void> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.staging_branch) throw new Error("No staging branch for this site");

  const raw = Buffer.from(base64Data, "base64");
  const logoBuffer = await removeBackground(raw);

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
    if (theme.favicon !== "/assets/favicon.png") {
      theme.favicon = "/assets/logo.png";
    }
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
// Auto-suggest topics via Gemini
// ---------------------------------------------------------------------------

const GEMINI_TEXT_MODEL = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Context passed to topic suggestion — everything available at step 2 of the wizard.
 * At this point audience/tone/guidelines are typically EMPTY (they're on the same step),
 * but siteName, siteTagline, vertical, and company are filled from step 0.
 */
interface TopicSuggestionContext {
  siteName: string;
  siteTagline?: string;
  vertical: string;
  company?: string;
  audience?: string;
  tone?: string;
  contentGuidelines?: string;
}

/**
 * Auto-suggest 4 topics for a site based on whatever info is available.
 * Uses Gemini Flash (text) for fast, cheap inference.
 * Falls back to smart per-vertical defaults if Gemini is unavailable.
 */
export async function suggestTopics(
  context: TopicSuggestionContext
): Promise<string[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return getFallbackTopics(context.siteName, context.vertical);
  }

  // Build rich context from ALL available fields
  const contextParts = [
    `Website name: "${context.siteName}"`,
  ];
  if (context.siteTagline) contextParts.push(`Tagline: "${context.siteTagline}"`);
  if (context.vertical && context.vertical !== "Other") {
    contextParts.push(`Category: ${context.vertical}`);
  }
  if (context.audience) contextParts.push(`Target audience: ${context.audience}`);
  if (context.tone) contextParts.push(`Tone: ${context.tone}`);
  if (context.contentGuidelines) contextParts.push(`Content guidelines: ${context.contentGuidelines}`);

  const prompt = `You are a content strategist helping launch a new content website.

Website info:
${contextParts.join("\n")}

Based on the website name${context.vertical !== "Other" ? ` and its "${context.vertical}" category` : ""}, suggest exactly 4 specific content topics that this site should cover. Topics should be:
- Specific to THIS site (not generic like "How-To Guides" or "Trending Topics")
- Short (2-4 words each)
- Suitable as article categories / content pillars
- Diverse — cover different angles of the site's niche

Reply with ONLY a JSON array of exactly 4 strings. No markdown, no explanation.
Example for a site called "PawPals" in Animals: ["Dog Training Tips", "Cat Health Guide", "Pet Nutrition", "Breed Spotlights"]`;

  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_TEXT_MODEL}:generateContent?key=${geminiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
      }),
    });

    if (!response.ok) {
      console.warn(`[wizard] Topic suggestion failed: ${response.status}`);
      return getFallbackTopics(context.siteName, context.vertical);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: { parts: Array<{ text?: string }> };
      }>;
    };

    const text = data.candidates?.[0]?.content.parts[0]?.text?.trim() ?? "";
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const topics = JSON.parse(jsonMatch[0]) as string[];
      if (Array.isArray(topics) && topics.length >= 1) {
        // Filter out junk: must be a real string, not "undefined", not empty
        const clean = topics
          .map((t) => String(t).trim())
          .filter((t) => t.length > 0 && t !== "undefined" && t !== "null");
        if (clean.length >= 2) return clean.slice(0, 4);
      }
    }

    return getFallbackTopics(context.siteName, context.vertical);
  } catch (err) {
    console.warn("[wizard] Topic suggestion error:", err);
    return getFallbackTopics(context.siteName, context.vertical);
  }
}

/**
 * Smart fallback topics — uses vertical-specific defaults
 * but also incorporates the site name for "Other" vertical.
 */
function getFallbackTopics(siteName: string, vertical: string): string[] {
  const topicMap: Record<string, string[]> = {
    Lifestyle: ["Health & Wellness", "Home & Living", "Personal Growth", "Style & Fashion"],
    Travel: ["Destination Guides", "Travel Tips", "Local Culture", "Adventure Activities"],
    Entertainment: ["Movie Reviews", "TV & Streaming", "Music Spotlight", "Celebrity Culture"],
    Animals: ["Pet Care & Health", "Animal Behavior", "Breed Guides", "Wildlife Stories"],
    Science: ["New Discoveries", "Space & Cosmos", "Health Science", "Environment & Climate"],
    "Food & Drink": ["Recipes & Cooking", "Restaurant Reviews", "Nutrition Tips", "Food Culture"],
    News: ["Current Events", "In-Depth Analysis", "Policy & Politics", "Local Stories"],
    Conspiracy: ["Unexplained Events", "Government Files", "Historical Mysteries", "Whistleblowers"],
  };

  if (topicMap[vertical]) return topicMap[vertical]!;

  // For "Other" vertical, derive topics from the site name
  // This is better than generic "Trending Topics" etc.
  const name = siteName.toLowerCase();
  if (name.includes("tech") || name.includes("digital") || name.includes("cyber")) {
    return ["Tech Reviews", "Industry News", "How-To Tutorials", "Future Trends"];
  }
  if (name.includes("sport") || name.includes("fitness") || name.includes("gym")) {
    return ["Training Guides", "Game Analysis", "Athlete Profiles", "Nutrition & Recovery"];
  }
  if (name.includes("finance") || name.includes("money") || name.includes("invest")) {
    return ["Market Analysis", "Personal Finance", "Investment Tips", "Economic Trends"];
  }
  if (name.includes("health") || name.includes("wellness") || name.includes("medical")) {
    return ["Health Tips", "Mental Wellness", "Nutrition Guide", "Medical Research"];
  }
  if (name.includes("game") || name.includes("gaming")) {
    return ["Game Reviews", "Gaming News", "Tips & Strategies", "Industry Updates"];
  }
  if (name.includes("art") || name.includes("design") || name.includes("creative")) {
    return ["Design Trends", "Artist Spotlights", "Tutorials", "Creative Tools"];
  }
  if (name.includes("auto") || name.includes("car") || name.includes("motor")) {
    return ["Car Reviews", "Maintenance Tips", "Industry News", "EV Technology"];
  }
  if (name.includes("education") || name.includes("learn") || name.includes("study")) {
    return ["Learning Tips", "Course Reviews", "Career Guidance", "Student Life"];
  }

  // True fallback — at least make them content-oriented
  return ["Expert Guides", "Latest News", "Tips & Advice", "In-Depth Reviews"];
}

// ---------------------------------------------------------------------------
// Gemini logo generation (internal helper)
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

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
- Transparent background (PNG with alpha channel) — do NOT include any background color, the background must be fully transparent`;

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

    const raw = Buffer.from(imagePart.inlineData.data, "base64");
    return removeBackground(raw);
  } catch (err) {
    console.warn("[wizard] Logo generation error:", err);
    return null;
  }
}
