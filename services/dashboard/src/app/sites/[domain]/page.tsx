import { notFound } from "next/navigation";
import { readDashboardIndex, readSiteConfig, readArticles } from "@/lib/github";
import { SiteDetailHeader } from "@/components/site-detail/SiteDetailHeader";
import { ContentTab } from "@/components/site-detail/ContentTab";
import { ContentAgentTab } from "@/components/site-detail/ContentAgentTab";
import { StagingTab } from "@/components/site-detail/StagingTab";
import { SiteDetailTabs } from "./SiteDetailTabs";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function SiteDetailPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { domain } = await params;
  const decodedDomain = decodeURIComponent(domain);

  const index = await readDashboardIndex();
  const site = index.sites.find((s) => s.domain === decodedDomain);
  if (!site) notFound();

  // Use staging branch for reads when site is in staging (files may not exist on main yet)
  const branch = site.staging_branch ?? undefined;

  const [siteConfig, articles] = await Promise.all([
    readSiteConfig(decodedDomain, branch),
    readArticles(decodedDomain, branch),
  ]);

  const brief = siteConfig?.brief as {
    audience: string;
    audiences?: string[];
    tone: string;
    topics: string[];
    articles_per_day?: number;
    articles_per_week?: number;
    preferred_days: string[];
    content_guidelines: string | string[];
    schedule?: {
      articles_per_day?: number;
      articles_per_week?: number;
      preferred_days: string[];
    };
    quality_threshold?: number;
    quality_weights?: {
      seo_quality?: number;
      tone_match?: number;
      content_length?: number;
      factual_accuracy?: number;
      keyword_relevance?: number;
    };
  } | null ?? null;

  // Normalize brief to include schedule fields at top level.
  // Dual-read: prefer articles_per_day; fall back to legacy articles_per_week.
  const normalizedBrief = brief
    ? {
        audience: brief.audiences?.join(", ") ?? brief.audience ?? "",
        tone: brief.tone,
        topics: brief.topics,
        articles_per_day:
          brief.schedule?.articles_per_day ?? brief.articles_per_day,
        articles_per_week:
          brief.schedule?.articles_per_week ?? brief.articles_per_week,
        preferred_days:
          brief.schedule?.preferred_days ?? brief.preferred_days ?? [],
        content_guidelines: brief.content_guidelines,
        quality_threshold: brief.quality_threshold,
        quality_weights: brief.quality_weights,
      }
    : null;

  return (
    <div className="space-y-6">
      <SiteDetailHeader site={site} />
      <SiteDetailTabs
        domain={decodedDomain}
        stagingTab={
          site.pages_project ? (
            <StagingTab
              domain={decodedDomain}
              pagesProject={site.pages_project}
              stagingBranch={site.staging_branch}
              previewUrl={site.preview_url}
              savedPreviews={site.saved_previews}
              siteStatus={site.status}
              customDomain={site.custom_domain}
              currentLogoPath={((siteConfig?.theme as Record<string, unknown> | undefined)?.logo as string) ?? null}
              currentFaviconPath={((siteConfig?.theme as Record<string, unknown> | undefined)?.favicon as string) ?? null}
            />
          ) : null
        }
        contentTab={
          <ContentTab
            articles={articles}
            domain={decodedDomain}
            stagingBranch={site.staging_branch}
            previewUrl={
              site.staging_branch && site.pages_project
                ? `https://${site.staging_branch.replace(/\//g, "-")}.${site.pages_project}.pages.dev`
                : site.preview_url ?? undefined
            }
          />
        }
        identityTab={
          <ContentAgentTab
            domain={decodedDomain}
            brief={normalizedBrief}
            siteConfig={siteConfig}
            stagingBranch={site.staging_branch}
            pagesProject={site.pages_project}
            customDomain={site.custom_domain}
          />
        }
      />
    </div>
  );
}
