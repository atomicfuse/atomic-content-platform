import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import {
  commitSiteFiles,
  invalidateSiteCaches,
  readDashboardIndex,
  readSiteConfig as readSiteConfigFromGit,
  triggerWorkflowViaPush,
  updateSiteInIndex,
} from "@/lib/github";
import { upsertDnsTxtRecord, deleteDnsTxtRecord } from "@/lib/cloudflare";
import type { StagingSiteConfig } from "@/actions/wizard";
import { extractFaviconFromLogo } from "@/lib/favicon-extractor";
import { removeBackground } from "@/lib/remove-background";
import { uploadToR2 } from "@/lib/r2-upload";

interface SaveRequestBody {
  domain: string;
  configUpdates: Partial<StagingSiteConfig> | null;
  logoBase64: string | null;
  /** Optional alternate footer logo. `null` removes the existing one, `undefined` leaves it untouched. */
  footerLogoBase64?: string | null;
  faviconBase64: string | null;
  /** When true, delete `theme.logo` and `theme.favicon` from site.yaml. Ignored if `logoBase64` is also set. */
  clearLogo?: boolean;
  /** When true, delete `theme.footer_logo` from site.yaml. Ignored if `footerLogoBase64` is also set. */
  clearFooterLogo?: boolean;
}

/**
 * Route Handler for saving staging edits.
 * Uses a plain HTTP response instead of RSC flight protocol,
 * avoiding the "Maximum array nesting exceeded" error that occurs
 * when Next.js bundles the full page RSC tree into server action responses.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: SaveRequestBody;
  try {
    body = (await req.json()) as SaveRequestBody;
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { domain, configUpdates, logoBase64, footerLogoBase64, faviconBase64, clearLogo, clearFooterLogo } = body;

  if (!domain) {
    return NextResponse.json(
      { status: "error", message: "domain is required" },
      { status: 400 }
    );
  }

  try {
    const index = await readDashboardIndex();
    const site = index.sites.find((s) => s.domain === domain);
    if (!site?.staging_branch) {
      return NextResponse.json(
        { status: "error", message: "No staging branch for this site" },
        { status: 400 }
      );
    }

    const existing = await readSiteConfigFromGit(domain, site.staging_branch);
    if (!existing) {
      return NextResponse.json(
        { status: "error", message: "Could not read site config from staging branch" },
        { status: 400 }
      );
    }

    // Apply config updates if provided
    if (configUpdates) {
      if (configUpdates.siteName !== undefined) existing.site_name = configUpdates.siteName;
      if (configUpdates.siteTagline !== undefined) existing.site_tagline = configUpdates.siteTagline || null;
      if (configUpdates.author !== undefined) {
        existing.author = configUpdates.author || undefined;
      }

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
      if (configUpdates.imageGuidelines !== undefined) {
        brief.image_guidelines = configUpdates.imageGuidelines
          ? configUpdates.imageGuidelines.split("\n").filter(Boolean)
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
      if (configUpdates.theme_colors !== undefined) {
        const theme = (existing.theme ?? {}) as Record<string, unknown>;
        theme.colors = configUpdates.theme_colors;
        existing.theme = theme;
      }
      if (configUpdates.theme_fonts !== undefined) {
        const theme = (existing.theme ?? {}) as Record<string, unknown>;
        theme.fonts = configUpdates.theme_fonts;
        existing.theme = theme;
      }
      if (configUpdates.theme_logo_height !== undefined) {
        const theme = (existing.theme ?? {}) as Record<string, unknown>;
        theme.logo_height = configUpdates.theme_logo_height;
        existing.theme = theme;
      }
      if (configUpdates.theme_logo_height_footer !== undefined) {
        const theme = (existing.theme ?? {}) as Record<string, unknown>;
        if (configUpdates.theme_logo_height_footer === null) {
          delete theme.logo_height_footer;
        } else {
          theme.logo_height_footer = configUpdates.theme_logo_height_footer;
        }
        existing.theme = theme;
      }
      if (configUpdates.layout !== undefined) {
        existing.layout = configUpdates.layout;
      }

      // Phase 1 config fields
      if (configUpdates.groups !== undefined) {
        existing.groups = configUpdates.groups;
      }
      if (configUpdates.tracking !== undefined) {
        const prev = (existing.tracking ?? {}) as Record<string, unknown>;
        existing.tracking = { ...prev, ...configUpdates.tracking };
      }
      if (configUpdates.scripts !== undefined) {
        // Only persist non-empty position arrays. Empty arrays mean "no
        // site-level override" and should not be written — they would
        // shadow inherited scripts from org/group/override layers during
        // the merge-by-id resolution in seed-kv.
        const scripts = configUpdates.scripts as Record<string, unknown[]>;
        const filtered: Record<string, unknown[]> = {};
        for (const [pos, entries] of Object.entries(scripts)) {
          if (Array.isArray(entries) && entries.length > 0) {
            filtered[pos] = entries;
          }
        }
        if (Object.keys(filtered).length > 0) {
          existing.scripts = filtered;
        } else {
          delete (existing as Record<string, unknown>).scripts;
        }
      }
      if (configUpdates.scripts_vars !== undefined) {
        const prev = (existing.scripts_vars ?? {}) as Record<string, string>;
        const merged = { ...prev, ...configUpdates.scripts_vars };
        // Don't persist an empty scripts_vars object — it adds noise to
        // site.yaml and shadows inherited vars from org/group layers.
        if (Object.keys(merged).length > 0) {
          existing.scripts_vars = merged;
        } else {
          delete (existing as Record<string, unknown>).scripts_vars;
        }
      }
      if (configUpdates.ads_config !== undefined) {
        const prev = (existing.ads_config ?? {}) as Record<string, unknown>;
        const merged = { ...prev, ...configUpdates.ads_config } as Record<string, unknown>;
        // Don't persist an empty ad_placements array — it shadows inherited
        // placements from org/group/override layers during deepMerge in
        // seed-kv. Same rationale as the scripts filter above.
        const placements = merged.ad_placements;
        if (Array.isArray(placements) && placements.length === 0) {
          delete merged.ad_placements;
        }
        // When interstitial is disabled (the normalizer default), strip it and
        // its config so the group/org inherited value flows through. A site-
        // level `interstitial: false` would shadow a group's `true`.
        if (!merged.interstitial) {
          delete merged.interstitial;
          delete merged.interstitial_config;
        }
        // If the remaining ads_config is empty or default-only (just
        // layout: "standard"), don't persist it at all.
        const remainingKeys = Object.keys(merged).filter(
          (k) => !(k === "layout" && merged[k] === "standard"),
        );
        if (remainingKeys.length > 0) {
          existing.ads_config = merged;
        } else {
          delete (existing as Record<string, unknown>).ads_config;
        }
      }
      // merge_modes is a feature-branch directive — the main-branch
      // seed-kv.ts ignores it. Don't persist until it ships on main.
      // if (configUpdates.merge_modes !== undefined) {
      //   existing.merge_modes = configUpdates.merge_modes;
      // }
      if (configUpdates.quality_threshold !== undefined) {
        brief.quality_threshold = configUpdates.quality_threshold;
      }
      if (configUpdates.quality_weights !== undefined) {
        brief.quality_weights = configUpdates.quality_weights;
      }

      // Niche targeting fields
      if (configUpdates.verticalId !== undefined) brief.vertical_id = configUpdates.verticalId;
      if (configUpdates.vertical !== undefined) brief.vertical = configUpdates.vertical;
      if (configUpdates.categoryIds !== undefined) brief.category_ids = configUpdates.categoryIds;
      if (configUpdates.tagIds !== undefined) brief.tag_ids = configUpdates.tagIds;
      if (configUpdates.seoKeywords !== undefined) brief.seo_keywords_focus = configUpdates.seoKeywords;
      if (configUpdates.bundleIds !== undefined) {
        const ids = configUpdates.bundleIds.filter((x): x is string => !!x);
        if (ids.length > 0) {
          brief.bundle_ids = ids;
        } else {
          delete (brief as Record<string, unknown>).bundle_ids;
        }
        // Strip legacy singular fields so saved yaml uses the new shape only.
        delete (existing as Record<string, unknown>).bundle_id;
        delete (brief as Record<string, unknown>).bundle_id;
      }

      // Per-topic-filter model. When topics_v2 is provided (non-empty array),
      // this site is on the new model — write `brief.theme` and `brief.topics_v2`
      // and strip every legacy niche-targeting field (bundle_ids, category_ids,
      // tag_ids, plus the singular legacy bundle_id at top level and brief level).
      if (configUpdates.topics_v2 !== undefined) {
        if (configUpdates.topics_v2.length > 0) {
          brief.topics_v2 = configUpdates.topics_v2;
          // Keep the legacy `topics` array in sync with topic names. The site
          // nav menu (Header.astro) and category-page routing read
          // `brief.topics`, so without this the live menu shows stale values
          // and per-topic add/remove/reorder never reaches the site.
          brief.topics = configUpdates.topics_v2.map((t) => t.name);
        } else {
          delete (brief as Record<string, unknown>).topics_v2;
        }
        // Legacy fields are out on per-topic sites.
        delete (brief as Record<string, unknown>).bundle_ids;
        delete (brief as Record<string, unknown>).bundle_id;
        delete (brief as Record<string, unknown>).category_ids;
        delete (brief as Record<string, unknown>).tag_ids;
        delete (existing as Record<string, unknown>).bundle_id;
      }

      if (configUpdates.theme !== undefined) {
        if (configUpdates.theme.trim().length > 0) {
          brief.theme = configUpdates.theme;
        } else {
          delete (brief as Record<string, unknown>).theme;
        }
      }
    }

    // Clean uploaded logos: remove background + trim whitespace so the logo
    // fills its bounding box (no tiny logo in a sea of white padding).
    let processedLogoBase64 = logoBase64;
    if (logoBase64) {
      try {
        const cleaned = await removeBackground(Buffer.from(logoBase64, "base64"));
        processedLogoBase64 = cleaned.toString("base64");
      } catch {
        // Keep the original if processing fails
      }
    }

    // Set theme references for logo/favicon
    // When a logo is provided without a separate favicon, auto-extract the
    // icon portion as a square favicon so the browser tab is recognizable.
    let effectiveFaviconBase64 = faviconBase64;
    if (processedLogoBase64 && !faviconBase64) {
      try {
        const extracted = await extractFaviconFromLogo(Buffer.from(processedLogoBase64, "base64"));
        effectiveFaviconBase64 = extracted.toString("base64");
      } catch {
        effectiveFaviconBase64 = processedLogoBase64;
      }
    }

    // Process footer logo if uploaded (light/dark variant)
    let processedFooterLogoBase64: string | null = footerLogoBase64 ?? null;
    if (processedFooterLogoBase64) {
      try {
        const cleaned = await removeBackground(Buffer.from(processedFooterLogoBase64, "base64"));
        processedFooterLogoBase64 = cleaned.toString("base64");
      } catch {
        // Keep the original if processing fails
      }
    }

    const shouldClearLogo = clearLogo && !processedLogoBase64;
    const shouldClearFooterLogo = (clearFooterLogo || footerLogoBase64 === null) && !processedFooterLogoBase64;

    if (
      processedLogoBase64
      || effectiveFaviconBase64
      || footerLogoBase64 !== undefined
      || shouldClearLogo
      || shouldClearFooterLogo
    ) {
      const theme = (existing.theme ?? {}) as Record<string, unknown>;
      if (processedLogoBase64) {
        theme.logo = "/assets/logo.png";
      } else if (shouldClearLogo) {
        delete theme.logo;
        delete theme.favicon;
      }
      if (effectiveFaviconBase64) {
        theme.favicon = "/assets/favicon.png";
      }
      if (shouldClearFooterLogo) {
        delete theme.footer_logo;
      } else if (processedFooterLogoBase64) {
        theme.footer_logo = "/assets/logo-footer.png";
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

    // Logos/favicons are R2-native: upload bytes directly to R2 (binary-safe),
    // never commit them to git. Only site.yaml (theme refs) goes to git below.
    if (processedLogoBase64) {
      await uploadToR2(`${domain}/assets/logo.png`, Buffer.from(processedLogoBase64, "base64"), "image/png");
    }
    if (processedFooterLogoBase64) {
      await uploadToR2(`${domain}/assets/logo-footer.png`, Buffer.from(processedFooterLogoBase64, "base64"), "image/png");
    }
    if (effectiveFaviconBase64) {
      await uploadToR2(`${domain}/assets/favicon.png`, Buffer.from(effectiveFaviconBase64, "base64"), "image/png");
    }

    const hasAssets = processedLogoBase64 || effectiveFaviconBase64;
    const assetLabel = processedLogoBase64 && effectiveFaviconBase64
      ? "logo and favicon"
      : processedLogoBase64
        ? "logo"
        : "favicon";
    const commitMsg = hasAssets && configUpdates
      ? `update site config and ${assetLabel}`
      : hasAssets
        ? `update ${assetLabel}`
        : "update site config";

    await commitSiteFiles(domain, files, commitMsg, site.staging_branch);
    await triggerWorkflowViaPush(site.staging_branch, domain);

    // Clear in-memory caches (tree, articles, site config) so the next read of
    // the site detail page reflects this save. siteConfigCache has an infinite
    // TTL, so without this the dashboard serves the pre-save config forever and
    // edits appear lost. See landmine #45.
    invalidateSiteCaches(domain, site.staging_branch);

    // Propagate vertical (category label) to dashboard-index so the Sites grid
    // reflects category changes immediately. Compare against `site.vertical`
    // (the value we read at the start) so we only write when it actually
    // changed.
    if (
      configUpdates?.vertical !== undefined &&
      configUpdates.vertical !== site.vertical
    ) {
      try {
        await updateSiteInIndex(domain, { vertical: configUpdates.vertical });
      } catch (err) {
        console.warn(
          `[sites/save] Failed to update dashboard-index.vertical for ${domain}:`,
          err instanceof Error ? err.message : err,
        );
        // Don't fail the save — site.yaml has the new vertical; the index can be
        // backfilled later.
      }
    }

    // Auto-upsert Facebook domain verification DNS TXT record when the
    // tracking field is set and the site has a Cloudflare zone.
    if (configUpdates?.tracking && site.zone_id) {
      const fbVerification = (configUpdates.tracking as Record<string, unknown>)
        .facebook_domain_verification as string | null | undefined;
      try {
        if (fbVerification) {
          await upsertDnsTxtRecord(
            site.zone_id,
            domain,
            `facebook-domain-verification=${fbVerification}`,
            domain,
          );
        } else if (fbVerification === null || fbVerification === "") {
          await deleteDnsTxtRecord(
            site.zone_id,
            domain,
            "facebook-domain-verification=",
            domain,
          );
        }
      } catch (err) {
        console.warn(
          `[sites/save] Failed to upsert Facebook DNS TXT for ${domain}:`,
          err instanceof Error ? err.message : err,
        );
        // Don't fail the save — DNS record can be added manually
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
