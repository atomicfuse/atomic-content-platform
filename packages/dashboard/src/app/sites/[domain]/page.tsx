import { notFound } from "next/navigation";
import { readDashboardIndex, readSiteConfig, readArticles } from "@/lib/github";
import { SiteDetailHeader } from "@/components/site-detail/SiteDetailHeader";
import { ContentTab } from "@/components/site-detail/ContentTab";
import { ContentAgentTab } from "@/components/site-detail/ContentAgentTab";
import { MonetizationTab } from "@/components/site-detail/MonetizationTab";
import { StagingTab } from "@/components/site-detail/StagingTab";
import { AttachDomainPanel } from "@/components/site-detail/AttachDomainPanel";
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
    tone: string;
    topics: string[];
    articles_per_week: number;
    preferred_days: string[];
    content_guidelines: string | string[];
    schedule?: {
      articles_per_week: number;
      preferred_days: string[];
    };
  } | null ?? null;

  // Normalize brief to include schedule fields at top level
  const normalizedBrief = brief
    ? {
        audience: brief.audience,
        tone: brief.tone,
        topics: brief.topics,
        articles_per_week:
          brief.schedule?.articles_per_week ?? brief.articles_per_week ?? 5,
        preferred_days:
          brief.schedule?.preferred_days ?? brief.preferred_days ?? [],
        content_guidelines: brief.content_guidelines,
      }
    : null;

  return (
    <div className="space-y-6">
      <SiteDetailHeader site={site} />
      <SiteDetailTabs
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
            />
          ) : null
        }
        contentTab={
          <ContentTab articles={articles} domain={decodedDomain} />
        }
        agentTab={
          <ContentAgentTab domain={decodedDomain} pagesProject={site.pages_project} stagingBranch={site.staging_branch} brief={normalizedBrief} />
        }
        monetizationTab={
          site.status === "Ready" || site.status === "Live"
            ? <MonetizationTab site={site} />
            : null
        }
      />
      {site.pages_project && (
        <AttachDomainPanel
          domain={decodedDomain}
          pagesProject={site.pages_project}
          customDomain={site.custom_domain}
        />
      )}
    </div>
  );
}
