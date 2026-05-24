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
  listNetworkDirectory,
  readFileContent,
  commitNetworkFiles,
} from "@/lib/github";
import {
  listZones,
  registerWorkerCustomDomain,
  deregisterWorkerCustomDomain,
  putKVEntry,
  deleteKVEntry,
  getKVEntry,
  listKVKeys,
  bulkPutKV,
} from "@/lib/cloudflare";
import { workerPreviewUrl, getKvNamespaces } from "@/lib/constants";
import type { WizardFormData, DashboardSiteEntry } from "@/types/dashboard";
import { revalidatePath } from "next/cache";
import { removeBackground } from "@/lib/remove-background";
import { extractFaviconFromLogo } from "@/lib/favicon-extractor";
import {
  enableEmailRouting,
  createEmailRoutingRule,
} from "@/lib/email-routing";
import { generateAuthorName } from "@/lib/author-names";
import { generateAndUploadDefaultSiteImage } from "@/lib/general-image";

// CONTENT_API_BASE_URL first: CloudGrid auto-injects CONTENT_AGGREGATOR_URL
// as a platform read-only env pointing to a stale entity URL.
const RAW_AGGREGATOR_URL =
  process.env.CONTENT_API_BASE_URL ??
  process.env.CONTENT_AGGREGATOR_URL ??
  "https://content-aggregator-v2-34cd.atomic.cloudgrid.io";
const AGGREGATOR_URL = RAW_AGGREGATOR_URL.replace(/\/api\/?$/, "");

interface StagingResult {
  stagingUrl: string;
  /** The network-repo folder name and dashboard-index `domain` for the new site. */
  siteFolder: string;
}

/** Create a content bundle on the aggregator. Handles 409 duplicate by appending " (2)".
 *  Post-2026-04-29: vertical_ids removed from bundle rules. Tier-1 category ID
 *  is included in category_ids alongside child IDs. */
async function createBundle(
  name: string,
  tier1CategoryId: string,
  childCategoryIds: string[],
  tagIds: string[],
): Promise<{ id: string; name: string } | null> {
  // Merge tier-1 ID with child category IDs (deduped)
  const allCategoryIds = [tier1CategoryId, ...childCategoryIds.filter((id) => id !== tier1CategoryId)];
  const payload = {
    name,
    description: `Auto-created content bundle for ${name}`,
    active: true,
    rules: {
      category_ids: allCategoryIds,
      tag_ids: tagIds,
    },
  };

  try {
    const url = `${AGGREGATOR_URL}/api/bundles`;
    console.log("[wizard] POST", url, JSON.stringify(payload, null, 2));

    let res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log("[wizard] Bundle creation response:", res.status, res.statusText);

    // Handle 409 (duplicate name) — retry with " (2)" suffix
    if (res.status === 409) {
      payload.name = `${name} (2)`;
      console.log("[wizard] 409 duplicate — retrying POST", url, JSON.stringify(payload, null, 2));
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log("[wizard] Retry response:", res.status, res.statusText);
    }

    // Accept both 200 and 201 as success — aggregators vary
    if (res.ok) {
      return (await res.json()) as { id: string; name: string };
    }
    const errorBody = await res.text().catch(() => "");
    console.error("[wizard] Bundle creation failed:", res.status, errorBody);
    return null;
  } catch (err) {
    console.error("[wizard] Bundle creation error:", err);
    return null;
  }
}

/** Create a content bundle for an existing site from the site settings page.
 *  Uses the niche targeting selections (category, subcategories, tags)
 *  already configured in the Content Brief tab. Returns the new bundleId
 *  on success, or throws on failure. */
export async function createBundleForSite(
  siteName: string,
  tier1CategoryId: string,
  childCategoryIds: string[],
  tagIds: string[],
): Promise<{ id: string; name: string }> {
  if (!tier1CategoryId) {
    throw new Error("A category must be selected before creating a bundle.");
  }
  if (childCategoryIds.length === 0) {
    throw new Error("At least one subcategory must be selected before creating a bundle.");
  }
  const bundle = await createBundle(siteName, tier1CategoryId, childCategoryIds, tagIds);
  if (!bundle) {
    throw new Error("Failed to create content bundle. Check the Content Aggregator service and try again.");
  }
  return bundle;
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
    if (bundle) {
      bundleId = bundle.id;
    } else {
      throw new Error("Failed to create content bundle. Check the Content Aggregator service and try again.");
    }
  }

  // 1. Build site.yaml content. `domain` is the site folder identifier
  // used by sync-kv.yml + middleware (CONFIG_KV key `site:<domain>`).
  const siteConfig = {
    domain: projectName,
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    author: generateAuthorName(),
    groups: data.groups.length > 0 ? data.groups : [],
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
      image_guidelines: data.imageGuidelines
        ? data.imageGuidelines.split("\n").filter(Boolean)
        : undefined,
      vertical: data.vertical || undefined,
      vertical_id: data.verticalId || undefined,
      category_ids: categoryIds.length > 0 ? categoryIds : undefined,
      tag_ids: tagIds.length > 0 ? tagIds : undefined,
      bundle_id: bundleId || undefined,
      review_percentage: 5,
      schedule: {
        articles_per_day: data.articlesPerDay,
        preferred_days: data.preferredDays,
        preferred_time: "10:00",
      },
    },
    theme: {
      base: data.themePreset,
      colors: data.themeColors,
      logo_height: data.logoHeight ?? 52,
      // Omit logo_height_footer entirely when auto so saved YAML signals
      // "let CSS auto-derive (92% of header)".
      ...(data.logoHeightFooter != null ? { logo_height_footer: data.logoHeightFooter } : {}),
      fonts: {
        heading: data.fontHeading,
        body: data.fontBody,
      },
    } as Record<string, unknown>,
    layout: data.themeLayout,
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
    // Clean up uploaded logos: remove background + trim whitespace so the
    // logo fills its bounding box instead of being a tiny mark in a sea of white.
    try {
      logoBuffer = await removeBackground(Buffer.from(data.logoBase64, "base64"));
    } catch {
      logoBuffer = Buffer.from(data.logoBase64, "base64");
    }
  } else {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        logoBuffer = await generateLogoWithGemini(
          geminiKey,
          data.siteName,
          data.vertical,
          data.audiences.join(", ") || undefined,
          data.themeColors?.primary,
          data.themeColors,
        );
      } catch (err) {
        console.warn("[wizard] Logo generation failed, continuing without:", err);
      }
    }
  }

  if (data.faviconBase64) {
    faviconBuffer = Buffer.from(data.faviconBase64, "base64");
  } else if (logoBuffer) {
    // Auto-extract a square icon favicon from the landscape logo so the
    // browser tab shows a recognizable icon rather than the full logo+text
    // shrunk to 16x16.
    try {
      faviconBuffer = await extractFaviconFromLogo(logoBuffer);
    } catch (err) {
      console.warn("[wizard] Favicon extraction failed, falling back to logo:", err);
      faviconBuffer = logoBuffer;
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

  // Add separate footer logo if uploaded (light/dark variant for footer)
  if (data.footerLogoBase64) {
    let footerLogoBuffer: Buffer;
    try {
      footerLogoBuffer = await removeBackground(Buffer.from(data.footerLogoBase64, "base64"));
    } catch {
      footerLogoBuffer = Buffer.from(data.footerLogoBase64, "base64");
    }
    files.push({
      path: `sites/${siteFolder}/assets/logo-footer.png`,
      content: footerLogoBuffer,
    });
    siteConfig.theme.footer_logo = "/assets/logo-footer.png";
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

  // EC-6: Pre-check — if the branch already exists AND the dashboard-index
  // has this slug in a completed state, another site owns it.
  const branchAlreadyExists = await branchExists(stagingBranch);
  if (branchAlreadyExists) {
    const preIndex = await readDashboardIndex({ fresh: true });
    const clash = preIndex.sites.find((s) => s.domain === siteFolder);
    if (clash && clash.status !== "Staging") {
      throw new Error(
        `A site with slug "${projectName}" already exists (status: ${clash.status}). Choose a different slug.`,
      );
    }
    // Otherwise it's a partial failure retry — proceed (EC-1).
  }

  // EC-1: Idempotent branch creation — catch 422 "Reference already exists"
  // so a retry after partial failure doesn't crash.
  try {
    await createBranch(stagingBranch);
  } catch (e: unknown) {
    const status = (e as { status?: number }).status;
    if (status !== 422) throw e;
    // Branch already exists — commitSiteFiles will overwrite it.
  }

  // 7. Commit site files to the staging branch via the Git Data API.
  await commitSiteFiles(siteFolder, files, "create site", stagingBranch);

  // 7b. Generate default site image and upload to R2 (non-blocking).
  // Failure here is non-fatal — the site creates fine without it.
  const verticalName = data.vertical || data.topics[0] || "general";
  const imageResult = await generateAndUploadDefaultSiteImage(
    projectName,
    data.siteName,
    verticalName,
  );
  if (!imageResult.success) {
    console.warn(`[wizard] Default site image generation failed: ${imageResult.reason}`);
  }

  // 8. Fire sync-kv.yml. The Git Data API push above does NOT trigger
  // GitHub Actions; only a Contents-API push does. triggerWorkflowViaPush
  // writes a .build-trigger file via the Contents API to wake up sync-kv,
  // which then seeds CONFIG_KV_STAGING + R2 for the new site.
  // (workflow_dispatch would be cleaner but the token lacks actions:write.)
  //
  // EC-3: Retry once after a 2s delay if the trigger push fails (network
  // timeout, auth glitch). If still failing, log and continue — the preview
  // poll will time out with a helpful message.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await triggerWorkflowViaPush(stagingBranch, siteFolder);
      break;
    } catch (triggerErr) {
      if (attempt === 0) {
        console.warn("[wizard] CI trigger attempt 1 failed, retrying in 2s:", triggerErr);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        console.error("[wizard] CI trigger failed after 2 attempts:", triggerErr);
        // Non-fatal: sync-kv will run on the next push to the branch.
      }
    }
  }

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

  // EC-4: Retry index update once on failure. If still failing, surface a
  // specific message so the user knows files are deployed but the index
  // needs manual attention.
  for (let indexAttempt = 0; indexAttempt < 2; indexAttempt++) {
    try {
      const index = await readDashboardIndex({ fresh: true });
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
      break;
    } catch (indexErr) {
      if (indexAttempt === 0) {
        console.warn("[wizard] Index update attempt 1 failed, retrying:", indexErr);
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        throw new Error(
          "Site files deployed but dashboard index update failed. " +
          "The site will appear after a manual index update or retry.",
        );
      }
    }
  }

  revalidatePath("/");

  // 10. Return result
  return { stagingUrl: previewUrl, siteFolder };
}

/**
 * Check if an error is a GitHub 409 merge conflict.
 */
function isMergeConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: number }).status === 409
  );
}

/** Binary file extensions that must be read as base64, not UTF-8. */
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".zip",
]);

function isBinaryFile(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Read a file from the network repo, preserving binary content.
 * Text files are read as UTF-8 strings; binary files as Buffers.
 */
async function readFilePreservingBinary(
  path: string,
  branch: string,
): Promise<{ path: string; content: string | Buffer } | null> {
  if (isBinaryFile(path)) {
    const base64 = await readFileBase64(path, branch);
    if (base64 === null) return null;
    return { path, content: Buffer.from(base64, "base64") };
  }
  const text = await readFileContent(path, branch);
  if (text === null) return null;
  return { path, content: text };
}

/**
 * Merge staging to main, falling back to a direct file copy if there's
 * a merge conflict (409). In the conflict case, staging always wins —
 * the user explicitly edited these files.
 */
async function mergeOrCopySiteToMain(
  domain: string,
  stagingBranch: string,
  commitMessage: string,
): Promise<void> {
  try {
    await mergeBranchToMain(stagingBranch, commitMessage);
  } catch (err: unknown) {
    if (!isMergeConflictError(err)) throw err;

    // Conflict: read all site files from staging and commit to main directly
    const siteFiles: Array<{ path: string; content: string | Buffer }> = [];
    const topLevel = await listNetworkDirectory(`sites/${domain}`, stagingBranch);

    for (const entry of topLevel) {
      if (entry.type === "file") {
        const file = await readFilePreservingBinary(entry.path, stagingBranch);
        if (file) siteFiles.push(file);
      } else if (entry.type === "dir") {
        const children = await listNetworkDirectory(entry.path, stagingBranch);
        for (const child of children) {
          if (child.type === "file") {
            const file = await readFilePreservingBinary(child.path, stagingBranch);
            if (file) siteFiles.push(file);
          }
        }
      }
    }

    if (siteFiles.length === 0) {
      throw new Error(`No site files found on ${stagingBranch} for ${domain}`);
    }

    await commitNetworkFiles(
      siteFiles,
      `${commitMessage} (conflict resolved)`,
      "main",
    );
  }
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

  // 3. Merge staging branch to main (with conflict fallback)
  await mergeOrCopySiteToMain(domain, stagingBranch, `site(${domain}): go live`);

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

  // Merge staging → main with conflict fallback (triggers production deploy via GitHub Actions)
  await mergeOrCopySiteToMain(
    domain,
    stagingBranch,
    `site(${domain}): publish staging edits to production`,
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
  const [assetsZones, dev1Zones, index] = await Promise.all([
    listZones(),
    listZones("financenewsbase"), // any Dev1 domain triggers Dev1 creds
    readDashboardIndex(),
  ]);

  const usedCustomDomains = new Set(
    index.sites.map((s) => s.custom_domain).filter((d): d is string => Boolean(d)),
  );

  // Merge and dedupe by zone name
  const seen = new Set<string>();
  const allZones = [...assetsZones, ...dev1Zones].filter((z) => {
    if (seen.has(z.name)) return false;
    seen.add(z.name);
    return true;
  });

  return allZones
    .filter((z) => z.status === "active" && !usedCustomDomains.has(z.name))
    .map((z) => ({ domain: z.name, zoneId: z.id }));
}

/** Copy all KV entries for a site from staging to production KV.
 *  This includes site-config, article-index, individual articles, shared pages,
 *  and sync-status. The hostname entry (site:<hostname>) is NOT included — that's
 *  handled separately by attachCustomDomain. */
async function promoteSiteToProduction(siteId: string): Promise<number> {
  // Known single-key entries for this site
  const singleKeys = [
    `site-config:${siteId}`,
    `article-index:${siteId}`,
    `sync-status:${siteId}`,
  ];

  // Prefix-based entries (articles + shared pages)
  const kv = getKvNamespaces(siteId);
  const [articleKeys, sharedPageKeys] = await Promise.all([
    listKVKeys(kv.staging, `article:${siteId}:`, siteId),
    listKVKeys(kv.staging, `shared-page:${siteId}:`, siteId),
  ]);

  const allKeys = [...singleKeys, ...articleKeys, ...sharedPageKeys];

  // Read all values from staging KV in parallel (batched to avoid overwhelming the API)
  const BATCH_SIZE = 20;
  const entries: Array<{ key: string; value: string }> = [];

  for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
    const batch = allKeys.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (key) => {
        const value = await getKVEntry(kv.staging, key, siteId);
        return value ? { key, value } : null;
      }),
    );
    for (const r of results) {
      if (r) entries.push(r);
    }
  }

  if (entries.length === 0) {
    console.warn(`[promoteSiteToProduction] No KV entries found for siteId="${siteId}" in staging`);
    return 0;
  }

  // Bulk write to production KV
  await bulkPutKV(kv.prod, entries, siteId);
  console.log(`[promoteSiteToProduction] Copied ${entries.length} KV entries from staging to production for siteId="${siteId}"`);
  return entries.length;
}

/**
 * Patch config.domain in both KV namespaces and site.yaml so canonical URLs,
 * og:url, and Meta verification use the real custom domain instead of the
 * siteId folder name. Best-effort — failures are logged, not thrown.
 */
async function patchSiteConfigDomain(siteId: string, customDomain: string): Promise<void> {
  const configKey = `site-config:${siteId}`;

  // Patch KV in both namespaces
  const kv = getKvNamespaces(siteId);
  for (const ns of [kv.prod, kv.staging]) {
    try {
      const raw = await getKVEntry(ns, configKey, siteId);
      if (!raw) continue;
      const config = JSON.parse(raw) as Record<string, unknown>;
      config.domain = customDomain;
      await putKVEntry(ns, configKey, JSON.stringify(config), siteId);
    } catch (err) {
      console.warn(`[patchSiteConfigDomain] Failed to patch KV (${ns})`, err);
    }
  }

  // Update site.yaml on the staging branch so next seed-kv picks up the
  // correct domain. Reads the current file, updates the domain field, commits.
  const stagingBranch = `staging/${siteId}`;
  try {
    const siteConfig = await readSiteConfigFromGit(siteId, stagingBranch);
    if (siteConfig) {
      siteConfig.domain = customDomain;
      await commitSiteFiles(
        siteId,
        [{ path: `sites/${siteId}/site.yaml`, content: stringifyYaml(siteConfig) }],
        `dashboard: update domain to ${customDomain}`,
        stagingBranch,
      );
    }
  } catch (err) {
    console.warn('[patchSiteConfigDomain] Failed to update site.yaml', err);
  }
}

export async function attachCustomDomain(
  domain: string,
  customDomain: string,
  zoneId: string,
): Promise<{ success: true }> {
  // --- Step 1: Write to dashboard-index ---
  // EC-7: Read fresh (bypass 30s TTL cache) to minimise the race window
  // where two users attach the same custom domain concurrently.
  const index = await readDashboardIndex({ fresh: true });
  const site = index.sites.find((s) => s.domain === domain);
  if (!site) throw new Error(`Site ${domain} not found in dashboard index`);

  // EC-7: Check if another site already claims this custom domain.
  const domainClash = index.sites.find(
    (s) => s.domain !== domain && s.custom_domain === customDomain,
  );
  if (domainClash) {
    throw new Error(
      `Custom domain "${customDomain}" is already attached to site "${domainClash.domain}".`,
    );
  }

  // Dupe-merge: absorb zone_id from a placeholder entry matching the custom domain name.
  // If rollback is needed later, the spliced-out dupe is NOT restored — it will be
  // recreated on the next syncDomainsFromCloudflare() run.
  let resolvedZoneId = zoneId;
  const dupeIndex = index.sites.findIndex((s) => s.domain === customDomain);
  if (dupeIndex !== -1) {
    const dupe = index.sites[dupeIndex]!;
    if (dupe.zone_id && !resolvedZoneId) resolvedZoneId = dupe.zone_id;
    index.sites.splice(dupeIndex, 1);
  }

  const previousCustomDomain = site.custom_domain;
  const previousStatus = site.status;
  const previousZoneId = site.zone_id;
  const previousPendingDns = site.worker_pending_dns;

  site.custom_domain = customDomain;
  site.zone_id = resolvedZoneId;
  site.status = 'Live';
  site.worker_pending_dns = false;
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: attach ${customDomain} to ${domain}`,
  );

  // --- Step 2: Register custom domain on CF worker ---
  // For WordPress migration domains that already have DNS records (A/CNAME),
  // CF Custom Domain registration fails with "externally managed DNS records".
  // This is expected — those domains use Routes (not Custom Domains) to reach
  // the manager worker. Skip registration and continue with KV seeding.
  try {
    await registerWorkerCustomDomain(customDomain, resolvedZoneId, domain);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isExternalDns = message.includes('externally managed DNS');
    if (isExternalDns) {
      console.warn(
        `[attachCustomDomain] Skipping CF Custom Domain registration for ${customDomain} — ` +
        `domain has existing DNS records (WordPress migration). Traffic must reach the manager via Routes.`,
      );
    } else {
      // Unexpected error — roll back index write
      console.error('[attachCustomDomain] CF registration failed, rolling back index', err);
      site.custom_domain = previousCustomDomain;
      site.status = previousStatus;
      site.zone_id = previousZoneId;
      site.worker_pending_dns = previousPendingDns;
      site.last_updated = new Date().toISOString();
      await writeDashboardIndex(
        index,
        `dashboard: rollback attach ${customDomain} from ${domain}`,
      );
      throw new Error(
        `Failed to register ${customDomain} on Cloudflare: ${message}`,
      );
    }
  }

  // --- Step 3: Seed KV hostname entry ---
  // key: site:<customDomain> → value: { siteId: domain }
  // domain is the dashboard-index domain field (site identifier, e.g. "coolnews-atl")
  //
  // EC-5: If KV seed fails, roll back CF registration + index so the domain
  // doesn't route to the Worker while KV has no site:<hostname> entry (→ 404).
  try {
    await putKVEntry(
      getKvNamespaces(domain).prod,
      `site:${customDomain.toLowerCase()}`,
      JSON.stringify({ siteId: domain }),
      domain,
    );
  } catch (kvErr) {
    console.error('[attachCustomDomain] KV seed failed, rolling back CF + index', kvErr);

    // Best-effort CF deregistration
    try {
      await deregisterWorkerCustomDomain(customDomain, domain);
    } catch (cfErr) {
      console.error(
        '[attachCustomDomain] CF deregistration also failed — may need manual cleanup in Cloudflare dashboard',
        cfErr,
      );
    }

    // Revert index
    site.custom_domain = previousCustomDomain;
    site.status = previousStatus;
    site.zone_id = previousZoneId;
    site.worker_pending_dns = previousPendingDns;
    site.last_updated = new Date().toISOString();
    await writeDashboardIndex(
      index,
      `dashboard: rollback attach ${customDomain} from ${domain} (KV seed failed)`,
    );

    throw new Error(
      `KV seed failed for ${customDomain}. CF registration and index have been rolled back. ` +
      `Custom domain may need manual cleanup in Cloudflare dashboard.`,
    );
  }

  // --- Step 4: Promote site data from staging KV to production KV ---
  // Copies site-config, article-index, individual articles, shared pages, and
  // sync-status so the production worker can serve the site immediately.
  // Best-effort — the domain is already working for the hostname entry; a failed
  // promotion just means the config/articles aren't in prod KV yet (fixable by
  // re-running seed-kv manually).
  try {
    const count = await promoteSiteToProduction(domain);
    console.log(`[attachCustomDomain] Promoted ${count} KV entries to production for ${domain}`);
  } catch (err) {
    console.error('[attachCustomDomain] KV promotion failed (site hostname is registered but config may be missing in prod KV)', err);
  }

  // --- Step 4b: Patch config.domain to the real custom domain ---
  // site.yaml stores domain as the siteId (e.g. "financenewsbase") but canonical
  // URLs, og:url, and Meta verification need the real domain ("financenewsbase.com").
  // Patch KV in both namespaces + update site.yaml on the staging branch.
  try {
    await patchSiteConfigDomain(domain, customDomain);
    console.log(`[attachCustomDomain] Patched config.domain to "${customDomain}" in KV + site.yaml`);
  } catch (err) {
    console.error('[attachCustomDomain] config.domain patch failed (canonical URLs may use siteId instead of domain)', err);
  }

  // --- Step 5: Best-effort email routing ---
  if (site.zone_id) {
    try {
      await enableEmailRouting(site.zone_id, domain);
      await createEmailRoutingRule(site.zone_id, customDomain);
    } catch (err) {
      console.error('[attachCustomDomain] email routing setup failed', err);
    }
  }

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { success: true };
}

export async function detachCustomDomain(
  domain: string,
): Promise<{ success: true }> {
  // --- Step 1: Read current state ---
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  if (!site?.custom_domain) {
    throw new Error(`No custom domain to detach for ${domain}`);
  }
  const removedDomain = site.custom_domain;

  // --- Step 2: Write index FIRST (critical ordering) ---
  // If CF/KV cleanup fails later, the index is already correct.
  // Orphaned CF route + KV entry are harmless and self-healing.
  site.custom_domain = null;
  site.status = 'Ready';
  site.worker_pending_dns = true;
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: detach ${removedDomain} from ${domain}`,
  );

  // --- Step 3: Deregister from CF worker (best-effort) ---
  try {
    await deregisterWorkerCustomDomain(removedDomain, domain);
  } catch (err) {
    console.warn('[detachCustomDomain] CF deregistration failed (will self-heal on next deploy)', err);
  }

  // --- Step 4: Delete KV hostname entry (best-effort) ---
  try {
    await deleteKVEntry(
      getKvNamespaces(domain).prod,
      `site:${removedDomain.toLowerCase()}`,
      domain,
    );
  } catch (err) {
    console.warn('[detachCustomDomain] KV delete failed (stale entry is harmless)', err);
  }

  // --- Step 5: Revert config.domain back to siteId (best-effort) ---
  try {
    await patchSiteConfigDomain(domain, domain);
    console.log(`[detachCustomDomain] Reverted config.domain to "${domain}" in KV + site.yaml`);
  } catch (err) {
    console.warn('[detachCustomDomain] config.domain revert failed', err);
  }

  revalidatePath('/');
  revalidatePath(`/sites/${domain}`);

  return { success: true };
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
  author?: string;
  audiences?: string[];
  /** Content Aggregator audience type IDs. */
  audienceIds?: string[];
  tone: string;
  topics: string[];
  contentGuidelines: string;
  imageGuidelines: string;
  articlesPerDay: number;
  preferredDays: string[];
  themeBase: string;
  logoBase64: string | null;
  // Niche targeting fields
  /** Content Aggregator vertical ID. */
  verticalId?: string;
  /** Display name of the vertical. */
  vertical?: string;
  /** Content Aggregator category IDs. */
  categoryIds?: string[];
  /** Content Aggregator tag IDs. */
  tagIds?: string[];
  /** SEO keywords focus list. */
  seoKeywords?: string[];
  /** Content bundle ID. */
  bundleId?: string;
  // Phase 1 config fields
  groups?: string[];
  tracking?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  scripts_vars?: Record<string, string>;
  ads_config?: Record<string, unknown>;
  quality_threshold?: number;
  quality_weights?: Record<string, number>;
  // Layout v2 theme fields
  theme_colors?: Record<string, string>;
  theme_fonts?: { heading: string; body: string };
  theme_logo_height?: number;
  /** `null` clears the field (auto-derive). `undefined` leaves it untouched. */
  theme_logo_height_footer?: number | null;
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
    author: (config.author as string) ?? "",
    audiences: (brief?.audiences as string[] | undefined) ?? (brief?.audience ? [brief.audience as string] : []),
    tone: (brief?.tone as string) ?? "",
    topics: (brief?.topics as string[]) ?? [],
    contentGuidelines: Array.isArray(brief?.content_guidelines)
      ? (brief.content_guidelines as string[]).join("\n")
      : (brief?.content_guidelines as string) ?? "",
    imageGuidelines: Array.isArray(brief?.image_guidelines)
      ? (brief.image_guidelines as string[]).join("\n")
      : (brief?.image_guidelines as string) ?? "",
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
  if (updates.imageGuidelines !== undefined) {
    brief.image_guidelines = updates.imageGuidelines
      ? updates.imageGuidelines.split("\n").filter(Boolean)
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

/**
 * Generate a logo preview (returns base64 PNGs, does NOT commit).
 *
 * Returns `{ logo, footerLogo }`. `footerLogo` is non-null ONLY when the footer
 * background contrast category differs from the header (one dark + one light) —
 * in that case the same header logo would be invisible on the footer, so a
 * second variant is generated. When both backgrounds share the same lightness
 * category, `footerLogo` is null and the caller should leave `footer_logo`
 * unset (falls back to the main logo).
 */
export async function generateLogoPreview(
  domain: string,
  options: { generateFooterVariant?: boolean } = {},
): Promise<{ logo: string | null; footerLogo: string | null }> {
  const { generateFooterVariant = true } = options;
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

  const theme = config?.theme as Record<string, unknown> | undefined;
  const colors = theme?.colors as Record<string, string> | undefined;
  const headerBg = colors?.primary ?? "#1a1a2e";
  const footerBg = colors?.footer_bg;

  const mainBuf = await generateLogoWithGemini(geminiKey, siteName, vertical, audience, headerBg, colors);
  const logo = mainBuf?.toString("base64") ?? null;

  // Footer variant is a RECOLOR of the main logo (image-to-image), not a fresh
  // generation — independent generations would produce a different mascot /
  // composition for the same site. The recolor preserves design and only
  // inverts colors for the opposite-contrast background.
  let footerLogo: string | null = null;
  if (generateFooterVariant && mainBuf && footerBg && isDarkColor(headerBg) !== isDarkColor(footerBg)) {
    const footerBuf = await recolorLogoForBackground(geminiKey, mainBuf, footerBg);
    footerLogo = footerBuf?.toString("base64") ?? null;
  }

  return { logo, footerLogo };
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
    // EC-9: removeBackground can throw on malformed images — use original
    // image as fallback so the deploy doesn't fail over a cosmetic issue.
    let processed: Buffer;
    try {
      processed = await removeBackground(raw);
    } catch (bgErr) {
      console.warn("[wizard] removeBackground failed, using original image:", bgErr);
      processed = raw;
    }
    files.push({
      path: `sites/${domain}/assets/logo.png`,
      content: processed,
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
  // EC-9: Use original image if removeBackground throws.
  let logoBuffer: Buffer;
  try {
    logoBuffer = await removeBackground(raw);
  } catch (bgErr) {
    console.warn("[wizard] removeBackground failed, using original image:", bgErr);
    logoBuffer = raw;
  }

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

const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

/** Simple luminance check — returns true if the hex color is dark. */
function isDarkColor(hex: string): boolean {
  const c = hex.replace("#", "");
  if (c.length < 6) return true;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Relative luminance (ITU-R BT.709)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

async function generateLogoWithGemini(
  apiKey: string,
  siteName: string,
  vertical: string,
  audience?: string,
  headerBg?: string,
  colors?: Record<string, string>,
): Promise<Buffer | null> {
  const headerHex = headerBg ?? "#1a1a2e";
  const dark = isDarkColor(headerHex);

  // Palette is filtered by lightness so dark hex values can't bleed into a light-version
  // logo (and vice versa). The previous palette line was the main cause of contrast failures.
  const paletteEntries = Object.entries(colors ?? {}).filter(([, v]) => typeof v === "string" && v.startsWith("#"));
  const filteredPalette = paletteEntries.filter(([, hex]) => isDarkColor(hex) !== dark);
  const paletteLine = filteredPalette.length > 0
    ? `\n• BRAND PALETTE (reference values for the designer — these codes must NEVER appear as text in the rendered image): inspired by ${filteredPalette.map(([k, v]) => `${k} ${v}`).join(", ")}. Use complementary ${dark ? "light" : "dark"} neutrals where helpful.`
    : "";

  const contrastDirective = dark
    ? `BACKGROUND & CONTRAST (MOST IMPORTANT — overrides any palette suggestion below):
The logo CANVAS is a solid ${headerHex} background (DARK). Design the logo as it will actually appear on the live website header. Every visible element — icon fills, icon outlines, brand text — MUST be LIGHT colors: pure WHITE, off-white, cream, pale pastels, or BRIGHT/VIBRANT saturated colors. Do NOT use black, dark grey, navy, dark brown, or any dark hex — those would be invisible.`
    : `BACKGROUND & CONTRAST (MOST IMPORTANT — overrides any palette suggestion below):
The logo CANVAS is a solid ${headerHex} background (LIGHT). Design the logo as it will actually appear on the live website header. Every visible element — icon fills, icon outlines, brand text — MUST be DARK colors: deep black, charcoal, navy, dark brown, or rich saturated colors. Do NOT use white, off-white, cream, or pale pastels — those would be invisible.`;

  const prompt = `${contrastDirective}

Create a polished, professional, horizontal BRAND LOGO for "${siteName}", a website about ${vertical}${audience ? ` targeting ${audience}` : ""}.

LAYOUT & STRUCTURE:
• COMPOSITION: One clear icon on the left, with the text "${siteName}" on the right.
• BALANCE: The icon and text should be vertically centered and horizontally aligned.
• ASPECT RATIO: Wide horizontal format (suitable for a website navigation bar).

VISUAL STYLE:
• ICON: A single, bold, recognizable symbol or stylized mascot representing ${vertical}. Crafted illustration with personality — confident outlines, soft internal shading, and a subtle sense of depth (think a modern brand mascot, NOT a flat two-tone icon).
• TYPOGRAPHY: Bold, modern, clean sans-serif. The text must read exactly "${siteName}".
• ART STYLE: Premium vector-illustration with subtle gradients, soft highlights, and shading WITHIN shapes for depth and richness. NOT photorealistic, NOT 3D-rendered, NOT a generic flat icon.
• COLORS: 2-4 ${dark ? "light/bright" : "dark/saturated"} brand colors with subtle shading variations.${paletteLine}

CRITICAL CONSTRAINTS:
• BACKGROUND: Solid uniform ${headerHex} background, edge to edge. No textures, patterns, gradients, or drop shadows. (This solid background will be stripped to transparency in post-processing — only the logo elements should remain.)
• TEXT IN IMAGE: The ONLY text rendered in the image is exactly "${siteName}". Do NOT render any hex codes, color codes, numbers, palette labels, version tags, or watermarks anywhere in the image.
• CONTRAST CHECK: ${dark ? "Re-verify before finalizing — every logo element must be clearly visible against a dark background." : "Re-verify before finalizing — every logo element must be clearly visible against a light background."}
• CLARITY: Perfect spelling of "${siteName}".
• PADDING: Leave a small amount of breathing room/padding around the edges.`;

  try {
    // EC-8: 15s timeout prevents the entire action from hanging if Gemini
    // is slow or unresponsive. On timeout, the catch block returns null
    // (non-fatal — site works fine without a logo).
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(20_000),
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
    // EC-9: Use original image if removeBackground throws.
    try {
      return await removeBackground(raw);
    } catch (bgErr) {
      console.warn("[wizard] removeBackground failed, using original image:", bgErr);
      return raw;
    }
  } catch (err) {
    console.warn("[wizard] Logo generation error:", err);
    return null;
  }
}

/**
 * Image-to-image recolor: pass an existing logo as input and ask Gemini to
 * produce an identical design with inverted colors for the opposite-contrast
 * background. Used to generate the footer-variant logo when header and footer
 * backgrounds invert (e.g. light header + dark footer). The source image is
 * already a transparent-background PNG produced by `generateLogoWithGemini`.
 */
async function recolorLogoForBackground(
  apiKey: string,
  sourceLogo: Buffer,
  targetBg: string,
): Promise<Buffer | null> {
  const dark = isDarkColor(targetBg);

  const prompt = `Recolor this exact logo so it is clearly visible on a solid ${targetBg} background (${dark ? "DARK" : "LIGHT"}).

CRITICAL — keep the design 100% IDENTICAL to the source image:
• Same icon, mascot, or character — same pose, same details.
• Same composition, layout, and proportions.
• Same typography and exact same brand-name spelling.
• Same level of detail and line weight.
The ONLY thing changing is the COLOR of the elements.

COLOR INVERSION:
${dark
  ? "• Every currently-dark element (black outlines, dark fills, dark text) → swap to LIGHT equivalents: white, off-white, cream, or bright tints of the source color.\n• Keep colorful brand elements but lighten their tone if needed for visibility on the dark background."
  : "• Every currently-light element (white outlines, light fills, light text) → swap to DARK equivalents: black, charcoal, or rich saturated shades of the source color.\n• Keep colorful brand elements but darken their tone if needed for visibility on the light background."}

CANVAS:
• Render on a solid uniform ${targetBg} background, edge to edge. No textures, gradients, patterns, or drop shadows. (This solid background will be stripped to transparency in post-processing.)

TEXT IN IMAGE:
• The ONLY text rendered is exactly the same brand name as the source image. Do NOT add or change any text. No hex codes, color codes, numbers, palette labels, or watermarks.`;

  try {
    const url = `${GEMINI_API_BASE}/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType: "image/png", data: sourceLogo.toString("base64") } },
            { text: prompt },
          ],
        }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      console.warn(`[wizard] Logo recolor failed: ${response.status}`);
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

    const imagePart = data.candidates?.[0]?.content.parts.find((p) => p.inlineData);
    if (!imagePart?.inlineData) {
      console.warn("[wizard] No image in Gemini recolor response");
      return null;
    }

    const raw = Buffer.from(imagePart.inlineData.data, "base64");
    try {
      return await removeBackground(raw);
    } catch (bgErr) {
      console.warn("[wizard] removeBackground failed on recolor, using original:", bgErr);
      return raw;
    }
  } catch (err) {
    console.warn("[wizard] Logo recolor error:", err);
    return null;
  }
}
