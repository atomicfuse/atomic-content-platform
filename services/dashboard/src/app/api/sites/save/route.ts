import { NextRequest, NextResponse } from "next/server";
import { stringify as stringifyYaml } from "yaml";
import {
  commitSiteFiles,
  readDashboardIndex,
  readSiteConfig as readSiteConfigFromGit,
  triggerWorkflowViaPush,
} from "@/lib/github";
import type { StagingSiteConfig } from "@/actions/wizard";

interface SaveRequestBody {
  domain: string;
  configUpdates: Partial<StagingSiteConfig> | null;
  logoBase64: string | null;
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

  const { domain, configUpdates, logoBase64 } = body;

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

    return NextResponse.json({ status: "ok" });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
