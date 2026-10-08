"use server";

import { stringify as stringifyYaml } from "yaml";
import { getDashboardIndex as readDashboardIndex } from "@/lib/db/dashboard-index";
import { getSiteConfig as readSiteConfigFromGit } from "@/lib/db/site-configs";
import {
  commitSiteFiles,
  writeDashboardIndex,
  updateSiteInIndex,
  addSitesToIndex,
  createBranch,
  getBranchHeadSha,
  resetBranchToMainIfUnchanged,
  branchExists,
  triggerWorkflowViaPush,
  readFileBase64,
  readFileContent,
  commitNetworkFiles,
  copySiteTreeToMain,
} from "@/lib/github";
import {
  listZones,
  registerWorkerCustomDomain,
  deregisterWorkerCustomDomain,
  deleteConflictingDnsRecords,
  putKVEntry,
  deleteKVEntry,
  getKVEntry,
  listKVKeys,
  bulkPutKV,
  bulkDeleteKV,
  deleteR2Objects,
} from "@/lib/cloudflare";
import { workerPreviewUrl, getKvNamespaces, R2_BUCKET_PROD } from "@/lib/constants";
import type { WizardFormData, DashboardSiteEntry, TopicV2 } from "@/types/dashboard";
import { requestTopicsFromGemini, type TopicSuggestionContext } from "@/lib/topic-suggestions";
import { revalidatePath } from "next/cache";
import { removeBackground } from "@/lib/remove-background";
import { extractFaviconFromLogo } from "@/lib/favicon-extractor";
import {
  enableEmailRouting,
  createEmailRoutingRule,
} from "@/lib/email-routing";
import { generateAuthorName } from "@/lib/author-names";
import { buildLogoPrompt, isDarkColor } from "@/lib/logo-prompt";
import { editOpenAIImage, generateOpenAIImage } from "@/lib/openai-image";
import { logoMedianContrast, MIN_LOGO_CONTRAST } from "@/lib/logo-contrast";
import sharp from "sharp";
import { versionedAsset } from "@/lib/versioned-asset";
import { logoBackgroundFor } from "@/lib/logo-background";
import { generateAndUploadDefaultSiteImage } from "@/lib/general-image";
import { uploadToR2 } from "@/lib/r2-upload";
import { fetchBlacklistedDomains } from "@/lib/domains-dashboard";
import { upsertSiteConfig } from "@/lib/db/site-configs";
import { upsertDashboardIndexEntry, updateDashboardIndexEntry } from "@/lib/db/dashboard-index";
import { deleteArticlesMeta } from "@/lib/db/articles";
import {
  buildWizardSiteSections,
  wizardDataForTemplate,
  wizardDisplayVertical,
} from "@/lib/wizard-site-sections";

interface StagingResult {
  stagingUrl: string;
  /** The network-repo folder name and dashboard-index `domain` for the new site. */
  siteFolder: string;
}

/** Create site files in a staging branch and trigger sync-kv to seed
 *  CONFIG_KV_STAGING + R2 for the multi-tenant site-worker. */
export async function createSiteAndBuildStaging(
  formData: WizardFormData
): Promise<StagingResult> {
  // G5: a Grid site never generates articles — clear every content-agent
  // field (topics, tone, audiences, schedule, …) so nothing left over from
  // an earlier pass through the Modern steps reaches site.yaml, skill.md,
  // the logo prompt or the default-image vertical. Modern data passes
  // through unchanged (same object).
  const data = wizardDataForTemplate(formData);
  const projectName = data.pagesProjectName;

  // The site folder in the network repo uses the project name as identifier.
  // sync-kv.yml iterates sites/*/ on commits to staging/** and main, and
  // writes CONFIG_KV under `site:<folder-name>` so the worker middleware
  // can resolve the right config when the hostname matches.
  const siteFolder = projectName;

  // 0. Per-topic model — the wizard writes brief.topics_v2 directly.
  // No bundle is created from the wizard anymore; topics carry raw filters.
  // Display-only category label for the dashboard Sites grid and the brief:
  // explicit `data.vertical` → first topic_v2 name → first plain topic →
  // undefined. Organization/sort only; aggregator filtering lives in topics_v2.
  const displayVertical = wizardDisplayVertical(data);
  // brief / theme (+ grid for Grid sites) — see lib/wizard-site-sections.ts.
  const sections = buildWizardSiteSections(data);

  // 1. Build site.yaml content. `domain` is the site folder identifier
  // used by sync-kv.yml + middleware (CONFIG_KV key `site:<domain>`).
  const siteConfig = {
    domain: projectName,
    site_name: data.siteName,
    site_tagline: data.siteTagline || null,
    author: generateAuthorName(),
    groups: data.groups.length > 0 ? data.groups : [],
    active: true,
    iab_vertical_code: data.iabVerticalCode || undefined,
    scripts_vars: Object.keys(data.scriptsVars).length > 0 ? data.scriptsVars : undefined,
    brief: sections.brief,
    theme: sections.theme,
    layout: data.themeLayout,
    // Grid only: top-level feed settings (omitted entirely for Modern).
    ...(sections.grid ? { grid: sections.grid } : {}),
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
    if (process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) {
      try {
        const { header: headerBg } = logoBackgroundFor(data.template, data.themeColors);
        const generated = await generateLogo(
          data.siteName,
          data.vertical,
          data.audiences.join(", ") || undefined,
          headerBg,
          data.themeColors,
          { tagline: data.siteTagline, topics: data.topics, tone: data.tone },
        );
        // One logo call only: site creation runs in a single request under the gateway's ~60 s limit.
        // The favicon is cropped from the logo below; "Generate with AI" on the site makes a full one.
        logoBuffer = generated?.png ?? null;
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

  // Logos/favicons are R2-native: upload bytes directly to R2 (binary-safe),
  // never commit them to git. The Worker serves them at
  // /<siteId>/assets/<file> straight from R2. theme.* config refs still point
  // at /assets/<file> (seed-kv rewrites them to the per-site R2 path).
  if (logoBuffer) {
    await uploadToR2(`${siteFolder}/assets/logo.png`, logoBuffer, "image/png");
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
    await uploadToR2(`${siteFolder}/assets/logo-footer.png`, footerLogoBuffer, "image/png");
    siteConfig.theme.footer_logo = "/assets/logo-footer.png";
  }

  // Add separate favicon if uploaded
  if (faviconBuffer) {
    await uploadToR2(`${siteFolder}/assets/favicon.png`, faviconBuffer, "image/png");
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

  // 8. Make sure sync-kv runs for the brand-new site. The commit above already
  // fires it; this explicit trigger is a deliberate safety net on the one-time
  // creation path (the preview poll depends on it). Elsewhere, don't add one
  // after a commit — see triggerWorkflowViaPush.
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
    company: data.company || null,
    vertical: displayVertical ?? "",
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
  let wasExistingEntry = false;
  for (let indexAttempt = 0; indexAttempt < 2; indexAttempt++) {
    try {
      const index = await readDashboardIndex({ fresh: true });
      const existing = index.sites.find((s) => s.domain === siteFolder);
      if (existing) {
        wasExistingEntry = true;
        await updateSiteInIndex(siteFolder, {
          status: "Staging",
          company: data.company || null,
          vertical: displayVertical,
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

  // Dual-write: mirror site config + dashboard index entry to MongoDB (soft-fail).
  // On a wizard re-run of an existing site, mirror ONLY the fields the git
  // path updated — upserting the freshly-built siteEntry would clobber
  // preserved fields in Mongo (custom_domain, site_id, created_at, …).
  await upsertSiteConfig(siteFolder, siteConfig as unknown as Record<string, unknown>);
  if (wasExistingEntry) {
    await upsertDashboardIndexEntry(siteFolder, {
      status: "Staging",
      company: data.company || null,
      vertical: displayVertical ?? "",
      staging_branch: stagingBranch,
      preview_url: previewUrl,
      last_updated: now,
    });
  } else {
    await upsertDashboardIndexEntry(siteFolder, siteEntry as unknown as Record<string, unknown>);
  }

  revalidatePath("/");

  // 10. Return result
  return { stagingUrl: previewUrl, siteFolder };
}

/**
 * Publish a single site's files from staging to main.
 *
 * Instead of merging the entire staging branch (which drags in stale
 * copies of OTHER sites' files), we copy only sites/{domain}/ from
 * the staging branch's tree to main using blob SHA references.
 */
/** Returns the slugs of articles that were deleted on staging (and now removed from main). */
async function mergeOrCopySiteToMain(
  domain: string,
  stagingBranch: string,
  commitMessage: string,
): Promise<string[]> {
  // Uses the Git Tree API: one recursive tree fetch to get all blob SHAs,
  // then creates a new commit on main referencing those SHAs directly.
  // This is O(1) reads instead of O(N) per-file reads, avoiding gateway
  // timeouts on sites with 100+ articles.
  return copySiteTreeToMain(domain, stagingBranch, commitMessage);
}

const PUBLISH_ATTEMPTS = 3;

/**
 * Copy staging → main, then point staging at main — without losing commits that land on staging
 * meanwhile (n8n hero-image callbacks keep arriving after generation). If staging moved during the
 * copy, copy again; if it keeps moving, leave it as is (its extra commits go out with the next
 * publish). Returns every deleted article slug seen across attempts, for the production cleanup.
 */
async function publishSiteToMain(domain: string, stagingBranch: string, commitMessage: string): Promise<string[]> {
  const deleted = new Set<string>();
  for (let attempt = 1; attempt <= PUBLISH_ATTEMPTS; attempt++) {
    const stagingSha = await getBranchHeadSha(stagingBranch);
    for (const slug of await mergeOrCopySiteToMain(domain, stagingBranch, commitMessage)) deleted.add(slug);
    if (await resetBranchToMainIfUnchanged(stagingBranch, stagingSha)) return [...deleted];
    console.warn(`[wizard] ${stagingBranch} changed during publish (attempt ${attempt}) — copying again`);
  }
  console.warn(`[wizard] ${stagingBranch} kept changing during publish — left as is; nothing lost, the next publish includes the rest`);
  return [...deleted];
}

/** Best-effort cleanup of deleted articles after publishing to production.
 *  Order: prod KV → MongoDB → R2 images (R2 last so the live site never
 *  shows broken images if an earlier step fails). */
async function cleanupDeletedArticles(
  domain: string,
  deletedSlugs: string[],
  stagingBranch?: string,
): Promise<void> {
  if (deletedSlugs.length === 0) return;

  console.log(
    `[wizard] Cleaning up ${deletedSlugs.length} deleted articles for ${domain}`,
  );

  // Step 4: Delete from production KV (article stops being served)
  let prodKvOk = true;
  try {
    const kv = getKvNamespaces(domain);
    const kvKeys = deletedSlugs.map((slug) => `article:${domain}:${slug}`);
    await bulkDeleteKV(kv.prod, kvKeys, domain);
  } catch (err) {
    prodKvOk = false;
    console.warn(
      `[wizard] Failed to delete prod KV entries for ${domain}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // If prod KV deletion failed the articles are still being served —
  // skip MongoDB + R2 to avoid broken images on the live site.
  if (!prodKvOk) return;

  // Step 5: Delete from MongoDB — both main and staging branch records (soft-fail)
  await deleteArticlesMeta(domain, deletedSlugs, "main");
  if (stagingBranch) {
    await deleteArticlesMeta(domain, deletedSlugs, stagingBranch);
  }

  // Step 6: Delete R2 images last
  try {
    const keys = deletedSlugs.map((s) => `${domain}/assets/images/${s}.webp`);
    await deleteR2Objects(R2_BUCKET_PROD, keys, domain);
  } catch (err) {
    console.warn(
      `[wizard] Failed to delete R2 images for ${domain}:`,
      err instanceof Error ? err.message : err,
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

  // 3. Copy staging to main and point staging at main (kept for future edits) — safely:
  // commits that land on staging mid-publish are never wiped.
  const deletedSlugs = await publishSiteToMain(domain, stagingBranch, `site(${domain}): go live`);

  // 3b. Clean up any articles that were deleted on staging before go-live
  await cleanupDeletedArticles(domain, deletedSlugs, stagingBranch);

  // 5. Update index, KEEP staging_branch and preview_url. A site with a
  // custom domain attached is serving production traffic — publishing staged
  // edits must not demote it from Live back to Ready (that stranded sites on
  // "Ready" with no path back, since only attachCustomDomain sets Live).
  const postPublishStatus = site.custom_domain ? "Live" : "Ready";
  await updateSiteInIndex(domain, {
    status: postPublishStatus,
  });

  // Dual-write: mirror status to MongoDB (soft-fail)
  await updateDashboardIndexEntry(domain, { status: postPublishStatus });

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

  // Step 3: Copy staging → main (additions + deletions via tree copy), then point staging at main
  // (clean slate for the next edit cycle) — never wiping commits that land on staging mid-publish.
  const deletedSlugs = await publishSiteToMain(
    domain,
    stagingBranch,
    `site(${domain}): publish staging edits to production`,
  );

  // Steps 4-6: Clean up deleted articles (prod KV → MongoDB → R2 images)
  await cleanupDeletedArticles(domain, deletedSlugs, stagingBranch);

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

  // Dual-write: mirror staging branch info to MongoDB (soft-fail)
  await updateDashboardIndexEntry(domain, {
    staging_branch: stagingBranch,
    preview_url: workerPreviewUrl(domain),
  });

  revalidatePath(`/sites/${domain}`);
  return stagingBranch;
}

/** Fetch Cloudflare zones not already used as a site identifier or as
 *  another site's custom_domain, and not blacklisted. */
export async function getAvailableZones(): Promise<
  Array<{ domain: string; zoneId: string }>
> {
  const [assetsZones, dev1Zones, index, blacklisted] = await Promise.all([
    listZones(),
    listZones("financenewsbase"), // any Dev1 domain triggers Dev1 creds
    readDashboardIndex(),
    fetchBlacklistedDomains(),
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
    .filter(
      (z) =>
        z.status === "active" &&
        !usedCustomDomains.has(z.name) &&
        !blacklisted.has(z.name),
    )
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
      // Dual-write: without this the next save reads the stale Mongo doc and
      // reverts site.yaml to the TLD-less siteId (see CLAUDE.md, "Mongo
      // Dual-Write After Git Mutations").
      await upsertSiteConfig(siteId, siteConfig);
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

  // Revert git index AND the MongoDB mirror. The success path mirrors the
  // attach to Mongo before CF/KV work — a git-only rollback would leave the
  // UI permanently showing Live + an attached domain that never registered.
  const rollbackAttach = async (commitMessage: string): Promise<void> => {
    site.custom_domain = previousCustomDomain;
    site.status = previousStatus;
    site.zone_id = previousZoneId;
    site.worker_pending_dns = previousPendingDns;
    site.last_updated = new Date().toISOString();
    await writeDashboardIndex(index, commitMessage);
    await updateDashboardIndexEntry(domain, {
      custom_domain: previousCustomDomain ?? null,
      status: previousStatus,
      zone_id: previousZoneId ?? null,
      worker_pending_dns: previousPendingDns ?? null,
    });
  };

  site.custom_domain = customDomain;
  site.zone_id = resolvedZoneId;
  site.status = 'Live';
  site.worker_pending_dns = false;
  site.last_updated = new Date().toISOString();

  await writeDashboardIndex(
    index,
    `dashboard: attach ${customDomain} to ${domain}`,
  );

  // Dual-write: mirror domain attachment to MongoDB (soft-fail)
  await updateDashboardIndexEntry(domain, {
    custom_domain: customDomain,
    zone_id: resolvedZoneId,
    status: "Live",
    worker_pending_dns: false,
  });

  // --- Step 2: Register custom domain on CF worker ---
  // If the zone already has A/AAAA/CNAME records for the hostname,
  // CF Custom Domain registration fails with "externally managed DNS records".
  // Auto-delete conflicting records and retry once before giving up.
  try {
    await registerWorkerCustomDomain(customDomain, resolvedZoneId, domain);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isExternalDns = message.includes('externally managed DNS');
    if (isExternalDns) {
      // Attempt auto-cleanup: delete conflicting A/AAAA/CNAME records and retry
      console.warn(
        `[attachCustomDomain] CF Custom Domain registration failed for ${customDomain} — ` +
        `zone has conflicting DNS records. Attempting auto-cleanup and retry…`,
      );
      try {
        const deleted = await deleteConflictingDnsRecords(resolvedZoneId, customDomain, domain);
        console.log(
          `[attachCustomDomain] Deleted ${deleted} conflicting DNS record(s) for ${customDomain}`,
        );
        await registerWorkerCustomDomain(customDomain, resolvedZoneId, domain);
        console.log(
          `[attachCustomDomain] CF Custom Domain registration succeeded for ${customDomain} after DNS cleanup`,
        );
      } catch (retryErr) {
        // Cleanup or retry failed — roll back
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error('[attachCustomDomain] CF registration failed after DNS cleanup, rolling back index', retryErr);
        await rollbackAttach(`dashboard: rollback attach ${customDomain} from ${domain}`);
        throw new Error(
          `Failed to register ${customDomain} on Cloudflare after DNS cleanup: ${retryMsg}`,
        );
      }
    } else {
      // Unexpected error — roll back index write
      console.error('[attachCustomDomain] CF registration failed, rolling back index', err);
      await rollbackAttach(`dashboard: rollback attach ${customDomain} from ${domain}`);
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

    // Revert index (git + Mongo mirror)
    await rollbackAttach(
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

  // Dual-write: mirror domain detachment to MongoDB (soft-fail)
  await updateDashboardIndexEntry(domain, {
    custom_domain: null,
    status: "Ready",
    worker_pending_dns: true,
  });

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

  // Dual-write: mirror to MongoDB (soft-fail) — the UI reads the index from
  // Mongo under USE_MONGO_READS.
  await updateDashboardIndexEntry(domain, { saved_previews: previews });

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
  /** Content Aggregator bundle IDs subscribed by this site. */
  bundleIds?: string[];
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
  /** Navigation menu item font size in pixels. */
  theme_menu_item_font_size?: number;
  layout?: Record<string, unknown>;
  /** Grid template switch → site.yaml theme.template ("modern" removes the key). */
  theme_template?: "modern" | "grid";
  /** Grid card look → site.yaml theme.card. */
  theme_card?: import("@/types/grid").GridCardFields;
  /** Grid feed settings → site.yaml grid (replaced wholesale). */
  grid?: import("@/types/grid").GridFields;
  /** Free-text site theme (per-topic model — drives AI proposals). */
  theme?: string;
  /** Per-topic filters list. When provided on save, the site config is
   *  rewritten to the new per-topic shape and legacy bundle_ids/category_ids/
   *  tag_ids are stripped. */
  topics_v2?: TopicV2[];
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

  // The commit's push (sites/**) starts sync-kv on its own — no extra trigger commit.
  await commitSiteFiles(domain, files, "update site config", site.staging_branch);

  revalidatePath(`/sites/${domain}`);
}

interface LogoContext extends LogoCues {
  siteName: string;
  vertical: string;
  audience?: string;
  colors?: Record<string, string>;
  headerBg: string;
  footerBg?: string;
}

async function loadLogoContext(domain: string): Promise<LogoContext> {
  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === domain);
  const config = site?.staging_branch ? await readSiteConfigFromGit(domain, site.staging_branch) : null;
  const brief = config?.brief as Record<string, unknown> | undefined;
  const audiences = (brief?.audiences as string[] | undefined) ?? (brief?.audience ? [brief.audience as string] : []);
  const theme = config?.theme as Record<string, unknown> | undefined;
  const colors = theme?.colors as Record<string, string> | undefined;
  const { header, footer } = logoBackgroundFor(theme?.template === "grid" ? "grid" : "modern", colors);
  return {
    siteName: (config?.site_name as string) ?? domain,
    vertical: site?.vertical ?? "Other",
    audience: audiences.join(", ") || undefined,
    colors,
    headerBg: header,
    footerBg: footer,
    tagline: typeof config?.site_tagline === "string" ? config.site_tagline : null,
    topics: Array.isArray(brief?.topics) ? (brief.topics as unknown[]).filter((t): t is string => typeof t === "string") : [],
    tone: typeof brief?.tone === "string" ? brief.tone : null,
  };
}

/**
 * Generate a logo preview (base64 PNG, does NOT commit). One image call, so the request stays inside the
 * gateway's ~60 s. `lowContrast` tells the caller to ask once more with `retryForContrast` and keep the
 * clearer one; favicon + footer variant come from `generateLogoExtras` (see lib/logo-generation-flow.ts).
 */
export async function generateLogoPreview(
  domain: string,
  options: { retryForContrast?: boolean } = {},
): Promise<{ logo: string | null; model: string | null; contrast: number | null; lowContrast: boolean; footerNeeded: boolean }> {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) throw new Error("No image model configured (OPENAI_API_KEY or GEMINI_API_KEY)");
  const ctx = await loadLogoContext(domain);
  const generated = await generateLogo(ctx.siteName, ctx.vertical, ctx.audience, ctx.headerBg, ctx.colors, {
    ...options,
    tagline: ctx.tagline,
    topics: ctx.topics,
    tone: ctx.tone,
  });
  const footerNeeded = !!ctx.footerBg && isDarkColor(ctx.headerBg) !== isDarkColor(ctx.footerBg);
  if (!generated) return { logo: null, model: null, contrast: null, lowContrast: false, footerNeeded };
  return {
    footerNeeded,
    logo: generated.png.toString("base64"),
    model: generated.model,
    contrast: generated.contrast,
    lowContrast: generated.contrast !== null && generated.contrast < MIN_LOGO_CONTRAST,
  };
}

/**
 * Favicon (simplified mark) and, when header and footer backgrounds invert (one dark, one light), a footer
 * variant — both image-to-image edits of the chosen logo, so the mascot stays the same. Run in parallel.
 */
export async function generateLogoExtras(
  domain: string,
  logoBase64: string,
  options: { generateFooterVariant?: boolean } = {},
): Promise<{ favicon: string | null; footerLogo: string | null }> {
  const { generateFooterVariant = true } = options;
  const ctx = await loadLogoContext(domain);
  const logo = Buffer.from(logoBase64, "base64");
  const footerBg = ctx.footerBg;
  const wantFooter = generateFooterVariant && !!footerBg && isDarkColor(ctx.headerBg) !== isDarkColor(footerBg);
  const [footerBuf, faviconBuf] = await Promise.all([
    wantFooter && footerBg ? generateFooterLogo(logo, footerBg) : Promise.resolve(null),
    generateFavicon(logo),
  ]);
  return {
    favicon: faviconBuf?.toString("base64") ?? null,
    footerLogo: footerBuf?.toString("base64") ?? null,
  };
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

  // Logo: processed first, then saved under a content-hashed name (the R2 bucket is shared with
  // production — a fixed name would make this staging edit live immediately).
  let processedLogo: Buffer | null = null;
  if (logoBase64) {
    const raw = Buffer.from(logoBase64, "base64");
    try {
      processedLogo = await removeBackground(raw);
    } catch (bgErr) {
      console.warn("[wizard] removeBackground failed, using original image:", bgErr);
      processedLogo = raw;
    }
  }
  const logoAsset = processedLogo ? versionedAsset(domain, "logo", processedLogo) : null;
  if (logoAsset) {
    const theme = (existing.theme ?? {}) as Record<string, unknown>;
    const faviconWasLogo = typeof theme.favicon !== "string" || theme.favicon === theme.logo;
    theme.logo = logoAsset.path;
    if (faviconWasLogo) theme.favicon = logoAsset.path; // keep a separately uploaded favicon
    existing.theme = theme;
  }

  // Build the file list — single commit for everything
  const files: Array<{ path: string; content: string | Buffer }> = [
    {
      path: `sites/${domain}/site.yaml`,
      content: stringifyYaml(existing, { lineWidth: 0 }),
    },
  ];

  if (logoAsset && processedLogo) {
    // R2-native: upload logo bytes to R2, never commit to git.
    await uploadToR2(logoAsset.key, processedLogo, "image/png");
  }

  const commitMsg = logoBase64 && configUpdates
    ? "update site config and logo"
    : logoBase64
      ? "update logo"
      : "update site config";

  // files now only ever contains site.yaml (logo went to R2). Skip the commit
  // entirely if there's nothing textual to write.
  if (files.length > 0) {
    await commitSiteFiles(domain, files, commitMsg, site.staging_branch); // starts sync-kv itself
  }
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

  // R2-native, content-hashed name (shared bucket with production — never overwrite its file).
  const logoAsset = versionedAsset(domain, "logo", logoBuffer);
  await uploadToR2(logoAsset.key, logoBuffer, "image/png");

  // Read existing config to update theme references (committed to git).
  const config = await readSiteConfigFromGit(domain, site.staging_branch);

  if (config) {
    const theme = (config.theme ?? {}) as Record<string, unknown>;
    const faviconWasLogo = typeof theme.favicon !== "string" || theme.favicon === theme.logo;
    theme.logo = logoAsset.path;
    if (faviconWasLogo) theme.favicon = logoAsset.path;
    config.theme = theme;
    await commitSiteFiles(
      domain,
      [{ path: `sites/${domain}/site.yaml`, content: stringifyYaml(config, { lineWidth: 0 }) }],
      "upload custom logo",
      site.staging_branch,
    ); // starts sync-kv itself
  }

  revalidatePath(`/sites/${domain}`);
}

// ---------------------------------------------------------------------------
// Auto-suggest topics via Gemini (+ shared Gemini constants)
// ---------------------------------------------------------------------------

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Suggest 4 topics for a site from everything entered so far (Gemini Flash, lib/topic-suggestions.ts).
 * `avoid` = topics already suggested this session (+ the current ones): "Regenerate" must give new ones.
 * First suggestion with no AI answer → per-vertical defaults; a regenerate with no AI answer → [] so
 * the wizard can say so instead of showing the same defaults again.
 */
export async function suggestTopics(context: TopicSuggestionContext, avoid: string[] = []): Promise<string[]> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const fallback = (): string[] => (avoid.length > 0 ? [] : getFallbackTopics(context.siteName, context.vertical, context.theme));
  if (!geminiKey) {
    console.warn("[wizard:suggestTopics] no GEMINI_API_KEY — using fallback");
    return fallback();
  }
  try {
    const topics = await requestTopicsFromGemini(context, avoid, geminiKey);
    if (topics) return topics;
  } catch (err) {
    console.warn("[wizard:suggestTopics] error:", err);
  }
  return fallback();
}

/**
 * Smart fallback topics — uses vertical-specific defaults
 * but also incorporates the site name for "Other" vertical.
 */
function getFallbackTopics(siteName: string, vertical: string, theme?: string): string[] {
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

  // Match against theme + name keywords combined. Theme is the stronger signal
  // when present (the per-topic model's primary editorial input).
  const haystack = `${theme ?? ""} ${siteName}`.toLowerCase();

  // Theme-keyword routing first — broader coverage than name-only matching.
  if (/\balien|\bufo|\bconspirac|\bpyramid|\bunexplain|\bparanormal|\bsupernatur|\bmyster/.test(haystack)) {
    return ["Unexplained Events", "Ancient Mysteries", "Conspiracy Theories", "Strange Phenomena"];
  }
  if (/\bscience|\bspace|\bcosmos|\bphysics|\biolog|\bchemistry|\bresearch/.test(haystack)) {
    return ["New Discoveries", "Space & Cosmos", "Health Science", "Environment & Climate"];
  }
  if (/\btravel|\bdestination|\btourism|\bvacation/.test(haystack)) {
    return ["Destinations", "Travel Tips", "Local Culture", "Adventure Activities"];
  }
  if (/\bfood|\bwine|\beer|\bculinary|\brestaurant|\brecipe/.test(haystack)) {
    return ["Recipes & Cooking", "Restaurant Reviews", "Food Culture", "Drinks & Pairings"];
  }
  if (/\bpet|\bdog|\bcat|\banimal|\bwildlif/.test(haystack)) {
    return ["Pet Care & Health", "Animal Behavior", "Breed Guides", "Wildlife Stories"];
  }
  if (/\bmovie|\bfilm|\bcelebri|\bmusic|\bstream|\btv\b|\bentertain/.test(haystack)) {
    return ["Movie Reviews", "TV & Streaming", "Music Spotlight", "Celebrity Culture"];
  }
  if (/\bfunny|\bfail|\bviral|\bmeme|\bcompilation|\bblooper|\bprank/.test(haystack)) {
    return ["Funny Fails", "Viral Clips", "Compilations", "Pranks & Reactions"];
  }
  if (/\bvideo|\byoutube|\btiktok|\bshorts|\breels/.test(haystack)) {
    return ["Trending Clips", "Creator Spotlights", "Channel Picks", "Behind the Scenes"];
  }

  // Fall through to legacy site-name keyword routing
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

const OPENAI_LOGO_MODEL = "gpt-image-2.5-sunburst";

/** Optional personality cues for the logo prompt (each left out when missing). */
interface LogoCues {
  tagline?: string | null;
  topics?: string[];
  tone?: string | null;
}

interface GeneratedLogo {
  png: Buffer;
  /** Which image model made it — shown to the user and logged. */
  model: string;
  /** WCAG median contrast against the header (OpenAI logos only; null when not measured). */
  contrast: number | null;
}

/**
 * CloudGrid's nginx gateway cuts a request at ~60 s, so every logo server action stays well inside that:
 * one OpenAI call per step (each capped below), and a fallback only when there's still time for it.
 */
const OPENAI_LOGO_TIMEOUT_MS = 45_000;
const OPENAI_EDIT_TIMEOUT_MS = 50_000;
/** A fallback (Gemini, ~20 s) only starts when the first attempt failed this fast. */
const FALLBACK_BUDGET_MS = 25_000;

/** Trim/resize/compress an image; already-transparent images keep their pixels (see removeBackground). */
async function tidyLogo(png: Buffer): Promise<Buffer> {
  try {
    return await removeBackground(png);
  } catch {
    return png;
  }
}

async function openAILogo(openaiKey: string, prompt: string): Promise<Buffer | null> {
  const png = await generateOpenAIImage({
    apiKey: openaiKey,
    model: OPENAI_LOGO_MODEL,
    size: "1536x1024",
    background: "transparent",
    quality: "high",
    // ~30 s measured; capped so the request ends inside the gateway's ~60 s.
    timeoutMs: OPENAI_LOGO_TIMEOUT_MS,
    prompt,
  });
  return png ? tidyLogo(png) : null;
}

/**
 * Site logo: OpenAI gpt-image-2.5-sunburst (transparent PNG), else today's Gemini path. One OpenAI call;
 * the logo's contrast against the header is measured and returned so the caller can ask for a retry
 * (`retryForContrast` adds a "much stronger contrast" instruction) in a separate request.
 */
async function generateLogo(
  siteName: string,
  vertical: string,
  audience?: string,
  headerBg?: string,
  colors?: Record<string, string>,
  options: { retryForContrast?: boolean } & LogoCues = {},
): Promise<GeneratedLogo | null> {
  const cues: LogoCues = { tagline: options.tagline, topics: options.topics, tone: options.tone };
  const started = Date.now();
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const header = headerBg ?? "#1a1a2e";
    const base = buildLogoPrompt({ siteName, vertical, audience, headerBg, colors, transparentOutput: true, ...cues });
    const prompt = options.retryForContrast
      ? `${base}\n\nThe previous attempt was too faint on the ${header} header (its colours were too close in brightness). Use much stronger contrast this time.`
      : base;
    const png = await openAILogo(openaiKey, prompt);
    if (png) {
      const contrast = await logoMedianContrast(png, header).catch(() => null);
      console.log(`[wizard] logo by ${OPENAI_LOGO_MODEL} (contrast ${contrast?.toFixed(1) ?? "?"}:1 on ${header}${options.retryForContrast ? ", contrast retry" : ""})`);
      return { png, model: OPENAI_LOGO_MODEL, contrast };
    }
    if (Date.now() - started > FALLBACK_BUDGET_MS) {
      console.warn("[wizard] OpenAI logo failed too late for a Gemini fallback inside the gateway timeout");
      return null;
    }
    console.warn("[wizard] OpenAI logo failed — falling back to Gemini");
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;
  const png = await generateLogoWithGemini(geminiKey, siteName, vertical, audience, headerBg, colors, cues);
  if (png) console.log(`[wizard] logo by ${GEMINI_IMAGE_MODEL}`);
  return png ? { png, model: GEMINI_IMAGE_MODEL, contrast: null } : null;
}

/** Footer variant: the same logo recoloured for the opposite-contrast footer (OpenAI edit, else Gemini). */
async function generateFooterLogo(sourceLogo: Buffer, footerBg: string): Promise<Buffer | null> {
  const started = Date.now();
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const png = await editOpenAIImage({
      apiKey: openaiKey,
      model: OPENAI_LOGO_MODEL,
      image: sourceLogo,
      size: "1536x1024",
      background: "transparent",
      quality: "high",
      timeoutMs: OPENAI_EDIT_TIMEOUT_MS,
      prompt: footerRecolorPrompt(footerBg, true),
    });
    if (png) return tidyLogo(png);
    if (Date.now() - started > FALLBACK_BUDGET_MS) {
      console.warn("[wizard] OpenAI footer logo failed too late for a Gemini fallback");
      return null;
    }
    console.warn("[wizard] OpenAI footer logo failed — falling back to Gemini");
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  return geminiKey ? recolorLogoForBackground(geminiKey, sourceLogo, footerBg) : null;
}

/**
 * Favicon: an OpenAI edit of the logo into a simplified, bold square mark (no text) that reads at 16px.
 * Returns null when it can't be made — callers then crop the icon out of the logo (extractFaviconFromLogo).
 */
async function generateFavicon(sourceLogo: Buffer): Promise<Buffer | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;
  const png = await editOpenAIImage({
    apiKey: openaiKey,
    model: OPENAI_LOGO_MODEL,
    image: sourceLogo,
    size: "1024x1024",
    background: "transparent",
    quality: "high",
    timeoutMs: OPENAI_EDIT_TIMEOUT_MS,
    prompt: `Turn this logo into a website FAVICON (browser-tab icon).
• Keep ONLY the icon / mascot from the logo — remove all text and letters.
• SIMPLIFY it into a bold, flat mark: few shapes, thick strokes, no fine detail, so it stays recognisable at 16×16 pixels.
• Keep the same character/symbol and the logo's main colours; add a strong dark outline so it reads on both light and dark browser tabs.
• Fill most of the square canvas, centred, with only a little padding.
• Fully TRANSPARENT background. No glow, no drop shadow, no outer halo, no backdrop shape.`,
  });
  if (!png) return null;
  try {
    return await sharp(png)
      .trim()
      .resize(180, 180, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true, quality: 80 })
      .toBuffer();
  } catch {
    return png;
  }
}

async function generateLogoWithGemini(
  apiKey: string,
  siteName: string,
  vertical: string,
  audience?: string,
  headerBg?: string,
  colors?: Record<string, string>,
  cues: LogoCues = {},
): Promise<Buffer | null> {
  const prompt = buildLogoPrompt({ siteName, vertical, audience, headerBg, colors, transparentOutput: false, ...cues });

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

/** Recolour prompt for the footer variant; `transparentOutput` for OpenAI, solid canvas for Gemini. */
function footerRecolorPrompt(targetBg: string, transparentOutput: boolean): string {
  const dark = isDarkColor(targetBg);
  const canvas = transparentOutput
    ? `BACKGROUND:
• Fully TRANSPARENT background — the logo will sit on a solid ${targetBg} website footer. No glow, no drop shadow, no outer halo, no backdrop shape.`
    : `CANVAS:
• Render on a solid uniform ${targetBg} background, edge to edge. No textures, gradients, patterns, or drop shadows. (This solid background will be stripped to transparency in post-processing.)`;
  return `Recolor this exact logo so it is clearly visible on a solid ${targetBg} background (${dark ? "DARK" : "LIGHT"}).

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

${canvas}

TEXT IN IMAGE:
• The ONLY text rendered is exactly the same brand name as the source image. Do NOT add or change any text. No hex codes, color codes, numbers, palette labels, or watermarks.`;
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
  const prompt = footerRecolorPrompt(targetBg, false);

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
